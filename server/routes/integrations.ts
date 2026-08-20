// Provider integrations (Phase 16 · ADR-028).
//   GET  /api/integrations/status            → admin-only provider status (Settings UI)
//   POST /api/integrations/email/webhook     → public: Resend / SendGrid / normalized email events
//   POST /api/integrations/twilio/status/:callId   → public: Twilio call status callbacks
//   POST /api/integrations/twilio/recording/:callId → public: recording + transcription callbacks
//   GET  /api/integrations/twilio/twiml/:callId    → public: TwiML Twilio plays for an outbound call
//
// Webhook security (spec §1.3): signature verification when a secret is
// configured (EMAIL_WEBHOOK_SECRET / TWILIO_AUTH_TOKEN), plus a capability
// proof in dev — the payload must reference a real row by its unguessable
// token/id. The global express.json captures `req.rawBody` (see index.ts) so
// signatures are verified against the exact bytes.
import { Router } from "express";
import { db } from "../db";
import { env } from "../env";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { integrationsStatus } from "../lib/integrations";
import {
  parseWebhookPayload,
  applyEmailWebhookEvent,
  verifySendgridSignature,
  verifyResendSignature,
} from "../lib/integrations/email";
import {
  twilioConfigured,
  verifyTwilioSignature,
  parseStatusCallback,
  fetchCallRecording,
  twimlForCall,
} from "../lib/integrations/telephony";

const router = Router();

// GET /api/integrations/status — provider config status (admin only).
router.get(
  "/status",
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    ok(res, { integrations: integrationsStatus() });
  })
);

// ── Email event webhook ─────────────────────────────────────────────────────
// Accepts Resend, SendGrid, and the normalized shape. Signature verification
// when EMAIL_WEBHOOK_SECRET is set; otherwise the payload must resolve to a
// real Message row (unknown id/token → 404 — no info leaked).
router.post(
  "/email/webhook",
  asyncHandler(async (req, res) => {
    const rawBody = String((req as any).rawBody ?? "");
    if (env.emailWebhookSecret) {
      const headers = req.headers as Record<string, string | undefined>;
      const sendgridOk = verifySendgridSignature(headers, rawBody, env.emailWebhookSecret);
      const resendOk = verifyResendSignature(headers, rawBody, env.emailWebhookSecret);
      if (!sendgridOk && !resendOk) throw badRequest("Invalid webhook signature");
    }
    const events = parseWebhookPayload(req.body);
    if (!events.length) throw badRequest("No supported email events in payload");
    let applied = 0;
    for (const event of events) {
      const message = await applyEmailWebhookEvent(event);
      if (message) applied++;
    }
    if (!applied) throw notFound("No message matches this webhook payload");
    ok(res, { ok: true, applied, events: events.map((e) => e.event) });
  })
);

// ── Twilio call status callbacks ────────────────────────────────────────────
router.post(
  "/twilio/status/:callId",
  asyncHandler(async (req, res) => {
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    if (!verifyTwilioSignature(fullUrl, req.headers["x-twilio-signature"] as string | undefined)) {
      throw badRequest("Invalid Twilio signature");
    }
    const call = await db().call.findUnique({ where: { id: String(req.params.callId) } });
    if (!call) throw notFound("Call not found");
    const parsed = parseStatusCallback(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.durationSec !== null) data.durationSec = parsed.durationSec;
    data.status = parsed.status;
    const wasCompleted = call.status === "completed";
    const nowCompleted = parsed.status === "completed";

    let recordingUrl: string | null = parsed.recordingUrl;
    let transcript: string | null = null;
    if (nowCompleted && !wasCompleted) {
      // Recording: prefer the callback's URL; otherwise fetch from Twilio.
      if (!recordingUrl && parsed.callSid) {
        const rec = await fetchCallRecording(parsed.callSid);
        recordingUrl = rec.recordingUrl;
        transcript = rec.transcript;
      }
      if (recordingUrl) data.recordingUrl = recordingUrl;
      if (transcript) data.transcript = transcript;
    }

    const updated = await db().call.update({ where: { id: call.id }, data });
    if (nowCompleted && !wasCompleted) {
      await emitEvent({
        orgId: call.orgId,
        environment: call.environment,
        type: "call.completed",
        entity: "call",
        entityId: call.id,
        actorId: call.ownerId,
        payload: { phone: call.phone, durationSec: parsed.durationSec ?? call.durationSec, direction: call.direction, contactId: call.contactId ?? null, opportunityId: call.opportunityId ?? null, provider: "twilio" },
      });
    }
    ok(res, { ok: true, call: updated });
  })
);

// ── Twilio recording / transcription callbacks ──────────────────────────────
// RecordingStatusCallback: { CallSid, RecordingUrl, … } → store recordingUrl.
// TranscribeCallback:      { TranscriptionText, … }      → store transcript.
router.post(
  "/twilio/recording/:callId",
  asyncHandler(async (req, res) => {
    const call = await db().call.findUnique({ where: { id: String(req.params.callId) } });
    if (!call) throw notFound("Call not found");
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.RecordingUrl) data.recordingUrl = String(req.body.RecordingUrl);
    if (req.body?.TranscriptionText) data.transcript = String(req.body.TranscriptionText);
    const updated = await db().call.update({ where: { id: call.id }, data });
    ok(res, { ok: true, call: updated });
  })
);

// ── TwiML for an outbound call (fetched by Twilio when it dials) ────────────
router.get(
  "/twilio/twiml/:callId",
  asyncHandler(async (req, res) => {
    const call = await db().call.findUnique({ where: { id: String(req.params.callId) } });
    if (!call) throw notFound("Call not found");
    const org = await db().organization.findUnique({ where: { id: call.orgId } });
    const settings = ((org?.settings ?? {}) as Record<string, unknown>).calling as Record<string, unknown> | undefined;
    const recordingEnabled = settings?.recording === true;
    const base = env.publicBaseUrl.replace(/\/$/, "");
    res.setHeader("content-type", "text/xml");
    res.send(twimlForCall({ recordingEnabled, recordingCallbackUrl: `${base}/api/integrations/twilio/recording/${call.id}` }));
  })
);

export default router;
