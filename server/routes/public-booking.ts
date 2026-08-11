// Public booking (Phase 2) — NO authentication on purpose, like public lead
// capture. The page slug is the handle; a honeypot + per-IP rate limit guard
// abuse. Slots are computed from the page config (duration + buffer over
// availability) minus already-booked times; booking assigns the next host
// round-robin and creates a Meeting (meeting.scheduled + booking.booked).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { slotsForDate, nextBookingHost, type BookingPageConfig } from "../lib/comm";

const router = Router();

// Minimal in-memory rate limit: 20 hits / min / IP (same shape as public leads).
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string, max = 20): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.resetAt < now) {
    if (hits.size > 500) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  rec.count++;
  return rec.count > max;
}

const HONEYPOT = "company_name"; // hidden field; bots fill it, humans don't

async function loadPage(slug: string): Promise<BookingPageConfig> {
  const page = await db().bookingPage.findFirst({ where: { slug: String(slug), active: true } });
  if (!page) throw badRequest("Booking page not found");
  return {
    id: page.id,
    orgId: page.orgId,
    name: page.name,
    slug: page.slug,
    description: page.description,
    durationMins: page.durationMins,
    bufferMins: page.bufferMins,
    hostPool: (page.hostPool as string[]) ?? [],
    cursor: page.cursor,
    availableDays: (page.availableDays as number[]) ?? [1, 2, 3, 4, 5],
    startHour: page.startHour,
    endHour: page.endHour,
    timezone: page.timezone,
    active: page.active,
  };
}

// GET /api/public/booking/:slug — public page config (no slots; client fetches per date)
router.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const cfg = await loadPage(String(req.params.slug));
    ok(res, { name: cfg.name, description: cfg.description, durationMins: cfg.durationMins, bufferMins: cfg.bufferMins, timezone: cfg.timezone, slug: cfg.slug, startHour: cfg.startHour, endHour: cfg.endHour });
  })
);

// GET /api/public/booking/:slug/slots?date=YYYY-MM-DD — open slots for a date
router.get(
  "/:slug/slots",
  asyncHandler(async (req, res) => {
    const cfg = await loadPage(String(req.params.slug));
    const dateStr = String(req.query.date ?? "");
    const all = slotsForDate(cfg, dateStr);
    // Busy = any meeting on this page in the slot window (same org, any host).
    const meetings = await db().meeting.findMany({
      where: { orgId: cfg.orgId, status: { not: "cancelled" }, startsAt: { gte: new Date(`${dateStr}T00:00:00.000Z`), lt: new Date(`${dateStr}T23:59:59.999Z`) } },
      select: { startsAt: true, endsAt: true },
    });
    const busy = meetings.flatMap((m) => {
      const out: string[] = [];
      for (let t = new Date(m.startsAt).getTime(); t < new Date(m.endsAt).getTime(); t += 60_000) {
        out.push(new Date(t).toISOString());
      }
      return out;
    });
    const slots = all.map((iso) => ({ start: iso, available: !busy.includes(iso) }));
    ok(res, { date: dateStr, slots });
  })
);

// POST /api/public/booking/:slug/book — create a meeting (round-robin host)
const bookSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  startsAt: z.string().min(1),
  notes: z.string().max(2_000).optional(),
  [HONEYPOT]: z.any().optional(),
});
router.post(
  "/:slug/book",
  asyncHandler(async (req, res) => {
    const ip = String(req.ip ?? "unknown");
    if (rateLimited(ip)) throw badRequest("Too many requests — try again shortly");
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body[HONEYPOT] && String(body[HONEYPOT]).trim() !== "") return ok(res, { ok: true, booked: false }); // honeypot: fake success

    const cfg = await loadPage(String(req.params.slug));
    const input = bookSchema.parse({ ...body, [HONEYPOT]: body[HONEYPOT] ?? "" });
    const starts = new Date(input.startsAt);
    if (Number.isNaN(starts.getTime())) throw badRequest("Invalid start time");
    const ends = new Date(starts.getTime() + cfg.durationMins * 60_000);

    // Slot must be one of the page's open slots (guards double-booking races).
    const dateStr = starts.toISOString().slice(0, 10);
    const open = await (async () => {
      const slots = slotsForDate(cfg, dateStr);
      const meetings = await db().meeting.findMany({
        where: { orgId: cfg.orgId, status: { not: "cancelled" }, startsAt: { gte: new Date(`${dateStr}T00:00:00.000Z`), lt: new Date(`${dateStr}T23:59:59.999Z`)} },
        select: { startsAt: true, endsAt: true },
      });
      const busy = meetings.flatMap((m) => {
        const out: string[] = [];
        for (let t = new Date(m.startsAt).getTime(); t < new Date(m.endsAt).getTime(); t += 60_000) out.push(new Date(t).toISOString());
        return out;
      });
      return slots.filter((s) => !busy.includes(s));
    })();
    if (!open.includes(input.startsAt)) throw badRequest("That slot is no longer available — pick another");

    const hostId = await nextBookingHost(cfg);
    const meeting = await db().meeting.create({
      data: {
        orgId: cfg.orgId,
        environment: "production",
        title: `${cfg.name} — ${input.name}`,
        startsAt: starts,
        endsAt: ends,
        status: "scheduled",
        location: "virtual",
        notes: input.notes ?? null,
        attendeeName: input.name,
        attendeeEmail: input.email,
        ownerId: hostId,
        bookingPageId: cfg.id,
      },
    });
    await emitEvent({ orgId: cfg.orgId, environment: "production", type: "meeting.scheduled", entity: "meeting", entityId: meeting.id, actorId: hostId, payload: { title: meeting.title, startsAt: starts.toISOString(), booking: true } });
    await emitEvent({ orgId: cfg.orgId, environment: "production", type: "booking.booked", entity: "meeting", entityId: meeting.id, actorId: hostId, payload: { slug: cfg.slug, name: input.name, email: input.email, hostId, startsAt: starts.toISOString() } });
    ok(res, { ok: true, booked: true, meetingId: meeting.id, hostId, startsAt: starts.toISOString() }, 201);
  })
);

export default router;
