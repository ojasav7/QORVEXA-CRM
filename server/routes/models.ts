// AI model router admin (Phase 8 · 🆕 blueprint) — flag ai.modelRouter.
//
// The model catalog is DATA (ModelRoute rows, like SlaPolicy targets): admins
// add/edit models (provider, capabilities, cost, latency, region residency,
// routing weight) and set the org's routing policy (default model, cost /
// quality / latency preference, preferred region). GET /route dry-runs the
// decision for a feature so the router is explainable before any call.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { ensureDefaultModels, routeModel, routerPolicy, ALL_CAPABILITIES, type RouterPolicy } from "../lib/ai";

const router = Router();

// GET /api/models — catalog rows + the org's routing policy.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    await ensureDefaultModels(user.orgId, environment);
    const items = await db().modelRoute.findMany({ where: { orgId: user.orgId, environment }, orderBy: [{ tier: "asc" }, { routingWeight: "desc" }] });
    ok(res, { items, policy: await routerPolicy(user.orgId, environment) });
  })
);

// GET /api/models/route?feature= — dry-run the routing decision (explainable).
router.get(
  "/route",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const feature = String(req.query.feature ?? "");
    if (!feature) throw badRequest("feature is required (e.g. deal.summary, lead.score, search)");
    ok(res, { decision: await routeModel(user.orgId, environment, feature) });
  })
);

// PUT /api/models/policy (admin) — set the org's routing policy.
const policySchema = z.object({
  defaultModel: z.string().min(1).optional(),
  preference: z.enum(["cost", "quality", "latency"]).optional(),
  preferredRegion: z.string().nullable().optional(),
});
router.put(
  "/policy",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const patch = policySchema.parse(req.body ?? {});
    const org = await db().organization.findUnique({ where: { id: user.orgId } });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const current = await routerPolicy(user.orgId, environment);
    const next: RouterPolicy = {
      defaultModel: patch.defaultModel ?? current.defaultModel,
      preference: patch.preference ?? current.preference,
      preferredRegion: patch.preferredRegion === undefined ? current.preferredRegion : patch.preferredRegion,
    };
    settings.ai = { ...((settings.ai ?? {}) as Record<string, unknown>), ...next };
    await db().organization.update({ where: { id: user.orgId }, data: { settings: settings as object } });
    await emitEvent({ orgId: user.orgId, environment, type: "ai.policy_updated", entity: "ai", entityId: user.orgId, actorId: user.id, payload: { preference: next.preference, defaultModel: next.defaultModel, preferredRegion: next.preferredRegion ?? null } });
    ok(res, { policy: next });
  })
);

const modelSchema = z.object({
  name: z.string().min(1).max(60),
  provider: z.string().default("mock"),
  tier: z.enum(["standard", "premium"]).default("standard"),
  capabilities: z.array(z.string()).default([]),
  costPer1kIn: z.number().min(0).default(0),
  costPer1kOut: z.number().min(0).default(0),
  latencyMs: z.number().int().min(0).default(120),
  region: z.string().default("any"),
  active: z.boolean().default(true),
  routingWeight: z.number().int().min(0).max(100).default(1),
});

// POST /api/models (admin) — add a model to the catalog.
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = modelSchema.parse(req.body ?? {});
    if (!input.capabilities.length) throw badRequest("capabilities must list at least one (summary | score | search | draft | sentiment | intent)");
    for (const c of input.capabilities) if (!ALL_CAPABILITIES.includes(c)) throw badRequest(`Unknown capability "${c}"`);
    const existing = await db().modelRoute.findFirst({ where: { orgId: user.orgId, environment, name: input.name } });
    if (existing) throw badRequest(`A model named "${input.name}" already exists`);
    const row = await db().modelRoute.create({ data: { orgId: user.orgId, environment, ...input, capabilities: input.capabilities as unknown as object } });
    await emitEvent({ orgId: user.orgId, environment, type: "model.created", entity: "model", entityId: row.id, actorId: user.id, payload: { name: row.name, tier: row.tier } });
    ok(res, { model: row }, 201);
  })
);

// PUT /api/models/:id (admin) — edit cost/latency/capabilities/weight/region.
router.put(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const row = await db().modelRoute.findUnique({ where: { id } });
    if (!row || row.orgId !== user.orgId || row.environment !== environment) throw notFound("Model not found");
    const input = modelSchema.partial().parse(req.body ?? {});
    if (input.capabilities) for (const c of input.capabilities) if (!ALL_CAPABILITIES.includes(c)) throw badRequest(`Unknown capability "${c}"`);
    const updated = await db().modelRoute.update({
      where: { id },
      data: {
        ...input,
        capabilities: input.capabilities ? (input.capabilities as unknown as object) : undefined,
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "model.updated", entity: "model", entityId: updated.id, actorId: user.id, payload: { name: updated.name, active: updated.active } });
    ok(res, { model: updated });
  })
);

// DELETE /api/models/:id (admin) — remove from the catalog.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const row = await db().modelRoute.findUnique({ where: { id } });
    if (!row || row.orgId !== user.orgId || row.environment !== environment) throw notFound("Model not found");
    await db().modelRoute.delete({ where: { id } });
    await emitEvent({ orgId: user.orgId, environment, type: "model.deleted", entity: "model", entityId: id, actorId: user.id, payload: { name: row.name } });
    ok(res, { ok: true });
  })
);

export default router;
