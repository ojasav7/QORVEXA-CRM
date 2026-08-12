# 06 · Roadmap — Blueprint → Build Status

Maps the 16-phase blueprint (`QORVEXAThe intelligent operating system for business.md`) to what exists in this repo. **Shipped** = working code; **Scaffolded** = schema/design ready, feature to build; **Planned** = future phase.

Legend: ✅ Shipped · 🧱 Scaffolded (foundation exists) · ⬜ Planned

## Phase 0 — Platform Foundations ✅ (core shipped)

| Blueprint item | Status | Where |
|---|---|---|
| Object/Relationship/Event architecture | ✅ | `lib/registry.ts`, `lib/object-service.ts`, Prisma schema |
| Event bus | ✅ | `lib/events.ts` + `Event` collection + UI feed |
| RBAC + record-level permissions | ✅ | `lib/access.ts`, roles admin/manager/rep |
| Multi-tenant org model | ✅ | `orgId` scoping everywhere |
| Custom fields (no-code, v1) | ✅ | `FieldDef` registry + Settings UI |
| API (REST) + Webhooks | ✅ | `docs/05-api-reference.md`, Settings UI |
| Audit trail (field-level diff) | ✅ | `lib/audit.ts` + `AuditLog` collection |
| OAuth / SSO | ✅ | API tokens + provider sign-in (`OAUTH_MOCK=1` dev mode); see ADR-005-A |
| Sandbox/staging, feature flags, data residency, backups, point-in-time restore | ✅ | ADR-008/009 + amendments; env switcher, reset, promote; scheduled snapshots + retention |

## Phase 1 — Core CRM ✅ **COMPLETE**

Contacts, accounts, leads, deals (6-stage pipeline board with drag-drop), activities (tasks + notes), tags, ownership, duplicate detection & merge (detection ✅, **merge UI ✅** — per-field master/merge), universal keyword search ✅ (semantic → Phase 8). **Phase 1 finishing:** lead routing (admin round-robin pool + manual override, ADR-010) ✅ · account hierarchy UI (cycle-guarded tree page) ✅ · dynamic segments (criteria builder + live counts) ✅ · public lead-capture forms (honeypot + rate limit + no-leak dedupe, ADR-012) ✅. See `docs/12-phase1-build-report.md`.

## Phase 2 — Communication Core ✅ **COMPLETE**

- **Email sync, templates, tracking — ✅**: `EmailTemplate` CRUD (admin/manager) with `{{variable}}` merge fields; `/api/emails` send (mock provider, `EMAIL_MOCK=1`) with template merge + per-message tracking token; mock inbox sync + simulated replies; public open-pixel/click-redirect endpoints (`/api/t/*`, token-scoped, ADR-014) that flip message status `sent → opened → clicked → replied` and emit `email.*` events.
- **Calendar / booking pages — ✅**: `/api/meetings` CRUD with date-range overlap queries + status lifecycle; admin `/api/booking-pages` (slug, duration/buffer, availability, round-robin host pool) and public `/b/:slug` booking flow (honeypot + rate limit + server-side slot re-validation); bookings create meetings owned by the assigned host.
- **Calling — ✅**: `/api/calls` log with direction/status/duration, optional mock recording + transcript (org setting `settings.calling.recording`), `call.completed` / `call.logged`.
- **Multi-pipeline engine — ✅ (Phase 2-lite)**: `Pipeline`/`PipelineStage` models (org × env), `/api/pipelines` CRUD with guards + events, per-org default pipeline lazily seeded from the registry, deals carry `pipelineId`, stage-validated with pipeline-derived probability, deals board pipeline switcher + per-pipeline columns, Settings → Pipelines editor, `deal.pipeline_changed` event. See `docs/13-phase2-lite-build-report.md`.
- **Auto-logging + record timeline — ✅**: `/api/timeline` aggregates notes + emails + calls + meetings per record; the record detail drawer renders it. Deal fields (win/lost reasons) shipped.
- **Feature-gated nav** — `comm.email` / `comm.calling` / `comm.calendar` flags (all on by default) gate the API + UI.

