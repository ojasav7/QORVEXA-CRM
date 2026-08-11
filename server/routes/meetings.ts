// Meetings (Phase 2) — scheduled + completed meetings. Booking-page bookings
// create meetings here (host = round-robin assignee). meeting.completed fires
// when a scheduled meeting moves to completed.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";

const router = Router();

const meetingSchema = z.object({
  title: z.string().min(1).max(200),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  status: z.enum(["scheduled", "completed", "cancelled", "no-show"]).optional(),
  location: z.string().max(200).optional(),
  notes: z.string().max(4_000).optional(),
  contactId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
});

// GET /api/meetings?from=&to=&ownerId= — date-range list (calendar view)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const where: Record<string, unknown> = { orgId: user.orgId, environment };
    const { from, to, ownerId, contactId, opportunityId, status } = req.query as Record<string, string | undefined>;
    if (from || to) {
      where.OR = [];
      if (from) (where.OR as any[]).push({ startsAt: { gte: new Date(from) } });
      if (to) (where.OR as any[]).push({ endsAt: { lte: new Date(to) } });
      // A meeting overlaps the range when it starts before `to` and ends after `from`.
      where.AND = [
        ...(from ? [{ endsAt: { gte: new Date(from) } }] : []),
        ...(to ? [{ startsAt: { lte: new Date(to) } }] : []),
      ];
      delete where.OR;
    }
    if (ownerId) where.ownerId = ownerId;
    if (contactId) where.contactId = contactId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (status) where.status = status;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 100));
    const [items, total] = await Promise.all([
      db().meeting.findMany({ where, orderBy: { startsAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().meeting.count({ where }),
    ]);
    ok(res, { items, total });
  })
);

// POST /api/meetings
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = meetingSchema.parse(req.body);
    const starts = new Date(input.startsAt);
    const ends = new Date(input.endsAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
      throw badRequest("endsAt must be after startsAt");
    }
    const meeting = await db().meeting.create({
      data: {
        orgId: user.orgId,
        environment,
        title: input.title,
        startsAt: starts,
        endsAt: ends,
        status: input.status ?? "scheduled",
        location: input.location ?? "virtual",
        notes: input.notes ?? null,
        contactId: input.contactId ?? null,
        accountId: input.accountId ?? null,
        opportunityId: input.opportunityId ?? null,
        ownerId: input.ownerId ?? user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "meeting.scheduled", entity: "meeting", entityId: meeting.id, actorId: user.id, payload: { title: input.title, startsAt: starts.toISOString(), contactId: input.contactId ?? null } });
    ok(res, { meeting }, 201);
  })
);

// PATCH /api/meetings/:id — reschedule, cancel, mark completed
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const existing = await db().meeting.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!existing) throw notFound("Meeting not found");
    const input = meetingSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["title", "status", "location", "notes", "contactId", "accountId", "opportunityId", "ownerId"] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    if (input.startsAt !== undefined) data.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined) data.endsAt = new Date(input.endsAt);
    const updated = await db().meeting.update({ where: { id: existing.id }, data });
    if (updated.status === "completed" && existing.status !== "completed") {
      await emitEvent({ orgId: user.orgId, environment, type: "meeting.completed", entity: "meeting", entityId: updated.id, actorId: user.id, payload: { title: updated.title, contactId: updated.contactId ?? null } });
    } else if (updated.status !== existing.status) {
      await emitEvent({ orgId: user.orgId, environment, type: "meeting.status_changed", entity: "meeting", entityId: updated.id, actorId: user.id, payload: { from: existing.status, to: updated.status } });
    }
    ok(res, { meeting: updated });
  })
);

// DELETE /api/meetings/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const existing = await db().meeting.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!existing) throw notFound("Meeting not found");
    await db().meeting.delete({ where: { id: existing.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "meeting.deleted", entity: "meeting", entityId: existing.id, actorId: user.id, payload: { title: existing.title } });
    ok(res, { ok: true });
  })
);

export default router;
