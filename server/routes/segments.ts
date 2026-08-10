// Segments (Phase 1) — dynamic lists. Reads are open to any authenticated user;
// create/update/delete are admin-only. Membership is computed on read against
// the segment's object type (org + environment + visibility scoped).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { listConditions } from "../lib/access";
import { parseCriteria, criteriaWhere, SEGMENT_OBJECT_TYPES } from "../lib/segments";
import { emitEvent } from "../lib/events";

const router = Router();

// No z.default() here — defaults would leak through .partial() on PATCH and
// silently wipe a segment's criteria/active. Applied explicitly in create.
const segmentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  objectType: z.enum(SEGMENT_OBJECT_TYPES as [string, ...string[]]),
  criteria: z.any().optional(),
  active: z.boolean().optional(),
});

// GET /api/segments — list the org's segments with live member counts
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().segment.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    const scope = listConditions({ ...user, environment }, "ownerId");
    const items = await Promise.all(
      rows.map(async (s) => {
        const criteria = parseCriteria(s.objectType, s.criteria);
        const count = await (db() as any)[s.objectType].count({ where: criteriaWhere(s.objectType, criteria, scope) });
        return { id: s.id, name: s.name, description: s.description, objectType: s.objectType, criteria: s.criteria, active: s.active, memberCount: count, createdAt: s.createdAt, updatedAt: s.updatedAt };
      })
    );
    ok(res, { items });
  })
);

// POST /api/segments (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = segmentSchema.parse(req.body);
    const criteria = parseCriteria(input.objectType, input.criteria ?? { filters: [] });
    const segment = await db().segment.create({
      data: { orgId: user.orgId, environment, name: input.name, description: input.description ?? null, objectType: input.objectType, criteria: criteria as object, active: input.active ?? true, createdBy: user.id },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "segment.created", entity: "segment", entityId: segment.id, actorId: user.id, payload: { objectType: input.objectType, name: input.name } });
    ok(res, { segment }, 201);
  })
);

// GET /api/segments/:id/members — compute the dynamic membership (paginated)
router.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const segment = await db().segment.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!segment) throw notFound("Segment not found");
    const criteria = parseCriteria(segment.objectType, segment.criteria);
    const scope = listConditions({ ...user, environment }, "ownerId");
    const where = criteriaWhere(segment.objectType, criteria, scope);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const delegate = (db() as any)[segment.objectType];
    const [items, total] = await Promise.all([
      delegate.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      delegate.count({ where }),
    ]);
    // Attach owner display names.
    const ownerIds = [...new Set<string>(items.map((r: any) => String(r.ownerId ?? r.authorId ?? "")))].filter(Boolean);
    const users = ownerIds.length ? await db().user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u.name]));
    for (const r of items) r.ownerName = byId.get(r.ownerId ?? r.authorId) ?? null;
    ok(res, { items, total, objectType: segment.objectType });
  })
);

// PATCH /api/segments/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const segment = await db().segment.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!segment) throw notFound("Segment not found");
    const input = segmentSchema.partial().parse(req.body);
    const objectType = input.objectType ?? segment.objectType;
    // Changing the object type without new criteria must still validate the
    // EXISTING filters against the new type — otherwise reads would 500 the
    // whole segment list. parseCriteria throws 400 on unknown fields.
    if (objectType !== segment.objectType && input.criteria === undefined) {
      parseCriteria(objectType, segment.criteria);
    }
    const criteria = input.criteria !== undefined ? parseCriteria(objectType, input.criteria) : undefined;
    const updated = await db().segment.update({
      where: { id: segment.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(objectType !== segment.objectType ? { objectType } : {}),
        ...(criteria ? { criteria: criteria as object } : {}),
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "segment.updated", entity: "segment", entityId: segment.id, actorId: user.id, payload: { objectType } });
    ok(res, { segment: updated });
  })
);

// DELETE /api/segments/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const segment = await db().segment.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!segment) throw notFound("Segment not found");
    await db().segment.delete({ where: { id: segment.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "segment.deleted", entity: "segment", entityId: segment.id, actorId: user.id, payload: { name: segment.name } });
    ok(res, { ok: true });
  })
);

export default router;
