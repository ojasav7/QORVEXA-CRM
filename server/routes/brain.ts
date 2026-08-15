// Phase 15 — Differentiators (the "1-of-1" layer) API
// (spec docs/49-spec-phase15.md). Mounted at /api/brain with per-area feature
// gates (diff.*): reads are open to authenticated users; writes (refresh,
// simulations, builder, orchestrator config, snapshots) are admin-only — the
// same governance discipline as every config phase. The command console
// executes 🟢 actions as the calling user and 🟡/🔴 paths never execute.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { badRequest, asyncHandler, ok, notFound } from "../lib/http";
import { requireAuth, requireRole, assertActiveUser } from "../lib/auth";
import { resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import { scanBrain, listInsights, setInsightStatus, dealXray, dealDetective, radarScan, radarFeed } from "../lib/brain";
import { graphV2ForDeal, graphV2ForAccount } from "../lib/graph";
import { recordMemory, listMemory, forgetMemory } from "../lib/memory";
import { listOrchestrators, getOrchestrator, createOrchestrator, updateOrchestrator, deleteOrchestrator, runOrchestrator, listDelegations, testOrchestrator } from "../lib/orchestrate";
import { reconstruct, compareStates, createSnapshot, listSnapshots, getSnapshot, retentionDays } from "../lib/timemachine";
import { runSimulation, listSimulations, simulationModels } from "../lib/simulate";
import { buildFromPrompt, builderCatalog } from "../lib/builder";
import { ubqAnswer, ubqExamples } from "../lib/ubq";
import { runCommand, commandCatalog } from "../lib/command";

const router = Router();

const asOfSchema = z.object({ entity: z.string().min(1), id: z.string().min(1), asOf: z.string().min(1) });
const compareSchema = z.object({ entity: z.string().min(1), id: z.string().min(1), from: z.string().min(1), to: z.string().min(1) });

// ── Overview ────────────────────────────────────────────────────────────────
router.get(
  "/overview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const [insights, signals, memory, orchestrators, snapshots, simulations] = await Promise.all([
      db().businessBrainInsight.findMany({ where: { orgId: user.orgId, environment }, select: { category: true, severity: true, status: true } }),
      radarFeed(user.orgId, environment),
      db().orgMemoryEntry.count({ where: { orgId: user.orgId, environment } }),
      db().agentOrchestrator.count({ where: { orgId: user.orgId, environment } }),
      db().timeMachineSnapshot.count({ where: { orgId: user.orgId, environment } }),
      db().simulationRun.count({ where: { orgId: user.orgId, environment } }),
    ]);
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const open = insights.filter((i) => i.status === "open").length;
    for (const i of insights) {
      byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
    }
    ok(res, {
      insights: { total: insights.length, open, byCategory, bySeverity },
      radar: { signals: signals.signals.length, byKind: signals.signals.reduce((acc: Record<string, number>, s) => { acc[s.kind] = (acc[s.kind] ?? 0) + 1; return acc; }, {}) },
      memory,
      orchestrators,
      snapshots,
      simulations,
      retentionDays: await retentionDays(user.orgId),
    });
  })
);

// ── Business Brain ──────────────────────────────────────────────────────────
router.post("/refresh", requireAuth, requireRole("admin"), requireFeature("diff.brain"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const result = await scanBrain(user.orgId, environment, user.id);
  ok(res, result);
}));

router.get("/insights", requireAuth, requireFeature("diff.brain"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  ok(res, { items: await listInsights(user.orgId, environment, status) });
}));

router.post("/insights/:id/:action", requireAuth, requireFeature("diff.brain"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const action = String(req.params.action);
  if (!["acknowledge", "dismiss", "action"].includes(action)) throw badRequest("action must be acknowledge | dismiss | action");
  const status = action === "acknowledge" ? "acknowledged" : action === "action" ? "actioned" : "dismissed";
  ok(res, await setInsightStatus(user.orgId, environment, String(req.params.id), status, user.id));
}));

// ── Deal X-Ray + AI Deal Detective ──────────────────────────────────────────
router.get("/xray/:dealId", requireAuth, requireFeature("diff.brain"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, await dealXray(user.orgId, environment, String(req.params.dealId)));
}));

