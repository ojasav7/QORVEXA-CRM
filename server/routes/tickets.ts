// Tickets (Phase 4 · Customer Service) — ADR-016.
//
// Tickets are a first-class object type: the generic object service powers
// CRUD + audit + events + search + custom fields (it emits ticket.created /
// updated / deleted / status_changed). This thin router adds the
// service-specific surface on top — per-org reference numbers, SLA deadlines
// (server/lib/slas.ts), reply threads, assignment, escalation, legal hold,
// email intake, and convert-to-lead.
//
// NOTE: like public-leads.ts, the service is built lazily per request because
// registerObject() in the server entry runs AFTER route-module imports — a
// module-level instance would miss the ticket config (eventPrefix, relations).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, forbidden, notFound, ok, ApiError } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { createObjectService } from "../lib/object-service";
import { emitEvent } from "../lib/events";
import {
  responseHoursFor,
  slaDueFor,
  slaStatusFor,
  runSlaSweep,
  escalateTicket,
  RESOLVED_STATUSES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_CHANNELS,
  TICKET_SOURCES,
} from "../lib/slas";
import { createNotification } from "../lib/notifications";

const router = Router();
const ticketService = () => createObjectService({ type: "ticket" });

const ticketInput = z.object({
  subject: z.string().min(1).max(240),
  description: z.string().max(10_000).optional(),
  status: z.enum(TICKET_STATUSES as [string, ...string[]]).optional(),
  priority: z.enum(TICKET_PRIORITIES as [string, ...string[]]).optional(),
  channel: z.enum(TICKET_CHANNELS as [string, ...string[]]).optional(),
  source: z.enum(TICKET_SOURCES as [string, ...string[]]).optional(),
  contactId: z.string().optional(),
  accountId: z.string().optional(),
  assigneeId: z.string().optional(),
  legalHold: z.boolean().optional(),
  slaDueAt: z.string().datetime().optional(), // registry date field — PATCHable (SLA backdating/sweep testing)
});

// ── Helpers ──────────────────────────────────────────────────────────────────
/** Next per-org reference (TKT-####) — max of existing numeric suffixes + 1. */
async function nextTicketReference(orgId: string, environment: string): Promise<string> {
  const rows = await db().ticket.findMany({ where: { orgId, environment }, select: { reference: true } });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.reference).replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `TKT-${String(max + 1).padStart(4, "0")}`;
}

/** Attach read-time slaStatus + assignee display name to ticket rows. */
async function enrich(rows: any[], orgId: string): Promise<any[]> {
  if (!rows.length) return rows;
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter(Boolean))];
  const users = ownerIds.length ? await db().user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...r,
    slaStatus: slaStatusFor(r),
    assigneeId: r.ownerId,
    assigneeName: byId.get(r.ownerId) ?? null,
  }));
}

async function loadOwnTicket(orgId: string, environment: string, id: string) {
  const ticket = await db().ticket.findFirst({ where: { id, orgId, environment } });
  if (!ticket) throw notFound("Ticket not found");
  return ticket;
}

// ── Queues (counts for the Tickets page tabs) ────────────────────────────────
router.get(
  "/queues",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const base = { orgId: user.orgId, environment };
    const open = { status: { notIn: RESOLVED_STATUSES } };
    const [allCount, my, newCount, openCount, pending, resolved, closed, breached, escalated] = await Promise.all([
      db().ticket.count({ where: { ...base } }),
      db().ticket.count({ where: { ...base, ...open, ownerId: user.id } }),
      db().ticket.count({ where: { ...base, status: "new" } }),
      db().ticket.count({ where: { ...base, status: "open" } }),
      db().ticket.count({ where: { ...base, status: "pending" } }),
      db().ticket.count({ where: { ...base, status: "resolved" } }),
      db().ticket.count({ where: { ...base, status: "closed" } }),
      db().ticket.count({ where: { ...base, ...open, slaDueAt: { lt: new Date() } } }),
      db().ticket.count({ where: { ...base, escalated: true } }),
    ]);
    ok(res, {
      items: [
        { key: "all", label: "All", count: allCount },
        { key: "my", label: "My tickets", count: my },
        { key: "new", label: "New", count: newCount },
        { key: "open", label: "Open", count: openCount },
        { key: "pending", label: "Pending", count: pending },
        { key: "resolved", label: "Resolved", count: resolved },
        { key: "closed", label: "Closed", count: closed },
        { key: "breached", label: "SLA breached", count: breached },
        { key: "escalated", label: "Escalated", count: escalated },
      ],
    });
  })
);

