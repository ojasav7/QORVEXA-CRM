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
  // Scheduled snapshots (ADR-009): interval + kill switch
  snapshotIntervalHours: Math.max(1, Number(process.env.SNAPSHOT_INTERVAL_HOURS ?? 24)),
  snapshotsEnabled: process.env.SNAPSHOTS_ENABLED !== "false",
};

export const isDev = process.env.NODE_ENV !== "production";
