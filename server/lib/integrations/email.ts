// Email provider adapters (Phase 16 · ADR-028) — real-world sends + provider
// event webhooks behind one narrow interface, REST-over-fetch (no new deps).
//
// Mock mode is the default and is byte-for-byte the old behavior: rows are
// created with status "sent" and nothing leaves the box. When EMAIL_PROVIDER
// is resend/sendgrid (with a key), sendOutboundWithProvider fires the real
// provider after the row exists — success stores providerMessageId, failure
// flips the row to "failed" + emits email.failed (delivery is async by
// nature, never a precondition of the API call).
//
// Webhook security (docs/54-spec-phase16.md §1.3): when EMAIL_WEBHOOK_SECRET
// is set, SendGrid / Resend signatures are REQUIRED; when unset (dev), the
// payload must still resolve to a real Message row by its unguessable
// tracking token or the provider message id (capability proof).
import { db } from "../../db";
import { env } from "../../env";
import { emitEvent } from "../events";

export type EmailProvider = "mock" | "resend" | "sendgrid";

/** One narrow send contract every adapter implements. */
export type SendEmailInput = {
  from: string; // the provider-verified sender (env), NOT the user's mailbox
  replyTo?: string | null; // the rep's actual address (providers allow reply-to)
  to: string;
  subject: string;
  body: string;
  trackingToken: string; // carried to the provider for webhook correlation
};

export type SendEmailResult = { providerMessageId: string };

/** A provider-level failure (bad key, unverified sender, network, 4xx/5xx). */
export class ProviderError extends Error {
  constructor(public provider: string, message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string; header: (name: string) => string | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, header: (name) => res.headers.get(name) };
}

// ── Adapters ────────────────────────────────────────────────────────────────

/** Resend (https://resend.com/docs/api-reference/emails/send-email). */
async function sendResend(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.resendApiKey) throw new ProviderError("resend", "RESEND_API_KEY is not set — enable the provider in .env");
  if (!env.resendFromEmail) throw new ProviderError("resend", "RESEND_FROM_EMAIL is not set (must be a verified sender)");
  const { status, text, header } = await postJson(
    "https://api.resend.com/emails",
    { authorization: `Bearer ${env.resendApiKey}` },
    {
      from: env.resendFromEmail,
      to: [input.to],
      reply_to: input.replyTo && input.replyTo !== input.from ? [input.replyTo] : undefined,
      subject: input.subject,
      text: input.body,
      headers: { "X-Qorvexa-Token": input.trackingToken },
    }
  );
  if (status >= 400) throw new ProviderError("resend", `Resend API ${status}: ${text.slice(0, 300)}`);
  let id = "";
  try {
    id = String(JSON.parse(text).id ?? "");
  } catch {
    /* non-JSON success — no id to correlate */
  }
  return { providerMessageId: id };
}

/** SendGrid v3 (https://docs.sendgrid.com/api-reference/mail-send/mail-send). */
async function sendSendgrid(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.sendgridApiKey) throw new ProviderError("sendgrid", "SENDGRID_API_KEY is not set — enable the provider in .env");
  if (!env.sendgridFromEmail) throw new ProviderError("sendgrid", "SENDGRID_FROM_EMAIL is not set (must be a verified sender)");
  const { status, text, header } = await postJson(
    "https://api.sendgrid.com/v3/mail/send",
    { authorization: `Bearer ${env.sendgridApiKey}` },
    {
      personalizations: [{ to: [{ email: input.to }], custom_args: { tracking_token: input.trackingToken } }],
      from: { email: env.sendgridFromEmail },
      reply_to: input.replyTo && input.replyTo !== input.from ? { email: input.replyTo } : undefined,
      subject: input.subject,
      content: [{ type: "text/plain", value: input.body }],
    }
  );
  if (status >= 400) throw new ProviderError("sendgrid", `SendGrid API ${status}: ${text.slice(0, 300)}`);
  return { providerMessageId: header("x-message-id") ?? "" };
}