// GET /api/tickets — generic list, enriched with read-time SLA status.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
    const result = await ticketService().list(scoped, {
      page: num(req.query.page),
      pageSize: num(req.query.pageSize),
      q: str(req.query.q),
      status: str(req.query.status),
      ownerId: str(req.query.ownerId),
      sort: str(req.query.sort),
    });
    ok(res, { items: await enrich(result.items, user.orgId), total: result.total });
  })
);

// POST /api/tickets — wrapped create: reference + SLA deadline, then the
// generic service (validation, audit, ticket.created) does the rest.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const scoped = { ...user, environment };
    const input = ticketInput.parse(req.body ?? {});
    const reference = await nextTicketReference(user.orgId, environment);
    const hours = await responseHoursFor(user.orgId, environment, input.priority ?? "low");
    const payload: Record<string, unknown> = {
      subject: input.subject,
      description: input.description ?? "",
      priority: input.priority ?? "low",
      channel: input.channel ?? "web",
      source: input.source ?? "manual",
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.assigneeId ? { ownerId: input.assigneeId } : {}),
      reference,
      slaDueAt: slaDueFor(new Date(), hours),
    };
    // Reference collisions after deletes → retry with a fresh number (max 5).
    let row: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        row = await ticketService().create(scoped, payload, req.ip);
        break;
      } catch (e) {
        const isRefDup = e instanceof ApiError && /reference already exists/i.test(e.message);
        if (isRefDup && attempt < 4) {
          payload.reference = await nextTicketReference(user.orgId, environment);
          continue;
        }
        throw e;
      }
    }
    ok(res, (await enrich([row], user.orgId))[0], 201);
  })
);

// GET /api/tickets/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const scoped = { ...user, environment };
    const row = await ticketService().get(scoped, String(req.params.id));
    ok(res, (await enrich([row], user.orgId))[0]);
  })
);

// PATCH /api/tickets/:id — wrapped update: legal-hold enforcement, resolvedAt
// on resolution, SLA recompute on priority change; the generic service emits
// ticket.updated / ticket.status_changed and audits the change.
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const before = await loadOwnTicket(user.orgId, environment, id);
    const input = ticketInput.partial().parse(req.body ?? {});
    if (before.legalHold && !(user.role === "admin" && input.legalHold === false)) {
      throw forbidden("This ticket is on legal hold — only an admin can modify it (and only to lift the hold)");
    }
    const patch: Record<string, unknown> = {};
    for (const key of ["subject", "description", "status", "priority", "channel", "source", "contactId", "accountId", "legalHold"] as const) {
      const v = (input as Record<string, unknown>)[key];
      if (v !== undefined) patch[key] = v;
    }
    // The generic service stores raw values (only merge.ts converts) — a string
    // slaDueAt would be stored as a string and Mongo `$lt` (Date) comparisons in
    // the SLA sweep would never match it. Normalise here (ADR-016).
    if (input.slaDueAt !== undefined) patch.slaDueAt = new Date(input.slaDueAt);
    if (input.assigneeId) patch.ownerId = input.assigneeId;
    // Priority change restarts the SLA clock (documented v1 semantics).
    if (input.priority && input.priority !== before.priority) {
      const hours = await responseHoursFor(user.orgId, environment, input.priority);
      patch.slaDueAt = slaDueFor(new Date(), hours);
    }
    const scoped = { ...user, environment };
    const row = await ticketService().update(scoped, id, patch, req.ip);
    // Resolution bookkeeping (resolvedAt is internal, not a registry field).
    if (input.status && RESOLVED_STATUSES.includes(input.status) && !RESOLVED_STATUSES.includes(String(before.status))) {
      const now = new Date();
      await db().ticket.update({ where: { id }, data: { resolvedAt: now, updatedAt: now } });
      row.resolvedAt = now;
    }
    ok(res, (await enrich([row], user.orgId))[0]);
  })
);

