// AI Agent Platform (Phase 9 · autonomous, governed) — flag ai.agents.
//
// Reads open (the Agents page is a monitoring + governance surface); writes
// (create/edit/delete, manual run, kill switch, policy) are admin-only —
// same pattern as automations/campaigns config entities. The approval
// endpoints are the human-in-the-loop gate: 🟡 yellow actions can be
// approved by admins/managers, 🔴 red actions by admins only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import {
  AGENT_TEMPLATES,
  ALL_TOOLS,
  TOOL_TIERS,
  agentAnalytics,
  agentMetering,
  approveAction,
  matchesRules,
  orgKillSwitch,
  rejectAction,
  runAgent,
  setOrgKillSwitch,
  testAgent,
} from "../lib/agents";
import { emitEvent } from "../lib/events";

const router = Router();

const agentSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.string().default("custom"),
  description: z.string().optional(),
  trigger: z.object({ kind: z.enum(["event", "manual"]), event: z.string().optional() }).default({ kind: "manual" }),
  rules: z.array(z.object({ field: z.string().min(1), op: z.string().min(1), value: z.unknown() })).default([]),
  tools: z.array(z.string()).default(["notify"]),
  tierPolicy: z.record(z.string(), z.enum(["green", "yellow", "red"])).default({}),
  memoryEnabled: z.boolean().default(true),
  active: z.boolean().default(true),
  killSwitched: z.boolean().default(false),
});

function normalizeAgentInput(input: Partial<z.infer<typeof agentSchema>>) {
  if (input.tools && !input.tools.length) throw badRequest("tools must list at least one");
  for (const t of input.tools ?? []) if (!ALL_TOOLS.includes(t)) throw badRequest(`Unknown tool "${t}" — allowed: ${ALL_TOOLS.join(", ")}`);
  for (const [tool, tier] of Object.entries(input.tierPolicy ?? {})) {
    if (!ALL_TOOLS.includes(tool)) throw badRequest(`Unknown tool "${tool}" in tierPolicy`);
    if (!["green", "yellow", "red"].includes(tier)) throw badRequest(`tierPolicy tier must be green|yellow|red`);
  }
  if (input.trigger?.kind === "event" && !input.trigger.event) throw badRequest("event trigger requires an event");
  if (input.trigger?.kind === "event") {
    const known = ["lead.created", "contact.created", "deal.stage_changed", "deal.created", "ticket.created", "form.submitted", "task.completed"];
    if (!known.includes(input.trigger.event!)) throw badRequest(`event must be one of: ${known.join(", ")}`);
  }
  return input;
}

// GET /api/agents — list agents (reads open; analytics live in /analytics).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().agent.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    ok(res, { items, templates: AGENT_TEMPLATES, toolTiers: TOOL_TIERS, orgKillSwitched: await orgKillSwitch(user.orgId) });
  })
);

// GET /api/agents/analytics — performance analytics (success rate, escalation rate, cost).
router.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, await agentAnalytics(user.orgId, environment));
  })
);

// GET /api/agents/metering — 🆕 cost control & metering per agent/entity.
router.get(
  "/metering",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, await agentMetering(user.orgId, environment));
  })
);

// GET /api/agents/runs — all runs (the audit trail surface).
router.get(
  "/runs",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const [items, total] = await Promise.all([
      db().agentRun.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: limit }),
      db().agentRun.count({ where: { orgId: user.orgId, environment } }),
    ]);
    ok(res, { items, total });
  })
);

// GET /api/agents/approvals — everything waiting on a human (🟡/🔴).
router.get(
  "/approvals",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const [items, total] = await Promise.all([
      db().agentAction.findMany({ where: { orgId: user.orgId, environment, status: "proposed", riskTier: { in: ["yellow", "red"] } }, orderBy: { createdAt: "asc" }, take: 50 }),
      db().agentAction.count({ where: { orgId: user.orgId, environment, status: "proposed", riskTier: { in: ["yellow", "red"] } } }),
    ]);
    ok(res, { items, total });
  })
);

// GET /api/agents/:id — one agent + its recent runs + memory.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    const [runs, actions, memory] = await Promise.all([
      db().agentRun.findMany({ where: { orgId: user.orgId, environment, agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      db().agentAction.findMany({ where: { orgId: user.orgId, environment, agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      db().agentMemory.findMany({ where: { orgId: user.orgId, environment, agentId: agent.id } }),
    ]);
    ok(res, { agent, runs, actions, memory });
  })
);

// POST /api/agents — create an agent (admin).
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = normalizeAgentInput(agentSchema.parse(req.body ?? {}));
    const agent = await db().agent.create({
      data: {
        orgId: user.orgId,
        environment,
        name: input.name ?? "Agent",
        kind: input.kind ?? "custom",
        description: input.description ?? null,
        trigger: input.trigger as object,
        rules: input.rules as unknown as object,
        tools: input.tools as unknown as object,
        tierPolicy: input.tierPolicy as object,
        memoryEnabled: input.memoryEnabled,
        active: input.active,
        killSwitched: input.killSwitched,
        createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "agent.created", entity: "agent", entityId: agent.id, actorId: user.id, payload: { name: agent.name, kind: agent.kind } });
    ok(res, { agent }, 201);
  })
);

