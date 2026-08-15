// AI Agent Platform (Phase 9 · autonomous, governed) — the blueprint's
// "AI performs work, not just suggests it" phase.
//
// An agent is a DECLARATIVE row (Agent — the ADR-015/017 row-as-config
// pattern): a trigger (event or manual), rules (field filters over the
// triggering record), and tools. When a run happens (event subscriber or
// manual/test endpoint), the engine:
//   1. checks the org-wide + per-agent KILL SWITCH (🆕 blueprint),
//   2. loads the record + recent events + agent memory into a FIREWALLED
//      context (Phase 8 data firewall — PII never enters the decision),
//   3. decides actions via the kind's deterministic decider,
//   4. assigns each action a RISK TIER (blueprint §3.4): 🟢 automatic
//      (executes now), 🟡 approval required (waits — customer-facing sends,
//      stage changes), 🔴 human required (refunds/deletions/contracts/large
//      discounts — admin-only, never auto),
//   5. writes the full AI audit trail (AgentRun + AgentAction rows), meters
//      simulated cost (tokens × ModelRoute cost — 🆕 cost metering), and
//      emits agent.action_proposed / agent.action_executed /
//      agent.action_approved / agent.killed.
// The TESTING LAB (🆕) re-runs a scenario WITHOUT executing anything and
// reports pass/block based on governance (red-tier action → blocked).
import { db } from "../db";
import { badRequest, notFound } from "./http";
import { emitEvent, onEvent } from "./events";
import { firewallPolicy, redactContext } from "./ai";
import { createObjectService } from "./object-service";
import { trackingToken } from "./comm";
import type { PersistedEvent } from "./events";

// ── Risk tiers (blueprint §3.4) ─────────────────────────────────────────────
export const TIER_GREEN = "green"; // 🟢 automatic — read-only, internal tasks
export const TIER_YELLOW = "yellow"; // 🟡 approval required — customer-facing sends, stage/status changes
export const TIER_RED = "red"; // 🔴 human required — refunds, deletions, contract changes, large discounts

/** Default tier per tool; agents may override per-tool via `tierPolicy`. */
export const TOOL_TIERS: Record<string, string> = {
  create_task: TIER_GREEN,
  notify: TIER_GREEN,
  create_ticket: TIER_GREEN,
  update_record: TIER_YELLOW, // stage/status changes affect the customer
  send_email: TIER_YELLOW, // customer-facing send
};

export const ALL_TOOLS = Object.keys(TOOL_TIERS);

export type ProposedAction = { tool: string; params: Record<string, unknown>; reason: string };

// ── Pre-built agent templates (blueprint) ───────────────────────────────────
export type AgentTemplate = {
  kind: string;
  name: string;
  description: string;
  trigger: { kind: string; event?: string };
  tools: string[];
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    kind: "lead",
    name: "Lead Agent",
    description: "Qualifies inbound leads: flags hot leads to the owner and schedules the first follow-up task.",
    trigger: { kind: "event", event: "lead.created" },
    tools: ["create_task", "notify", "update_record"],
  },
  {
    kind: "sales",
    name: "Sales Agent",
    description: "Drives the deal pipeline: celebrates wins, prepares negotiations, and analyzes losses.",
    trigger: { kind: "event", event: "deal.stage_changed" },
    tools: ["create_task", "notify"],
  },
  {
    kind: "service",
    name: "Customer Service Agent",
    description: "Protects SLAs: high/urgent tickets get an immediate owner ping + a response task.",
    trigger: { kind: "event", event: "ticket.created" },
    tools: ["create_task", "notify"],
  },
  {
    kind: "renewal",
    name: "Renewal Agent",
    description: "Safeguards recurring revenue: spots deals closing within 30 days and proposes the renewal conversation.",
    trigger: { kind: "event", event: "deal.stage_changed" },
    tools: ["create_task", "notify", "send_email"],
  },
];

export function templateFor(kind: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.kind === kind);
}

// ── Rule matching (field ops — same vocabulary as segments/automations) ─────
function fieldValue(record: any, field: string): unknown {
  if (field.startsWith("payload.")) return undefined;
  const v = record?.[field];
  if (typeof v === "object" && v !== null && "value" in v) return (v as any).value;
  return v;
}

