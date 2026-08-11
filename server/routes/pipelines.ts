// Multi-pipeline admin (Phase 2-lite) — CRUD for per-org deal pipelines.
// Reads are open to any authenticated user (the deals board + form need them);
// writes are admin-only. Emits pipeline.created / pipeline.updated /
// pipeline.deleted (+ audit rows). Delete guards: can't delete the default
// pipeline, the last pipeline, or a pipeline that still has deals.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { writeAudit } from "../lib/audit";
import { resolveEnvironment } from "../lib/environment";
import { normalizeStages, findPipeline, listPipelines, ensureDefaultPipeline, type PipelineStageDef } from "../lib/pipelines";

const router = Router();

// GET /api/pipelines — all of the org's pipelines in this environment, with live deal counts.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listPipelines(user.orgId, environment) });
  })
);

const stageSchema = z.object({
  key: z.string().optional(),
  label: z.string().min(1),
  probability: z.number().min(0).max(100).optional(),
});

// POST-facing schema (defaults applied explicitly — the Zod PATCH rule).
const createSchema = z.object({
  name: z.string().min(1),
  stages: z.array(stageSchema).min(1),
  isDefault: z.boolean().optional(),
});
// PATCH-facing schema: partial — a `{ isDefault: true }`-only patch must validate.
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  stages: z.array(stageSchema).min(1).optional(), // omitted = keep existing
  isDefault: z.boolean().optional(),
});

// POST /api/pipelines — create a pipeline (admin). The first pipeline for the
// org automatically becomes the default.
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = createSchema.parse(req.body);
    const stages = normalizeStages(input.stages ?? []);
    await ensureDefaultPipeline(user.orgId, environment);
    const existing = await (db() as any).pipeline.count({ where: { orgId: user.orgId, environment } });
    const wantsDefault = input.isDefault === true || existing === 0;
    // If this pipeline becomes the default, demote the current one.
    if (wantsDefault) {
      await (db() as any).pipeline.updateMany({ where: { orgId: user.orgId, environment, isDefault: true }, data: { isDefault: false, updatedAt: new Date() } });
    }
    const created = await (db() as any).pipeline.create({
      data: { orgId: user.orgId, environment, name: input.name, isDefault: wantsDefault, stages },
    });
    await writeAudit({ orgId: user.orgId, environment, actorId: user.id, entity: "pipeline", entityId: created.id, action: "create", after: created, ip: req.ip });
    await emitEvent({ orgId: user.orgId, environment, type: "pipeline.created", entity: "pipeline", entityId: created.id, actorId: user.id, payload: { name: created.name, isDefault: wantsDefault } });
    ok(res, { pipeline: { ...created, stages } }, 201);
  })
);

// PATCH /api/pipelines/:id — rename, replace stages, or make default (admin).
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const pipeline = await findPipeline(user.orgId, environment, id);
    if (!pipeline) throw badRequest("Pipeline not found in this environment");

    const input = patchSchema.parse(req.body);
    const before = pipeline;
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.stages !== undefined) patch.stages = normalizeStages(input.stages);
    if (input.isDefault === true) {
      await (db() as any).pipeline.updateMany({ where: { orgId: user.orgId, environment, isDefault: true }, data: { isDefault: false, updatedAt: new Date() } });
      patch.isDefault = true;
    }
    if (Object.keys(patch).length === 0) throw badRequest("Nothing to update");
    patch.updatedAt = new Date();
    const updated = await (db() as any).pipeline.update({ where: { id }, data: patch });
    const after = { ...before, ...updated, stages: updated.stages };
    await writeAudit({
      orgId: user.orgId,
      environment,
      actorId: user.id,
      entity: "pipeline",
      entityId: id,
      action: "update",
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      ip: req.ip,
    });
    await emitEvent({ orgId: user.orgId, environment, type: "pipeline.updated", entity: "pipeline", entityId: id, actorId: user.id, payload: { name: updated.name, isDefault: updated.isDefault } });
    ok(res, { pipeline: after });
  })
);

// DELETE /api/pipelines/:id — guarded (admin): no default, no last, no deals.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const pipeline = await findPipeline(user.orgId, environment, id);
    if (!pipeline) throw badRequest("Pipeline not found in this environment");
    if (pipeline.isDefault) throw badRequest("Cannot delete the default pipeline — make another pipeline default first");
    const others = await (db() as any).pipeline.count({ where: { orgId: user.orgId, environment } });
    if (others <= 1) throw badRequest("Cannot delete the only pipeline — create another one first");
    const deals = await (db() as any).opportunity.count({ where: { orgId: user.orgId, environment, pipelineId: id } });
    if (deals > 0) throw badRequest(`Cannot delete "${pipeline.name}" — ${deals} deal${deals === 1 ? "" : "s"} are in it. Move or delete them first.`);

    await (db() as any).pipeline.delete({ where: { id } });
    await writeAudit({ orgId: user.orgId, environment, actorId: user.id, entity: "pipeline", entityId: id, action: "delete", before: pipeline as unknown as Record<string, unknown>, ip: req.ip });
    await emitEvent({ orgId: user.orgId, environment, type: "pipeline.deleted", entity: "pipeline", entityId: id, actorId: user.id, payload: { name: pipeline.name } });
    ok(res, { ok: true });
  })
);

export default router;
export type { PipelineStageDef };