// DELETE /api/tickets/:id — legal hold blocks deletion for everyone.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const before = await loadOwnTicket(user.orgId, environment, id);
    if (before.legalHold) throw forbidden("This ticket is on legal hold — deletion is locked");
    await ticketService().remove({ ...user, environment }, id, req.ip);
    ok(res, { ok: true });
  })
);

// ── Reply thread ─────────────────────────────────────────────────────────────
// GET /api/tickets/:id/replies
router.get(
  "/:id/replies",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    await loadOwnTicket(user.orgId, environment, id);
    const items = await db().ticketReply.findMany({ where: { orgId: user.orgId, environment, ticketId: id }, orderBy: { createdAt: "asc" } });
    const authorIds = [...new Set(items.map((r) => r.authorId))];
    const users = authorIds.length ? await db().user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u.name]));
    ok(res, { items: items.map((r) => ({ ...r, authorName: byId.get(r.authorId) ?? null })) });
  })
);

// POST /api/tickets/:id/reply — staff reply; sets firstResponseAt + new → open.
router.post(
  "/:id/reply",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const ticket = await loadOwnTicket(user.orgId, environment, id);
    if (ticket.legalHold) throw forbidden("This ticket is on legal hold — replies are locked");
    const { body, internal } = z.object({ body: z.string().min(1).max(10_000), internal: z.boolean().optional() }).parse(req.body ?? {});
    const reply = await db().ticketReply.create({
      data: { orgId: user.orgId, environment, ticketId: id, authorId: user.id, body, internal: internal ?? false },
    });
    const now = new Date();
    if (!ticket.firstResponseAt) {
      await db().ticket.update({ where: { id }, data: { firstResponseAt: now, updatedAt: now } });
    }
    let updated = ticket;
    if (ticket.status === "new") {
      updated = await ticketService().update({ ...user, environment }, id, { status: "open" }, req.ip);
    }
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "ticket.replied",
      entity: "ticket",
      entityId: id,
      actorId: user.id,
      payload: { reference: ticket.reference, internal: internal ?? false, replyId: reply.id },
    });
    ok(res, { reply: { ...reply, authorName: user.name }, ticket: (await enrich([updated], user.orgId))[0] }, 201);
  })
);

// POST /api/tickets/:id/assign — admin/manager reassign; notifies the new owner.
router.post(
  "/:id/assign",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const ticket = await loadOwnTicket(user.orgId, environment, id);
    if (ticket.legalHold) throw forbidden("This ticket is on legal hold — assignment is locked");
    const { assigneeId } = z.object({ assigneeId: z.string().min(1) }).parse(req.body ?? {});
    const target = await db().user.findUnique({ where: { id: assigneeId }, select: { orgId: true, active: true, name: true } });
    if (!target || target.orgId !== user.orgId || !target.active) throw badRequest("Assignee must be an active user in this workspace");
    const row = await ticketService().update({ ...user, environment }, id, { ownerId: assigneeId }, req.ip);
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "ticket.assigned",
      entity: "ticket",
      entityId: id,
      actorId: user.id,
      payload: { reference: ticket.reference, from: ticket.ownerId, to: assigneeId },
    });
    await createNotification({
      orgId: user.orgId,
      environment,
      userId: assigneeId,
      title: `Ticket ${ticket.reference} assigned to you`,
      body: ticket.subject,
      kind: "assignment",
      link: `/tickets?id=${id}`,
    });
    ok(res, (await enrich([row], user.orgId))[0]);
  })
);

// POST /api/tickets/:id/escalate — flag + notify assignee & managers.
router.post(
  "/:id/escalate",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const ticket = await loadOwnTicket(user.orgId, environment, id);
    if (ticket.legalHold) throw forbidden("This ticket is on legal hold — escalation is locked");
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : undefined;
    // Manual escalation raises priority (≥ high) and restarts the SLA clock —
    // consistent with the PATCH wrapper's priority-change semantics (ADR-016).
    await escalateTicket(user.orgId, environment, id, user.id, reason, { bumpPriority: true });
    const updated = await db().ticket.findUnique({ where: { id } });
    ok(res, (await enrich([updated], user.orgId))[0]);
  })
);

