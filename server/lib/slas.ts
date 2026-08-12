// SLA engine (Phase 4 · Customer Service) — ADR-016.
//
// SLA = declarative policy rows + a computed deadline. A SlaPolicy holds
// per-priority response-hour targets; the engine computes `slaDueAt` when a
// ticket is created or its priority changes, computes a READ-TIME `slaStatus`
// (on_track / due_soon / breached / n/a) from timestamps — so a missed sweep
// can never show a stale "on track" — and the admin-triggered sweep persists
// `breachedAt` + emits `ticket.sla_breached` + auto-escalates high/urgent
// breaches (notify + `ticket.escalated`).
import { db } from "../db";
import { emitEvent } from "./events";
import { createNotification } from "./notifications";

// Default targets (hours) — used until the org's policy exists (lazily seeded).
export const DEFAULT_SLA_TARGETS: Record<string, { responseHours: number }> = {
  low: { responseHours: 24 },
  medium: { responseHours: 8 },
  high: { responseHours: 4 },
  urgent: { responseHours: 1 },
};

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"];
export const TICKET_STATUSES = ["new", "open", "pending", "resolved", "closed"];
export const TICKET_CHANNELS = ["email", "web", "chat", "whatsapp", "sms", "phone", "social"];
export const TICKET_SOURCES = ["portal", "email", "manual"];
export const RESOLVED_STATUSES = ["resolved", "closed"];

export type SlaStatus = "on_track" | "due_soon" | "breached" | "n/a";

/** Response-hour target for a priority under the org's effective policy. */
export async function responseHoursFor(orgId: string, environment: string, priority: string): Promise<number> {
  const targets = await slaTargets(orgId, environment);
  return targets[priority]?.responseHours ?? DEFAULT_SLA_TARGETS[priority]?.responseHours ?? 24;
}

/** The org's effective SLA targets (policy row → defaults), seeded lazily. */
export async function slaTargets(orgId: string, environment: string): Promise<Record<string, { responseHours: number }>> {
  const policy = await db().slaPolicy.findFirst({ where: { orgId, environment, active: true } });
  if (policy) {
    const t = (policy.targets ?? {}) as Record<string, { responseHours?: number }>;
    const merged: Record<string, { responseHours: number }> = {};
    for (const p of TICKET_PRIORITIES) {
      merged[p] = { responseHours: t[p]?.responseHours ?? DEFAULT_SLA_TARGETS[p].responseHours };
    }
    return merged;
  }
  // Seed the default policy so the admin can see/edit it later.
  await db().slaPolicy.create({
    data: { orgId, environment, name: "Default", targets: DEFAULT_SLA_TARGETS as object, active: true },
  });
  return DEFAULT_SLA_TARGETS;
}

/** Due date for a ticket's response SLA (created/priority-changed time + target). */
export function slaDueFor(now: Date, responseHours: number): Date {
  return new Date(now.getTime() + responseHours * 3_600_000);
}

/**
 * Read-time SLA status for one ticket. Resolved/closed (or no deadline) is
 * `n/a`; past the deadline is `breached`; inside the last 25% of the window is
 * `due_soon`; otherwise `on_track`. Derived from timestamps — never stale.
 */
export function slaStatusFor(ticket: { status?: string | null; slaDueAt?: Date | string | null; createdAt?: Date | string | null }, now = new Date()): SlaStatus {
  if (!ticket.slaDueAt || RESOLVED_STATUSES.includes(String(ticket.status ?? ""))) return "n/a";
  const due = new Date(ticket.slaDueAt).getTime();
  const t = now.getTime();
  if (t >= due) return "breached";
  const window = due - t;
  // due_soon when we've passed 75% of the (unknown-length) window — approximate
  // via a 25% remainder of the total elapsed + remaining. Keep simple: flag
  // within 25% of the total window before the deadline.
  const started = new Date(ticket.createdAt ?? now).getTime();
  const total = Math.max(1, due - started);
  return window <= total * 0.25 ? "due_soon" : "on_track";
}

export type SlaSweepResult = { checked: number; breached: number; escalated: number; breachedIds: string[] };

