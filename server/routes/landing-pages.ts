// Landing pages (Phase 5 · Marketing Automation) — admin CRUD for the public
// `/l/:slug` pages. Reads open; writes admin-only (org config like forms).
// The unauthenticated intake lives in server/routes/public-landing.ts. A page
// can be linked to a Campaign for attribution (leads tagged via custom).
// Flag: marketing.landing.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";

const router = Router();

const pageSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers and dashes"),
  headline: z.string().min(1).max(200),
  subtext: z.string().max(500).optional(),
  ctaLabel: z.string().max(60).optional(),
  successMessage: z.string().max(200).optional(),
  theme: z.enum(["indigo", "emerald", "rose", "amber", "slate"]).optional(),
  campaignId: z.string().optional(),
  fields: z.any().optional(),
  active: z.boolean().optional(),
});

const DEFAULT_FIELDS = ["firstName", "lastName", "email", "phone", "company"];

// GET /api/landing-pages
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().landingPage.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    ok(res, { items });
  })
);

// POST /api/landing-pages (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = pageSchema.parse(req.body);
    const slug = input.slug.trim().toLowerCase();
    // Globally unique slug — the public loader (/api/public/pages/:slug) is
    // org-blind, so a per-org check would let a second tenant shadow a page.
    const clash = await db().landingPage.findFirst({ where: { slug } });
    if (clash) throw badRequest(`A landing page with slug "${slug}" already exists`);
    const fields = normalizeFields(input.fields);
    const page = await db().landingPage.create({
      data: {
        orgId: user.orgId, environment, name: input.name.trim(), slug,
        headline: input.headline.trim(), subtext: input.subtext ?? null,
        ctaLabel: input.ctaLabel ?? "Submit", successMessage: input.successMessage ?? "Thanks — we'll be in touch soon.",
        theme: input.theme ?? "indigo", campaignId: input.campaignId ?? null, fields: fields as object,
        active: input.active ?? true,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "landing.created", entity: "landingPage", entityId: page.id, actorId: user.id, payload: { name: page.name, slug: page.slug } });
    ok(res, { page }, 201);
  })
);

// PATCH /api/landing-pages/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const page = await db().landingPage.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!page) throw notFound("Landing page not found");
    const input = pageSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.slug !== undefined) {
      const slug = input.slug.trim().toLowerCase();
      const clash = await db().landingPage.findFirst({ where: { slug, id: { not: page.id } } });
      if (clash) throw badRequest(`A landing page with slug "${slug}" already exists`);
      data.slug = slug;
    }
    if (input.headline !== undefined) data.headline = input.headline.trim();
    if (input.subtext !== undefined) data.subtext = input.subtext ?? null;
    if (input.ctaLabel !== undefined) data.ctaLabel = input.ctaLabel;
    if (input.successMessage !== undefined) data.successMessage = input.successMessage;
    if (input.theme !== undefined) data.theme = input.theme;
    if (input.campaignId !== undefined) data.campaignId = input.campaignId ?? null;
    if (input.fields !== undefined) data.fields = normalizeFields(input.fields) as object;
    if (input.active !== undefined) data.active = input.active;
    const updated = await db().landingPage.update({ where: { id: page.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "landing.updated", entity: "landingPage", entityId: page.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { page: updated });
  })
);

// DELETE /api/landing-pages/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const page = await db().landingPage.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!page) throw notFound("Landing page not found");
    await db().landingPage.delete({ where: { id: page.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "landing.deleted", entity: "landingPage", entityId: page.id, actorId: user.id, payload: { name: page.name } });
    ok(res, { ok: true });
  })
);

function normalizeFields(raw: unknown): { key: string; enabled: boolean }[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_FIELDS.map((key) => ({ key, enabled: true }));
  return DEFAULT_FIELDS.map((key) => {
    const row = raw.find((r: any) => r?.key === key);
    return { key, enabled: row ? row.enabled !== false : false };
  });
}

export default router;
