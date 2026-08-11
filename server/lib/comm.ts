// Communication helpers (Phase 2 — Email, Calling, Booking).
// Centralises the pieces the comm routes share:
//  • template variable merge ({{contact.firstName}} → value)
//  • tracking token generation (open pixel / click redirect)
//  • mock provider helpers (EMAIL_MOCK=1 pattern, mirrors OAUTH_MOCK dev mode)
//  • call recording/transcription mock (real telephony is deferred — ADR-014)
import crypto from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { badRequest } from "./http";

// ── Template variable merge ──────────────────────────────────────────────────
// Replace {{path.to.value}} with a value from `vars`. Unknown variables are
// left empty (never crash a send because a field was missing). Nested keys are
// supported via dot paths. Falsy-but-present values are rendered as-is.
export function mergeTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, vars);
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

// ── Tracking ─────────────────────────────────────────────────────────────────
// Random URL-safe token scoping the open/click endpoints. Unguessable enough
// that public tracking endpoints leak nothing (ADR-014).
export function trackingToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Absolute URL for the open pixel of a message (public, token-scoped). */
export function openPixelUrl(token: string): string {
  const base = env.publicBaseUrl.replace(/\/$/, "");
  return `${base}/api/t/px/${encodeURIComponent(token)}`;
}

/** Absolute URL for a link that, when clicked, marks the message clicked then redirects. */
export function clickRedirectUrl(token: string, target: string): string {
  const base = env.publicBaseUrl.replace(/\/$/, "");
  return `${base}/api/t/click/${encodeURIComponent(token)}?u=${encodeURIComponent(target)}`;
}

// ── Mock email provider (EMAIL_MOCK=1 dev mode; ADR-014) ────────────────────
// In dev/demo there is no real SMTP. "Sending" records the Message with a
// tracking token; inbound mail is simulated. When a real provider is plugged
// in later, only these two functions change.
export const emailProviderMock = () => env.emailMock;

/** Simulated inbound messages (a tiny "inbox" the sync endpoint drains). */
const MOCK_INBOUND: { from: string; subject: string; body: string }[] = [
  {
    from: "sarah@acmecorp.io",
    subject: "Re: Northwind proposal",
    body: "Thanks for the deck — leadership is reviewing it this week. Can we talk Thursday?",
  },
  {
    from: "dana@brightlabs.dev",
    subject: "Qorvexa trial feedback",
    body: "The pipeline view is great. Could you send over the pricing page again?",
  },
  {
    from: "mike@globex.example",
    subject: "Intro call follow-up",
    body: "Appreciate the call earlier. Sending over our security questionnaire today.",
  },
];

// A per-org queue so repeated sync calls deliver different mail.
const inboundQueues = new Map<string, typeof MOCK_INBOUND>();

function queueFor(orgId: string) {
  let q = inboundQueues.get(orgId);
  if (!q || q.length === 0) {
    q = [...MOCK_INBOUND];
    inboundQueues.set(orgId, q);
  }
  return q;
}

/** Drain up to `limit` simulated inbound messages for an org (mock sync). */
export function drainMockInbound(orgId: string, limit = 3): (typeof MOCK_INBOUND)[number][] {
  const q = queueFor(orgId);
  return q.splice(0, limit);
}

/** Build a plausible reply body prefixed quote (mock "reply" simulation). */
export function mockReplyBody(original: string): string {
  const quote = original
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 3)
    .map((l) => `> ${l}`)
    .join("\n");
  return `Sounds good — let's find time next week.\n\n${quote}`;
}

// ── Call recording + transcription mock (ADR-014) ───────────────────────────
// When org settings enable recording, we generate a placeholder recording URL
// and a canned transcript so the UI + data model are fully exercisable without
// a real telephony provider. Swap with a real provider later.
export function mockRecordingUrl(callId: string): string {
  const base = env.publicBaseUrl.replace(/\/$/, "");
  return `${base}/api/mock/media/calls/${callId}.wav`;
}

const TRANSCRIPT_LINES = [
  "Thanks for taking the time to talk today.",
  "We're focused on reducing manual data entry for the sales team.",
  "Your team mentioned the pipeline reporting was a big pain point.",
  "I'll send over a proposal with next steps by end of week.",
];

