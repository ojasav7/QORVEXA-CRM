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

**The intelligent operating system for business** — Phases 0–14 **complete**: platform backbone + full core CRM + **Communication Core** (email, calling, calendar, booking) + **Automation & Workflow Engine** + **Customer Service** (tickets, SLAs, portal, knowledge base) + **Marketing Automation** (campaigns, journeys, landing pages, deliverability) + **Analytics, Forecasting & BI** (dashboards, metrics, forecasts, reports) + **CDP / Customer 360** (identity resolution, unified profiles, behavior tracking, health engine, portability) + **AI Assistant Layer** (model router, data firewall, summaries, drafts, AI scoring, semantic search) + **AI Agent Platform** (governed agents, approvals, kill switches) + **Revenue Cloud** (CPQ, contracts, billing) + **Customer Success** (plans, usage, churn, surveys, loyalty) + **Field Operations** (territories, visits, work orders, inventory) + **Ecosystem** (marketplace, partners, change sets, schema safety) + **Enterprise Security** (MFA, sessions, IP restriction, consent/DSRs, retention, status page, SCIM, i18n).

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
- **Multi-pipeline engine (Phase 2-lite)** — per-org pipelines with editable stages (label + probability); the deals board switches pipelines, probability is derived from each pipeline's stage definition, and a default pipeline is lazily seeded for every org.
- **Email + templates (Phase 2)** — reusable templates with `{{variable}}` merge fields, compose-from-template, mock inbox sync + simulated replies, and **open/click tracking** (public token-scoped pixel/redirect) with per-message status (`sent → opened → clicked → replied`).
- **Calling (Phase 2)** — click-to-call + full call log with optional mock recording/transcription.
- **Calendar + booking (Phase 2)** — meetings with date-range calendar view, plus **public booking pages** (`/b/<slug>`) with round-robin host assignment, honeypot + rate limiting, and server-side slot validation.
- **Auto-logged record timeline (Phase 2)** — every email, call, meeting, and note against a record appears on its detail drawer automatically.
- **Workflows & automation (Phase 3)** — visual **trigger → condition → action** builder over the event bus (`deal.stage_changed → won → notify + create task`), the reserved **`task.completed`** event, in-app **notifications** (header bell), a per-run **action log** with a synchronous **test endpoint**, and duplicate-workflow detection — see `docs/15-spec-phase3.md`.
- **Tickets & helpdesk (Phase 4)** — tickets as a first-class object with per-org `TKT-####` references, queue tabs, reply threads (incl. internal notes), assignment, escalation, and **convert-to-lead** — see `docs/17-spec-phase4.md`.
- **SLAs (Phase 4)** — priority-based response deadlines (`SlaPolicy`, lazily seeded), live `slaStatus` badges (`ok / warning / breached`), and an admin **breach sweep** that flags + auto-escalates high/urgent overdue tickets.
- **Public support portal (Phase 4)** — admin-configured portal pages at `/p/<slug>`: no-auth ticket submission (honeypot + rate limit) and a **no-leak status lookup** (email + reference must match) that shows public replies.
- **Knowledge base (Phase 4)** — admin-authored articles with categories, tags, search, and slugs; published articles appear in the portal with view tracking.
- **Legal hold (Phase 4)** — admin-only compliance lock that freezes a ticket against edits, replies, and deletion.
- **Campaigns (Phase 5)** — send-to-segment email campaigns with **A/B subjects**, live open/click/ROI stats, and a winner declaration — see `docs/19-spec-phase5.md`.
- **Landing pages (Phase 5)** — admin pages with globally-unique slugs and a public capture form at `/l/<slug>` (honeypot + rate limit + no-leak duplicates) that creates routed leads tagged with the source campaign.
- **Journeys (Phase 5)** — the **journey orchestration engine**: event/segment triggers → `wait` / `send_email` / `notify` / `create_task` / `update_record` / `condition` / `end` steps, with a 60s ticker advancing due waits, a per-step run log, and a synchronous test endpoint.
- **Deliverability monitoring (Phase 5)** — live email health (bounce/open/click rates, 0–100 health score) with simulated provider events.
- **Analytics & metrics (Phase 6)** — a metrics library computed **on read** (never stale) across sales / marketing / service / revenue / executive dashboards, with **data lineage** on every number — see `docs/21-spec-phase6.md`.
- **Sales forecasting (Phase 6)** — the **weighted pipeline** (pipeline / weighted / commit / best-case buckets, per-stage + per-owner) with admin **snapshot history** (`forecast.updated`).
- **Predictive v1 (Phase 6)** — transparent conversion-likelihood, churn-risk, and LTV scores with documented inputs.
- **Report builder (Phase 6)** — saved dashboard configs (`kind` + metric keys) that render **live** metrics — reports can never go stale.
- **Metric thresholds + alerts (Phase 6)** — org-configurable thresholds that trip admin notifications + `metric.threshold_breached` events.
- **Identity resolution + Customer 360 (Phase 7)** — one unified profile per person (email is the canonical key), built continuously by an event-bus subscriber — a contact + a lead with the same email become one identity with merge lineage (`customer.identity_merged`) — see `docs/23-spec-phase7.md`.
- **Behavioral tracking (Phase 7)** — a `BehaviorEvent` log of what the customer did (email opens/clicks/replies, form submits, tickets, calls, meetings) fed by a public API and an automatic **event-bus mirror**, all resolved to the unified profile.
- **AI model router (Phase 8)** — a `ModelRoute` catalog + org-configurable routing policy (`cost / quality / latency`, EU **data-residency pin**); every generation returns an explainable `{ picked, reason, candidates }` decision — see `docs/26-spec-phase8.md`.
- **Data firewall (Phase 8)** — every prompt is server-built and redacted **before the model sees it** (emails, phones, cards, long numbers → `[REDACTED]`) with a redaction log shown in the UI and a receipt endpoint.
- **AI summaries + drafts (Phase 8)** — record summaries (deal/contact/account/ticket), **call summaries from transcripts**, **Customer-360 profile summaries**, and tone-controlled **email drafts**.
- **Explained AI scoring (Phase 8)** — lead (5 components) and deal (4 components) scores, each with value + weight + why; plus sentiment + buying-intent detection.
- **Semantic search (Phase 8)** — natural-language queries like *"won deals over 50k"* parse into predicates (`amount ≥ 50000`) and rank hits with evidence + confidence.
- **Confidence flagging (Phase 8)** — every AI output carries a 0–100 confidence; below-threshold results trip an admin alert ("Low AI confidence ⚠️") via the header bell.
- **Short-term AI memory (Phase 8)** — the assistant's scratchpad (org/user scoped, TTL), private per user.
- **Relationship graph v1 (Phase 7)** — the **buying committee** derived on read with **influence scores** from real touchpoints (email reply 4, call 3, meeting 5, primary +10) — see `docs/25-cdp-guide.md`.
- **Customer health engine (Phase 7)** — an **explained** composite score (engagement 40 + support 25 + revenue 25 + recency 10) with churn risk; every component shows its formula + raw inputs.
- **Right-to-portability (Phase 7)** — one admin click downloads a **JSON bundle of every org × environment collection** (objects, comms, tickets, marketing, analytics, CDP, events, audit) with password hashes stripped.
- **No-code object builder (v1)** — admins define custom fields per object type via the UI; values are stored per-record and rendered dynamically.
- **Multi-tenant from Day 1** — every document carries `orgId`; isolation is enforced on every query.
- **MFA (Phase 14)** — TOTP two-step login with one-time recovery codes, DB-backed sessions with device management + instant revocation, and an org security policy (IP/CIDR allowlist enforced on every request, MFA requirement, session TTL, encryption posture) — see `docs/44-spec-phase14.md`.
- **Consent & privacy center (Phase 14)** — purpose-based consent records (`consent.updated`) and data-subject requests (access/export/delete/rectify) with admin fulfillment, retention/deletion policies (`retention.policy_applied`), and sub-processor/vendor transparency.
- **Status page + SCIM + i18n (Phase 14)** — the uptime SLA dashboard with incidents, SCIM 2.0 provisioning (scim-scoped tokens, groups → roles), and locale/currency/timezone config with a localization-QA catalog.
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
| `npm run backfill:pipeline` | Stamp legacy deals onto their org's default pipeline (run once after `db:push` on existing DBs) |
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
| [docs/13-phase2-lite-build-report.md](docs/13-phase2-lite-build-report.md) | Phase 2-lite — multi-pipeline engine (CRUD, per-org config, pipeline-aware deals board) |
z` | [docs/14-communication-guide.md](docs/14-communication-guide.md) | Phase 2 how-it-works — email/templates/tracking, calls, meetings, booking, timeline, mock providers |
| [docs/14-calling-compliance.md](docs/14-calling-compliance.md) | Calling/recording compliance notes — consent, retention, access control, GDPR/CCPA obligations |
| [docs/14-pipeline-builder-guide.md](docs/14-pipeline-builder-guide.md) | Pipeline builder guide — create pipelines/stages/probabilities, set default, guards |
| [docs/14-phase2-build-report.md](docs/14-phase2-build-report.md) | Phase 2 completion — Communication Core shipped end-to-end, verification evidence |
| [docs/15-spec-phase3.md](docs/15-spec-phase3.md) | The spec that drove Phase 3 — the workflow engine (trigger → condition → action), `task.completed`, notifications, duplicate guard |
| [docs/16-phase3-build-report.md](docs/16-phase3-build-report.md) | Phase 3 completion — workflow engine + notifications shipped end-to-end, verification evidence |
| [docs/17-spec-phase4.md](docs/17-spec-phase4.md) | The spec that drove Phase 4 — tickets as a first-class object, SLAs, omnichannel intake, knowledge base, public portal, legal hold |
| [docs/18-phase4-build-report.md](docs/18-phase4-build-report.md) | Phase 4 completion — Customer Service shipped end-to-end, verification evidence |
| [docs/19-spec-phase5.md](docs/19-spec-phase5.md) | The spec that drove Phase 5 — campaigns (A/B + attribution), landing pages, the journey engine, deliverability |
| [docs/20-phase5-build-report.md](docs/20-phase5-build-report.md) | Phase 5 completion — Marketing Automation shipped end-to-end, verification evidence |
| [docs/21-spec-phase6.md](docs/21-spec-phase6.md) | The spec that drove Phase 6 — the metrics library with data lineage, weighted forecasting + snapshots, predictive v1, report builder, thresholds |
| [docs/22-phase6-build-report.md](docs/22-phase6-build-report.md) | Phase 6 completion — Analytics, Forecasting & BI shipped end-to-end, verification evidence |
| [docs/23-spec-phase7.md](docs/23-spec-phase7.md) | The spec that drove Phase 7 — deterministic identity resolution + unified profiles, behavioral tracking, the 360 view, relationship graph v1, the explained health engine, right-to-portability |
| [docs/24-phase7-build-report.md](docs/24-phase7-build-report.md) | Phase 7 completion — CDP / Customer 360 shipped end-to-end, verification evidence |
| [docs/25-cdp-guide.md](docs/25-cdp-guide.md) | CDP how-it-works — identity rules, the behavior catalog + mirror, graph schema + influence scoring, the health formula |
| [docs/26-spec-phase8.md](docs/26-spec-phase8.md) | The spec that drove Phase 8 — the non-agentic AI copilot: model router, data firewall, generators, confidence, memory |
| [docs/27-phase8-build-report.md](docs/27-phase8-build-report.md) | Phase 8 completion — AI Assistant Layer shipped end-to-end, verification evidence |
| [docs/28-ai-guide.md](docs/28-ai-guide.md) | AI how-it-works — routing policy + residency pin, firewall + receipts, generator catalog, search syntax, memory |

---

<div align="center"><i>Part 1 · Chapter 2 — CRM · built on the universal 7-step loop</i></div>