router.get("/detective/:dealId", requireAuth, requireFeature("diff.brain"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, await dealDetective(user.orgId, environment, String(req.params.dealId)));
}));

// ── Opportunity Radar ───────────────────────────────────────────────────────
router.post("/radar/scan", requireAuth, requireRole("admin"), requireFeature("diff.brain"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, await radarScan(user.orgId, environment, user.id));
}));

router.get("/radar", requireAuth, requireFeature("diff.brain"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, await radarFeed(user.orgId, environment));
}));

// ── Relationship Graph v2 ───────────────────────────────────────────────────
router.get("/graph", requireAuth, requireFeature("diff.graph"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const { accountId, dealId } = req.query;
  if (dealId && typeof dealId === "string") return ok(res, await graphV2ForDeal(user.orgId, environment, dealId));
  if (accountId && typeof accountId === "string") return ok(res, await graphV2ForAccount(user.orgId, environment, accountId));
  throw badRequest("provide ?dealId= or ?accountId=");
}));

// ── Organizational memory ───────────────────────────────────────────────────
router.get("/memory", requireAuth, requireFeature("diff.memory"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  const scopeId = typeof req.query.scopeId === "string" ? req.query.scopeId : undefined;
  ok(res, { items: await listMemory(user.orgId, environment, scope, scopeId) });
}));

router.post("/memory", requireAuth, requireFeature("diff.memory"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ scope: z.string(), scopeId: z.string().nullish(), kind: z.enum(["fact", "observation", "insight"]), content: z.string() }).parse(req.body);
  ok(res, await recordMemory(user.orgId, environment, user.id, { scope: body.scope, scopeId: body.scopeId ?? null, kind: body.kind, content: body.content }), 201);
}));

router.delete("/memory/:id", requireAuth, requireFeature("diff.memory"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const gone = await forgetMemory(user.orgId, environment, String(req.params.id));
  if (!gone) throw notFound("Memory entry not found");
  ok(res, { deleted: true });
}));

// ── Multi-agent orchestration ───────────────────────────────────────────────
router.get("/orchestrators", requireAuth, requireFeature("diff.orchestration"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, { items: await listOrchestrators(user.orgId, environment) });
}));

router.post("/orchestrators", requireAuth, requireRole("admin"), requireFeature("diff.orchestration"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ name: z.string(), description: z.string().nullish(), trigger: z.object({ kind: z.enum(["event", "manual"]), event: z.string().nullish() }), childAgentIds: z.array(z.string()).min(1), mode: z.enum(["parallel", "sequential"]).default("sequential") }).parse(req.body);
  ok(res, await createOrchestrator(user.orgId, environment, user.id, { name: body.name, description: body.description ?? undefined, trigger: { kind: body.trigger.kind, event: body.trigger.event ?? undefined }, childAgentIds: body.childAgentIds, mode: body.mode }), 201);
}));

router.patch("/orchestrators/:id", requireAuth, requireRole("admin"), requireFeature("diff.orchestration"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, await updateOrchestrator(user.orgId, environment, String(req.params.id), req.body));
}));

router.delete("/orchestrators/:id", requireAuth, requireRole("admin"), requireFeature("diff.orchestration"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  await deleteOrchestrator(user.orgId, environment, String(req.params.id));
  ok(res, { deleted: true });
}));

router.post("/orchestrators/:id/run", requireAuth, requireRole("admin"), requireFeature("diff.orchestration"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ entity: z.string(), entityId: z.string() }).parse(req.body);
  const orchestrator = await getOrchestrator(user.orgId, environment, String(req.params.id));
  ok(res, await runOrchestrator({ orchestrator, entity: body.entity, entityId: body.entityId, actorId: user.id }));
}));

router.post("/orchestrators/:id/test", requireAuth, requireRole("admin"), requireFeature("diff.orchestration"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ entity: z.string(), entityId: z.string() }).parse(req.body);
  ok(res, await testOrchestrator(user.orgId, environment, String(req.params.id), body.entity, body.entityId, user.id));
}));

router.get("/orchestrators/:id/delegations", requireAuth, requireFeature("diff.orchestration"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, { items: await listDelegations(user.orgId, environment, String(req.params.id)) });
}));

