// Journeys (Phase 5 · Marketing Automation) — the journey orchestration
// engine's admin surface. Reads open; writes admin-only (org config like
// automations). The engine (lib/journeys.ts) subscribes to the event bus and
// a ticker advances waiting enrollments; POST /advance runs a ticker pass
// manually (deterministic for tests). Flag: marketing.journeys.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { parseJourneyParts, runTickerPass, testJourney, JOURNEY_EVENT_TRIGGERS } from "../lib/journeys";

const router = Router();

const journeySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  trigger: z.any().optional(),
  steps: z.any().optional(),
  active: z.boolean().optional(),
});

// GET /api/journeys
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().journey.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    const segmentIds = [...new Set(rows.map((r) => (r.trigger as any)?.kind === "segment" ? (r.trigger as any).segmentId : null).filter(Boolean))];
    const segments = segmentIds.length ? await db().segment.findMany({ where: { id: { in: segmentIds } }, select: { id: true, name: true } }) : [];
    const segByName = new Map(segments.map((s) => [s.id, s.name]));
    ok(res, {
      items: rows.map((r) => ({
        id: r.id, name: r.name, description: r.description, trigger: r.trigger, steps: r.steps,
        active: r.active, enrolledCount: r.enrolledCount, createdAt: r.createdAt, updatedAt: r.updatedAt,
        triggerLabel: (r.trigger as any)?.kind === "segment" ? `Segment: ${segByName.get((r.trigger as any).segmentId) ?? "?"}` : (r.trigger as any)?.event ?? "?",
      })),
    });
  })
);

// POST /api/journeys (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = journeySchema.parse(req.body);
    const parts = parseJourneyParts({ trigger: input.trigger ?? {}, steps: input.steps ?? [] });
    const journey = await db().journey.create({
      data: {
        orgId: user.orgId, environment, name: input.name, description: input.description ?? null,
        trigger: parts.trigger as object, steps: parts.steps as object, active: input.active ?? true, createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "journey.created", entity: "journey", entityId: journey.id, actorId: user.id, payload: { name: input.name, trigger: parts.trigger } });
    ok(res, { journey }, 201);
  })
);

// GET /api/journeys/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const journey = await db().journey.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!journey) throw notFound("Journey not found");
    ok(res, { journey });
  })
);

// PATCH /api/journeys/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const journey = await db().journey.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!journey) throw notFound("Journey not found");
    const input = journeySchema.partial().parse(req.body);
    const nextTrigger = input.trigger !== undefined ? input.trigger : journey.trigger;
    const nextSteps = input.steps !== undefined ? input.steps : journey.steps;
    const parts = parseJourneyParts({ trigger: nextTrigger ?? {}, steps: nextSteps ?? [] });
    const updated = await db().journey.update({
      where: { id: journey.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.trigger !== undefined ? { trigger: parts.trigger as object } : {}),
        ...(input.steps !== undefined ? { steps: parts.steps as object } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "journey.updated", entity: "journey", entityId: journey.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { journey: updated });
  })
);

// DELETE /api/journeys/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const journey = await db().journey.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!journey) throw notFound("Journey not found");
    await db().journey.delete({ where: { id: journey.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "journey.deleted", entity: "journey", entityId: journey.id, actorId: user.id, payload: { name: journey.name } });
    ok(res, { ok: true });
  })
);

// GET /api/journeys/:id/enrollments
router.get(
  "/:id/enrollments",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const journey = await db().journey.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!journey) throw notFound("Journey not found");
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const [items, total] = await Promise.all([
      db().journeyEnrollment.findMany({ where: { orgId: user.orgId, environment, journeyId: journey.id }, orderBy: { enteredAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().journeyEnrollment.count({ where: { orgId: user.orgId, environment, journeyId: journey.id } }),
    ]);
    const entityIds = items.map((e) => e.entityId);
    const contacts = entityIds.length ? await db().contact.findMany({ where: { id: { in: entityIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const leads = entityIds.length ? await db().lead.findMany({ where: { id: { in: entityIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const byId = new Map([...contacts, ...leads].map((r) => [r.id, r]));
    ok(res, {
      items: items.map((e) => ({
        id: e.id, entity: e.entity, entityId: e.entityId, currentStep: e.currentStep, status: e.status,
        nextRunAt: e.nextRunAt, enteredAt: e.enteredAt, completedAt: e.completedAt,
        entityName: byId.get(e.entityId) ? `${byId.get(e.entityId)!.firstName ?? ""} ${byId.get(e.entityId)!.lastName ?? ""}`.trim() || null : null,
        entityEmail: byId.get(e.entityId)?.email ?? null,
      })),
      total,
    });
  })
);

// GET /api/journeys/:id/runs — the step-run log.
router.get(
  "/:id/runs",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const journey = await db().journey.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!journey) throw notFound("Journey not found");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const items = await db().journeyStepRun.findMany({ where: { orgId: user.orgId, environment, journeyId: journey.id }, orderBy: { createdAt: "desc" }, take: limit });
    ok(res, { items });
  })
);

// POST /api/journeys/:id/test (admin) — run synchronously against a contact.
router.post(
  "/:id/test",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const journey = await db().journey.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!journey) throw notFound("Journey not found");
    const { entityId } = z.object({ entityId: z.string().min(1) }).parse(req.body);
    const contact = await db().contact.findFirst({ where: { id: entityId, orgId: user.orgId, environment } });
    if (!contact) throw notFound("Contact not found");
    const outcome = await testJourney(journey as any, entityId, user.id);
    ok(res, { ok: true, ...outcome });
  })
);

// POST /api/journeys/advance (admin) — one manual ticker pass.
router.post(
  "/advance",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const advanced = await runTickerPass();
    ok(res, { ok: true, advanced });
  })
);

export default router;
