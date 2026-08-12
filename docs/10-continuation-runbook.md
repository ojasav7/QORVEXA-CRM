# 10 · Continuation Runbook

> A context pack for whoever (or whatever — a fresh Claude) picks this project up next.
> If you have no memory of this conversation, **start here**.

## 1. What this project is

QORVEXA CRM — a multi-tenant, API-first CRM built on the blueprint `QORVEXAThe intelligent operating system for business.md` (16 phases). Phases 0–3 are complete and live-verified: platform backbone, core CRM, Communication Core, and the Automation & Workflow Engine (trigger → condition → action over the event bus, `task.completed`, notifications, run log, duplicate guard). The architecture centers on a **generic object service**: one CRUD engine powers every object type, with events, audit, permissions, and custom fields handled centrally — and an **event-bus subscriber engine** (`server/lib/automations.ts`) that consumes the same event stream for workflows.

## 2. Where to get oriented (read in this order)

1. `README.md` — what it is, quick start, scripts
2. `PROGRESS.md` — 16-phase status: what's done, what's left, effort estimates
3. `docs/01-architecture.md` — how it's built (object model, event bus, layers)
4. `docs/05-api-reference.md` — the API surface
5. `docs/08-decision-log.md` — the "why" behind every choice (read before proposing changes)
6. `docs/09-spec-phase0-hardening.md` — the agreed spec for the next milestone
7. `docs/07-setup.md` — env, deploy, troubleshooting

## 3. Current state snapshot

- **Stack:** Express 5 REST API + Prisma 6 + MongoDB 7 (single-node replica set in Docker) + React 19/Vite 8/Tailwind v4 SPA served by Express.
- **Auth:** HMAC-signed httpOnly cookies; roles `admin`/`manager`/`rep`; record visibility `org`/`owner`.
- **Objects live:** contact, account, lead, opportunity, task, note — all through the generic service (`server/lib/object-service.ts`, defs in `server/lib/registry.ts`).
- **Events & audit:** every mutation persists an `Event` and writes an `AuditLog` with field diffs; webhooks are HMAC-signed with retries.
- **Custom fields:** `FieldDef` registry + Settings UI; values in per-record `custom` JSON.
- **Verified working (smoke + browser):** auth, CRUD, duplicate detection, deal stage changes → `deal.stage_changed` events, search (admin + rep), notes CRUD, custom fields, event feed, dashboard. Zero console errors.
- **Demo data:** seeded via `npm run seed`; login `admin@qorvexa.dev / password123` (also `priya@`, `leo@qorvexa.dev`).
- **Known gaps:** no sandbox envs, no feature flags, no CSV export/merge UI, no backups, no OAuth (all Phase 0 leftovers — see the spec).

## 4. The ready-made "continue here" prompt

> Copy this whole block into a fresh Claude conversation. It is self-contained.

```
You are continuing work on QORVEXA CRM, a full-stack CRM at
part1-core-fullstack-apps/02-crm in this workspace.

CONTEXT (read these files first):
- README.md and PROGRESS.md for orientation and status
- docs/01-architecture.md for how the object model / event bus / layers work
- docs/08-decision-log.md for the "why" behind each choice — do not re-litigate
- docs/09-spec-phase0-hardening.md for the agreed next milestone spec
- docs/07-setup.md for env/commands/troubleshooting

TASK (do these in order):
1. Implement Phase 0 hardening per docs/09-spec-phase0-hardening.md:
   a. `environment` column on all models + `X-Environment` scoping through
      server/lib/access.ts (listConditions / assertCanAccess) + a backfill
      script for existing docs + a cross-env leak smoke test.
   b. Feature flags: FeatureFlag model + requireFeature middleware +
      GET/PUT /api/features + Settings UI toggle.
   c. CSV import merge: extend POST /api/import with dryRun + per-row merge
      resolution (new / merge into existing with field-scoped diffs) + an
      Import page with preview.
   d. Backups: snapshot script (mongodump archive) + BackupJob model +
      POST /api/backup/create + POST /api/backup/restore (restore ALWAYS
      into a fresh sandbox env, never production) + Settings UI.
   e. Environments UI: env switcher (X-Environment header, persisted in
      localStorage), create/reset sandbox, promote-copy.
2. Then finish Phase 1 leftovers per PROGRESS.md: duplicate merge UI,
   lead routing (round-robin), account hierarchy UI, segments as an entity,
   public lead-capture forms.
3. Update docs/03-event-catalog.md and docs/05-api-reference.md with new
   events/endpoints, and PROGRESS.md statuses as you ship.

SETUP BEFORE CODING (the DB must be running and seeded):
- npm install · npm run mongo:up · cp .env.example .env
- npm run db:generate · npm run db:push · npm run seed
- Confirm: curl http://localhost:8787/api/health returns db connected
  (start the server with npm run dev:server in a second terminal).

RULES:
- Follow existing conventions exactly (generic object service, event/audit
  on every mutation, zod validation, central permission scoping).
- MongoDB + Prisma constraints: no relations (manual *Id joins), no enums,
  replica set required, no @updatedAt, db push does NOT backfill — run the
  backfill script.
- New features must emit events and write audit rows; sandbox events must
  NOT dispatch prod webhooks.
- Verify with: npm run typecheck, npm run build, then boot the server
  (npm run dev:server) and curl the new endpoints with the demo login.
- Do not change architecture decisions recorded in docs/08-decision-log.md
  without flagging it as an ADR amendment.
```

## 5. Commands cheat-sheet

| Task | Command |
|---|---|
| Start Mongo (replica set — required) | `npm run mongo:up` |
| Stop Mongo | `npm run mongo:down` |
| Install / env | `npm install` · `cp .env.example .env` |
| Sync schema | `npm run db:generate` · `npm run db:push` |
| Demo data | `npm run seed` |
| Dev (API :8787 + Vite :5173) | `npm run dev` |
| API only | `npm run dev:server` |
| Typecheck / build | `npm run typecheck` · `npm run build` |
| Production serve | `npm start` |
| Reset DB to clean demo | `docker exec qorvexa-mongo mongosh qorvexa --eval 'db.dropDatabase()'` → `npm run db:push` → `npm run seed` |
| API smoke | `curl -c /tmp/c.txt -X POST localhost:8787/api/auth/login -H 'content-type: application/json' -d '{"email":"admin@qorvexa.dev","password":"password123"}'` then `curl -b /tmp/c.txt localhost:8787/api/contacts` |

**Windows gotchas:** npm scripts that use `&&` fail under PowerShell — use the provided `scripts/build.mjs` for builds. If Prisma errors `EPERM … query_engine-windows.dll.node`, a running server holds the file — kill it (`netstat -ano | grep 8787`, `taskkill //F //PID <pid>`) before `prisma db push`/`generate`.

## 6. Hand-off notes

- The spec (`docs/09-spec-phase0-hardening.md`) contains ADR-008/009 — the sandbox (environment field) and backup (snapshot + restore-to-sandbox) decisions were explicitly chosen by the user.
- Do the four spec items in the order given in section 8 of the spec; each is independently shippable.
- The user's session cadence: they say "go" and expect Phase 0 hardening then Phase 1 finishing items implemented with the same docs + verification discipline as the original build.
