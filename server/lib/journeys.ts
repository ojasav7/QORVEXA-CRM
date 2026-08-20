// Journey engine (Phase 5 · Marketing Automation) — ADR-017.
//
// A Journey is a declarative row: a trigger (an event, or entry when a
// contact joins a segment) and an ordered list of steps (wait / send_email /
// notify / create_task / update_record / condition / end). The engine
// subscribes to the event bus like workflows (onEvent("*")) and enrolls the
// triggering record; a TICKER (setInterval, 60s v1) advances enrollments
// whose nextRunAt is due, so `wait` steps gain the time dimension the pure
// event-driven workflow engine lacks. Every executed step logs a
// JourneyStepRun + emits journey.step_entered. Loop protection: one active
// enrollment per (journey, entity).
//
// Steps run through the same helpers as workflows (generic object service for
// create_task/update_record, comm/email path for send_email, Notification
// rows for notify) so audit + events + tracking come along. The admin can
// trigger a ticker pass manually (POST /api/journeys/advance) for
// deterministic tests — a backdated nextRunAt advances immediately.
import { onEvent, emitEvent, type PersistedEvent } from "./events";
import { db } from "../db";
import { createObjectService } from "./object-service";
import { getObjectDef } from "./registry";
import { mergeTemplate, trackingToken } from "./comm";
import { sendOutboundWithProvider } from "./integrations/email";
import { listConditions } from "./access";
import { parseCriteria, criteriaWhere } from "./segments";
import { badRequest } from "./http";

// ── Journey shapes ───────────────────────────────────────────────────────────
export type JourneyStep =
  | { type: "wait"; hours?: number; days?: number }
  | { type: "send_email"; templateId: string; subject?: string; body?: string }
  | { type: "notify"; title: string; body?: string }
  | { type: "create_task"; title: string; description?: string; dueInDays?: number; priority?: string }
  | { type: "update_record"; field: string; value: unknown }
  | { type: "condition"; field: string; op: string; value: unknown; thenIndex: number; elseIndex?: number }
  | { type: "end" };

export type JourneyTrigger = { kind: "event"; event: string } | { kind: "segment"; segmentId: string };

export const JOURNEY_EVENT_TRIGGERS = [
  "lead.created",
  "contact.created",
  "deal.created",
  "deal.stage_changed",
  "task.completed",
  "ticket.created",
  "ticket.status_changed",
  "form.submitted",
];

