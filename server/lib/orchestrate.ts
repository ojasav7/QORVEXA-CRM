// Multi-agent orchestration (Phase 15) — agents delegate to each other via an
// orchestrator.
//
// An AgentOrchestrator is a config row (same discipline as agents/workflows):
// a trigger (event | manual) fans out to child Phase 9 agents in parallel or
// sequence. Each child invocation goes through the EXISTING Phase 9 runAgent
// pipeline (risk tiers, kill switches, cost metering, approval queue — nothing
// new), and every delegation is recorded as an AgentDelegation row linking the
// orchestrator → child AgentRun (AgentRun.parentRunId keeps the chain, so the
// AI audit trail spans the delegation). Events: agent.delegated.
import { db } from "../db";
import { emitEvent, onEvent } from "./events";
import { notFound, badRequest } from "./http";
import { runAgent } from "./agents";

export async function listOrchestrators(orgId: string, environment: string) {
  return db().agentOrchestrator.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" } });
}

export async function getOrchestrator(orgId: string, environment: string, id: string) {
  const row = await db().agentOrchestrator.findUnique({ where: { id } });
  if (!row || row.orgId !== orgId || row.environment !== environment) throw notFound("Orchestrator not found");
  return row;
}

export async function createOrchestrator(orgId: string, environment: string, actorId: string, input: { name: string; description?: string; trigger: { kind: string; event?: string }; childAgentIds: string[]; mode: string }) {
  if (!input.name || !input.name.trim()) throw badRequest("name is required");
  if (!["parallel", "sequential"].includes(input.mode)) throw badRequest("mode must be parallel | sequential");
  if (!input.childAgentIds.length) throw badRequest("childAgentIds must not be empty");
  if (input.trigger.kind === "event" && !input.trigger.event) throw badRequest("an event trigger needs an event type");
  const children = await db().agent.findMany({ where: { id: { in: input.childAgentIds }, orgId, environment } });
  if (children.length !== input.childAgentIds.length) throw badRequest("one or more child agents do not exist in this org × environment");
  return db().agentOrchestrator.create({
    data: {
      orgId,
      environment,
      name: input.name,
      description: input.description ?? null,
      trigger: { kind: input.trigger.kind, event: input.trigger.kind === "event" ? input.trigger.event : null } as object,
      childAgentIds: input.childAgentIds as unknown as object,
      mode: input.mode,
      active: true,
      createdBy: actorId,
    },
  });
}

export async function updateOrchestrator(orgId: string, environment: string, id: string, input: Partial<{ name: string; description: string | null; trigger: { kind: string; event?: string }; childAgentIds: string[]; mode: string; active: boolean }>) {
  const existing = await getOrchestrator(orgId, environment, id);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.mode !== undefined) {
    if (!["parallel", "sequential"].includes(input.mode)) throw badRequest("mode must be parallel | sequential");
    data.mode = input.mode;
  }
  if (input.active !== undefined) data.active = input.active;
  if (input.trigger !== undefined) {
    if (input.trigger.kind === "event" && !input.trigger.event) throw badRequest("an event trigger needs an event type");
    data.trigger = { kind: input.trigger.kind, event: input.trigger.kind === "event" ? input.trigger.event : null } as object;
  }
  if (input.childAgentIds !== undefined) {
    const children = await db().agent.findMany({ where: { id: { in: input.childAgentIds }, orgId, environment } });
    if (children.length !== input.childAgentIds.length) throw badRequest("one or more child agents do not exist in this org × environment");
    data.childAgentIds = input.childAgentIds as unknown as object;
  }
  return db().agentOrchestrator.update({ where: { id: existing.id }, data: { ...data, updatedAt: new Date() } });
}

export async function deleteOrchestrator(orgId: string, environment: string, id: string) {
  const existing = await getOrchestrator(orgId, environment, id);
  await db().agentOrchestrator.delete({ where: { id: existing.id } });
}

/**
 * Run an orchestrator against one record: delegate to each child agent through
 * the Phase 9 run pipeline. Records an AgentDelegation per child and emits
 * agent.delegated. Sequential mode stops at the first failed run.
 */