See `docs/14-phase2-build-report.md` + `docs/14-communication-guide.md`.

## Phase 3 — Automation & Workflow Engine ✅ **COMPLETE**

- **Visual workflow builder (trigger → condition → action) — ✅**: `Automation` rows (org × env, ADR-015) + one `onEvent("*")` engine subscriber (`lib/automations.ts`). Triggers: `deal.stage_changed` (optional `to` stage), `deal.created/updated`, `lead.created`, `contact.created`, `task.completed`. Conditions: segment-style field filters (+ `payload.*`). Actions: `create_task` (`{{field}}` merge), `notify` (in-app), `update_record` — through the generic object service as the workflow's creator. Workflows page with builder modal, run history, test endpoint. See `docs/15-spec-phase3.md` + `docs/16-phase3-build-report.md`.
- **`task.completed` — ✅**: emitted on `todo/in_progress → done` (reservation fulfilled).
- **Notifications — ✅**: `Notification` model + `/api/notifications` + header bell (unread badge, mark read/all).
- **Conflict resolution UI + duplicate-automation detection — ✅**: `AutomationRun` log (matched or not, per-action outcomes) + 409 duplicate guard with `allowDuplicate` override.
- Sequences (multi-step scheduled journeys), escalations — ⬜ (deferred, spec §1 non-goals).

## Phase 4 — Customer Service ✅ **COMPLETE**

- **Tickets as an object type — ✅** (ADR-016): `Ticket` via the documented object-model path (`docs/01-architecture.md` "Adding a new object type") — full CRUD, audit, events, search, custom fields, and the Phase 3 workflow engine (`ticket.created / status_changed / escalated` triggers) for free. A thin ticket router adds per-org `TKT-####` references, SLA deadlines, status transitions (`ticket.status_changed`), reply threads (public/internal), assignment (`ticket.assigned` + notification), escalation (`ticket.escalated` + notify), **legal hold** (locks edits/deletes for everyone but an admin lifting the hold), email intake (`ticket.captured`), and convert-to-lead (`ticket.converted`).
- **Queues + SLAs — ✅**: `/api/tickets/queues` counts; `SlaPolicy` rows (per-priority response hours, lazily seeded defaults) + read-time `slaStatus` (`on_track/due_soon/breached/n/a`) + admin **SLA sweep** (`POST /api/tickets/sla/check`) that persists `breachedAt`, emits `ticket.sla_breached`, and auto-escalates high/urgent breaches.
- **Knowledge base — ✅** (flag `service.knowledge`): articles, categories, search, published/draft, view counts; published articles appear in the public portal.
- **Self-service portal — ✅** (flag `service.tickets`): admin `PortalPage` CRUD (`/api/portals`) + public `/p/:slug` page — submit a ticket (honeypot + rate limit) and track by reference + email (no-leak), with published help articles shown.
- Channels `email / web / chat / whatsapp / sms / phone / social` are first-class ticket data + workflow-triggerable; real provider integrations are deferred exactly like telephony (ADR-014).

See `docs/17-spec-phase4.md` + `docs/18-phase4-build-report.md`.

## Phase 5 — Marketing Automation ✅ **COMPLETE**

