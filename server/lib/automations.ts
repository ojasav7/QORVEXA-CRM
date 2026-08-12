// Automation engine (Phase 3) — the workflow runtime over the event bus.
//
// A workflow is a declarative row (Automation): trigger (an event, optionally
// filtered, e.g. deal.stage_changed → "won") → conditions (field filters on the
// triggering record + event payload) → actions (create task / notify /
// update record). This module subscribes to every persisted event via
// onEvent("*") and evaluates matching org × environment workflows in-process
// (ADR-015). Actions run through the generic object service so task/note writes
// get audit + events + validation for free; notifications are direct rows.
//
// Loop protection: an in-memory cooldown keyed (automationId, entityId,
// eventType) skips repeat runs within 30s — an action's own emitted event
// (e.g. update_record → deal.updated) can never re-fire the same workflow
// endlessly. Runs are logged to AutomationRun for the conflict-resolution UI.
import { onEvent, emitEvent, type PersistedEvent } from "./events";
import { db } from "../db";
import { createObjectService } from "./object-service";
import { getObjectDef } from "./registry";
import { mergeTemplate } from "./comm";
import { badRequest } from "./http";

// ── Workflow shapes (ADR-015; docs/15-spec-phase3.md §3) ─────────────────────
export type AutomationTrigger = { kind: "event"; event: string; to?: string };
export type AutomationCondition = { field: string; op: string; value: unknown };
export type AutomationAction =
  | { type: "create_task"; title: string; description?: string; dueInDays?: number; priority?: string }
  | { type: "notify"; title: string; body?: string; target: "owner" | "actor" | "user"; userId?: string }
  | { type: "update_record"; field: string; value: unknown };

// The trigger catalog (v1): event → the object type its entityId refers to.
// deal.* maps to the opportunity collection (the event prefix is "deal").
export const EVENT_OBJECT_TYPES: Record<string, string> = {
  "deal.stage_changed": "opportunity",
  "deal.created": "opportunity",
  "deal.updated": "opportunity",
  "lead.created": "lead",
  "contact.created": "contact",
  "task.completed": "task",
};
export const TRIGGER_EVENTS = Object.keys(EVENT_OBJECT_TYPES);

