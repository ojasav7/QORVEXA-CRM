// Booking pages (Phase 2) — admin-managed public scheduling pages. The public
// side (no auth) lives in routes/public-booking.ts. A page defines duration,
// buffer, host pool (round-robin), and availability; bookings create Meetings
// owned by the next host in the pool (mirrors lead routing, ADR-010 pattern).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { normalizeBookingPage } from "../lib/comm";

const router = Router();
router.use(requireRole("admin"));

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

// NOTE: no z.default() — defaults are applied explicitly in create (partial()
// on PATCH must not silently reset fields, same rule as lead-forms).
const pageSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(SLUG_RE, "Slug: 2-40 chars, lowercase letters, numbers, hyphens"),
  description: z.string().max(400).optional(),
  durationMins: z.number().int().min(10).max(240),
  bufferMins: z.number().int().min(0).max(60).optional(),
  hostPool: z.array(z.string().min(1)).optional(),
  availableDays: z.array(z.number().int().min(0).max(6)).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(1).max(24).optional(),
  timezone: z.string().max(60).optional(),
  active: z.boolean().optional(),
});

// GET /api/booking-pages
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().bookingPage.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
    ok(res, { items });
  })
);

// POST /api/booking-pages
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const input = pageSchema.parse(req.body);
    const cfg = normalizeBookingPage({ ...input, hostPool: input.hostPool ?? [] });
    const dup = await db().bookingPage.findFirst({ where: { orgId: user.orgId, slug: cfg.slug } });
    if (dup) throw badRequest(`A booking page with slug "${cfg.slug}" already exists`);
    const page = await db().bookingPage.create({
      data: {
        orgId: user.orgId,
        name: cfg.name,
        slug: cfg.slug,
        description: cfg.description,
        durationMins: cfg.durationMins,
        bufferMins: cfg.bufferMins,
        hostPool: cfg.hostPool as object,
        availableDays: cfg.availableDays as object,
        startHour: cfg.startHour,
        endHour: cfg.endHour,
        timezone: cfg.timezone,
        active: cfg.active,
      },
    });
    await emitEvent({ orgId: user.orgId, environment: "production", type: "booking.page_created", entity: "bookingPage", entityId: page.id, actorId: user.id, payload: { name: cfg.name, slug: cfg.slug } });
    ok(res, { page }, 201);
  })
);

// PATCH /api/booking-pages/:id
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const existing = await db().bookingPage.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!existing) throw notFound("Booking page not found");
    const input = pageSchema.partial().parse(req.body);
    const cfg = normalizeBookingPage({ ...(existing as object), ...input, hostPool: input.hostPool ?? (existing.hostPool as string[]) });
    if (cfg.slug !== existing.slug) {
      const dup = await db().bookingPage.findFirst({ where: { orgId: user.orgId, slug: cfg.slug } });
      if (dup) throw badRequest(`A booking page with slug "${cfg.slug}" already exists`);
    }
    const updated = await db().bookingPage.update({
      where: { id: existing.id },
      data: {
        name: cfg.name,
        slug: cfg.slug,
        description: cfg.description,
        durationMins: cfg.durationMins,
        bufferMins: cfg.bufferMins,
        hostPool: cfg.hostPool as object,
        availableDays: cfg.availableDays as object,
        startHour: cfg.startHour,
        endHour: cfg.endHour,
        timezone: cfg.timezone,
        active: cfg.active,
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment: "production", type: "booking.page_updated", entity: "bookingPage", entityId: updated.id, actorId: user.id, payload: { slug: updated.slug } });
    ok(res, { page: updated });
  })
);

// DELETE /api/booking-pages/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const existing = await db().bookingPage.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!existing) throw notFound("Booking page not found");
    await db().bookingPage.delete({ where: { id: existing.id } });
    await emitEvent({ orgId: user.orgId, environment: "production", type: "booking.page_deleted", entity: "bookingPage", entityId: existing.id, actorId: user.id, payload: { slug: existing.slug } });
    ok(res, { ok: true });
  })
);

export default router;