- **Campaigns — ✅** (flag `marketing.campaigns`): admin CRUD + **send-to-segment** (Phase-1 dynamic segment audience snapshot, A/B subject split, per-recipient `Message` rows through the Phase-2 email path with tracking + `CampaignRecipient` links), idempotency guard, live stats (sent/opened/clicked + rates + per-variant), A/B winner declaration (`campaign.winner_declared`), and **attribution/ROI** (won deal amounts on recipient contacts; landing leads tagged with `campaignId`).
- **Landing pages — ✅** (flag `marketing.landing`): admin CRUD with **globally unique slugs** + public `/l/:slug` capture — honeypot + per-IP rate limit + no-leak duplicates, routed leads (`source: "Landing page"`, `campaignId` when linked), `form.submitted` + `intent.detected` (new leads only) — and the `form.submitted` workflow trigger.
- **Journeys — ✅** (flag `marketing.journeys`): the **journey orchestration engine** (ADR-017) — declarative `Journey` rows with event/segment triggers and steps (`wait` / `send_email` / `notify` / `create_task` / `update_record` / `condition` / `end`), an event-bus subscriber + 60s **ticker** that advances due `wait` enrollments (claim-guarded), per-step run log + `journey.enrolled/step_entered/completed` events, loop guard (one active enrollment per journey × entity), admin test endpoint + manual advance.
- **Deliverability monitoring — ✅** (flag `marketing.deliverability`): derived metrics (rates + 0–100 health + status grades) + simulated provider events (bounce/unsubscribe/complaint → `email.*` events).
- Segmentation — ✅ already shipped (Phase 1 dynamic segments are the campaign/journey audience).

See `docs/19-spec-phase5.md` + `docs/20-phase5-build-report.md`.

## Phase 6 — Analytics, Forecasting & BI ✅ **COMPLETE**