export function matchesRules(record: any, rules: { field: string; op: string; value: unknown }[]): boolean {
  for (const r of rules ?? []) {
    const got = fieldValue(record, r.field);
    const want = r.value;
    switch (r.op) {
      case "eq":
        if (String(got ?? "") !== String(want ?? "")) return false;
        break;
      case "neq":
        if (String(got ?? "") === String(want ?? "")) return false;
        break;
      case "contains":
        if (!String(got ?? "").toLowerCase().includes(String(want ?? "").toLowerCase())) return false;
        break;
      case "not_contains":
        if (String(got ?? "").toLowerCase().includes(String(want ?? "").toLowerCase())) return false;
        break;
      case "gt":
        if (!(Number(got) > Number(want))) return false;
        break;
      case "gte":
        if (!(Number(got) >= Number(want))) return false;
        break;
      case "lt":
        if (!(Number(got) < Number(want))) return false;
        break;
      case "lte":
        if (!(Number(got) <= Number(want))) return false;
        break;
      case "in":
        if (!(Array.isArray(want) ? want : []).includes(got)) return false;
        break;
      case "not_in":
        if ((Array.isArray(want) ? want : []).includes(got)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

// ── Kill switches (🆕 blueprint) ─────────────────────────────────────────────
export async function orgKillSwitch(orgId: string): Promise<boolean> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const agents = (settings.agents ?? {}) as Record<string, unknown>;
  return agents.killSwitched === true;
}

export async function setOrgKillSwitch(orgId: string, environment: string, on: boolean, actorId: string): Promise<boolean> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const agents = (settings.agents ?? {}) as Record<string, unknown>;
  await db().organization.update({
    where: { id: orgId },
    data: { settings: { ...settings, agents: { ...agents, killSwitched: on } } as object },
  });
  await emitEvent({
    orgId,
    environment,
    type: "agent.killed",
    entity: "agent",
    entityId: orgId,
    actorId,
    payload: { scope: "org", on },
  });
  return on;
}

// ── Cost metering (🆕 blueprint) — simulated tokens × ModelRoute cost ───────
async function cheapestModel(orgId: string, environment: string): Promise<{ name: string; costPer1kIn: number; costPer1kOut: number }> {
  const rows = await db().modelRoute.findMany({ where: { orgId, environment, active: true }, orderBy: [{ costPer1kIn: "asc" }, { routingWeight: "desc" }] });
  const row = rows[0] ?? { name: "mock-fast", costPer1kIn: 0.1, costPer1kOut: 0.2 };
  return { name: row.name, costPer1kIn: Number(row.costPer1kIn) || 0.1, costPer1kOut: Number(row.costPer1kOut) || 0.2 };
}

function estimateTokens(text: string): number {
  return Math.max(10, Math.round(text.length / 4));
}

/** Simulated cost of a run: input = context + rules, output = the proposals. */
export async function runCost(
  orgId: string,
  environment: string,
  context: string,
  proposals: ProposedAction[]
): Promise<{ cost: number; modelId: string; inputTokens: number; outputTokens: number }> {
  const model = await cheapestModel(orgId, environment);
  const inputTokens = estimateTokens(context);
  const outputTokens = proposals.reduce((s, p) => s + estimateTokens(JSON.stringify(p.params ?? {})), Math.max(10, proposals.length * 20));
  const cost = (inputTokens / 1000) * model.costPer1kIn + (outputTokens / 1000) * model.costPer1kOut;
  return { cost: Math.round(cost * 100_000) / 100_000, modelId: model.name, inputTokens, outputTokens };
}

// ── Context assembly (scoped → firewalled) ──────────────────────────────────
function entityName(entity: string): string {
  return entity === "opportunity" ? "deal" : entity;
}

async function buildContext(
  orgId: string,
  environment: string,
  entity: string,
  record: any,
  recent: { type: string; payload: any; createdAt: Date }[]
): Promise<{ context: string; redactions: { type: string; count: number }[] }> {
  const policy = await firewallPolicy(orgId);
  const facts = [
    `${entityName(entity)} ${record?.name ?? record?.firstName ?? record?.subject ?? record?.id ?? ""}`.trim(),
    `email ${record?.email ?? "none"}`,
    `status ${record?.status ?? record?.stage ?? "unknown"}`,
    record?.amount ? `amount ${Number(record.amount) || 0}` : null,
    record?.score != null ? `score ${record.score}` : null,
    record?.priority ? `priority ${record.priority}` : null,
    record?.ownerId ? `owner ${record.ownerId}` : null,
    record?.contactId ? `contact ${record.contactId}` : null,
    recent.length ? `recent events: ${recent.map((e) => `${e.type}${e.payload?.to ? `→${e.payload.to}` : ""}`).join(", ")}` : null,
  ].filter(Boolean);
  const { text, redactions } = redactContext(facts.join(" | "), policy);
  return { context: text, redactions };
}

async function agentMemoryFor(orgId: string, environment: string, agentId: string, entity: string, entityId: string) {
  const rows = await db().agentMemory.findMany({ where: { orgId, environment, agentId, entity, entityId } });
  return rows.map((r) => ({ key: r.key, value: r.value }));
}

// ── Deciders (per kind — deterministic, explainable) ────────────────────────
type DeciderArgs = {
  orgId: string;
  environment: string;
  entity: string;
  record: any;
  eventType?: string | null;
  payload?: Record<string, unknown>;
};

function personName(record: any): string {
  return [record?.firstName, record?.lastName].filter(Boolean).join(" ") || record?.name || record?.subject || "record";
}

export function decideActions(agent: any, args: DeciderArgs): { actions: ProposedAction[]; reasoning: string } {
  const { entity, record, eventType, payload } = args;
  const name = personName(record);
  const actions: ProposedAction[] = [];
  const notes: string[] = [];

  switch (agent.kind) {
    case "lead": {
      const score = Number(record?.score) || 0;
      const hot = score >= 70;
      actions.push({
        tool: "create_task",
        params: {
          title: hot ? `🔥 Follow up with hot lead ${name} (score ${score})` : `Follow up with lead ${name}`,
          description: `Lead agent follow-up for ${name}${record?.email ? ` (${record.email})` : ""}. Lead score ${score}.`,
          dueAt: new Date(Date.now() + (hot ? 4 : 24) * 3_600_000).toISOString(),
          priority: hot ? "high" : "medium",
          ownerId: record?.ownerId ?? null,
          contactId: entity === "lead" ? null : null,
          leadId: entity === "lead" ? record?.id : undefined,
        },
        reason: hot ? `lead score ${score} ≥ 70 — schedule fast follow-up` : `new lead ${name} needs a first touch`,
      });
      if (hot) {
        actions.push({ tool: "notify", params: { userId: record?.ownerId, title: `🔥 Hot lead inbound: ${name}`, body: `Lead scored ${score} — call before it goes cold.`, kind: "agent" }, reason: `hot lead (score ${score}) needs immediate owner attention` });
        notes.push(`lead ${name} is hot (score ${score})`);
      }
      if (score >= 70) {
        actions.push({ tool: "update_record", params: { field: "status", value: "qualified" }, reason: `score ${score} ≥ 70 — promote to qualified (approval)` });
      }
      break;
    }
    case "sales": {
      const to = payload?.to ?? record?.stage;
      if (to === "won") {
        actions.push({ tool: "create_task", params: { title: `🏆 Celebrate + ask for referral: ${name}`, description: `Deal won — send the celebration note and ask for a referral.`, priority: "high", ownerId: record?.ownerId ?? null }, reason: `deal ${name} won — capture the referral moment` });
        actions.push({ tool: "notify", params: { userId: record?.ownerId, title: `🏆 ${name} won!`, body: `Deal closed — follow up with a referral ask.`, kind: "agent" }, reason: `deal won — owner should celebrate + ask for referral` });
        notes.push(`deal ${name} won`);
      } else if (to === "negotiation" || to === "proposal") {
        actions.push({ tool: "create_task", params: { title: `📝 Prepare ${to} for ${name}`, description: `Deal entered ${to} — prepare the next artifact.`, priority: "high", ownerId: record?.ownerId ?? null }, reason: `deal ${name} entered ${to}` });
      } else if (to === "lost" || to === "closed_lost") {
        actions.push({ tool: "create_task", params: { title: `📉 Lost-deal analysis: ${name}`, description: `Run the win/loss review for ${name} and capture the reason.`, ownerId: record?.ownerId ?? null }, reason: `deal ${name} lost — learn from it` });
        notes.push(`deal ${name} lost`);
      } else {
        actions.push({ tool: "create_task", params: { title: `Follow up on ${name}`, description: `Deal moved to ${to ?? "a new stage"}.`, ownerId: record?.ownerId ?? null }, reason: `deal ${name} stage change` });
      }
      break;
    }
    case "service": {
      const priority = record?.priority ?? "low";
      const ref = record?.reference ?? "ticket";
      const urgent = priority === "high" || priority === "urgent";
      actions.push({
        tool: "create_task",
        params: {
          title: urgent ? `⏰ Respond to ${ref} within SLA` : `Review ${ref}`,
          description: `SLA-protected response task for ${ref}: ${record?.subject ?? "ticket"}.`,
          priority: urgent ? "high" : "normal",
          ownerId: record?.ownerId ?? null,
        },
        reason: urgent ? `${ref} is ${priority} priority — response task with SLA guard` : `${ref} needs a first review`,
      });
      if (urgent) {
        actions.push({ tool: "notify", params: { userId: record?.ownerId, title: `⏰ SLA guard: ${ref}`, body: `${priority} ticket "${record?.subject ?? ""}" — respond within the SLA window.`, kind: "agent" }, reason: `${ref} is ${priority} — ping the assignee immediately` });
        notes.push(`${ref} is ${priority}`);
      }
      break;
    }
    case "renewal": {
      const close = record?.closeDate ? new Date(record.closeDate) : null;
      const days = close ? Math.ceil((close.getTime() - Date.now()) / 86_400_000) : null;
      const due = days !== null && days >= 0 && days <= 30;
      if (due) {
        actions.push({ tool: "create_task", params: { title: `🔄 Prepare renewal: ${name}`, description: `Deal closes in ${days} day(s) — prepare the renewal conversation.`, priority: "high", ownerId: record?.ownerId ?? null }, reason: `${name} closes in ${days} day(s) — renewal window open` });
        const contact = record?.contactId;
        if (contact) {
          actions.push({ tool: "send_email", params: { contactId: contact, subject: `Planning your renewal — ${name}`, body: `Hi,\n\nWe noticed ${name} is coming up for renewal soon. We'd love to make sure you get maximum value.\n\nBest,\nThe Qorvexa team`, reason: "" }, reason: `${name} renews in ${days} day(s) — customer-facing renewal outreach (approval)` });
        }
        actions.push({ tool: "notify", params: { userId: record?.ownerId, title: `🔄 Renewal window: ${name}`, body: `Deal closes in ${days} day(s) — start the renewal conversation.`, kind: "agent" }, reason: `${name} renewal window open` });
        notes.push(`${name} renews in ${days} days`);
      } else if (days !== null && days < 0) {
        actions.push({ tool: "create_task", params: { title: `Review closed deal: ${name}`, description: `Deal close date passed — check for upsell/renewal follow-up.`, ownerId: record?.ownerId ?? null }, reason: `${name} close date passed — inspect for follow-up` });
      } else if (days === null) {
        actions.push({ tool: "create_task", params: { title: `Track renewal: ${name}`, description: `Deal has no close date — set one to enable renewal tracking.`, ownerId: record?.ownerId ?? null }, reason: `${name} has no close date` });
      } else {
        actions.push({ tool: "create_task", params: { title: `Renewal watch: ${name}`, description: `Deal closes in ${days} day(s) — set a reminder to open the renewal conversation when the 30-day window arrives.`, ownerId: record?.ownerId ?? null }, reason: `${name} closes in ${days} day(s) — outside the 30-day window, keep watching` });
      }
      break;
    }
    default: {
      // Custom agents with no kind-specific logic: notify the owner as a baseline.
      actions.push({ tool: "notify", params: { userId: record?.ownerId, title: `Agent ${agent.name} noted ${name}`, body: `${entityName(entity)} ${name} triggered ${eventType ?? "a manual run"}.`, kind: "agent" }, reason: `default action for ${name}` });
      notes.push(`custom agent baseline`);
    }
  }

  const reasoning = notes.length ? notes.join("; ") : `no applicable rules for ${name}`;
  return { actions, reasoning };
}

// ── Execution ────────────────────────────────────────────────────────────────
function systemUserFor(agent: { orgId: string; environment: string; createdBy: string }) {
  return { id: agent.createdBy, orgId: agent.orgId, role: "admin", environment: agent.environment };
}

async function executeTool(agent: any, action: ProposedAction, tier: string, entity: string, entityId: string): Promise<{ status: string; result: Record<string, unknown> }> {
  const p = (action.params ?? {}) as Record<string, unknown>;
  const env = agent.environment;
  const orgId = agent.orgId;
  try {
    switch (action.tool) {
      case "create_task": {
        const svc = createObjectService({ type: "task" });
        const input: Record<string, unknown> = {
          title: String(p.title ?? "Agent task"),
          description: p.description ? String(p.description) : undefined,
          priority: String(p.priority ?? "medium"),
          status: "todo",
          ownerId: String(p.ownerId ?? agent.createdBy),
          dueAt: p.dueAt ? new Date(String(p.dueAt)) : undefined,
          contactId: p.contactId ? String(p.contactId) : entity === "contact" ? entityId : undefined,
          opportunityId: p.dealId ? String(p.dealId) : entity === "opportunity" ? entityId : undefined,
        };
        const created = await svc.create(systemUserFor(agent), Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), "agent");
        return { status: "ok", result: { entityId: created.id, title: created.title } };
      }
      case "notify": {
        const userId = p.userId ? String(p.userId) : agent.createdBy;
        const notif = await db().notification.create({
          data: {
            orgId,
            environment: env,
            userId,
            title: String(p.title ?? "Agent notification"),
            body: p.body ? String(p.body) : null,
            kind: "agent",
            link: `/${entityName(entity) === "deal" ? "deals" : `${entityName(entity)}s`}?id=${entityId}`,
          },
        });
        await emitEvent({ orgId, environment: env, type: "notification.created", entity: "notification", entityId: notif.id, actorId: agent.createdBy, payload: { userId, kind: "agent", title: notif.title } });
        return { status: "ok", result: { entityId: notif.id } };
      }
      case "update_record": {
        const svc = createObjectService({ type: entity });
        const updated = await svc.update(systemUserFor(agent), entityId, { [String(p.field)]: p.value });
        return { status: "ok", result: { entityId: updated.id, field: p.field, value: p.value } };
      }
      case "send_email": {
        if (!p.contactId) return { status: "failed", result: { error: "contactId required" } };
        const contact = await db().contact.findFirst({ where: { id: String(p.contactId), orgId, environment: env } });
        if (!contact) return { status: "failed", result: { error: "contact not found" } };
        const token = trackingToken();
        const message = await db().message.create({
          data: {
            orgId,
            environment: env,
            direction: "out",
            threadId: crypto.randomUUID(),
            trackingToken: token,
            fromEmail: "agents@qorvexa.dev",
            toEmail: contact.email ?? "unknown@example.com",
            subject: String(p.subject ?? "Update from Qorvexa"),
            body: String(p.body ?? ""),
            status: "sent",
            contactId: contact.id,
            ownerId: agent.createdBy,
          },
        });
        await emitEvent({ orgId, environment: env, type: "email.sent", entity: "message", entityId: message.id, actorId: agent.createdBy, payload: { to: message.toEmail, subject: message.subject, trackingToken: token, contactId: contact.id } });
        return { status: "ok", result: { entityId: message.id, to: message.toEmail } };
      }
      case "create_ticket": {
        const svc = createObjectService({ type: "ticket" });
        const created = await svc.create(
          systemUserFor(agent),
          {
            subject: String(p.subject ?? "Agent-created ticket"),
            description: p.description ? String(p.description) : undefined,
            priority: String(p.priority ?? "medium"),
            status: "new",
            channel: "web",
            source: "agent",
            ownerId: String(p.ownerId ?? agent.createdBy),
          },
          "agent"
        );
        return { status: "ok", result: { entityId: created.id, reference: (created as any).reference } };
      }
      default:
        return { status: "failed", result: { error: `unknown tool ${action.tool}` } };
    }
  } catch (err: any) {
    return { status: "failed", result: { error: err?.message ?? String(err) } };
  }
}

/** Effective tier for a tool, honoring the agent's tierPolicy override. */
function tierFor(agent: any, tool: string): string {
  const policy = (agent.tierPolicy ?? {}) as Record<string, string>;
  return policy[tool] ?? TOOL_TIERS[tool] ?? TIER_GREEN;
}

// ── The run ──────────────────────────────────────────────────────────────────
export type RunInput = {
  agent: any;
  entity: string;
  entityId: string;
  eventType?: string | null;
  payload?: Record<string, unknown>;
  trigger: string; // event | manual | test | orchestrated
  actorId: string;
  parentRunId?: string | null; // Phase 15 — delegation chain (orchestrator → child run)
};

/**
 * Execute one agent run against one record. Returns the run row + created
 * action rows. Green actions execute immediately; yellow actions are stored
 * proposed (run → waiting_approval) and wait for POST /approve; red actions
 * are stored proposed and require an admin approval (never auto).
 */
export async function runAgent(input: RunInput): Promise<any> {
  const { agent, entity, entityId, eventType, payload, trigger, actorId, parentRunId } = input;
  const orgId = agent.orgId;
  const environment = agent.environment;

  // Kill switch guard (org-wide + per-agent).
  if (agent.killSwitched || (await orgKillSwitch(orgId))) {
    return { skipped: true, reason: "kill switch active", run: null };
  }

  const delegate = (db() as any)[entity];
  const record = delegate ? await delegate.findUnique({ where: { id: entityId } }) : null;
  if (!record || record.orgId !== orgId || record.environment !== environment) throw notFound(`${entityName(entity)} not found`);
  if (!matchesRules(record, (agent.rules ?? []) as any)) return { skipped: true, reason: "rules did not match", run: null };

  const recent = await db().event.findMany({ where: { orgId, environment, entity, entityId }, orderBy: { createdAt: "desc" }, take: 8, select: { type: true, payload: true, createdAt: true } });
  const { context, redactions } = await buildContext(orgId, environment, entity, record, recent);
  const memory = await agentMemoryFor(orgId, environment, agent.id, entity, entityId);

  const decision = decideActions(agent, { orgId, environment, entity, record, eventType, payload });
  const allowedTools = new Set((agent.tools ?? []) as string[]);
  const proposals = decision.actions.filter((a) => allowedTools.has(a.tool));
  const { cost, modelId } = await runCost(orgId, environment, context, proposals);

  const run = await db().agentRun.create({
    data: {
      orgId,
      environment,
      agentId: agent.id,
      parentRunId: parentRunId ?? null,
      trigger,
      eventType: eventType ?? null,
      entity,
      entityId,
      context: { context, redactions, memory, modelId } as object,
      reasoning: decision.reasoning,
      status: "proposed",
      cost,
      createdBy: actorId,
    },
  });

  const actions: any[] = [];
  let yellow = 0;
  let red = 0;
  let green = 0;
  let success = true;

  for (const proposal of proposals) {
    const tier = tierFor(agent, proposal.tool);
    if (tier === TIER_YELLOW) yellow++;
    else if (tier === TIER_RED) red++;
    else green++;

    const action = await db().agentAction.create({
      data: {
        orgId,
        environment,
        runId: run.id,
        agentId: agent.id,
        tool: proposal.tool,
        riskTier: tier,
        params: proposal.params as object,
        reason: proposal.reason,
        status: "proposed",
        cost: cost / Math.max(1, proposals.length),
      },
    });
    actions.push(action);

    await emitEvent({
      orgId,
      environment,
      type: "agent.action_proposed",
      entity: "agent",
      entityId: agent.id,
      actorId,
      payload: { runId: run.id, actionId: action.id, tool: proposal.tool, riskTier: tier, entity, entityId, reason: proposal.reason },
    });

    if (tier === TIER_GREEN) {
      const outcome = await executeTool(agent, proposal, tier, entity, entityId);
      const finalStatus = outcome.status === "ok" ? "executed" : "failed";
      if (outcome.status !== "ok") success = false;
      await db().agentAction.update({ where: { id: action.id }, data: { status: finalStatus, result: outcome.result as object, updatedAt: new Date() } });
      await emitEvent({
        orgId,
        environment,
        type: "agent.action_executed",
        entity: "agent",
        entityId: agent.id,
        actorId,
        payload: { runId: run.id, actionId: action.id, tool: proposal.tool, status: finalStatus, result: outcome.result },
      });
    }
  }

  const status = yellow > 0 || red > 0 ? "waiting_approval" : success ? "executed" : "failed";
  const updated = await db().agentRun.update({
    where: { id: run.id },
    data: { status, riskSummary: { green, yellow, red } as object, updatedAt: new Date() },
  });

  await db().agent.update({
    where: { id: agent.id },
    data: {
      runCount: { increment: 1 },
      successCount: { increment: success && yellow === 0 && red === 0 ? 1 : 0 },
      approveCount: { increment: yellow > 0 || red > 0 ? 1 : 0 },
      costTotal: { increment: cost },
      updatedAt: new Date(),
    },
  });

  // Agent memory: remember what the agent learned about this entity.
  if (agent.memoryEnabled && decision.actions.length) {
    const existing = await db().agentMemory.findFirst({ where: { orgId, environment, agentId: agent.id, entity, entityId, key: "last.decision" } });
    const value = { reasoning: decision.reasoning, proposals: decision.actions.map((a) => a.tool), at: new Date().toISOString() };
    if (existing) {
      await db().agentMemory.update({ where: { id: existing.id }, data: { value: value as object, updatedAt: new Date() } });
    } else {
      await db().agentMemory.create({ data: { orgId, environment, agentId: agent.id, entity, entityId, key: "last.decision", value: value as object } });
    }
  }

  // 🟡 approval notifications — tell admins what is waiting.
  if (yellow > 0 || red > 0) {
    const admins = await db().user.findMany({ where: { orgId, role: "admin", active: true }, select: { id: true } });
    for (const a of admins) {
      await db().notification.create({
        data: {
          orgId,
          environment,
          userId: a.id,
          title: `Agent ${agent.name} needs ${yellow > 0 ? "approval" : "review"} 🟡`,
          body: `${proposals.filter((p, i) => actions[i] && actions[i].riskTier !== TIER_GREEN).length} action(s) on ${entityName(entity)} ${entityId} await ${yellow > 0 ? "approval" : "human review"}.`,
          kind: "agent",
          link: `/agents?run=${run.id}`,
        },
      });
    }
  }

  return { run: updated, actions, status, cost, modelId, redactions };
}

// ── Testing / simulation lab (🆕 blueprint) ─────────────────────────────────
/**
 * Dry-run a scenario (NO execution). Reports pass/block/failed:
 *   passed  — every proposed action is green or yellow (governance allows it)
 *   blocked — a red-tier action was proposed (human required → not go-live safe)
 *   failed  — no actions proposed, record missing, or rules didn't match
 */
export async function testAgent(agent: any, entity: string, entityId: string, name: string, actorId: string): Promise<any> {
  const orgId = agent.orgId;
  const environment = agent.environment;
  const delegate = (db() as any)[entity];
  const record = delegate ? await delegate.findUnique({ where: { id: entityId } }) : null;
  if (!record || record.orgId !== orgId || record.environment !== environment) throw notFound(`${entityName(entity)} not found`);
  const matched = matchesRules(record, (agent.rules ?? []) as any);

  const recent = await db().event.findMany({ where: { orgId, environment, entity, entityId }, orderBy: { createdAt: "desc" }, take: 8, select: { type: true, payload: true, createdAt: true } });
  const { context, redactions } = await buildContext(orgId, environment, entity, record, recent);
  const decision = decideActions(agent, { orgId, environment, entity, record });
  const allowedTools = new Set((agent.tools ?? []) as string[]);
  const proposals = decision.actions.filter((a) => allowedTools.has(a.tool));
  const { cost } = await runCost(orgId, environment, context, proposals);

  const tiers = proposals.map((p) => ({ tool: p.tool, riskTier: tierFor(agent, p.tool), reason: p.reason }));
  const redCount = tiers.filter((t) => t.riskTier === TIER_RED).length;
  const green = tiers.filter((t) => t.riskTier === TIER_GREEN).length;
  const yellow = tiers.filter((t) => t.riskTier === TIER_YELLOW).length;
  const riskSummary = { green, yellow, red: redCount };

  let status = "failed";
  let note = "no actions proposed";
  if (matched && proposals.length && redCount === 0) {
    status = "passed";
    note = "every proposed action is executable under governance (green auto / yellow approval)";
  } else if (matched && proposals.length && redCount > 0) {
    status = "blocked";
    note = `${redCount} red-tier action(s) require a human — agent is not go-live safe for this scenario`;
  } else if (!matched) {
    note = "agent rules did not match this record";
  }

  const test = await db().agentTest.create({
    data: {
      orgId,
      environment,
      agentId: agent.id,
      name,
      entity,
      entityId,
      status,
      actions: tiers as unknown as object,
      riskSummary: riskSummary as object,
      predictedCost: cost,
      note,
      createdBy: actorId,
    },
  });
  return { test, status, note, riskSummary, cost };
}

// ── Approval / rejection ─────────────────────────────────────────────────────
/** Approve a waiting 🟡/🔴 action and execute it. Admin for red; admin/manager for yellow. */
export async function approveAction(actionId: string, approver: { id: string; orgId: string; role: string }, environment: string): Promise<any> {
  const action = await db().agentAction.findUnique({ where: { id: actionId } });
  if (!action || action.orgId !== approver.orgId || action.environment !== environment) throw notFound("Action not found");
  if (action.status !== "proposed") throw badRequest(`Action is ${action.status}, not awaiting approval`);
  if (action.riskTier === TIER_RED && approver.role !== "admin") throw badRequest("Red-tier actions require an admin (human required)");
  if (action.riskTier === TIER_GREEN) throw badRequest("Green actions execute automatically");

  const agent = await db().agent.findUnique({ where: { id: action.agentId } });
  if (!agent || agent.orgId !== approver.orgId) throw notFound("Agent not found");

  const proposal: ProposedAction = { tool: action.tool, params: (action.params as Record<string, unknown>) ?? {}, reason: action.reason ?? "" };
  const run = await db().agentRun.findUnique({ where: { id: action.runId } });
  const outcome = await executeTool(agent, proposal, action.riskTier, run?.entity ?? "contact", run?.entityId ?? "");

  const finalStatus = outcome.status === "ok" ? "executed" : "failed";
  await db().agentAction.update({ where: { id: action.id }, data: { status: finalStatus, result: outcome.result as object, approvedBy: approver.id, updatedAt: new Date() } });

  // Re-check the run: if no proposed actions remain, close it.
  const remaining = await db().agentAction.count({ where: { runId: action.runId, status: "proposed" } });
  if (remaining === 0 && run) {
    await db().agentRun.update({ where: { id: run.id }, data: { status: outcome.status === "ok" ? "executed" : "failed", updatedAt: new Date() } });
  }

  await emitEvent({
    orgId: approver.orgId,
    environment,
    type: "agent.action_approved",
    entity: "agent",
    entityId: agent.id,
    actorId: approver.id,
    payload: { actionId: action.id, runId: action.runId, tool: action.tool, status: finalStatus, result: outcome.result },
  });

  return { action: { ...action, status: finalStatus, result: outcome.result, approvedBy: approver.id }, outcome };
}

export async function rejectAction(actionId: string, approver: { id: string; orgId: string; role: string }, environment: string): Promise<any> {
  const action = await db().agentAction.findUnique({ where: { id: actionId } });
  if (!action || action.orgId !== approver.orgId || action.environment !== environment) throw notFound("Action not found");
  if (action.status !== "proposed") throw badRequest(`Action is ${action.status}, not awaiting approval`);
  await db().agentAction.update({ where: { id: action.id }, data: { status: "rejected", approvedBy: approver.id, result: { rejected: true } as object, updatedAt: new Date() } });
  const remaining = await db().agentAction.count({ where: { runId: action.runId, status: "proposed" } });
  if (remaining === 0) {
    await db().agentRun.update({ where: { id: action.runId }, data: { status: "rejected", updatedAt: new Date() } });
  }
  await emitEvent({ orgId: approver.orgId, environment, type: "agent.action_rejected", entity: "agent", entityId: action.agentId, actorId: approver.id, payload: { actionId: action.id, runId: action.runId, tool: action.tool } });
  return { ok: true };
}

// ── Analytics + metering ─────────────────────────────────────────────────────
export async function agentAnalytics(orgId: string, environment: string) {
  const agents = await db().agent.findMany({ where: { orgId, environment }, orderBy: { name: "asc" } });
  const rows = await Promise.all(
    agents.map(async (a) => {
      const runs = await db().agentRun.count({ where: { orgId, environment, agentId: a.id } });
      const successRuns = await db().agentRun.count({ where: { orgId, environment, agentId: a.id, status: "executed" } });
      const waiting = await db().agentRun.count({ where: { orgId, environment, agentId: a.id, status: "waiting_approval" } });
      const actions = await db().agentAction.count({ where: { orgId, environment, agentId: a.id } });
      const yellowActions = await db().agentAction.count({ where: { orgId, environment, agentId: a.id, riskTier: TIER_YELLOW } });
      const redActions = await db().agentAction.count({ where: { orgId, environment, agentId: a.id, riskTier: TIER_RED } });
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        active: a.active,
        killSwitched: a.killSwitched,
        runs,
        successRuns,
        successRate: runs ? Math.round((successRuns / runs) * 100) : 0,
        waitingApproval: waiting,
        actions,
        escalationRate: actions ? Math.round(((yellowActions + redActions) / actions) * 100) : 0,
        costTotal: a.costTotal,
        runCount: a.runCount,
        approveCount: a.approveCount,
      };
    })
  );
  const totals = rows.reduce(
    (acc, r) => ({
      runs: acc.runs + r.runs,
      actions: acc.actions + r.actions,
      costTotal: acc.costTotal + r.costTotal,
      waitingApproval: acc.waitingApproval + r.waitingApproval,
    }),
    { runs: 0, actions: 0, costTotal: 0, waitingApproval: 0 }
  );
  return { agents: rows, totals };
}