// ── CRM Time Machine ────────────────────────────────────────────────────────
router.get("/timemachine/reconstruct", requireAuth, requireFeature("diff.timemachine"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const { entity, id, asOf } = asOfSchema.parse(req.query);
  const when = new Date(asOf);
  if (Number.isNaN(when.getTime())) throw badRequest("asOf must be an ISO date");
  const result = await reconstruct(user.orgId, environment, entity, id, when);
  if (!result) throw notFound(`No audited state for this ${entity} as of ${asOf}`);
  ok(res, result);
}));

router.get("/timemachine/compare", requireAuth, requireFeature("diff.timemachine"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const { entity, id, from, to } = compareSchema.parse(req.query);
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) throw badRequest("from/to must be ISO dates");
  const a = await reconstruct(user.orgId, environment, entity, id, fromDate);
  const b = await reconstruct(user.orgId, environment, entity, id, toDate);
  if (!a || !b || a.deleted || b.deleted) throw notFound("Both dates must have a live reconstructed state");
  ok(res, { from: { asOf: from, state: a.state }, to: { asOf: to, state: b.state }, diff: compareStates(a.state as Record<string, unknown>, b.state as Record<string, unknown>) });
}));

router.post("/timemachine/snapshot", requireAuth, requireRole("admin"), requireFeature("diff.timemachine"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ scope: z.enum(["full", "record"]), entity: z.string().nullish(), entityId: z.string().nullish() }).parse(req.body);
  ok(res, await createSnapshot(user.orgId, environment, user.id, body.scope, body.entity ?? null, body.entityId ?? null), 201);
}));

router.get("/timemachine/snapshots", requireAuth, requireFeature("diff.timemachine"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  ok(res, { items: await listSnapshots(user.orgId, environment, scope) });
}));

router.get("/timemachine/snapshots/:id", requireAuth, requireFeature("diff.timemachine"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, await getSnapshot(user.orgId, environment, String(req.params.id)));
}));

// ── What-If simulator ───────────────────────────────────────────────────────
router.get("/simulate/models", requireAuth, requireFeature("diff.simulator"), asyncHandler(async (_req, res) => {
  ok(res, { models: simulationModels() });
}));

router.post("/simulate", requireAuth, requireRole("admin"), requireFeature("diff.simulator"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ name: z.string(), scenario: z.string(), params: z.record(z.string(), z.number()) }).parse(req.body);
  ok(res, await runSimulation(user.orgId, environment, user.id, body), 201);
}));

router.get("/simulations", requireAuth, requireFeature("diff.simulator"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, { items: await listSimulations(user.orgId, environment) });
}));

// ── AI-built generators ─────────────────────────────────────────────────────
router.get("/builder/catalog", requireAuth, requireFeature("diff.builder"), asyncHandler(async (_req, res) => {
  ok(res, { items: builderCatalog() });
}));

router.post("/builder", requireAuth, requireRole("admin"), requireFeature("diff.builder"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ prompt: z.string().min(3) }).parse(req.body);
  ok(res, await buildFromPrompt(user.orgId, environment, user.id, body.prompt), 201);
}));

// ── Universal Business Query ────────────────────────────────────────────────
router.get("/ubq", requireAuth, requireFeature("diff.ubq"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q.trim()) return ok(res, { examples: ubqExamples() });
  ok(res, await ubqAnswer(user.orgId, environment, q));
}));

// ── Voice & computer-use console ────────────────────────────────────────────
router.get("/command/catalog", requireAuth, requireFeature("diff.command"), asyncHandler(async (_req, res) => {
  ok(res, { items: commandCatalog() });
}));

router.post("/command", requireAuth, requireFeature("diff.command"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const body = z.object({ text: z.string().nullish(), action: z.object({ element: z.string(), action: z.string(), params: z.record(z.string(), z.unknown()).nullish() }).nullish() }).parse(req.body);
  const input = { text: body.text ?? undefined, action: body.action ? { ...body.action, params: body.action.params ?? undefined } : undefined };
  ok(res, await runCommand(user.orgId, environment, { id: user.id, orgId: user.orgId, role: user.role, environment }, input));
}));

export default router;