export const CONDITION_OPS = ["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "in", "not_in"];

// Event → object type whose entityId a trigger event refers to (for
// validation + record resolution). Mirrors automations' EVENT_OBJECT_TYPES.
const EVENT_ENTITY: Record<string, string> = {
  "lead.created": "lead",
  "contact.created": "contact",
  "deal.created": "opportunity",
  "deal.stage_changed": "opportunity",
  "task.completed": "task",
  "ticket.created": "ticket",
  "ticket.status_changed": "ticket",
  "form.submitted": "lead",
};

const TICKER_MS = 60_000;

// ── Validation (shared by the routes) ────────────────────────────────────────
export function parseJourneyParts(raw: unknown): { trigger: JourneyTrigger; steps: JourneyStep[] } {
  const r = (raw ?? {}) as Record<string, any>;
  const triggerRaw = (r.trigger ?? {}) as Record<string, any>;
  const kind = String(triggerRaw.kind ?? "event");
  let trigger: JourneyTrigger;
  if (kind === "event") {
    const event = String(triggerRaw.event ?? "");
    if (!JOURNEY_EVENT_TRIGGERS.includes(event)) throw badRequest(`Unknown journey trigger event "${event}"`);
    trigger = { kind: "event", event };
  } else if (kind === "segment") {
    if (typeof triggerRaw.segmentId !== "string" || !triggerRaw.segmentId) {
      throw badRequest("Segment trigger needs a segmentId");
    }
    trigger = { kind: "segment", segmentId: triggerRaw.segmentId };
  } else {
    throw badRequest("Journey trigger kind must be event | segment");
  }

  const steps: JourneyStep[] = Array.isArray(r.steps) ? r.steps : [];
  steps.forEach((s, i) => validateStep(s, i, steps.length));

  return { trigger, steps };
}

function validateStep(s: JourneyStep, index: number, total: number) {
  if (!s || typeof s.type !== "string") throw badRequest(`Step ${index + 1} needs a type`);
  switch (s.type) {
    case "wait":
      if (s.hours !== undefined && (!Number.isFinite(Number(s.hours)) || Number(s.hours) < 0)) throw badRequest("wait hours must be ≥ 0");
      if (s.days !== undefined && (!Number.isFinite(Number(s.days)) || Number(s.days) < 0)) throw badRequest("wait days must be ≥ 0");
      if (s.hours === undefined && s.days === undefined) throw badRequest("wait step needs hours and/or days");
      break;
    case "send_email":
      if (typeof s.templateId !== "string" || !s.templateId) throw badRequest("send_email needs a templateId");
      break;
    case "notify":
      if (typeof s.title !== "string" || !s.title.trim()) throw badRequest("notify needs a title");
      break;
    case "create_task":
      if (typeof s.title !== "string" || !s.title.trim()) throw badRequest("create_task needs a title");
      if (s.dueInDays !== undefined && (!Number.isInteger(s.dueInDays) || s.dueInDays < 0)) throw badRequest("dueInDays must be ≥ 0");
      if (s.priority !== undefined && !["low", "medium", "high"].includes(s.priority)) throw badRequest("priority must be low | medium | high");
      break;
    case "update_record": {
      const entity = "contact"; // v1: journeys run against contact/lead records
      const def = getObjectDef(entity);
      if (typeof s.field !== "string" || !def.fields.some((f) => f.key === s.field)) {
        throw badRequest(`update_record field "${s.field}" is not on ${entity}`);
      }
      break;
    }
    case "condition": {
      const entity = "contact";
      const def = getObjectDef(entity);
      if (typeof s.field !== "string" || !def.fields.some((f) => f.key === s.field)) {
        throw badRequest(`condition field "${s.field}" is not on ${entity}`);
      }
      if (!CONDITION_OPS.includes(s.op)) throw badRequest(`Unknown condition operator "${s.op}"`);
      const thenIndex = Number(s.thenIndex);
      if (!Number.isInteger(thenIndex) || thenIndex <= index || thenIndex >= total) {
        throw badRequest(`condition thenIndex must be a later step (0-${total - 1})`);
      }
      if (s.elseIndex !== undefined) {
        const elseIndex = Number(s.elseIndex);
        if (!Number.isInteger(elseIndex) || elseIndex === index || elseIndex < 0 || elseIndex >= total) {
          throw badRequest("condition elseIndex must be a different, valid step");
        }
      }
      break;
    }
    case "end":
      break;
    default:
      throw badRequest(`Unknown journey step type "${(s as any).type}"`);
  }
}

// ── Engine ───────────────────────────────────────────────────────────────────
let ticker: ReturnType<typeof setInterval> | null = null;

export function startJourneyEngine() {
  onEvent("*", async (event) => {
    try {
      await handleEvent(event);
    } catch (e) {
      console.error("[journey engine]", e);
    }
  });
  if (!ticker) {
    ticker = setInterval(() => {
      void runTickerPass().catch((e) => console.error("[journey ticker]", e));
    }, TICKER_MS);
  }
}

/** Event triggers + segment-membership triggers. */
async function handleEvent(event: PersistedEvent) {
  const journeys = await db().journey.findMany({ where: { orgId: event.orgId, environment: event.environment, active: true } });
  for (const journey of journeys as any[]) {
    const trigger = (journey.trigger ?? {}) as JourneyTrigger;
    if (trigger.kind === "event") {
      if (trigger.event === event.type) {
        await enroll(journey, event, "event");
      }
    } else if (trigger.kind === "segment") {
      await maybeEnrollFromSegment(journey, event);
    }
  }
}

/** Segment triggers: enroll when the event's entity belongs to the segment. */
async function maybeEnrollFromSegment(journey: any, event: PersistedEvent) {
  const segment = await db().segment.findFirst({ where: { id: journey.trigger.segmentId, orgId: event.orgId, environment: event.environment } });
  if (!segment) return;
  const criteria = parseCriteria(segment.objectType, segment.criteria);
  const scope = listConditions({ orgId: event.orgId, environment: event.environment, role: "admin", id: event.orgId } as any, "ownerId");
  const delegate = (db() as any)[segment.objectType];
  if (!delegate) return;
  const member = await delegate.findFirst({ where: { id: event.entityId, ...criteriaWhere(segment.objectType, criteria, []) } });
  if (member) await enroll(journey, event, "segment");
}

/** Enroll an entity into a journey (loop guard: one active per journey+entity). */
export async function enroll(journey: any, event: PersistedEvent, source: "event" | "segment" | "test"): Promise<any> {
  const steps = Array.isArray(journey.steps) ? (journey.steps as JourneyStep[]) : [];
  if (!steps.length) return null;

  const existing = await db().journeyEnrollment.findUnique({
    where: { orgId_environment_journeyId_entityId: { orgId: journey.orgId, environment: journey.environment, journeyId: journey.id, entityId: event.entityId } },
  });
  if (existing && (existing.status === "active" || existing.status === "waiting")) {
    return { skipped: true, reason: "already enrolled" };
  }
  if (existing) {
    // Re-entered after completion — reopen as a fresh run.
    await db().journeyEnrollment.update({ where: { id: existing.id }, data: { status: "active", currentStep: 0, nextRunAt: null, enteredAt: new Date(), completedAt: null } });
  } else {
    await db().journeyEnrollment.create({
      data: {
        orgId: journey.orgId,
        environment: journey.environment,
        journeyId: journey.id,
        entity: EVENT_ENTITY[source === "event" ? (journey.trigger?.event ?? "") : event.type] ?? event.entity,
        entityId: event.entityId,
        currentStep: 0,
        status: "active",
      },
    });
  }
  await db().journey.update({ where: { id: journey.id }, data: { enrolledCount: { increment: 1 }, updatedAt: new Date() } });
  await emitEvent({
    orgId: journey.orgId,
    environment: journey.environment,
    type: "journey.enrolled",
    entity: "journey",
    entityId: journey.id,
    actorId: event.actorId,
    payload: { name: journey.name, entity: event.entity, entityId: event.entityId, source },
  });

  // Run the entry steps synchronously up to the first wait.
  const enrollment = await db().journeyEnrollment.findUnique({
    where: { orgId_environment_journeyId_entityId: { orgId: journey.orgId, environment: journey.environment, journeyId: journey.id, entityId: event.entityId } },
  });
  if (enrollment) await advanceEnrollment(journey, enrollment as any, event, source);
  return { skipped: false };
}

/** One ticker pass — advance every due `waiting` enrollment in every org. */
export async function runTickerPass(): Promise<number> {
  const due = await db().journeyEnrollment.findMany({
    where: { status: "waiting", nextRunAt: { lt: new Date() } },
    take: 200,
  });
  let advanced = 0;
  for (const enrollment of due as any[]) {
    // Claim before advancing: flip nextRunAt to a short future sentinel with a
    // conditional update, so a concurrent ticker/advance pass (which sees the
    // same due rows) can't also run this enrollment's next step. The step
    // execution overwrites nextRunAt anyway (wait → resume time, end → null).
    const claimed = await db().journeyEnrollment.updateMany({
      where: { id: enrollment.id, status: "waiting", nextRunAt: { lt: new Date() } },
      data: { nextRunAt: new Date(Date.now() + 5 * 60_000) },
    });
    if (claimed.count === 0) continue; // another pass already claimed it
    const journey = await db().journey.findUnique({ where: { id: enrollment.journeyId } });
    if (!journey) continue;
    const synthetic: PersistedEvent = {
      id: `tick-${Date.now()}`,
      orgId: enrollment.orgId,
      environment: enrollment.environment,
      type: "journey.tick",
      entity: enrollment.entity,
      entityId: enrollment.entityId,
      actorId: enrollment.orgId,
      payload: {},
      createdAt: new Date(),
    };
    await advanceEnrollment(journey as any, enrollment, synthetic, "event");
    advanced++;
  }
  return advanced;
}

/**
 * Execute an enrollment from its current step until the next wait/end (or a
 * failed step). `wait` flips the enrollment to `waiting` + nextRunAt; the
 * ticker (or POST /advance) resumes it later.
 */
async function advanceEnrollment(journey: any, enrollment: any, event: PersistedEvent, source: "event" | "segment" | "test") {
  const steps = Array.isArray(journey.steps) ? (journey.steps as JourneyStep[]) : [];
  let stepIndex = enrollment.currentStep;
  let guard = 0;

  while (stepIndex < steps.length && guard++ < 100) {
    const step = steps[stepIndex];
    if (!step) break;
    const outcome = await executeStep(journey, enrollment, step, stepIndex, event);
    await db().journeyStepRun.create({
      data: {
        orgId: journey.orgId,
        environment: journey.environment,
        journeyId: journey.id,
        enrollmentId: enrollment.id,
        stepIndex,
        stepType: step.type,
        status: outcome.status,
        detail: outcome.detail ?? null,
      },
    });

    if (step.type === "wait") {
      // Pause here — resume when nextRunAt is due.
      await db().journeyEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "waiting", currentStep: stepIndex + 1, nextRunAt: outcome.nextRunAt ?? null },
      });
      return;
    }
    if (step.type === "end" || outcome.status === "failed") {
      const finished = step.type === "end";
      await db().journeyEnrollment.update({
        where: { id: enrollment.id },
        data: { status: finished ? "completed" : "exited", nextRunAt: null, completedAt: finished ? new Date() : null },
      });
      if (finished) {
        await emitEvent({
          orgId: journey.orgId,
          environment: journey.environment,
          type: "journey.completed",
          entity: "journey",
          entityId: journey.id,
          actorId: event.actorId,
          payload: { name: journey.name, entity: enrollment.entity, entityId: enrollment.entityId },
        });
      }
      return;
    }
    if (step.type === "condition") {
      // outcome.nextStep is the branch target.
      stepIndex = outcome.nextStep ?? stepIndex + 1;
      await db().journeyEnrollment.update({ where: { id: enrollment.id }, data: { currentStep: stepIndex } });
      continue;
    }
    stepIndex++;
    await db().journeyEnrollment.update({ where: { id: enrollment.id }, data: { currentStep: stepIndex } });
  }
  // Ran off the end without an explicit end step — complete.
  await db().journeyEnrollment.update({ where: { id: enrollment.id }, data: { status: "completed", nextRunAt: null, completedAt: new Date() } });
  await emitEvent({
    orgId: journey.orgId,
    environment: journey.environment,
    type: "journey.completed",
    entity: "journey",
    entityId: journey.id,
    actorId: event.actorId,
    payload: { name: journey.name, entity: enrollment.entity, entityId: enrollment.entityId },
  });
}