export const CONDITION_OPS = ["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "in", "not_in"];

const COOLDOWN_MS = 30_000;
const cooldown = new Map<string, number>();

/** Prune stale cooldown entries (called on each set — bounded memory). */
function cooldownCheck(key: string, now: number) {
  if (cooldown.size > 500) {
    for (const [k, t] of cooldown) {
      if (now - t > COOLDOWN_MS) cooldown.delete(k);
    }
  }
  cooldown.set(key, now);
}

export type ActionOutcome = { type: string; status: "ok" | "skipped" | "failed"; detail?: string; entityId?: string };

// ── Validation (shared by the routes) ────────────────────────────────────────
// Condition fields must be a registry field of the trigger's object type, or a
// `payload.*` path (e.g. payload.to). Unknown fields fail the save (400) —
// never silently true/false at runtime.
export function parseWorkflowParts(raw: unknown): {
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
} {
  const r = (raw ?? {}) as Record<string, any>;
  const trigger = (r.trigger ?? {}) as Record<string, any>;
  const event = String(trigger.event ?? "");
  if (!TRIGGER_EVENTS.includes(event)) throw badRequest(`Unknown trigger event "${event}"`);
  const objectType = EVENT_OBJECT_TYPES[event];
  if (event === "deal.stage_changed" && trigger.to !== undefined && typeof trigger.to !== "string") {
    throw badRequest("Trigger `to` (stage) must be a string");
  }

  const def = getObjectDef(objectType);
  const conditions: AutomationCondition[] = Array.isArray(r.conditions) ? r.conditions : [];
  for (const c of conditions) {
    if (!c || typeof c.field !== "string") throw badRequest("Each condition needs a field");
    const field = c.field;
    const isPayloadPath = field.startsWith("payload.");
    if (!isPayloadPath && !def.fields.some((f) => f.key === field)) {
      throw badRequest(`Unknown condition field "${field}" on ${objectType}`);
    }
    if (!CONDITION_OPS.includes(c.op)) throw badRequest(`Unknown condition operator "${c.op}"`);
  }

  const actions: AutomationAction[] = Array.isArray(r.actions) ? r.actions : [];
  for (const a of actions) {
    if (!a || typeof a.type !== "string") throw badRequest("Each action needs a type");
    switch (a.type) {
      case "create_task":
        if (typeof a.title !== "string" || !a.title.trim()) throw badRequest("create_task needs a title");
        if (a.dueInDays !== undefined && (!Number.isInteger(a.dueInDays) || a.dueInDays < 0 || a.dueInDays > 365)) throw badRequest("dueInDays must be 0–365");
        if (a.priority !== undefined && !["low", "medium", "high"].includes(a.priority)) throw badRequest("priority must be low | medium | high");
        break;
      case "notify":
        if (typeof a.title !== "string" || !a.title.trim()) throw badRequest("notify needs a title");
        if (!["owner", "actor", "user"].includes(a.target)) throw badRequest("notify target must be owner | actor | user");
        if (a.target === "user" && typeof a.userId !== "string") throw badRequest("notify with target=user needs a userId");
        break;
      case "update_record":
        if (typeof a.field !== "string" || !def.fields.some((f) => f.key === a.field)) {
          throw badRequest(`update_record field "${a.field}" is not on ${objectType}`);
        }
        break;
      default:
        throw badRequest(`Unknown action type "${(a as any).type}"`);
    }
  }

  return {
    trigger: { kind: "event", event, ...(event === "deal.stage_changed" && trigger.to ? { to: String(trigger.to) } : {}) },
    conditions,
    actions,
  };
}

/** Stable JSON serialization (sorted keys + arrays) so semantically equal
 * conditions/actions fingerprint the same regardless of key order. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Fingerprint for duplicate-automation detection (trigger + conditions + actions).
 * Conditions and actions are order-normalized so reordering rows (a semantically
 * identical workflow) still trips the 409 guard. */
export function workflowFingerprint(parts: { trigger: unknown; conditions: unknown; actions: unknown }): string {
  const conditions = Array.isArray(parts.conditions)
    ? [...(parts.conditions as unknown[])].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
    : [];
  const actions = Array.isArray(parts.actions)
    ? [...(parts.actions as unknown[])].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
    : [];
  return JSON.stringify([parts.trigger, conditions, actions]);
}

// ── Engine ───────────────────────────────────────────────────────────────────
// Subscribe once at boot. Every event fans in here; we query the org's active
// workflows and evaluate matches. Runs synchronously with the event so a smoke
// test can assert automation side effects immediately after the trigger.
export function startAutomationEngine() {
  onEvent("*", async (event) => {
    try {
      await runEngineForEvent(event, "event");
    } catch (e) {
      console.error("[automation engine]", e);
    }
  });
}

/** Evaluate all active workflows of the event's org × environment. */
export async function runEngineForEvent(event: PersistedEvent, triggeredBy: "event" | "test") {
  const automations = await db().automation.findMany({
    where: { orgId: event.orgId, environment: event.environment, active: true },
  });
  for (const auto of automations) {
    await runAutomation(auto as any, event, triggeredBy);
  }
}

/** Run one workflow against an event; returns the outcome (for the test route). */
export async function runAutomation(
  auto: {
    id: string;
    orgId: string;
    environment: string;
    name: string;
    trigger: unknown;
    conditions: unknown;
    actions: unknown;
    createdBy: string;
  },
  event: PersistedEvent,
  triggeredBy: "event" | "test"
): Promise<{ matched: boolean; note?: string; actions: ActionOutcome[] }> {
  const trigger = (auto.trigger ?? {}) as { kind?: string; event?: string; to?: string };
  if (String(trigger.kind) !== "event" || trigger.event !== event.type) {
    return { matched: false, note: `trigger ${trigger.event ?? "?"} ≠ ${event.type}`, actions: [] };
  }
  // Extra trigger filter (e.g. deal.stage_changed → to: "won").
  if (event.type === "deal.stage_changed" && trigger.to && event.payload?.to !== trigger.to) {
    await logRun(auto, event, triggeredBy, false, `stage ${String(event.payload?.to)} ≠ ${trigger.to}`, []);
    return { matched: false, note: `stage ${String(event.payload?.to)} ≠ ${trigger.to}`, actions: [] };
  }

  // Loop guard: skip a repeat of the same (workflow, entity, event) within 30s.
  if (triggeredBy === "event") {
    const key = `${auto.id}:${event.entityId}:${event.type}`;
    const last = cooldown.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) {
      return { matched: false, note: "skipped (cooldown)", actions: [] };
    }
    cooldownCheck(key, Date.now());
  }

  // Resolve the triggering record (may be gone — log and continue gracefully).
  let record: any = null;
  try {
    const delegate = (db() as any)[event.entity];
    if (delegate?.findUnique) record = await delegate.findUnique({ where: { id: event.entityId } });
  } catch {
    record = null;
  }

  const conditions = Array.isArray(auto.conditions) ? (auto.conditions as AutomationCondition[]) : [];
  const context = { record, payload: (event.payload ?? {}) as Record<string, unknown> };
  for (const c of conditions) {
    if (!evalCondition(c, context)) {
      const note = `condition failed: ${c.field} ${c.op} ${String(c.value)}`;
      await logRun(auto, event, triggeredBy, false, note, []);
      return { matched: false, note, actions: [] };
    }
  }

  // Execute actions — each is isolated so one failure never aborts the rest.
  const actions = Array.isArray(auto.actions) ? (auto.actions as AutomationAction[]) : [];
  const outcomes: ActionOutcome[] = [];
  for (const action of actions) {
    outcomes.push(await executeAction(auto, action, context, event));
  }

  await db().automation.update({
    where: { id: auto.id },
    data: { runCount: { increment: 1 }, lastRunAt: new Date(), updatedAt: new Date() },
  });
  await logRun(auto, event, triggeredBy, true, undefined, outcomes);
  await emitEvent({
    orgId: event.orgId,
    environment: event.environment,
    type: "automation.triggered",
    entity: "automation",
    entityId: auto.id,
    actorId: event.actorId,
    payload: { automationId: auto.id, name: auto.name, eventType: event.type, entity: event.entity, entityId: event.entityId, matched: true, actionCount: outcomes.length },
  });
  return { matched: true, actions: outcomes };
}

