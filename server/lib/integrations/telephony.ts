// Telephony adapter (Phase 16 · ADR-028) — Twilio outbound calls behind the
// same mock-first discipline: nothing requires Twilio to boot, and the
// existing POST /api/calls logging path is untouched. When TWILIO_* env is
// configured, POST /api/calls/:id/place initiates a REAL call with status +
// recording callbacks that land on our public webhook endpoints; mock mode
// returns a 400 with an actionable message (never a silent fake).
//
// Callback security: X-Twilio-Signature (base64 HMAC-SHA1 of the full request
// URL, keyed with TWILIO_AUTH_TOKEN) is verified whenever Twilio is
// configured; otherwise the :callId in the URL must resolve to a real Call
// row (capability proof — dev mode).
import crypto from "node:crypto";
import { env } from "../../env";

export function twilioConfigured(): boolean {
  return Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioFromNumber);
}

export class TelephonyError extends Error {
  constructor(public code: "not-configured" | "provider", message: string) {
    super(message);
    this.name = "TelephonyError";
  }
}

const API_BASE = "https://api.twilio.com/2010-04-01";

function authHeader(): string {
  return `Basic ${Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64")}`;
}

/**
 * Initiate an outbound call. Twilio dials To, plays the TwiML served at
 * twimlUrl (a <Say> + optional <Record>), and posts status/recording
 * callbacks to statusCallbackUrl / recordingCallbackUrl (our webhook routes).
 */
export async function placeTwilioCall(input: {
  to: string;
  twimlUrl: string;
  statusCallbackUrl: string;
  recordingCallbackUrl?: string;
}): Promise<{ callSid: string }> {
  if (!twilioConfigured()) {
    throw new TelephonyError("not-configured", "No telephony provider configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (see docs/54-spec-phase16.md)");
  }
  const body = new URLSearchParams({
    From: env.twilioFromNumber,
    To: input.to,
    Url: input.twimlUrl,
    StatusCallback: input.statusCallbackUrl,
    StatusCallbackEvent: "initiated ringing answered completed",
  });
  if (input.recordingCallbackUrl) body.set("RecordingStatusCallback", input.recordingCallbackUrl);

  const res = await fetch(`${API_BASE}/Accounts/${env.twilioAccountSid}/Calls.json`, {
    method: "POST",
    headers: { authorization: authHeader(), "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TelephonyError("provider", `Twilio API ${res.status}: ${text.slice(0, 300)}`);
  }
  let sid = "";
  try {
    sid = String(JSON.parse(text).sid ?? "");
  } catch {
    /* unexpected shape */
  }
  return { callSid: sid };
}

/** TwiML for an outbound call — plain greeting, or greeting + recording when the org enables it. */
export function twimlForCall(opts: { recordingEnabled: boolean; recordingCallbackUrl: string }): string {
  if (!opts.recordingEnabled) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Hello, this is a call from your CRM. Thanks for taking the time.</Say></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">This call may be recorded.</Say><Record transcribe="true" transcribeCallback="${opts.recordingCallbackUrl}" maxLength="1800" /><Say>Goodbye.</Say></Response>`;
}

/**
 * Verify a Twilio callback signature: base64(HMAC-SHA1(authToken, fullUrl))
 * where fullUrl is the absolute request URL exactly as Twilio saw it.
 * When Twilio is not configured (dev/mock) this is skipped — the caller
 * falls back to the capability proof (callId resolves to a real row).
 */
export function verifyTwilioSignature(url: string, signature: string | undefined): boolean {
  if (!twilioConfigured() || !env.twilioAuthToken) return true; // dev mode — caller still proves :callId
  if (!signature) return false;
  const expected = crypto.createHmac("sha1", env.twilioAuthToken).update(url).digest("base64");
  try {
    const a = Buffer.from(expected, "base64");
    const b = Buffer.from(signature, "base64");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Map Twilio CallStatus → our Call.status vocabulary. */
export function mapTwilioStatus(callStatus: string): "completed" | "no-answer" {
  if (callStatus === "completed") return "completed";
  // busy / no-answer / canceled / failed / unanswered
  return "no-answer";
}

/** Parse a Twilio status-callback payload into our update shape. */
export function parseStatusCallback(body: any): { status: "completed" | "no-answer"; durationSec: number | null; recordingUrl: string | null; callSid: string } {
  const status = mapTwilioStatus(String(body.CallStatus ?? ""));
  const duration = Number(body.CallDuration);
  return {
    status,
    durationSec: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    recordingUrl: body.RecordingUrl ? String(body.RecordingUrl) : null,
    callSid: String(body.CallSid ?? ""),
  };
}

/**
 * Fetch the recording media URL + best-effort transcript for a call SID via
 * the Twilio REST API. Called from the recording webhook when the recording
 * callback itself did not carry the URL (it normally does).
 */
export async function fetchCallRecording(callSid: string): Promise<{ recordingUrl: string | null; transcript: string | null }> {
  if (!twilioConfigured()) return { recordingUrl: null, transcript: null };
  try {
    const res = await fetch(`${API_BASE}/Accounts/${env.twilioAccountSid}/Calls/${callSid}/Recordings.json`, {
      headers: { authorization: authHeader() },
    });
    const text = await res.text();
    if (!res.ok) return { recordingUrl: null, transcript: null };
    const data = JSON.parse(text);
    const rec = Array.isArray(data.recordings) && data.recordings.length ? data.recordings[0] : null;
    if (!rec) return { recordingUrl: null, transcript: null };
    // A media URL is more useful than the list URL for playback in the UI.
    const recordingUrl = rec.media_url ? String(rec.media_url) : rec.uri ? `https://api.twilio.com${rec.uri.replace(/\\.json$/, "")}.wav` : null;
    // Best-effort transcript (Twilio Transcriptions under the recording).
    let transcript: string | null = null;
    try {
      const t = await fetch(`${API_BASE}/Accounts/${env.twilioAccountSid}/Recordings/${rec.sid}/Transcriptions.json`, { headers: { authorization: authHeader() } });
      const tt = await t.text();
      const td = JSON.parse(tt);
      const tr = Array.isArray(td.transcriptions) && td.transcriptions.length ? td.transcriptions[0] : null;
      if (tr?.transcription_text) transcript = String(tr.transcription_text);
    } catch {
      /* transcription is best-effort — recording URL is the durable artifact */
    }
    return { recordingUrl, transcript };
  } catch {
    return { recordingUrl: null, transcript: null };
  }
}