// POST /api/tickets/:id/legal-hold — admin-only lock toggle.
router.post(
  "/:id/legal-hold",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    await loadOwnTicket(user.orgId, environment, id);
    const { legalHold } = z.object({ legalHold: z.boolean() }).parse(req.body ?? {});
    const row = await ticketService().update({ ...user, environment }, id, { legalHold }, req.ip);
    ok(res, (await enrich([row], user.orgId))[0]);
  })
);

// POST /api/tickets/:id/convert-to-lead — create a lead from the ticket's contact.
router.post(
  "/:id/convert-to-lead",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const ticket = await loadOwnTicket(user.orgId, environment, id);
    const contact = ticket.contactId ? await db().contact.findUnique({ where: { id: ticket.contactId } }) : null;
    const account = ticket.accountId ? await db().account.findUnique({ where: { id: ticket.accountId } }) : null;
    const leadService = createObjectService({ type: "lead" });
    const lead = await leadService.create(
      { ...user, environment },
      {
        firstName: contact?.firstName ?? "Support",
        lastName: contact?.lastName ?? "Lead",
        ...(contact?.email ? { email: contact.email.toLowerCase().trim() } : {}),
        ...(account?.name ? { company: account.name } : {}),
        source: "Other",
        status: "new",
        score: 0,
      },
      req.ip
    );
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "ticket.converted",
      entity: "ticket",
      entityId: id,
      actorId: user.id,
      payload: { reference: ticket.reference, leadId: lead.id },
    });
    ok(res, { lead });
  })
);

// ── Email intake ─────────────────────────────────────────────────────────────
// POST /api/tickets/intake/email — email → ticket (channel email), contact
// linked by address (auto-created when unknown). The mock-provider seam of
// Phase 2 can POST here when a real inbox sync lands.
router.post(
  "/intake/email",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { from, subject, body, contactId } = z
      .object({ from: z.string().email().max(200), subject: z.string().min(1).max(240), body: z.string().max(10_000).optional(), contactId: z.string().optional() })
      .parse(req.body ?? {});
    const email = from.toLowerCase().trim();
    let contact = contactId ? await db().contact.findUnique({ where: { id: contactId } }) : null;
    if (!contact) {
      contact = await db().contact.findFirst({ where: { orgId: user.orgId, environment, email } });
    }
    if (!contact) {
      const local = email.split("@")[0] ?? "Inbound";
      const contactService = () => createObjectService({ type: "contact" });
      try {
        contact = await contactService().create(
          { ...user, environment },
          { firstName: local, lastName: "Inbound", email, source: "Other", status: "new" },
          req.ip
        );
      } catch (e) {
        // race: another intake created the same email between check + write
        if (e instanceof ApiError && /already exists/i.test(e.message)) {
          contact = await db().contact.findFirst({ where: { orgId: user.orgId, environment, email } });
        } else throw e;
      }
    }
    if (!contact) throw badRequest("Could not resolve the sender contact");
    const reference = await nextTicketReference(user.orgId, environment);
    const hours = await responseHoursFor(user.orgId, environment, "low");
    const row = await ticketService().create(
      { ...user, environment },
      {
        subject,
        description: body ?? "",
        priority: "low",
        channel: "email",
        source: "email",
        contactId: contact.id,
        reference,
        slaDueAt: slaDueFor(new Date(), hours),
      },
      req.ip
    );
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "ticket.captured",
      entity: "ticket",
      entityId: row.id,
      actorId: user.id,
      payload: { reference, channel: "email", from: email, subject },
    });
    ok(res, (await enrich([row], user.orgId))[0], 201);
  })
);

// POST /api/tickets/sla/check — admin sweep: breach + auto-escalate.
router.post(
  "/sla/check",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const result = await runSlaSweep(user.orgId, environment, user.id);
    ok(res, result);
  })
);

function num(v: unknown): number | undefined {
  if (typeof v !== "string" || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export default router;
