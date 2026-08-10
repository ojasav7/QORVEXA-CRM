# 07 · Setup, Deployment & Troubleshooting

## Local development

```bash
npm install
npm run mongo:up          # Docker Mongo (single-node replica set — required)
cp .env.example .env      # set DATABASE_URL + SESSION_SECRET
npm run db:generate
npm run db:push           # sync schema to Mongo
npm run backfill:env      # ONLY if upgrading a DB that already has data (stamps environment="production")
npm run seed              # optional demo data
npm run dev               # API :8787 + Vite :5173 (proxies /api)
```

`.env` values: see `.env.example`.

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `mongodb://localhost:27017/qorvexa` | MongoDB (replica set required) |
| `SESSION_SECRET` | dev-only default | HMAC key for session cookies — **must** be set in production |
| `ALLOWED_REGISTRATION_DOMAINS` | empty | Comma-separated domains that may self-register (blank = open) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | empty | Enable Google SSO button (OAuth 2.0 app, redirect URI `<origin>/api/auth/oauth/google/callback`) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | empty | Enable GitHub SSO button |
| `OAUTH_REDIRECT_ORIGIN` | `http://localhost:8787` | Origin used for OAuth redirect URIs + post-login redirects |
| `OAUTH_MOCK` | off | `1` completes the SSO flow instantly as `admin@qorvexa.dev` (non-production only) — demo/dev only |
| `SNAPSHOT_INTERVAL_HOURS` | `24` | Scheduled snapshot interval (ADR-009) |
| `SNAPSHOTS_ENABLED` | `true` | `false` disables the scheduled snapshot job |

**Scheduled backups:** the server snapshots each org's production env on the interval above (first run 60s after boot) and prunes archives older than `Organization.settings.backupRetentionDays` (default 30). Set the retention per org via `PATCH /api/org` → `settings.backupRetentionDays`.

**API tokens:** issue from Settings → API tokens (admin), authenticate with `Authorization: Bearer <token>`. Only the sha256 hash is stored; the raw token is shown once.

## MongoDB without Docker

Prisma **requires a replica set** on MongoDB. Atlas (M0+) is a replica set by default — use your Atlas connection string as `DATABASE_URL` and you're done. For local installs, start `mongod` with `--replSet rs0` and run `rs.initiate()` once.

## Production build & deploy

```bash
npm run build             # typecheck + client → dist/
npm start                 # Express serves /api + dist/ on PORT
```

### Render (recommended for Express)

1. Push to GitHub → new **Web Service**.
2. Build: `npm install && npm run db:generate && npm run build`
3. Start: `npm start`
4. Env vars: `DATABASE_URL`, `SESSION_SECRET`, `PORT=8787`.

### Vercel

Vercel hosts static frontends; the Express server needs a serverless adapter. For this repo, Render is the simpler path — Vercel becomes viable once we add a serverless wrapper (later phase).

## Verification checklist (post-deploy)

1. `GET /api/health` → `{ "db": "connected" }`.
2. Register a workspace → redirected to the dashboard.
3. Create a contact, then create the same email again → 400 duplicate error.
4. Drag a deal to a new stage → `deal.stage_changed` appears in the Events feed.
5. Settings → Custom fields → add a `select` field → it appears in the contact form.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `P2031` "Prisma needs to perform transactions…" | Mongo is not a replica set. `npm run mongo:down && npm run mongo:up`, or use Atlas. |
| Production queries return 0 rows after adding `environment` | Existing docs were never stamped (db push doesn't backfill). Run `npm run backfill:env`. |
| Backups / restore | Snapshots write to `backups/` (gitignored) — ensure the process can write there. Restore always creates a fresh `sandbox-restored-*` env, never touches production. Retention: `settings.backupRetentionDays`. |
| SSO buttons don't show | Provider credentials unset — set `GOOGLE_CLIENT_ID/SECRET` or `GITHUB_CLIENT_ID/SECRET`, or `OAUTH_MOCK=1` for a no-setup demo. |
| API token returns 401 | Token revoked/expired, or it's `read`-scoped and you're calling a non-GET endpoint. Issue a new one in Settings → API tokens. |
| `P1012` "Environment variable not found: DATABASE_URL" | No `.env` file. `cp .env.example .env`. |
| Vite dev can't reach the API | API must be on `:8787` (the Vite proxy targets it). Check the `dev:server` log. |
| `prisma db push` validates but seed fails | Schema/client mismatch — rerun `npm run db:generate`. |
| Login says "Invalid email or password" | Forgot to seed, or the user is disabled. `npm run seed`, check `User.active`. |
| Port 8787 already in use | `netstat -ano | grep 8787` → kill the PID, or change `PORT` in `.env`. |
| Stale server served old code | Dev server hot-reloads; the production server needs `npm run build` before `npm start`. |

## Data notes

- The seed script is **idempotent** — re-running it skips existing records (keyed by email/name/slug).
- `npm run seed` logs the demo credentials on completion.
- Events and audit logs grow with usage; retention policies arrive in Phase 14 (GDPR) — until then the full history powers the future Time Machine.