export function mockTranscript(direction: string): string {
  const speaker = direction === "out" ? "You" : "Prospect";
  return TRANSCRIPT_LINES.map((l, i) => `${i % 2 === 0 ? speaker : i % 2 ? (direction === "out" ? "Prospect" : "You") : speaker}: ${l}`).join("\n");
}

// ── Booking slot math ────────────────────────────────────────────────────────
export type BookingPageConfig = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  durationMins: number;
  bufferMins: number;
  hostPool: string[];
  cursor: number;
  availableDays: number[];
  startHour: number;
  endHour: number;
  timezone: string;
  active: boolean;
};

/** Validate + normalise a booking page config from raw org input. */
export function normalizeBookingPage(raw: unknown): Omit<BookingPageConfig, "id" | "orgId" | "cursor"> {
  const r = (raw ?? {}) as Record<string, any>;
  const duration = Number(r.durationMins);
  const buffer = Number(r.bufferMins);
  const days = Array.isArray(r.availableDays) ? r.availableDays.map(Number).filter((d) => d >= 0 && d <= 6) : [1, 2, 3, 4, 5];
  const start = Number(r.startHour);
  const end = Number(r.endHour);
  if (!Number.isFinite(duration) || duration < 10 || duration > 240) throw badRequest("durationMins must be 10–240");
  if (!Number.isFinite(buffer) || buffer < 0 || buffer > 60) throw badRequest("bufferMins must be 0–60");
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 24 || start >= end) {
    throw badRequest("startHour must be < endHour (0–24)");
  }
  if (days.length === 0) throw badRequest("At least one available day is required");
  return {
    name: String(r.name ?? "").trim(),
    slug: String(r.slug ?? "").trim().toLowerCase(),
    description: r.description ? String(r.description) : null,
    durationMins: duration,
    bufferMins: buffer,
    hostPool: Array.isArray(r.hostPool) ? r.hostPool.map(String).filter(Boolean) : [],
    availableDays: [...new Set(days)].sort(),
    startHour: start,
    endHour: end,
    timezone: String(r.timezone ?? "UTC"),
    active: r.active !== false,
  };
}

/**
 * Generate available start times for a date (org-local semantics): slots of
 * durationMins separated by bufferMins, inside [startHour, endHour). Returns
 * ISO strings; caller compares against existing bookings to mark busy.
 */
export function slotsForDate(cfg: BookingPageConfig, dateStr: string): string[] {
  // dateStr = YYYY-MM-DD in the org's local timezone (client passes it).
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) throw badRequest("Invalid date (expected YYYY-MM-DD)");
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!cfg.availableDays.includes(day)) return [];
  const total = cfg.durationMins + cfg.bufferMins;
  const slots: string[] = [];
  for (let mins = cfg.startHour * 60; mins + cfg.durationMins <= cfg.endHour * 60; mins += total) {
    // Store as an absolute UTC instant derived from the local wall-clock —
    // v1 keeps timezone handling explicit and client-side for display.
    slots.push(new Date(Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60)).toISOString());
  }
  return slots;
}

/** Pick the next round-robin host for a booking, persisting the cursor. */
export async function nextBookingHost(cfg: BookingPageConfig): Promise<string> {
  const pool = cfg.hostPool;
  if (!pool.length) throw badRequest("This booking page has no hosts assigned — ask the workspace admin");
  // Only active, same-org users are eligible (inactive/removed hosts skipped).
  const users = await db().user.findMany({ where: { id: { in: pool }, orgId: cfg.orgId, active: true }, select: { id: true } });
  const eligible = users.map((u) => u.id);
  if (!eligible.length) throw badRequest("No active hosts available on this booking page");
  const idx = cfg.cursor % eligible.length;
  // Persist the cursor (read-modify-write; concurrent bookings may share an
  // index — acceptable v1, same caveat as lead routing).
  await db().bookingPage.update({
    where: { id: cfg.id },
    data: { cursor: (idx + 1) % eligible.length, updatedAt: new Date() },
  });
  return eligible[idx];
}