export async function agentMetering(orgId: string, environment: string) {
  const agents = await db().agent.findMany({ where: { orgId, environment }, orderBy: { costTotal: "desc" }, select: { id: true, name: true, kind: true, runCount: true, costTotal: true } });
  const byEntity = await db().agentRun.groupBy({ by: ["entity"], where: { orgId, environment }, _sum: { cost: true }, _count: { _all: true } });
  const total = agents.reduce((s, a) => s + a.costTotal, 0);
  const model = await cheapestModel(orgId, environment);
  return { total, currency: "USD (simulated)", model: model.name, agents, byEntity };
}

// ── Engine (event-bus subscriber, like automations) ─────────────────────────
let engineStarted = false;

export function startAgentEngine() {
  if (engineStarted) return;
  engineStarted = true;
  // Subscribe to the whole bus; agents filter by their own trigger event.
  onEvent("*", async (event: PersistedEvent) => {
    try {
      const agents = await db().agent.findMany({ where: { orgId: event.orgId, environment: event.environment, active: true } });
      for (const agent of agents) {
        const trigger = (agent.trigger ?? {}) as { kind?: string; event?: string };
        if (trigger.kind !== "event" || trigger.event !== event.type) continue;
        const entity = (event.type.split(".")[0] === "deal" ? "opportunity" : event.type.split(".")[0]) as string;
        if (event.entity && event.entity !== entity && event.entity !== event.type.split(".")[0]) continue;
        const target = event.entity ?? event.type.split(".")[0];
        try {
          await runAgent({
            agent,
            entity: target === "deal" ? "opportunity" : target,
            entityId: event.entityId,
            eventType: event.type,
            payload: (event.payload ?? {}) as Record<string, unknown>,
            trigger: "event",
            actorId: event.actorId,
          });
        } catch (err) {
          console.error(`[agent-engine] ${agent.name} failed on ${event.type}:`, (err as Error)?.message ?? err);
        }
      }
    } catch (err) {
      console.error("[agent-engine] dispatch error:", (err as Error)?.message ?? err);
    }
  });
  // Ticker: purge expired agent memory.
  setInterval(() => {
    db().agentMemory
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);
  }, 60_000);
  console.log("  Agents       · engine subscribed (event bus) + memory ticker");
}