/** Dispatch to the configured adapter. */
export async function sendEmail(provider: EmailProvider, input: SendEmailInput): Promise<SendEmailResult> {
  if (provider === "resend") return sendResend(input);
  if (provider === "sendgrid") return sendSendgrid(input);
  return { providerMessageId: "" }; // mock — nothing leaves the box
}

/**
 * Fire the real provider for an outbound Message row that already exists.
 * Mock mode is a no-op. Success stores provider + providerMessageId; failure
 * flips the row to "failed" and emits email.failed — the API contract of the
 * sending endpoint is identical either way (delivery is asynchronous).
 */
export async function sendOutboundWithProvider(message: {
  id: string;
  orgId: string;
  environment: string;
  ownerId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  trackingToken: string | null;
}): Promise<void> {
  const provider = env.emailProvider;
  if (provider === "mock") return;
  try {
    const result = await sendEmail(provider, {
      from: provider === "resend" ? env.resendFromEmail : env.sendgridFromEmail,
      replyTo: message.fromEmail,
      to: message.toEmail,
      subject: message.subject,
      body: message.body,
      trackingToken: message.trackingToken ?? "",
    });
    await db().message.update({
      where: { id: message.id },
      data: { provider, providerMessageId: result.providerMessageId, updatedAt: new Date() },
    });
  } catch (e) {
    console.error(`[integrations email] ${provider} send failed:`, (e as Error).message);
    await db().message
      .update({ where: { id: message.id }, data: { status: "failed", updatedAt: new Date() } })
      .catch(() => undefined);
    await emitEvent({
      orgId: message.orgId,
      environment: message.environment,
      type: "email.failed",
      entity: "message",
      entityId: message.id,
      actorId: message.ownerId,
      payload: { provider, errorClass: (e as Error).name ?? "error", to: message.toEmail, subject: message.subject },
    }).catch(() => undefined);
  }
}

// ── Engagement + deliverability application (shared with /api/t tracking) ───

/** Roll a first open/click up into the campaign's recipient + count rows. */
export async function rollupCampaignRecipient(message: any, kind: "opened" | "clicked") {
  if (!message.campaignId) return;
  const now = new Date();
  await db().campaignRecipient.updateMany({
    where: { messageId: message.id, campaignId: message.campaignId },
    data: kind === "opened" ? { status: "opened", openedAt: now } : { status: "clicked", clickedAt: now },
  });
  const field = kind === "opened" ? "openedCount" : "clickedCount";
  await db().campaign.update({ where: { id: message.campaignId }, data: { [field]: { increment: 1 }, updatedAt: now } });
}

/** Mark a message opened (first open emits email.opened + campaign rollup). */
export async function markMessageOpened(message: any) {
  const wasOpened = !!message.openedAt;
  await db().message.update({
    where: { id: message.id },
    data: { openedAt: message.openedAt ?? new Date(), openedCount: { increment: 1 }, status: message.status === "replied" ? "replied" : "opened", updatedAt: new Date() },
  });
  if (wasOpened) return;
  await rollupCampaignRecipient(message, "opened");
  await emitEvent({
    orgId: message.orgId,
    environment: message.environment,
    type: "email.opened",
    entity: "message",
    entityId: message.id,
    actorId: message.ownerId,
    payload: { to: message.toEmail, subject: message.subject, contactId: message.contactId ?? null, campaignId: message.campaignId ?? null },
  });
}

/** Mark a message clicked (first click emits email.clicked + campaign rollup). */
export async function markMessageClicked(message: any, url: string) {
  const wasClicked = !!message.clickedAt;
  await db().message.update({
    where: { id: message.id },
    data: { clickedAt: message.clickedAt ?? new Date(), status: message.status === "replied" ? "replied" : "clicked", updatedAt: new Date() },
  });
  if (wasClicked) return;
  await rollupCampaignRecipient(message, "clicked");
  await emitEvent({
    orgId: message.orgId,
    environment: message.environment,
    type: "email.clicked",
    entity: "message",
    entityId: message.id,
    actorId: message.ownerId,
    payload: { to: message.toEmail, subject: message.subject, url, contactId: message.contactId ?? null, campaignId: message.campaignId ?? null },
  });
}