type StepOutcome = { status: "ok" | "skipped" | "failed"; detail?: string; nextRunAt?: Date; nextStep?: number };

async function executeStep(
  journey: any,
  enrollment: any,
  step: JourneyStep,
  stepIndex: number,
  event: PersistedEvent
): Promise<StepOutcome> {
  const base = {
    orgId: journey.orgId,
    environment: journey.environment,
    type: "journey.step_entered",
    entity: "journey",
    entityId: journey.id,
    actorId: event.actorId,
    payload: { journeyName: journey.name, stepIndex, stepType: step.type, entity: enrollment.entity, entityId: enrollment.entityId },
  };
  try {
    switch (step.type) {
      case "wait": {
        const hours = Number(step.hours ?? 0);
        const days = Number(step.days ?? 0);
        const ms = (days * 24 + hours) * 3_600_000;
        const nextRunAt = new Date(Date.now() + ms);
        await emitEvent(base);
        return { status: "ok", detail: `waiting until ${nextRunAt.toISOString()}`, nextRunAt };
      }
      case "send_email": {
        const record = await resolveEntity(enrollment);
        if (!record?.email) return { status: "skipped", detail: "record has no email" };
        const template = await db().emailTemplate.findFirst({ where: { id: step.templateId, orgId: journey.orgId, environment: journey.environment } });
        if (!template) return { status: "failed", detail: "template not found" };
        const vars = { contact: record, lead: record };
        const body = mergeTemplate(step.body ?? template.body, vars);
        const subject = mergeTemplate(step.subject ?? template.subject, vars);
        const token = trackingToken();
        const message = await db().message.create({
          data: {
            orgId: journey.orgId,
            environment: journey.environment,
            direction: "out",
            threadId: token,
            trackingToken: token,
            fromEmail: "marketing@qorvexa.dev",
            toEmail: String(record.email),
            subject,
            body,
            status: "sent",
            templateId: template.id,
            contactId: enrollment.entity === "contact" ? enrollment.entityId : null,
            opportunityId: enrollment.entity === "opportunity" ? enrollment.entityId : null,
            ownerId: journey.createdBy,
          },
        });
        // Phase 16 (ADR-028): fire the real provider send after the row exists.
        void sendOutboundWithProvider(message);
        await emitEvent({
          ...base,
          type: "email.sent",
          entity: "message",
          entityId: message.id,
          payload: { to: message.toEmail, subject, trackingToken: token, contactId: message.contactId, journeyId: journey.id },
        });
        await emitEvent(base);
        return { status: "ok", detail: `sent "${subject}" to ${message.toEmail}` };
      }
      case "notify": {
        const record = await resolveEntity(enrollment);
        const ownerId = record?.ownerId ?? event.actorId;
        const vars = { contact: record, lead: record };
        const title = mergeTemplate(step.title, vars).trim() || "Journey notification";
        const notif = await db().notification.create({
          data: {
            orgId: journey.orgId,
            environment: journey.environment,
            userId: ownerId,
            title,
            body: step.body ? mergeTemplate(step.body, vars).trim() || null : null,
            kind: "journey",
            link: `/${enrollment.entity === "opportunity" ? "deals" : `${enrollment.entity}s`}?id=${enrollment.entityId}`,
          },
        });
        await emitEvent({ ...base, type: "notification.created", entity: "notification", entityId: notif.id, payload: { userId: ownerId, kind: "journey", title } });
        await emitEvent(base);
        return { status: "ok", detail: `notified ${ownerId}` };
      }
      case "create_task": {
        const record = await resolveEntity(enrollment);
        const svc = createObjectService({ type: "task" });
        const sysUser = { id: journey.createdBy, orgId: journey.orgId, role: "admin", environment: journey.environment };
        const vars = { contact: record, lead: record };
        const task = await svc.create(sysUser, {
          title: mergeTemplate(step.title, vars).trim() || "Journey follow-up",
          description: step.description ? mergeTemplate(step.description, vars).trim() || null : null,
          priority: step.priority ?? "medium",
          status: "todo",
          dueAt: step.dueInDays !== undefined ? new Date(Date.now() + step.dueInDays * 86_400_000) : null,
          ownerId: record?.ownerId ?? journey.createdBy,
          ...(enrollment.entity === "contact" ? { contactId: enrollment.entityId } : {}),
        });
        await emitEvent(base);
        return { status: "ok", detail: `task "${task.title}" created`, nextStep: undefined };
      }
      case "update_record": {
        const record = await resolveEntity(enrollment);
        if (!record) return { status: "skipped", detail: "record gone" };
        const svc = createObjectService({ type: enrollment.entity });
        await svc.update({ id: journey.createdBy, orgId: journey.orgId, role: "admin", environment: journey.environment }, enrollment.entityId, { [step.field]: step.value });
        await emitEvent(base);
        return { status: "ok", detail: `${step.field} = ${String(step.value)}` };
      }
      case "condition": {
        const record = await resolveEntity(enrollment);
        const actual = record?.[step.field];
        const matches = evalCondition(step.op, actual, step.value);
        const nextStep = matches ? step.thenIndex : step.elseIndex;
        await emitEvent({ ...base, payload: { ...base.payload, matched: matches, branch: nextStep ?? null } });
        if (!matches && step.elseIndex === undefined) {
          return { status: "failed", detail: `condition ${step.field} ${step.op} ${String(step.value)} unmatched — exited` };
        }
        return { status: "ok", detail: `condition → step ${nextStep}`, nextStep };
      }
      case "end":
        await emitEvent(base);
        return { status: "ok", detail: "journey complete" };
      default:
        return { status: "failed", detail: "unknown step type" };
    }
  } catch (e: any) {
    await emitEvent({ ...base, type: "journey.step_entered", payload: { ...base.payload, failed: true } }).catch(() => {});
    return { status: "failed", detail: e?.message ?? "step failed" };
  }
}

