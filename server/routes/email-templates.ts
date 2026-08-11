// Email templates (Phase 2) — reusable subject/body pairs with {{variable}}
// merge fields. Reads are open to any authenticated user; writes are
// admin/manager (permissions mirror the other admin-only config surfaces but
// managers can draft templates too). See docs/14-communication-guide.md.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";

const router = Router();

const templateSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60).optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  active: z.boolean().optional(),
});

// GET /api/email-templates
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().emailTemplate.findMany({ where: { orgId: user.orgId, environment }, orderBy: { updatedAt: "desc" } });
    ok(res, { items });
  })
);

// POST /api/email-templates (admin + manager)
router.post(
  "/",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = templateSchema.parse(req.body);
    const template = await db().emailTemplate.create({
      data: { orgId: user.orgId, environment, name: input.name, category: input.category ?? "general", subject: input.subject, body: input.body, active: input.active ?? true, createdBy: user.id },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "template.created", entity: "emailTemplate", entityId: template.id, actorId: user.id, payload: { name: template.name, category: template.category } });
    ok(res, { template }, 201);
  })
);

// PATCH /api/email-templates/:id
router.patch(
  "/:id",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const existing = await db().emailTemplate.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!existing) throw notFound("Template not found");
    const input = templateSchema.partial().parse(req.body);
    const updated = await db().emailTemplate.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "template.updated", entity: "emailTemplate", entityId: updated.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { template: updated });
  })
);

// DELETE /api/email-templates/:id
router.delete(
  "/:id",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const existing = await db().emailTemplate.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!existing) throw notFound("Template not found");
    await db().emailTemplate.delete({ where: { id: existing.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "template.deleted", entity: "emailTemplate", entityId: existing.id, actorId: user.id, payload: { name: existing.name } });
    ok(res, { ok: true });
  })
);

export default router;
