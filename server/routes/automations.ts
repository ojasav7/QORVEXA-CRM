// Automations (Phase 3) — workflow engine CRUD. Reads are open to any
// authenticated user; writes are admin-only (workflows are org config, like
// segments/pipelines). Creation detects duplicate workflows (409 + duplicateId
// unless allowDuplicate) — the Phase-3 conflict-resolution guard. The engine
// (lib/automations.ts) consumes the rows on the event bus.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent, type PersistedEvent } from "../lib/events";
import { parseWorkflowParts, workflowFingerprint, runAutomation, EVENT_OBJECT_TYPES } from "../lib/automations";

const router = Router();

// No z.default() — defaults applied explicitly in create (ADR engineering note).
const automationSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  trigger: z.any().optional(),
  conditions: z.any().optional(),
  actions: z.any().optional(),
  active: z.boolean().optional(),
  allowDuplicate: z.boolean().optional(),
});

/** Duplicate guard: another ACTIVE automation with the same normalized parts. */
async function findDuplicate(
  orgId: string,
  environment: string,
  parts: { trigger: any; conditions: any; actions: any },
  excludeId?: string
) {
  const fp = workflowFingerprint(parts);
  const rows = await db().automation.findMany({
    where: { orgId, environment, active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, trigger: true, conditions: true, actions: true },
  });
  return rows.find((r) => workflowFingerprint({ trigger: r.trigger, conditions: r.conditions, actions: r.actions }) === fp) ?? null;
}

// GET /api/automations — list the org's workflows (reads open).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().automation.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
    const creators = creatorIds.length ? await db().user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(creators.map((u) => [u.id, u.name]));
    ok(res, {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        trigger: r.trigger,
        conditions: r.conditions,
        actions: r.actions,
        active: r.active,
        runCount: r.runCount,
        lastRunAt: r.lastRunAt,
        createdByName: byId.get(r.createdBy) ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  })
);

// POST /api/automations (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = automationSchema.parse(req.body);
    const parts = parseWorkflowParts({ trigger: input.trigger, conditions: input.conditions ?? [], actions: input.actions ?? [] });

    const dup = await findDuplicate(user.orgId, environment, parts);
    if (dup && !input.allowDuplicate) {
      return ok(res, { error: `This workflow duplicates "${dup.name}"`, duplicateId: dup.id, duplicateName: dup.name }, 409);
    }

    const automation = await db().automation.create({
      data: {
        orgId: user.orgId,
        environment,
        name: input.name,
        description: input.description ?? null,
        trigger: parts.trigger as object,
        conditions: parts.conditions as object,
        actions: parts.actions as object,
        active: input.active ?? true,
        createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "automation.created", entity: "automation", entityId: automation.id, actorId: user.id, payload: { name: input.name, trigger: parts.trigger } });
    ok(res, { automation }, 201);
  })
);

// GET /api/automations/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const automation = await db().automation.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!automation) throw notFound("Automation not found");
    ok(res, { automation });
  })
);

// PATCH /api/automations/:id (admin) — partial update, PATCH semantics.
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const automation = await db().automation.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!automation) throw notFound("Automation not found");
    const input = automationSchema.partial().parse(req.body);

    const nextTrigger = input.trigger !== undefined ? input.trigger : automation.trigger;
    const nextConditions = input.conditions !== undefined ? input.conditions : automation.conditions;
    const nextActions = input.actions !== undefined ? input.actions : automation.actions;
    const parts = parseWorkflowParts({ trigger: nextTrigger, conditions: nextConditions ?? [], actions: nextActions ?? [] });

    const dup = await findDuplicate(user.orgId, environment, parts, automation.id);
    if (dup && !input.allowDuplicate) {
      return ok(res, { error: `This workflow duplicates "${dup.name}"`, duplicateId: dup.id, duplicateName: dup.name }, 409);
    }

    const updated = await db().automation.update({
      where: { id: automation.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.trigger !== undefined ? { trigger: parts.trigger as object } : {}),
        ...(input.conditions !== undefined ? { conditions: parts.conditions as object } : {}),
        ...(input.actions !== undefined ? { actions: parts.actions as object } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "automation.updated", entity: "automation", entityId: automation.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { automation: updated });
  })
);

// DELETE /api/automations/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const automation = await db().automation.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!automation) throw notFound("Automation not found");
    await db().automation.delete({ where: { id: automation.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "automation.deleted", entity: "automation", entityId: automation.id, actorId: user.id, payload: { name: automation.name } });
    ok(res, { ok: true });
  })
);

// GET /api/automations/:id/runs — the run log (conflict-resolution surface).
router.get(
  "/:id/runs",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const automation = await db().automation.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!automation) throw notFound("Automation not found");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const items = await db().automationRun.findMany({ where: { automationId: automation.id }, orderBy: { createdAt: "desc" }, take: limit });
    ok(res, { items });
  })
);

// POST /api/automations/:id/test (admin) — run the workflow against a real
// record synchronously, without waiting for the event to fire naturally.
router.post(
  "/:id/test",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const automation = await db().automation.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!automation) throw notFound("Automation not found");
    const body = z.object({ entityId: z.string().min(1) }).parse(req.body);

    const trigger = (automation.trigger ?? {}) as { kind: string; event: string; to?: string };
    const entity = EVENT_OBJECT_TYPES[trigger.event];
    if (!entity) throw badRequest("This workflow's trigger has no object type to test against");
    const delegate = (db() as any)[entity];
    const record = await delegate.findUnique({ where: { id: body.entityId } });
    if (!record || record.orgId !== user.orgId || record.environment !== environment) throw notFound("Record not found");

    // Synthesize the trigger event from the live record so conditions + actions
    // run against real data. stage_changed gets from/to from the current stage.
    const payload: Record<string, unknown> =
      trigger.event === "deal.stage_changed"
        ? { from: record.stage, to: trigger.to ?? record.stage }
        : { [entity]: record };
    const synthetic: PersistedEvent = {
      id: `test-${Date.now()}`,
      orgId: user.orgId,
      environment,
      type: trigger.event,
      entity,
      entityId: body.entityId,
      actorId: user.id,
      payload,
      createdAt: new Date(),
    };
    const outcome = await runAutomation(automation as any, synthetic, "test");
    ok(res, { ok: true, matched: outcome.matched, note: outcome.note ?? null, actions: outcome.actions });
  })
);

export default router;