/**
 * Admin-triggered sweep: find open tickets past their response deadline that
 * aren't yet marked breached → persist breachedAt, emit `ticket.sla_breached`,
 * and auto-escalate high/urgent breaches (notify assignee + managers, emit
 * `ticket.escalated`). Returns counts for the UI/log.
 */
export async function runSlaSweep(orgId: string, environment: string, actorId: string): Promise<SlaSweepResult> {
  const now = new Date();
  const pastDue = await db().ticket.findMany({
    where: {
      orgId,
      environment,
      status: { notIn: RESOLVED_STATUSES },
      slaDueAt: { lt: now },
    },
  });
  // Prisma/Mongo `breachedAt: null` only matches explicit nulls — API-created
  // tickets omit the field entirely (the generic service stores registry fields
  // only). Filter in JS so both shapes are treated as "not yet breached".
  const open = pastDue.filter((t) => !t.breachedAt);
  const result: SlaSweepResult = { checked: open.length, breached: 0, escalated: 0, breachedIds: [] };
  for (const ticket of open) {
    await db().ticket.update({ where: { id: ticket.id }, data: { breachedAt: now, updatedAt: now } });
    result.breached++;
    result.breachedIds.push(ticket.id);
    await emitEvent({
      orgId,
      environment,
      type: "ticket.sla_breached",
      entity: "ticket",
      entityId: ticket.id,
      actorId,
      payload: { reference: ticket.reference, priority: ticket.priority, slaDueAt: ticket.slaDueAt?.toISOString() },
    });
    // High/urgent breaches escalate automatically (ADR-016).
    if (ticket.priority === "high" || ticket.priority === "urgent") {
      // No bumpPriority — the ticket is already breached; escalation here is
      // the flag + notify, never a fresh deadline (ADR-016).
      await escalateTicket(orgId, environment, ticket.id, actorId, "SLA breach");
      result.escalated++;
    }
  }
  return result;
}

/**
 * Mark a ticket escalated + notify the assignee and managers.
 *
 * `bumpPriority` (manual escalation only) raises the priority to at least
 * `high` and restarts the SLA clock from the escalation moment — mirroring the
 * PATCH wrapper's "priority change restarts the clock" semantics. The SLA
 * sweep deliberately does NOT pass it: a breached ticket must stay breached,
 * not get a fresh deadline.
 */
export async function escalateTicket(orgId: string, environment: string, ticketId: string, actorId: string, reason?: string, opts: { bumpPriority?: boolean } = {}): Promise<void> {
  const now = new Date();
  const ticket = await db().ticket.findFirst({ where: { id: ticketId, orgId, environment } });
  if (!ticket) return;
  const update: Record<string, unknown> = {};
  if (!ticket.escalated) {
    update.escalated = true;
    update.escalatedAt = now;
  }
  if (opts.bumpPriority) {
    const raised = ticket.priority === "urgent" ? "urgent" : "high";
    if (raised !== ticket.priority) {
      const hours = await responseHoursFor(orgId, environment, raised);
      update.priority = raised;
      update.slaDueAt = slaDueFor(now, hours);
    }
  }
  if (Object.keys(update).length > 0) {
    await db().ticket.update({ where: { id: ticketId }, data: { ...update, updatedAt: now } });
  }
  await emitEvent({
    orgId,
    environment,
    type: "ticket.escalated",
    entity: "ticket",
    entityId: ticketId,
    actorId,
    payload: { reference: ticket.reference, reason: reason ?? null },
  });
  // Notify the assignee + all managers/admins of the org.
  const title = `Ticket ${ticket.reference} escalated`;
  const body = reason ? `${ticket.subject} — ${reason}.` : ticket.subject;
  const link = `/tickets?id=${ticketId}`;
  const targets = await db().user.findMany({ where: { orgId, active: true }, select: { id: true, role: true } });
  const recipientIds = new Set<string>([ticket.ownerId, ...targets.filter((u) => u.role === "admin" || u.role === "manager").map((u) => u.id)]);
  for (const userId of recipientIds) {
    await createNotification({ orgId, environment, userId, title, body, kind: "escalation", link });
  }
}
