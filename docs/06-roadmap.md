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

## Phase 4 — Customer Service ⬜

Tickets, omnichannel intake, knowledge base, portal, SLAs, legal hold. (Adding `Ticket` via the object model is the intended path — see `docs/01-architecture.md` "Adding a new object type".)

## Phase 5 — Marketing Automation ⬜

Campaigns, journeys, segmentation (Tag-based segments already work), landing pages, deliverability monitoring.

## Phase 6 — Analytics & BI 🧱

- Dashboards — 🧱 dashboard stats endpoint exists; add report builder + metrics library
- Forecasting — 🧱 pipeline data is event-sourced, ready for weighted forecasts
- Predictive analytics — ⬜

## Phase 7 — CDP / Customer 360 ⬜

Identity resolution, relationship graph, health engine, right-to-portability export. (Audit + events are the raw material.)

## Phase 8 — AI Assistant Layer 🧱

- AI summaries / scoring / semantic search — the `Event` + `AuditLog` history and searchable fields are the context substrate; `ModelRoute`/`AIInsight` models to add
- Confidence scoring, data firewall, model router — ⬜

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
3. **Phase 6-lite:** report builder + metrics library over the event-sourced pipeline/comm data (weighted forecasts are ready to compute).
