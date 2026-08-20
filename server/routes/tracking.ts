// Email tracking (Phase 2) — PUBLIC endpoints on purpose: the recipient is not
// logged in when they open an email or click a link. Security relies on an
// unguessable per-message token (24 random bytes). No org/user data is exposed
// in the response — only a 1×1 gif / a 302 redirect.
//   GET /api/t/px/<token>      → 1×1 transparent gif, marks opened
//   GET /api/t/click/<token>?u=… → 302 to u, marks clicked
// The open/click application lives in lib/integrations/email.ts so the Phase
// 16 provider webhooks (Resend/SendGrid events) share the exact same logic.
import { Router } from "express";
import { db } from "../db";
import { asyncHandler, ok } from "../lib/http";
import { markMessageOpened, markMessageClicked } from "../lib/integrations/email";

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
        await markMessageOpened(message);
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
        await markMessageClicked(message, url.toString());
      } catch (e) {
        console.error("[tracking click]", e);
      }
    })();
    res.redirect(302, url.toString());
  })
);

export default router;
