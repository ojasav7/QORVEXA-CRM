// Campaigns (Phase 5 · Marketing Automation) — ADR-017. Config entities like
// segments/automations: reads open, writes admin-only. Sending resolves the
// audience segment and writes per-recipient Message + CampaignRecipient rows
// through the Phase-2 email path (tracking + events free). A/B subjects live
// in `ab`; the winner is declared by open rate (or forced). Flag:
// marketing.campaigns.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { sendCampaign, campaignStats, declareCampaignWinner, audienceFor } from "../lib/campaigns";

const router = Router();

// No z.default() — defaults applied explicitly in create (ADR engineering note).
const campaignSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  templateId: z.string().optional(),
  audienceSegmentId: z.string().optional(),
  ab: z.any().optional(),
  sendAt: z.string().datetime().optional(),
  status: z.enum(["draft", "active", "paused"]).optional(),
});

// GET /api/campaigns
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().campaign.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    const segmentIds = [...new Set(rows.map((r) => r.audienceSegmentId).filter(Boolean))] as string[];
    const segments = segmentIds.length ? await db().segment.findMany({ where: { id: { in: segmentIds } }, select: { id: true, name: true } }) : [];
    const segByName = new Map(segments.map((s) => [s.id, s.name]));
    const items = await Promise.all(
      rows.map(async (c) => {
        const stats = await campaignStats(user.orgId, environment, c.id);
        return {
          id: c.id, name: c.name, description: c.description, status: c.status, channel: c.channel,
          subject: c.subject, ab: c.ab, winner: c.winner, audienceSegmentId: c.audienceSegmentId,
          audienceName: c.audienceSegmentId ? segByName.get(c.audienceSegmentId) ?? null : null,
          sentCount: stats.sent, openedCount: stats.opened, clickedCount: stats.clicked,
          openRate: stats.openRate, roi: stats.roi, createdAt: c.createdAt, updatedAt: c.updatedAt,
        };
      })
    );
    ok(res, { items });
  })
);

// POST /api/campaigns (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = campaignSchema.parse(req.body);
    const ab = normalizeAb(input.ab);
    const campaign = await db().campaign.create({
      data: {
        orgId: user.orgId, environment, name: input.name, description: input.description ?? null,
        subject: input.subject, body: input.body, templateId: input.templateId ?? null,
        audienceSegmentId: input.audienceSegmentId ?? null, ab: ab as object,
        sendAt: input.sendAt ? new Date(input.sendAt) : null, status: input.status ?? "draft", createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "campaign.created", entity: "campaign", entityId: campaign.id, actorId: user.id, payload: { name: input.name } });
    ok(res, { campaign }, 201);
  })
);

// GET /api/campaigns/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const campaign = await db().campaign.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!campaign) throw notFound("Campaign not found");
    const stats = await campaignStats(user.orgId, environment, campaign.id);
    ok(res, { campaign, stats });
  })
);

// PATCH /api/campaigns/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const campaign = await db().campaign.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!campaign) throw notFound("Campaign not found");
    const input = campaignSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.subject !== undefined) data.subject = input.subject;
    if (input.body !== undefined) data.body = input.body;
    if (input.templateId !== undefined) data.templateId = input.templateId ?? null;
    if (input.audienceSegmentId !== undefined) data.audienceSegmentId = input.audienceSegmentId ?? null;
    if (input.ab !== undefined) data.ab = normalizeAb(input.ab) as object;
    if (input.sendAt !== undefined) data.sendAt = input.sendAt ? new Date(input.sendAt) : null;
    if (input.status !== undefined) data.status = input.status;
    const updated = await db().campaign.update({ where: { id: campaign.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "campaign.updated", entity: "campaign", entityId: campaign.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { campaign: updated });
  })
);

// DELETE /api/campaigns/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const campaign = await db().campaign.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!campaign) throw notFound("Campaign not found");
    await db().campaign.delete({ where: { id: campaign.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "campaign.deleted", entity: "campaign", entityId: campaign.id, actorId: user.id, payload: { name: campaign.name } });
    ok(res, { ok: true });
  })
);

// POST /api/campaigns/:id/send (admin) — send now to the segment audience.
router.post(
  "/:id/send",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const campaign = await db().campaign.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!campaign) throw notFound("Campaign not found");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await sendCampaign(campaign as any, { id: user.id, orgId: user.orgId, environment, email: user.email }, { force: body.force === true });
    ok(res, { ok: true, ...result }, 201);
  })
);

// POST /api/campaigns/:id/declare-winner (admin)
router.post(
  "/:id/declare-winner",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { variant } = z.object({ variant: z.enum(["A", "B"]) }).parse(req.body ?? {});
    const campaign = await declareCampaignWinner(user.orgId, environment, String(req.params.id), variant, user.id);
    ok(res, { campaign });
  })
);

// GET /api/campaigns/:id/recipients
router.get(
  "/:id/recipients",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const campaign = await db().campaign.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!campaign) throw notFound("Campaign not found");
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const [items, total] = await Promise.all([
      db().campaignRecipient.findMany({ where: { orgId: user.orgId, environment, campaignId: campaign.id }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().campaignRecipient.count({ where: { orgId: user.orgId, environment, campaignId: campaign.id } }),
    ]);
    const contactIds = [...new Set(items.map((r) => r.contactId).filter(Boolean))];
    const contacts = contactIds.length ? await db().contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const byId = new Map(contacts.map((c) => [c.id, c]));
    ok(res, {
      items: items.map((r) => ({
        id: r.id, contactId: r.contactId, variant: r.variant, status: r.status, openedAt: r.openedAt, clickedAt: r.clickedAt, createdAt: r.createdAt,
        contactName: byId.get(r.contactId) ? `${byId.get(r.contactId)!.firstName} ${byId.get(r.contactId)!.lastName}`.trim() : null,
        contactEmail: byId.get(r.contactId)?.email ?? null,
      })),
      total,
    });
  })
);

// GET /api/campaigns/:id/audience-preview — segment member count + names.
// Admin-only: it resolves the full org audience and exposes member PII, and
// the rep-scoped resolver would return an empty list anyway (ADR-017).
router.get(
  "/:id/audience-preview",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const campaign = await db().campaign.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!campaign) throw notFound("Campaign not found");
    const audience = await audienceFor(campaign as any, { orgId: user.orgId, environment, role: "admin", id: user.id });
    ok(res, { count: audience.length, contacts: audience.slice(0, 20).map((c: any) => ({ id: c.id, name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(), email: c.email })) });
  })
);

function normalizeAb(raw: unknown): { enabled: boolean; splitA: number; subjectB: string | null } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const enabled = Boolean(r.enabled);
  let splitA = typeof r.splitA === "number" ? r.splitA : Number(r.splitA ?? 50);
  if (!Number.isFinite(splitA) || splitA < 0 || splitA > 100) splitA = 50;
  const subjectB = typeof r.subjectB === "string" && r.subjectB.trim() ? r.subjectB.trim() : null;
  if (enabled && !subjectB) throw badRequest("A/B enabled needs a subjectB variant");
  return { enabled, splitA, subjectB };
}

export default router;
