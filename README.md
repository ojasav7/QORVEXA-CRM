<div align="center">

```
 ██████╗  ██████╗ ██████╗ ██╗   ██╗███████╗██╗  ██╗ █████╗
██╔═══██╗██╔═══██╗██╔══██╗██║   ██║██╔════╝╚██╗██╔╝██╔══██╗
██║   ██║██║   ██║██████╔╝██║   ██║█████╗   ╚███╔╝ ███████║
██║▄▄ ██║██║   ██║██╔══██╗╚██╗ ██╔╝██╔══╝   ██╔██╗ ██╔══██║
╚██████╔╝╚██████╔╝██║  ██║ ╚████╔╝ ███████╗██╔╝ ██╗██║  ██║
 ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
```

# QORVEXA CRM

**The intelligent operating system for business** — Phases 0–1 **complete** (platform backbone + full core CRM) and running.

</div>

---

## What this is

A production-shaped CRM implementing the architecture principles from `QORVEXAThe intelligent operating system for business.md`:

- **Object + Relationship + Event model** — one generic CRUD engine powers every object type (contact, account, lead, deal, task, note). Add a type in `server/lib/registry.ts`, get full CRUD + events + audit + search for free.
- **Event bus from Day 1** — every state change emits a persisted event (`deal.stage_changed`, `lead.routed`, `contact.created`, …) visible in the UI, auditable, and deliverable to webhooks.
- **Field/record-level permissions from Day 1** — roles (`admin`/`manager`/`rep`) + per-record `visibility` + per-field read/write restrictions, enforced in the service layer (not just the UI).
- **Lead routing** — admin-configured round-robin pool with manual override anytime (explicit `ownerId` always wins; `lead.routed` events with `mode`).
- **Dynamic segments** — criteria builder with live member counts, computed on read.
- **Public lead-capture forms** — embeddable, no-auth forms with honeypot + rate limiting; submissions create routed leads (`source: "Website"`).
- **Account hierarchy + duplicate merge UI** — cycle-guarded parent/child tree page; pick two records and merge per-field.
- **No-code object builder (v1)** — admins define custom fields per object type via the UI; values are stored per-record and rendered dynamically.
- **Multi-tenant from Day 1** — every document carries `orgId`; isolation is enforced on every query.
- **Audit trail** — every mutation is logged with a field-level diff (`before`/`after`/`changed`), the foundation for the Phase-15 Time Machine.

## Stack

| Layer | Tech |
|---|---|
| API | Express 5 (REST) + signed-cookie sessions |
| Database | MongoDB 7 via Prisma 6 (single-node replica set in Docker) |
| Frontend | React 19 + Vite 8 + Tailwind CSS v4 + React Router 7 |
| Validation | Zod 4 |
| Runtime | Node 20+ (tsx) |

## Quick start

```bash
# 1. Start MongoDB (Docker, single-node replica set — Prisma requires it)
npm run mongo:up

# 2. Configure env
cp .env.example .env        # edit DATABASE_URL / SESSION_SECRET

# 3. Push schema + seed demo data
npm run db:generate
npm run db:push
npm run seed

# 4. Run (API on :8787, Vite dev server on :5173)
npm run dev
```

Open http://localhost:5173 → log in with the seeded demo account:

```
admin@qorvexa.dev / password123   (also: priya@ / leo@qorvexa.dev)
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server with proxy |
| `npm run build` | Typecheck + production client build into `dist/` |
| `npm start` | Run the API server, serving the built client |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` / `db:push` | Prisma client / schema sync |
| `npm run seed` | Demo data generator (idempotent) |
| `npm run mongo:up` / `mongo:down` | Docker Mongo up/down |

## Documentation

**Start here:** [PROGRESS.md](PROGRESS.md) — the 16-phase build report (what's done, what's left, estimates) · [docs/10-continuation-runbook.md](docs/10-continuation-runbook.md) — context pack + ready-made prompt to continue the build.

| Doc | Contents |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | Stack decision, layers, folder map, how the object model works |
| [docs/02-data-model.md](docs/02-data-model.md) | Entities, relationships, custom-field strategy |
| [docs/03-event-catalog.md](docs/03-event-catalog.md) | Event naming, Phase 0–1 catalog, webhook delivery |
| [docs/04-permissions.md](docs/04-permissions.md) | Roles, record visibility, AI risk tiers |
| [docs/05-api-reference.md](docs/05-api-reference.md) | Every endpoint, methods, payloads, events emitted |
| [docs/06-roadmap.md](docs/06-roadmap.md) | The full 16-phase blueprint mapped to build status |
| [docs/07-setup.md](docs/07-setup.md) | Environments, deployment (Render/Vercel), troubleshooting |
| [docs/08-decision-log.md](docs/08-decision-log.md) | ADRs — why each architecture choice was made |
| [docs/09-spec-phase0-hardening.md](docs/09-spec-phase0-hardening.md) | The spec that drove Phase 0 hardening — **implemented** (see docs/11) |
| [docs/10-continuation-runbook.md](docs/10-continuation-runbook.md) | Hand-off pack + "continue here" prompt for a fresh session |
| [docs/11-phase0-build-report.md](docs/11-phase0-build-report.md) | Phase 0 hardening + completion — what shipped, deviations, verification evidence |
| [docs/12-phase1-build-report.md](docs/12-phase1-build-report.md) | Phase 1 completion — lead routing, hierarchy UI, segments, lead-capture forms, merge UI |

---

<div align="center"><i>Part 1 · Chapter 2 — CRM · built on the universal 7-step loop</i></div>
