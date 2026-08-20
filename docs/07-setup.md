# 07 · Setup, Deployment & Troubleshooting

## One URL, one stack (landing page + CRM app)

The public **landing page** (`qorvexacrm/`, a static Vite app) and the **CRM app**
(the React SPA) are served by the same Express server and ship in one Docker
image — no separate hosting, no CORS:

- `https://your-domain/` → marketing landing page
- `https://your-domain/app` → CRM app (SPA at the `/app` base)
- `https://your-domain/api/*` → REST API
- `https://your-domain/app/forms/<slug>` → public lead-capture forms
  (`/app/b/<slug>` booking, `/app/p/<slug>` portal, `/app/l/<slug>` landing)
  — old root-level URLs (`/forms/x`, …) redirect here

The landing page's **Request a demo** form POSTs to the CRM's public lead
endpoint (`/api/public/forms/request-a-demo/submit`) — every submission becomes a
real lead (source "Website", round-robin routed). The form + its custom fields
are seeded by `npm run seed`; delete the form in Settings → Lead capture to take
it offline. See `qorvexacrm/README.md` for landing-page details.

## Local development

```bash
npm install
npm run mongo:up          # Docker Mongo (single-node replica set — required)
cp .env.example .env      # set DATABASE_URL + SESSION_SECRET
npm run db:generate
npm run db:push           # sync schema to Mongo
npm run backfill:env      # ONLY if upgrading a DB that already has data (stamps environment="production")
npm run seed              # optional demo data (creates the request-a-demo form too)
npm run dev               # API :8787 + Vite :5173 (proxies /api)
```

In dev the CRM SPA runs on Vite at `http://localhost:5173/app` (the `/app` base
redirects to it; `/api` is proxied to :8787). For the landing page locally:
`cd qorvexacrm && npm install && npm run dev` (port 5174 — set
`VITE_CRM_API=http://localhost:8787/api` when running it standalone).

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
| `PUBLIC_BASE_URL` | `http://localhost:8787` | Public origin — OAuth redirects, tracking pixels, email click links. Set to the real deployed origin in production. |
| `EMAIL_MOCK` | `true` | `false` + a provider adapter to send real email; when true messages are simulated |

**Scheduled backups:** the server snapshots each org's production env on the interval above (first run 60s after boot) and prunes archives older than `Organization.settings.backupRetentionDays` (default 30). Set the retention per org via `PATCH /api/org` → `settings.backupRetentionDays`.

**API tokens:** issue from Settings → API tokens (admin), authenticate with `Authorization: Bearer <token>`. Only the sha256 hash is stored; the raw token is shown once.

## MongoDB without Docker

Prisma **requires a replica set** on MongoDB. Atlas (M0+) is a replica set by default — use your Atlas connection string as `DATABASE_URL` and you're done. For local installs, start `mongod` with `--replSet rs0` and run `rs.initiate()` once.

## Production build & deploy

```bash
npm run build             # typecheck + CRM app → dist/ + landing page → landing/
npm start                 # Express serves /api + dist/ (/app) + landing/ (/) on PORT
```

> `npm run build` builds BOTH apps: the CRM SPA into `dist/` (mounted at `/app`)
> and the landing page (`qorvexacrm/`) into `landing/` (served at the site
> root). `npm start` runs the TypeScript server via `tsx` — `tsx` is in
> `dependencies` so a bare `npm ci --omit=dev` install still boots.
> `NODE_ENV=production` is required for the session-secret guard to engage.

### Docker Compose (recommended)

The repo ships a full production stack: multi-stage `Dockerfile` + `docker-compose.prod.yml` with the app, MongoDB (single-node replica set — required by Prisma), and persistent volumes for the database, scheduled backups, and GDPR/portability exports.

```bash
# 1. Configure secrets (SESSION_SECRET is mandatory)
cp .env.example .env
openssl rand -hex 32          # put the output into SESSION_SECRET
# optionally: set PUBLIC_BASE_URL to your real origin, EMAIL_MOCK=false, SSO keys

# 2. Build & start
npm run mongo:down 2>/dev/null || true   # avoid a port clash with the dev Mongo
docker compose -f docker-compose.prod.yml up -d --build

# 3. Verify
curl http://localhost:8787/api/health      # → { "status": "ok", "db": "connected" }
docker compose -f docker-compose.prod.yml ps   # app should be (healthy)
```

First-run only: create the admin workspace in the browser (`/app/register` — note the `/app` base), then `npm run seed` is **not** required (the DB starts empty). To load demo data instead: `docker compose -f docker-compose.prod.yml exec app npm run seed`.

Verify the whole surface after boot:

```bash
curl -L http://localhost:8787/          # landing page (site root)
curl -L http://localhost:8787/app       # CRM app (redirects to /app/)
curl -X POST http://localhost:8787/api/public/forms/request-a-demo/submit \
  -H 'content-type: application/json' \
  -d '{"firstName":"Alex","lastName":"Mercer","email":"alex@example.com","company":"Example","teamSize":"51-200","notes":"Pipeline demo","company_website":""}'
# → { "ok": true, "duplicate": false, "leadId": "..." } — the lead shows up in the CRM
```

Operational notes:
- **Data persistence** — named volumes `qorvexa-prod-mongo`, `qorvexa-prod-backups`, `qorvexa-prod-portability` survive `down`/`up`. To wipe everything: `docker compose -f docker-compose.prod.yml down -v`.
- **The image is non-root** — the server runs as the `node` user; backups/portability dirs are writable and volume-mounted.
- **Healthcheck** — the app container is only `healthy` when Mongo answers a ping (`/api/health`).
- **Migrations** — `docker compose -f docker-compose.prod.yml exec app npx prisma db push` after a deploy that changed `prisma/schema.prisma`. The image runs `prisma generate` at build time.
- **Logs** — `docker compose -f docker-compose.prod.yml logs -f app`.
- **Updates** — pull, `docker compose -f docker-compose.prod.yml up -d --build`, run the migration step above if the schema changed.

### Render (recommended for a single Express service)

1. Push to GitHub → new **Web Service**.
2. Build: `npm install && npm run db:generate && npm run build`
3. Start: `npm start`
4. Env vars: `DATABASE_URL`, `SESSION_SECRET`, `PORT=8787`, `PUBLIC_BASE_URL=https://<your-app>.onrender.com`, `NODE_ENV=production`.
5. Use a hosted Mongo (Atlas M0+) — Prisma needs a replica set, which a single container can't provide. Render's free disk is ephemeral, so set `SNAPSHOTS_ENABLED=false` or attach a disk for `backups/`.

> The same build serves the landing page at `/` and the CRM app at `/app` on
> Render — no extra service needed.

### Vercel

Vercel hosts static frontends; the Express server needs a serverless adapter. For this repo, Render/Docker is the simpler path — Vercel becomes viable once we add a serverless wrapper (later phase).

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