- **Metrics library + dashboards — ✅** (flag `analytics.metrics`): five dashboard kinds (sales / marketing / service / revenue / executive) computed **on read** with **data lineage** on every metric (`sources: [{ entity, query, note }]` — the number knows where it came from). Sales velocity, win rate, weighted pipeline, SLA health, campaign ROI all live here. See `docs/21-spec-phase6.md` + `docs/22-phase6-build-report.md`.
- **Sales forecasting — ✅**: the **weighted pipeline** (pipeline / weighted / commit / bestCase buckets, per-stage + per-owner rows) computed live; admin refresh persists a **`Forecast` snapshot** (history) + emits `forecast.updated`.
- **Predictive analytics v1 — ✅**: transparent arithmetic with documented inputs — conversion likelihood (0–100), churn risk (0–100), LTV estimates.
- **Report builder — ✅** (flag `analytics.reports`): saved dashboard configs (`kind` + metric `keys`); `GET /:id/data` renders LIVE metrics with lineage — reports can never go stale.
- **Thresholds + alerts — ✅**: org-configurable metric thresholds evaluated at refresh → admin notifications + `metric.threshold_breached` (🆕 data lineage + threshold alerting were the blueprint's Phase 6 additions).

## Phase 7 — CDP / Customer 360 ✅ **COMPLETE**

- **Identity resolution + unified profiles — ✅** (flag `cdp.profiles`, ADR-019): one `IdentityProfile` per person per org × env; **email is the canonical deterministic key** (lowercased, unique per org × env); phone + name+company are secondary rules surfaced through the merge flow. The CDP engine subscribes to `contact.created`/`lead.created` and attaches records in real time — two records under one profile = one identity (`customer.identity_merged`). Admin `rebuild` reconciles every contact + lead (idempotent); admin `merge` moves members + behaviors + health history with `mergedFromIds` lineage. Rules documented in `docs/25-cdp-guide.md`.
- **Behavioral event tracking — ✅**: `BehaviorEvent` (distinct from the system event log — what the *customer* did across web/product/purchase/support/ads). API ingest (`POST /api/cdp/behaviors`, identity resolves profileId → record email → email) **plus an event-bus mirror** (`startCdpEngine`) that maps `email.opened/clicked/replied`, `form.submitted`, `ticket.created`, `call.completed`, `meeting.completed` → behaviors with no code at the source.
- **Customer 360 view — ✅**: `/api/cdp/overview`, searchable `/api/cdp/profiles` (each row carries derived health), and `/api/cdp/profiles/:id` — identity members, unified contact/account info, the touchpoint stream (behaviors + emails + calls + meetings + tickets), the person's graph slice, health + churn + history. **Customers** page (new "Customer data" nav section) with KPI cards, profile cards, and a 360 drawer (Overview / Touchpoints / Graph / Health tabs) incl. admin Rebuild / Refresh / Merge actions.
- **Relationship graph v1 — ✅** (derived on read): account node + people + deal involvement; **influence** = weighted real touchpoints (email 1–4, call 3, meeting 5, ticket 2, primary +10, cap 100); `GET /api/cdp/graph?accountId=` and `?dealId=` (the buying committee). Schema + scoring in `docs/25-cdp-guide.md`.
- **Customer health engine — ✅**: explained composite `engagement(40) + support(25) + revenue(25) + recency(10)`, `churnRisk = 100 − score` (at risk ≥ 70); live via `GET /api/cdp/health`, admin `POST /api/cdp/health/refresh` persists `HealthScore` snapshots (history + deltas) and emits `customer.health_changed` / `customer.churn_risk_changed`. Formula in `docs/25-cdp-guide.md`.
- **Right-to-portability export — ✅** (🆕 blueprint, flag `cdp.portability`): one admin click produces a **single downloadable JSON bundle of EVERY org × environment collection** (incl. `Event` log + `AuditLog`; staff users minus password hashes); `PortabilityExport` rows track status/size/date; download streams, DELETE purges. **Portability** page in the "Customer data" nav section.
- **Demo data** — 9 unified profiles (5 contacts + 4 leads) incl. a **duplicate-identity lead** merged into Elena's profile (the `customer.identity_merged` demo), seeded behaviors (page views, product use, purchase, campaign opens, support ticket, ad click), and a health snapshot.

See `docs/23-spec-phase7.md` + `docs/25-cdp-guide.md` + `docs/24-phase7-build-report.md`.

## Phase 8 — AI Assistant Layer ✅ **COMPLETE**

- **Model router — ✅** (flag `ai.modelRouter`, ADR-020): `ModelRoute` catalog (4 default models per org × env) + org-configurable routing policy (`defaultModel`, `preference: cost|quality|latency`, `preferredRegion`); every generation returns an explainable `decision` (picked + candidates + reason). 🆕 **Data-residency pin**: `preferredRegion: "eu"` routes to the EU-resident model with the reason stated.
- **Data firewall — ✅** (🆕 blueprint): every prompt is server-built and redacted **before the model** (`redactContext`: emails, phones, cards, long numbers → `[REDACTED]`); the redaction log rides in every insight and is shown in the UI; policy is org-configurable with a receipt endpoint (`/api/ai/firewall/check?text=`). Reads open, writes admin-only.
- **Summaries — ✅**: record summaries (deal/contact/account/ticket), **call summaries from transcripts**, **Customer-360 profile summaries** reading the Phase 7 graph + health.
- **Email drafts — ✅**: tone-controlled (follow_up / proposal / casual / formal) for a contact, optional deal context — firewalled body + redaction log.
- **AI scoring — ✅**: explained lead (5 components) and deal (4 components) scores, each with value + weight + why; supersedes the Phase-1 static lead score.
- **Sentiment + intent — ✅**: `POST /api/ai/sentiment` (positive/negative/neutral + matched terms), `POST /api/ai/intent` (buying / churning / researching / inactive from real behaviors).
- **Semantic search — ✅**: `GET /api/ai/search?q=` — "won deals over 50k" parses to a `{ field, op, value }` predicate (transparent keyword parser), ranks hits across all object types with `evidence` + confidence, and persists each query as an audited insight (universal keyword search upgrade from Phase 1).
- **Confidence scoring + flagging — ✅** (🆕): every generator ships confidence 0–100; below threshold → `lowConfidence` + `ai.confidence_flagged` event + admin notification (kind `ai`).
- **Short-term AI memory — ✅**: `AIMemory` rows (org/user scoped, TTL) — user memory defaults to the caller and is private (cross-user write → 400).
- **UI — ✅**: **Copilot** page (chat-style composer, insight cards with confidence bars + model + latency + redaction receipts + reasons, firewall policy editor, memory list) and **Model router** admin page (catalog table + policy form + live route demo) under a new **AI** nav section. Feature flags `ai.assistant` + `ai.modelRouter`.

See `docs/26-spec-phase8.md` + `docs/28-ai-guide.md` + `docs/27-phase8-build-report.md`.

## Phase 9 — AI Agent Platform ⬜

Agent builder, risk-tiered actions, kill switch, testing lab, cost metering. Governance model already defined (`docs/04-permissions.md`).

## Phase 10 — Revenue Cloud ⬜

CPQ, contracts, billing, subscriptions, MRR. Opportunity amount/stage history already event-sourced.

## Phase 11 — Customer Success ⬜ / Phase 12 — Field Ops ⬜ / Phase 13 — Ecosystem ⬜

Success plans, usage intelligence, loyalty · territory/field service/inventory · no-code platform, marketplace, change-impact analysis.

## Phase 14 — Enterprise Security ⬜

SSO/MFA/SCIM, encryption/masking, GDPR/consent, vendor transparency, WCAG 2.2 AA, status page, i18n. Auth/permissions foundation shipped.

## Phase 15 — Differentiators ⬜

Business Brain, relationship graph v2, multi-agent orchestration, Deal X-Ray, Time Machine (**audit + events already provide the history substrate**), simulators, voice/computer-use agent, universal business query.

---

## Suggested next milestones

1. **~~Phase 2-lite~~** — done (multi-pipeline). **~~Phase 2~~** — done (Communication Core: email, calling, calendar, booking, timeline).
2. **~~Phase 3~~** — done (Automation & Workflow Engine: visual trigger → condition → action builder, `task.completed`, notifications, run log + duplicate guard). Spec `docs/15-spec-phase3.md`, report `docs/16-phase3-build-report.md`.
3. **~~Phase 4~~** — done (Customer Service: tickets + queues + SLAs + escalation + legal hold, knowledge base, self-service portal, email intake, convert-to-lead). Spec `docs/17-spec-phase4.md`, report `docs/18-phase4-build-report.md`.
4. **~~Phase 5~~** — done (Marketing Automation: campaigns with A/B + attribution/ROI, landing pages + public capture, the journey engine with a time ticker, deliverability monitoring). Spec `docs/19-spec-phase5.md`, report `docs/20-phase5-build-report.md`.
5. **~~Phase 6~~** — done (Analytics, Forecasting & BI: derived metrics library with data lineage, five dashboards, weighted forecast + snapshot history, predictive v1, report builder, metric thresholds + alerts). Spec `docs/21-spec-phase6.md`, report `docs/22-phase6-build-report.md`.
6. **~~Phase 7~~** — done (CDP / Customer 360: deterministic identity resolution + unified profiles, behavioral tracking via API + event-bus mirror, the 360 view, relationship graph with influence, explained health engine, right-to-portability export). Spec `docs/23-spec-phase7.md`, guide `docs/25-cdp-guide.md`, report `docs/24-phase7-build-report.md`.
7. **~~Phase 8~~** — done (AI Assistant Layer: non-agentic copilot — model router with cost/quality/latency preference + EU data-residency pin, the data firewall, record/call/360 summaries, tone-controlled email drafts, explained AI scoring, sentiment + intent, natural-language semantic search with predicates + evidence, confidence flagging with admin alerts, short-term AI memory). Spec `docs/26-spec-phase8.md`, guide `docs/28-ai-guide.md`, report `docs/27-phase8-build-report.md`.
8. **Phase 9-lite** — AI agent groundwork (agent governance: risk-tiered actions, kill switch, testing lab) over the Phase 8 model router — or Phase 10-lite (Revenue Cloud first slice).