function evalCondition(op: string, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "eq": return String(actual ?? "") === String(expected ?? "");
    case "neq": return String(actual ?? "") !== String(expected ?? "");
    case "contains": return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "not_contains": return !String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "gt": return Number(actual) > Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "in": return (Array.isArray(expected) ? expected : String(expected ?? "").split(",").map((s) => s.trim())).includes(String(actual ?? ""));
    case "not_in": return !(Array.isArray(expected) ? expected : String(expected ?? "").split(",").map((s) => s.trim())).includes(String(actual ?? ""));
    default: return false;
  }
}

async function resolveEntity(enrollment: any): Promise<any | null> {
  const delegate = (db() as any)[enrollment.entity];
  if (!delegate?.findUnique) return null;
  try {
    return await delegate.findUnique({ where: { id: enrollment.entityId } });
  } catch {
    return null;
  }
}

/** Synchronous test run: enroll + advance without honoring waits. */
export async function testJourney(journey: any, entityId: string, actorId: string) {
  const entity = "contact"; // v1 test surface
  const steps = Array.isArray(journey.steps) ? (journey.steps as JourneyStep[]) : [];
  const synthetic: PersistedEvent = {
    id: `test-${Date.now()}`,
    orgId: journey.orgId,
    environment: journey.environment,
    type: "journey.test",
    entity,
    entityId,
    actorId,
    payload: {},
    createdAt: new Date(),
  };
  const outcomes: { stepIndex: number; stepType: string; status: string; detail?: string }[] = [];
  // Simulate: run steps sequentially, treating waits as 0-delay.
  let record = await (db() as any).contact.findUnique({ where: { id: entityId } });
  for (let i = 0; i < steps.length && i < 100; i++) {
    const step = steps[i];
    const result = await executeStep(journey, { id: `test-${Date.now()}`, entity, entityId }, step, i, synthetic);
    outcomes.push({ stepIndex: i, stepType: step.type, status: result.status, detail: result.detail });
    if (step.type === "condition") {
      i = result.nextStep !== undefined ? result.nextStep - 1 : i;
      if (result.status === "failed") break;
    }
    if (step.type === "end" || result.status === "failed") break;
  }
  return { outcomes };
}