// ── Webhook parsing ─────────────────────────────────────────────────────────

export type EmailWebhookEvent =
  | "opened"
  | "clicked"
  | "bounced"
  | "delivered"
  | "unsubscribed"
  | "complained";

export type NormalizedEmailEvent = {
  provider: EmailProvider | "unknown";
  event: EmailWebhookEvent;
  messageId?: string; // provider's message id (resend email_id / sendgrid sg_message_id)
  trackingToken?: string; // our token (normalized shape; mock-mode capability proof)
  url?: string; // clicked target
  occurredAt?: string;
};

const RESEND_EVENT_MAP: Record<string, EmailWebhookEvent> = {
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.delivered": "delivered",
  "email.complained": "complained",
  "email.unsubscribed": "unsubscribed",
};

const SENDGRID_EVENT_MAP: Record<string, EmailWebhookEvent> = {
  open: "opened",
  click: "clicked",
  bounce: "bounced",
  dropped: "bounced",
  delivered: "delivered",
  spamreport: "complained",
  group_unsubscribe: "unsubscribed",
  unsubscribe: "unsubscribed",
};

/** Parse a raw Resend webhook payload → normalized event(s). */
export function parseResendPayload(body: any): NormalizedEmailEvent[] {
  if (!body || typeof body !== "object") return [];
  const type = String(body.type ?? "");
  const event = RESEND_EVENT_MAP[type];
  if (!event) return []; // email.sent / unknown → ignore
  const data = (body.data ?? {}) as Record<string, any>;
  return [
    {
      provider: "resend",
      event,
      messageId: data.email_id ? String(data.email_id) : undefined,
      url: data.url ? String(data.url) : undefined,
      occurredAt: body.created_at ? String(body.created_at) : undefined,
    },
  ];
}

/** Parse a raw SendGrid event-webhook payload (an array) → normalized event(s). */
export function parseSendgridPayload(body: any): NormalizedEmailEvent[] {
  if (!Array.isArray(body)) return [];
  const out: NormalizedEmailEvent[] = [];
  for (const raw of body) {
    const event = SENDGRID_EVENT_MAP[String(raw?.event ?? "")];
    if (!event) continue; // processed / deferred / open? handled above / etc.
    // sg_message_id looks like "<id>.<pool-id>" — correlation uses the id.
    const sg = String(raw?.sg_message_id ?? "");
    out.push({
      provider: "sendgrid",
      event,
      messageId: sg ? sg.split(".")[0] : undefined,
      url: raw?.url ? String(raw.url) : undefined,
      occurredAt: raw?.timestamp ? new Date(Number(raw.timestamp) * 1000).toISOString() : undefined,
    });
  }
  return out;
}

/** Parse the documented normalized shape (tests + non-resend/sendgrid providers). */
export function parseNormalizedPayload(body: any): NormalizedEmailEvent[] {
  if (!body || typeof body !== "object" || !body.event) return [];
  const event = String(body.event);
  if (!(SENDGRID_EVENT_MAP[event] ?? RESEND_EVENT_MAP[`email.${event}`])) {
    const known = ["opened", "clicked", "bounced", "delivered", "unsubscribed", "complained"];
    if (!known.includes(event)) return [];
  }
  return [
    {
      provider: body.provider === "resend" || body.provider === "sendgrid" ? body.provider : "unknown",
      event: event as EmailWebhookEvent,
      messageId: body.messageId ? String(body.messageId) : undefined,
      trackingToken: body.trackingToken ? String(body.trackingToken) : undefined,
      url: body.url ? String(body.url) : undefined,
    },
  ];
}

/**
 * Normalize ANY accepted payload shape (resend | sendgrid | normalized) into
 * a flat event list. The raw body was already captured for signature checks.
 */