async function logRun(
  auto: { id: string; orgId: string; environment: string },
  event: PersistedEvent,
  triggeredBy: "event" | "test",
  matched: boolean,
  note: string | undefined,
  actions: ActionOutcome[]
) {
  try {
    await db().automationRun.create({
      data: {
        orgId: event.orgId,
        environment: event.environment,
        automationId: auto.id,
        eventType: event.type,
        entity: event.entity,
        entityId: event.entityId,
        matched,
        actions: actions as object,
        note: note ?? null,
        triggeredBy,
      },
    });
  } catch (e) {
    console.error("[automation run log]", e);
  }
}

// ── Conditions ───────────────────────────────────────────────────────────────
// field resolves against the record first, then the event payload (payload.*).
function resolveField(context: { record: any; payload: Record<string, unknown> }, field: string): unknown {
  if (field.startsWith("payload.")) return context.payload[field.slice("payload.".length)];
  return context.record?.[field];
}

function evalCondition(c: AutomationCondition, context: { record: any; payload: Record<string, unknown> }): boolean {
  const actual = resolveField(context, c.field);
  const expected = c.value;
  switch (c.op) {
    case "eq":
      return String(actual ?? "") === String(expected ?? "");
    case "neq":
      return String(actual ?? "") !== String(expected ?? "");
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "not_contains":
      return !String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "in":
      return (Array.isArray(expected) ? expected : String(expected ?? "").split(",").map((s) => s.trim())).includes(String(actual ?? ""));
    case "not_in":
      return !(Array.isArray(expected) ? expected : String(expected ?? "").split(",").map((s) => s.trim())).includes(String(actual ?? ""));
    default:
      return false;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────
// Actions act as the workflow's creator (org-level admin actor, ADR-015): the
// generic object service gets a system user with the automation creator's id so
// audit names a real person while field permissions never block automation.
function systemUserFor(auto: { orgId: string; environment: string; createdBy: string }) {
  return { id: auto.createdBy, orgId: auto.orgId, role: "admin", environment: auto.environment };
}

/** Merge vars for {{field}} templating: record fields + payload at payload.* */
function templateVars(record: any, payload: Record<string, unknown>): Record<string, unknown> {
  return { ...(record ?? {}), payload };
}

async function executeAction(
  auto: { id: string; orgId: string; environment: string; createdBy: string },
  action: AutomationAction,
  context: { record: any; payload: Record<string, unknown> },
  event: PersistedEvent
): Promise<ActionOutcome> {
  try {
    switch (action.type) {
      case "create_task": {
        const vars = templateVars(context.record, context.payload);
        const title = mergeTemplate(action.title, vars).trim() || "Follow up";
        const input: Record<string, unknown> = {
          title,
          description: action.description ? mergeTemplate(action.description, vars).trim() || null : null,
          priority: action.priority ?? "medium",
          status: "todo",
          // dueInDays 0 is valid (0–365) — only `undefined` means "no due date".
          dueAt: action.dueInDays !== undefined ? new Date(Date.now() + action.dueInDays * 86_400_000) : null,
          ownerId: context.record?.ownerId ?? event.actorId,
        };
        // Link the task to the triggering record where the task model supports it.
        if (event.entity === "opportunity") input.opportunityId = event.entityId;
        if (event.entity === "contact") input.contactId = event.entityId;
        const svc = createObjectService({ type: "task" });
        const task = await svc.create(systemUserFor(auto), input);
        return { type: "create_task", status: "ok", detail: `Task "${title}" created`, entityId: task.id };
      }
      case "notify": {
        let targetId: string | null = null;
        if (action.target === "owner") targetId = context.record?.ownerId ?? event.actorId;
        else if (action.target === "actor") targetId = event.actorId;
        else if (action.target === "user") targetId = action.userId ?? null;
        if (!targetId) return { type: "notify", status: "skipped", detail: "no target user" };
        // Cross-tenant guard: the target must be a real, same-org user — a
        // workflow must never write a notification for another org's member.
        const target = await db().user.findUnique({ where: { id: targetId }, select: { orgId: true, active: true } });
        if (!target || target.orgId !== event.orgId || !target.active) {
          return { type: "notify", status: "skipped", detail: "target user is not in this org" };
        }
        const vars = templateVars(context.record, context.payload);
        const notif = await db().notification.create({
          data: {
            orgId: event.orgId,
            environment: event.environment,
            userId: targetId,
            title: mergeTemplate(action.title, vars).trim() || "Automation notification",
            body: action.body ? mergeTemplate(action.body, vars).trim() || null : null,
            kind: "automation",
            link: `/${event.entity === "opportunity" ? "deals" : `${event.entity}s`}?id=${event.entityId}`,
          },
        });
        await emitEvent({
          orgId: event.orgId,
          environment: event.environment,
          type: "notification.created",
          entity: "notification",
          entityId: notif.id,
          actorId: event.actorId,
          payload: { userId: targetId, kind: "automation", title: notif.title },
        });
        return { type: "notify", status: "ok", detail: `Notified ${targetId}`, entityId: notif.id };
      }
      case "update_record": {
        if (!context.record) return { type: "update_record", status: "skipped", detail: "record gone" };
        const svc = createObjectService({ type: event.entity });
        const updated = await svc.update(systemUserFor(auto), event.entityId, { [action.field]: action.value });
        return { type: "update_record", status: "ok", detail: `${action.field} = ${String(action.value)}`, entityId: updated.id };
      }
      default:
        return { type: (action as any).type ?? "unknown", status: "failed", detail: "unknown action type" };
    }
  } catch (e: any) {
    return { type: action.type, status: "failed", detail: e?.message ?? "action failed" };
  }
}