export async function runOrchestrator(input: { orchestrator: any; entity: string; entityId: string; eventType?: string | null; actorId: string }) {
  const { orchestrator, entity, entityId, eventType, actorId } = input;
  const orgId = orchestrator.orgId;
  const environment = orchestrator.environment;
  const childIds = (orchestrator.childAgentIds ?? []) as string[];
  const children = await db().agent.findMany({ where: { id: { in: childIds }, orgId, environment } });
  const byId = new Map(children.map((c) => [c.id, c]));

  const delegations: any[] = [];
  let failed = 0;
  for (const childId of childIds) {
    const child = byId.get(childId);
    if (!child) {
      delegations.push({ childAgentId: childId, status: "skipped", reason: "child agent missing" });
      failed++;
      continue;
    }
    if (child.killSwitched) {
      const d = await db().agentDelegation.create({ data: { orgId, environment, orchestratorId: orchestrator.id, childAgentId: child.id, entity, entityId, status: "skipped", reason: "child kill-switched", createdAt: new Date() } });
      delegations.push(d);
      failed++;
      continue;
    }
    const outcome = await runAgent({ agent: child, entity, entityId, eventType: eventType ?? null, trigger: "orchestrated", actorId }).catch((e) => ({ run: null, error: String(e?.message ?? e) }));
    if (outcome.skipped) {
      const d = await db().agentDelegation.create({ data: { orgId, environment, orchestratorId: orchestrator.id, childAgentId: child.id, entity, entityId, status: "skipped", reason: outcome.reason, createdAt: new Date() } });
      delegations.push(d);
      continue;
    }
    if (!outcome.run) {
      const d = await db().agentDelegation.create({ data: { orgId, environment, orchestratorId: orchestrator.id, childAgentId: child.id, entity, entityId, status: "failed", reason: outcome.error ?? "run failed", createdAt: new Date() } });
      delegations.push(d);
      failed++;
      if (orchestrator.mode === "sequential") break;
      continue;
    }
    const d = await db().agentDelegation.create({
      data: { orgId, environment, orchestratorId: orchestrator.id, childAgentId: child.id, childRunId: outcome.run.id, parentRunId: outcome.run.parentRunId ?? null, entity, entityId, status: "delegated", reason: null, createdAt: new Date() },
    });
    delegations.push(d);
    await emitEvent({
      orgId,
      environment,
      type: "agent.delegated",
      entity: entity,
      entityId,
      actorId,
      payload: { orchestratorId: orchestrator.id, childAgentId: child.id, childRunId: outcome.run.id, delegationId: d.id, status: outcome.run.status, mode: orchestrator.mode },
    });
    if (orchestrator.mode === "sequential" && outcome.run.status === "failed") {
      failed++;
      break;
    }
  }

  await db().agentOrchestrator.update({ where: { id: orchestrator.id }, data: { runCount: { increment: 1 }, updatedAt: new Date() } });
  return { delegations, failed, total: childIds.length };
}

export async function listDelegations(orgId: string, environment: string, orchestratorId?: string) {
  return db().agentDelegation.findMany({ where: { orgId, environment, ...(orchestratorId ? { orchestratorId } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
}

/** Dry-run: report which children would match + their risk posture, without executing. */
export async function testOrchestrator(orgId: string, environment: string, orchestratorId: string, entity: string, entityId: string, actorId: string) {
  const orchestrator = await getOrchestrator(orgId, environment, orchestratorId);
  const childIds = (orchestrator.childAgentIds ?? []) as string[];
  const children = await db().agent.findMany({ where: { id: { in: childIds }, orgId, environment } });
  const results: any[] = [];
  for (const child of children) {
    results.push({
      childAgentId: child.id,
      childName: child.name,
      active: child.active && !child.killSwitched,
      tools: (child.tools ?? []) as string[],
      tierPolicy: (child.tierPolicy ?? {}) as object,
      wouldRun: child.active && !child.killSwitched,
    });
  }
  return { orchestratorId, entity, entityId, mode: orchestrator.mode, children: results };
}

/** Orchestration engine — fires orchestrators whose event trigger matches. */
export function startOrchestrationEngine() {
  onEvent("*", async (event) => {
    try {
      const orchestrators = await db().agentOrchestrator.findMany({ where: { orgId: event.orgId, environment: event.environment, active: true } });
      const matches = orchestrators.filter((o) => {
        const t = (o.trigger ?? {}) as { kind?: string; event?: string };
        return t.kind === "event" && t.event === event.type;
      });
      for (const o of matches) {
        try {
          await runOrchestrator({ orchestrator: o, entity: event.entity, entityId: event.entityId, eventType: event.type, actorId: event.actorId });
        } catch (e) {
          console.error("[orchestrator run failed]", o.id, e);
        }
      }
    } catch (e) {
      console.error("[orchestration engine]", e);
    }
  });
  // Loop protection is delegated to the child agents themselves (Phase 9 run guard).
}
