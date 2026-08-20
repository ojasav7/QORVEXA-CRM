// Centralised environment access. All config lives here so nothing else
// reads process.env directly. See .env.example for documentation.
import "dotenv/config";

const DEFAULT_SECRET = "dev-only-insecure-secret-change-me";
const secret = process.env.SESSION_SECRET ?? DEFAULT_SECRET;

// A forgeable session secret is a critical vulnerability — refuse to boot in
// production with the known default rather than risk it.
if (process.env.NODE_ENV === "production" && (secret === DEFAULT_SECRET || secret === "change-me-to-a-long-random-string")) {
  console.error("✗ SESSION_SECRET must be set to a long random string in production.");
  process.exit(1);
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "mongodb://localhost:27017/qorvexa",
  sessionSecret: secret,
  port: Number(process.env.PORT ?? 8787),
  allowedRegistrationDomains: (process.env.ALLOWED_REGISTRATION_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  // OAuth SSO providers (empty = provider disabled / button hidden)
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  // Dev-only: complete the OAuth flow without a real provider (OAUTH_MOCK=1)
  oauthMock: process.env.OAUTH_MOCK === "1" || process.env.OAUTH_MOCK === "true",
  // Phase 2 communication: public base URL for tracking pixels/click links and
  // mock media URLs (falls back to the local origin). EMAIL_MOCK=1 simulates an
  // SMTP provider (no real sends) — same pattern as OAUTH_MOCK for SSO.
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  emailMock: process.env.EMAIL_MOCK !== "false",
  // ── Phase 16 · real provider integrations (ADR-028) ─────────────────────
  // Provider choice is environment config, never org state. `mock` is always
  // the default; a missing key means mock (graceful fallback, never a crash).
  // EMAIL_MOCK=false keeps its historical meaning (→ resend) as a fallback.
  emailProvider: (["mock", "resend", "sendgrid"] as const).includes(process.env.EMAIL_PROVIDER as any)
    ? (process.env.EMAIL_PROVIDER as "mock" | "resend" | "sendgrid")
    : process.env.EMAIL_MOCK === "false"
      ? "resend"
      : "mock",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "",
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL ?? "",
  // When set, provider event webhooks must carry a valid signature (SendGrid
  // X-Twilio-Email-Event-Webhook-Signature / Resend svix-*). When unset (dev),
  // the payload must still resolve to a real Message row by its tracking token.
  emailWebhookSecret: process.env.EMAIL_WEBHOOK_SECRET ?? "",
  aiProvider: process.env.AI_PROVIDER === "openai" || process.env.OPENAI_API_KEY ? "openai" : "mock",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, ""),
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? "",
  // Scheduled snapshots (ADR-009): interval + kill switch
  snapshotIntervalHours: Math.max(1, Number(process.env.SNAPSHOT_INTERVAL_HOURS ?? 24)),
  snapshotsEnabled: process.env.SNAPSHOTS_ENABLED !== "false",
};

export const isDev = process.env.NODE_ENV !== "production";
