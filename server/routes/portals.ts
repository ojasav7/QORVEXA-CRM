// Portal pages (Phase 4 · Customer Service) — admin CRUD for the public
// self-service portal config (PortalPage). The unauthenticated intake lives in
// server/routes/public-portal.ts. Writes are admin-only; reads open. Flag:
// service.tickets.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";

const router = Router();

const portalSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers and dashes"),
  description: z.string().max(500).optional(),
  autoCreateContact: z.boolean().optional(),
  active: z.boolean().optional(),
});

// GET /api/portals
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().portalPage.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    ok(res, { items });
  })
);

// POST /api/portals (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = portalSchema.parse(req.body);
    const slug = input.slug.trim().toLowerCase();
    // The public router looks a portal up by slug ONLY (no auth → no org
    // context), so slugs must be globally unique — a per-org check would let
    // two orgs share "support" and route submissions to an arbitrary one.
    const clash = await db().portalPage.findFirst({ where: { slug } });
    if (clash) throw badRequest(`A portal with slug "${slug}" already exists`);
    const portal = await db().portalPage.create({
      data: {
        orgId: user.orgId,
        environment,
        name: input.name.trim(),
        slug,
        description: input.description ?? null,
        autoCreateContact: input.autoCreateContact ?? true,
        active: input.active ?? true,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "portal.created", entity: "portalPage", entityId: portal.id, actorId: user.id, payload: { name: portal.name, slug: portal.slug } });
    ok(res, { portal }, 201);
  })
);

// PATCH /api/portals/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const portal = await db().portalPage.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!portal) throw notFound("Portal not found");
    const input = portalSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.slug !== undefined) {
      const slug = input.slug.trim().toLowerCase();
      // Global uniqueness (public lookups are slug-only — see the create check).
      const clash = await db().portalPage.findFirst({ where: { slug, id: { not: portal.id } } });
      if (clash) throw badRequest(`A portal with slug "${slug}" already exists`);
      data.slug = slug;
    }
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.autoCreateContact !== undefined) data.autoCreateContact = input.autoCreateContact;
    if (input.active !== undefined) data.active = input.active;
    const updated = await db().portalPage.update({ where: { id: portal.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "portal.updated", entity: "portalPage", entityId: portal.id, actorId: user.id, payload: { name: updated.name, slug: updated.slug } });
    ok(res, { portal: updated });
  })
);

// DELETE /api/portals/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const portal = await db().portalPage.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!portal) throw notFound("Portal not found");
    await db().portalPage.delete({ where: { id: portal.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "portal.deleted", entity: "portalPage", entityId: portal.id, actorId: user.id, payload: { name: portal.name } });
    ok(res, { ok: true });
  })
);

export default router;