// PUT /api/agents/:id — edit (admin).
router.put(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    const input = normalizeAgentInput(agentSchema.partial().parse(req.body ?? {}));
    const updated = await db().agent.update({
      where: { id: agent.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.trigger !== undefined ? { trigger: input.trigger as object } : {}),
        ...(input.rules !== undefined ? { rules: input.rules as unknown as object } : {}),
        ...(input.tools !== undefined ? { tools: input.tools as unknown as object } : {}),
        ...(input.tierPolicy !== undefined ? { tierPolicy: input.tierPolicy as object } : {}),
        ...(input.memoryEnabled !== undefined ? { memoryEnabled: input.memoryEnabled } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "agent.updated", entity: "agent", entityId: agent.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { agent: updated });
  })
);

// DELETE /api/agents/:id (admin) — remove the agent + its runs/actions/memory.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    await db().agentAction.deleteMany({ where: { orgId: user.orgId, environment, agentId: agent.id } });
    await db().agentRun.deleteMany({ where: { orgId: user.orgId, environment, agentId: agent.id } });
    await db().agentMemory.deleteMany({ where: { orgId: user.orgId, environment, agentId: agent.id } });
    await db().agentTest.deleteMany({ where: { orgId: user.orgId, environment, agentId: agent.id } });
    await db().agent.delete({ where: { id: agent.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "agent.deleted", entity: "agent", entityId: agent.id, actorId: user.id, payload: { name: agent.name } });
    ok(res, { ok: true });
  })
);

// POST /api/agents/:id/run — MANUAL run against a record (admin). Green actions
// execute; yellow/red wait for approval.
const runSchema = z.object({ entity: z.string().min(1), entityId: z.string().min(1) });
router.post(
  "/:id/run",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    if (agent.killSwitched || (await orgKillSwitch(user.orgId))) throw badRequest("Agent is kill-switched");
    const { entity, entityId } = runSchema.parse(req.body);
    const result = await runAgent({ agent, entity, entityId, trigger: "manual", actorId: user.id });
    ok(res, result, 201);
  })
);

// POST /api/agents/:id/test — 🆕 testing / simulation lab (dry-run, no execution).
const testSchema = z.object({ entity: z.string().min(1), entityId: z.string().min(1), name: z.string().min(1).max(80) });
router.post(
  "/:id/test",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    const { entity, entityId, name } = testSchema.parse(req.body);
    ok(res, await testAgent(agent, entity, entityId, name, user.id), 201);
  })
);

// GET /api/agents/:id/tests — test history.
router.get(
  "/:id/tests",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    const items = await db().agentTest.findMany({ where: { orgId: user.orgId, environment, agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 25 });
    ok(res, { items });
  })
);

// POST /api/agents/actions/:id/approve — approve + execute a waiting action.
// Admin + manager (the lib enforces admin-only for red-tier actions).
router.post(
  "/actions/:id/approve",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, await approveAction(String(req.params.id), user, environment));
  })
);

// POST /api/agents/actions/:id/reject — reject a waiting action.
router.post(
  "/actions/:id/reject",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, await rejectAction(String(req.params.id), user, environment));
  })
);

// POST /api/agents/kill-switch — 🆕 org-wide kill switch (admin).
router.post(
  "/kill-switch",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { on } = z.object({ on: z.boolean() }).parse(req.body ?? {});
    const enabled = await setOrgKillSwitch(user.orgId, environment, on, user.id);
    ok(res, { killSwitched: enabled });
  })
);

// POST /api/agents/:id/kill — 🆕 per-agent kill switch (admin).
router.post(
  "/:id/kill",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    const { on } = z.object({ on: z.boolean() }).parse(req.body ?? {});
    const updated = await db().agent.update({ where: { id: agent.id }, data: { killSwitched: on, updatedAt: new Date() } });
    await emitEvent({ orgId: user.orgId, environment, type: "agent.killed", entity: "agent", entityId: agent.id, actorId: user.id, payload: { scope: "agent", name: agent.name, on } });
    ok(res, { agent: updated });
  })
);

// GET /api/agents/:id/rules — dry-run rule matching against a record (diagnostic).
router.get(
  "/:id/rules",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const agent = await db().agent.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!agent) throw notFound("Agent not found");
    const entity = String(req.query.entity ?? "");
    const entityId = String(req.query.entityId ?? "");
    if (!entity || !entityId) throw badRequest("entity + entityId required");
    const delegate = (db() as any)[entity];
    const record = delegate ? await delegate.findUnique({ where: { id: entityId } }) : null;
    if (!record || record.orgId !== user.orgId || record.environment !== environment) throw notFound("Record not found");
    ok(res, { matched: matchesRules(record, (agent.rules ?? []) as any) });
  })
);

export default router;