export function parseWebhookPayload(body: any): NormalizedEmailEvent[] {
  if (body && typeof body === "object" && body.type && typeof body.type === "string" && body.type.startsWith("email.")) {
    return parseResendPayload(body);
  }
  if (Array.isArray(body)) return parseSendgridPayload(body);
  return parseNormalizedPayload(body);
}

// ── Signature verification (when EMAIL_WEBHOOK_SECRET is set) ───────────────

import crypto from "node:crypto";

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "base64");
    const bb = Buffer.from(b, "base64");
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** SendGrid: X-Twilio-Email-Event-Webhook-Signature = base64(HMAC-SHA256(secret, timestamp + "." + rawBody)). */
export function verifySendgridSignature(headers: Record<string, string | undefined>, rawBody: string, secret: string): boolean {
  const signature = headers["x-twilio-email-event-webhook-signature"] ?? "";
  const timestamp = headers["x-twilio-email-event-webhook-timestamp"] ?? "";
  if (!signature || !timestamp) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("base64");
  return timingSafeEqualHex(expected, signature);
}

/** Resend svix: signature header "v1,<base64>[,...]" over `${svix-id}.${svix-timestamp}.${rawBody}`. */
export function verifyResendSignature(headers: Record<string, string | undefined>, rawBody: string, secret: string): boolean {
  const id = headers["svix-id"] ?? "";
  const ts = headers["svix-timestamp"] ?? "";
  const sig = headers["svix-signature"] ?? "";
  if (!id || !ts || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return sig.split(",").some((s) => s.trim().startsWith("v1,") && timingSafeEqualHex(expected, s.trim().slice(3)));
}

// ── Apply a normalized event to the Message row ─────────────────────────────

/**
 * Correlate + apply one normalized webhook event. Returns the affected
 * Message row, or null when no row matches (unknown id/token — the caller
 * 404s; a forged payload can only touch rows whose token it already knows).
 */
export async function applyEmailWebhookEvent(event: NormalizedEmailEvent): Promise<any | null> {
  const where: Record<string, string> = {};
  if (event.messageId) where.providerMessageId = event.messageId;
  if (event.trackingToken) where.trackingToken = event.trackingToken;
  if (!Object.keys(where).length) return null;
  const message = await db().message.findFirst({ where });
  if (!message) return null;

  const payload = { to: message.toEmail, subject: message.subject, contactId: message.contactId ?? null, campaignId: message.campaignId ?? null, url: event.url ?? null };

  if (event.event === "opened") {
    await markMessageOpened(message);
  } else if (event.event === "clicked") {
    await markMessageClicked(message, event.url ?? "");
  } else if (event.event === "bounced") {
    if (!message.bouncedAt) {
      await db().message.update({ where: { id: message.id }, data: { bouncedAt: new Date(), updatedAt: new Date() } });
      await emitEvent({ orgId: message.orgId, environment: message.environment, type: "email.bounced", entity: "message", entityId: message.id, actorId: message.ownerId, payload });
    }
  } else if (event.event === "unsubscribed") {
    if (!message.unsubscribedAt) {
      await db().message.update({ where: { id: message.id }, data: { unsubscribedAt: new Date(), updatedAt: new Date() } });
      await emitEvent({ orgId: message.orgId, environment: message.environment, type: "email.unsubscribed", entity: "message", entityId: message.id, actorId: message.ownerId, payload });
    }
  } else if (event.event === "complained") {
    if (!message.unsubscribedAt) {
      await db().message.update({ where: { id: message.id }, data: { unsubscribedAt: new Date(), updatedAt: new Date() } });
      await emitEvent({ orgId: message.orgId, environment: message.environment, type: "email.complained", entity: "message", entityId: message.id, actorId: message.ownerId, payload });
    }
  } else if (event.event === "delivered") {
    // No column — the event itself is the deliverability signal (Phase 5 metrics).
    await emitEvent({ orgId: message.orgId, environment: message.environment, type: "email.delivered", entity: "message", entityId: message.id, actorId: message.ownerId, payload });
  }

  return message;
}
