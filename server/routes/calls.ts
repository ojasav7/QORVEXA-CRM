// Calling (Phase 2) — call log entries. Click-to-call is client-side (tel:);
// logging a completed call here records it on the record timeline (auto-log).
// When org settings enable recording, a mock recording URL + basic transcript
// are generated (real telephony is deferred — ADR-014). call.completed fires
// when a call with duration > 0 is logged.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, badRequest, forbidden, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { mockRecordingUrl, mockTranscript } from "../lib/comm";
import { placeTwilioCall, TelephonyError } from "../lib/integrations/telephony";

const router = Router();

const callSchema = z.object({
  direction: z.enum(["in", "out"]).optional(),
  phone: z.string().min(3).max(40),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  status: z.enum(["completed", "no-answer", "voicemail"]).optional(),
  notes: z.string().max(4_000).optional(),
  contactId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  startedAt: z.string().optional(),
  recording: z.boolean().optional(), // requested — resolved against org settings
});

// GET /api/calls?contactId=&opportunityId=&q=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { contactId, opportunityId, accountId } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { orgId: user.orgId, environment };
    if (contactId) where.contactId = contactId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (accountId) where.accountId = accountId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const [items, total] = await Promise.all([
      db().call.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().call.count({ where }),
    ]);
    ok(res, { items, total });
  })
);

// POST /api/calls — log a call
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = callSchema.parse(req.body);

    const org = await db().organization.findUnique({ where: { id: user.orgId } });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const callSettings = (settings.calling ?? {}) as Record<string, unknown>;
    const recordingEnabled = callSettings.recording === true;

    const status = input.status ?? "completed";
    const durationSec = input.durationSec ?? (status === "completed" ? Math.floor(120 + Math.random() * 600) : 0);
    const call = await db().call.create({
      data: {
        orgId: user.orgId,
        environment,
        direction: input.direction ?? "out",
        phone: input.phone,
        durationSec,
        status,
        recordingUrl: recordingEnabled ? mockRecordingUrl("placeholder") : null,
        transcript: recordingEnabled ? mockTranscript(input.direction ?? "out") : null,
        notes: input.notes ?? null,
        contactId: input.contactId ?? null,
        accountId: input.accountId ?? null,
        opportunityId: input.opportunityId ?? null,
        ownerId: user.id,
        startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
      },
    });
    if (status === "completed") {
      await emitEvent({
        orgId: user.orgId,
        environment,
        type: "call.completed",
        entity: "call",
        entityId: call.id,
        actorId: user.id,
        payload: { phone: input.phone, durationSec, direction: call.direction, contactId: input.contactId ?? null, opportunityId: input.opportunityId ?? null },
      });
    } else {
      await emitEvent({ orgId: user.orgId, environment, type: "call.logged", entity: "call", entityId: call.id, actorId: user.id, payload: { phone: input.phone, status } });
    }
    ok(res, { call }, 201);
  })
);

// PATCH /api/calls/:id — e.g. mark status, attach notes
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const existing = await db().call.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!existing) throw notFound("Call not found");
    const input = callSchema.partial().parse(req.body);
    const updated = await db().call.update({
      where: { id: existing.id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
        ...(input.direction !== undefined ? { direction: input.direction } : {}),
        updatedAt: new Date(),
      },
    });
    ok(res, { call: updated });
  })
);

// POST /api/calls/:id/place — initiate a REAL outbound call via the configured
// telephony provider (Twilio, Phase 16 · ADR-028). Mock mode → 400 with an
// actionable message (never a silent fake). Twilio then dials the number,
// plays the TwiML at /api/integrations/twilio/twiml/:id, and posts status /
// recording callbacks back to the integration webhooks, which flip the row
// to completed/no-answer + attach recording/transcript + emit call.completed.
router.post(
  "/:id/place",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    if (!["admin", "manager"].includes(user.role)) throw forbidden("Only admins and managers can place outbound calls");
    const environment = await resolveEnvironment(req, user.orgId);
    const call = await db().call.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!call) throw notFound("Call not found");
    const base = env.publicBaseUrl.replace(/\/$/, "");
    try {
      const { callSid } = await placeTwilioCall({
        to: call.phone,
        twimlUrl: `${base}/api/integrations/twilio/twiml/${call.id}`,
        statusCallbackUrl: `${base}/api/integrations/twilio/status/${call.id}`,
        recordingCallbackUrl: `${base}/api/integrations/twilio/recording/${call.id}`,
      });
      const updated = await db().call.update({ where: { id: call.id }, data: { status: "ringing", updatedAt: new Date() } });
      await emitEvent({
        orgId: user.orgId,
        environment,
        type: "call.initiated",
        entity: "call",
        entityId: call.id,
        actorId: user.id,
        payload: { phone: call.phone, callSid, provider: "twilio" },
      });
      ok(res, { call: updated, callSid, provider: "twilio" }, 201);
    } catch (e) {
      if (e instanceof TelephonyError && e.code === "not-configured") throw badRequest(e.message);
      throw e;
    }
  })
);

// DELETE /api/calls/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const existing = await db().call.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!existing) throw notFound("Call not found");
    await db().call.delete({ where: { id: existing.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "call.deleted", entity: "call", entityId: existing.id, actorId: user.id, payload: { phone: existing.phone } });
    ok(res, { ok: true });
  })
);

export default router;
