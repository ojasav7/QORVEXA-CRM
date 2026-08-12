// Email tracking (Phase 2) — PUBLIC endpoints on purpose: the recipient is not
// logged in when they open an email or click a link. Security relies on an
// unguessable per-message token (24 random bytes). No org/user data is exposed
// in the response — only a 1×1 gif / a 302 redirect.
//   GET /api/t/px/<token>      → 1×1 transparent gif, marks opened
//   GET /api/t/click/<token>?u=… → 302 to u, marks clicked
import { Router } from "express";
import { db } from "../db";
import { asyncHandler, ok } from "../lib/http";
import { emitEvent } from "../lib/events";

const router = Router();

const TRACKING_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

router.get(
  "/px/:token",
  asyncHandler(async (_req, res) => {
    // Fire-and-forget tracking write; the pixel must respond instantly even if
    // the DB is slow. The token lookup is cheap and idempotent.
    void (async () => {
      try {
        const token = String((_req.params as any).token);
        const message = await db().message.findFirst({ where: { trackingToken: token } });
        if (!message) return;
        const wasOpened = !!message.openedAt;
        await db().message.update({
          where: { id: message.id },
          data: { openedAt: message.openedAt ?? new Date(), openedCount: { increment: 1 }, status: message.status === "replied" ? "replied" : "opened", updatedAt: new Date() },
        });
        if (!wasOpened) {
          await rollupCampaignRecipient(message, "opened");
          await emitEvent({
            orgId: message.orgId,
            environment: message.environment,
            type: "email.opened",
            entity: "message",
            entityId: message.id,
            actorId: message.ownerId,
            payload: { to: message.toEmail, subject: message.subject, contactId: message.contactId ?? null, campaignId: message.campaignId ?? null },
          });
        }
      } catch (e) {
        console.error("[tracking px]", e);
      }
    })();
    res.setHeader("content-type", "image/gif");
    res.setHeader("cache-control", "no-store, max-age=0");
    res.send(TRACKING_GIF);
  })
);

// Validate the redirect target before 302-ing — never open-redirect to
// javascript:/data: or other schemes.
router.get(
  "/click/:token",
  asyncHandler(async (req, res) => {
    const token = String(req.params.token);
    const target = String(req.query.u ?? "");
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return ok(res, { error: "invalid link" }, 400);
    }
    if (!/^https?:$/.test(url.protocol)) return ok(res, { error: "invalid link" }, 400);

    void (async () => {
      try {
        const message = await db().message.findFirst({ where: { trackingToken: token } });
        if (!message) return;
        const wasClicked = !!message.clickedAt;
        await db().message.update({
          where: { id: message.id },
          data: { clickedAt: message.clickedAt ?? new Date(), status: message.status === "replied" ? "replied" : "clicked", updatedAt: new Date() },
        });
        if (!wasClicked) {
          await rollupCampaignRecipient(message, "clicked");
          await emitEvent({
            orgId: message.orgId,
            environment: message.environment,
            type: "email.clicked",
            entity: "message",
            entityId: message.id,
            actorId: message.ownerId,
            payload: { to: message.toEmail, subject: message.subject, url: url.toString(), contactId: message.contactId ?? null, campaignId: message.campaignId ?? null },
          });
        }
      } catch (e) {
        console.error("[tracking click]", e);
      }
    })();
    res.redirect(302, url.toString());
  })
);

/**
 * Roll a tracking event up into the campaign's recipient + count rows (Phase
 * 5). Fire-and-forget — tracking must never block the pixel/redirect. Only
 * the FIRST open/click counts (wasOpened/wasClicked guards in the callers).
 */
async function rollupCampaignRecipient(message: any, kind: "opened" | "clicked") {
  try {
    if (!message.campaignId) return;
    const now = new Date();
    await db().campaignRecipient.updateMany({
      where: { messageId: message.id, campaignId: message.campaignId },
      data: kind === "opened" ? { status: "opened", openedAt: now } : { status: "clicked", clickedAt: now },
    });
    const field = kind === "opened" ? "openedCount" : "clickedCount";
    await db().campaign.update({ where: { id: message.campaignId }, data: { [field]: { increment: 1 }, updatedAt: now } });
  } catch (e) {
    console.error("[tracking campaign rollup]", e);
  }
}

export default router;
