# QORVEXA CRM — Build Progress Report

> Living report: how many of the blueprint's 16 phases are complete, and what's left.
> Status cross-references the blueprint (`QORVEXAThe intelligent operating system for business.md`)
> and what's actually verified in this repo. **Effort estimates are rough build-days for one developer.**

<!-- Last updated: 2026-08-10 -->

## Summary

| Metric | Value |
|---|---|
| Phases complete | **2 / 16** (Phase 0 — Platform Foundations ✅ 100%, Phase 1 — Core CRM ✅ 100%) |
| Phases substantially built | 0 |
| Phases partially built | 2 (Phase 6 substrate, Phase 8 substrate) |
| Phases not started | 12 |
| Current focus | Phase 2-lite (multi-pipeline admin + email templates) |

**Phases 0 and 1 are complete.** The platform backbone (object model, event bus, RBAC, audit, custom fields, sandboxes, feature flags, import/export with merge, scheduled backups, field-level permissions, data residency, OAuth tokens + SSO) and the full core CRM (lead routing, account hierarchy UI, dynamic segments, public lead-capture forms, duplicate-merge UI) are all shipped and live-verified. The object model means every later phase starts from a solid, extensible base.

## Phase-by-phase status

---

### Phase 0 — Platform Foundations ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅**
- Object/Relationship/Event architecture — generic CRUD engine (`object-service.ts`)
- Event bus with persistence + webhook dispatch + in-process subscribers
- RBAC (admin/manager/rep) + record-level visibility (`org`/`owner`)
- Multi-tenant org model (`orgId` scoping enforced centrally)
- Custom fields & custom objects v1 (FieldDef registry + Settings UI)
- REST API + Webhooks (HMAC-signed, retried deliveries)
- Audit trail with field-level diffs
- CSV **import** with duplicate detection, dry-run preview, and per-row **merge** (`/import` page; `<type>.imported` / `<type>.merged` events)
- CSV **export** (RFC 4180, environment-scoped, field-permission-aware column filtering, `Export CSV` on list pages + deals board)
- Sandbox/staging environments (ADR-008: `environment` scoping field threaded through the access layer; `X-Environment` header; switcher, create, reset, promote-copy with `promotedFrom` lineage; cross-env leak smoke-tested)
- Feature flag system (server-owned `FeatureFlag` registry, `requireFeature` API gate, per-org×env overrides, Settings toggles)
- Backup / snapshot + **scheduled snapshots with retention pruning** + restore-to-sandbox (ADR-009: JSON archives, `BackupJob` rows, `SNAPSHOT_INTERVAL_HOURS` + `settings.backupRetentionDays`)
- **Field-level permissions** (blueprint principle #3: `FieldPermission` rows per org×env×object×field; read-masking in list/detail/export, write rejection 403 in create/update; admin always passes; Settings UI)
- **Data residency configuration** (`Organization.settings.dataResidency` region + policy; Settings → Environments card; enforcement lands with multi-region hosting)
- **OAuth** — both blueprint shapes: API bearer tokens (`ApiToken`, sha256-at-rest, role+scope+env scoped, Settings → API tokens) *and* provider SSO (Google/GitHub authorization-code flow, CSRF state cookie, `OAUTH_MOCK=1` dev mode, login-page buttons)

**Verified by:** `npm run typecheck` + `npm run build` green; live curl smoke tests covering env isolation, feature gating, import dry-run/merge, snapshot/restore/promote/reset, scheduled snapshot + retention pruning, export (incl. masked columns), field-permission masking + 403 writes, token scopes/revocation, and SSO mock flows (see `docs/11-phase0-build-report.md`).

---

### Phase 1 — Core CRM ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅**
- Contacts & accounts with custom fields, tags, ownership
- **Lead routing** — admin-configured round-robin pool (`Organization.settings.leadRouting`, Settings → Lead routing); explicit `ownerId` always wins (create + PATCH reassign, admin/manager only); `lead.routed` events with `mode` (ADR-010)
- **Account hierarchy UI** — `parentId` + cycle guard (400 on cycle/self-parent), `parentId_label` hydration, Accounts → Hierarchy tree page, parent picker in the form
- Lead capture via API + CSV import + manual UI + **public lead-capture forms** (embeddable, no-auth: honeypot + per-IP rate limit + no-leak duplicate handling; submissions create routed leads with `source: "Website"` + `lead.captured`; Settings → Lead capture embed snippet) (ADR-012)
- Basic lead scoring (`score` 0–100)
- Deal pipeline (6 stages) with drag-drop board, probability auto-derivation
- Activities: tasks, notes, reminders (due dates), timeline on record detail
- Duplicate detection (email/name) + global keyword search + **duplicate merge UI** (`POST /api/merge`, per-field master/merge choice, `<type>.merged` `via: "records"`) (ADR-011)
- **Segments** — dynamic lists as a first-class entity: `Segment` model + criteria builder/compiler, live member counts, `/api/segments` CRUD + `/members`, Segments page with filter builder (ADR-003 pattern)

**Verified by:** `npm run typecheck` + `npm run build` green; live curl smoke tests for round-robin cycling (full-id assertions), explicit-owner precedence, manual reassign, rep 403, public-form dedupe/routing/honeypot, segment counts + bad-field 400, hierarchy cycle guards, and merge field choices — plus three real bugs caught and fixed during verification (see `docs/12-phase1-build-report.md`).

---

### Phase 2 — Communication Core ⬜ — *est. 6–8 days*

Email sync/templates/tracking, calendar + booking, calling, **multi-pipeline engine** (registry already parameterizes the pipeline — the cheapest win in the roadmap), auto-logging, win/lost reasons (fields already exist). Pipeline config per org is the recommended entry point.

---

### Phase 3 — Automation & Workflow Engine ⬜ — *est. 8–10 days*

Visual workflow builder over the event bus: trigger (`deal.stage_changed`) → condition → action (create task, notify). `onEvent()` subscriber API already exists in `lib/events.ts` — the trigger substrate is done. Also: `task.completed` event (currently emits `task.updated`), sequences, notifications, conflict-resolution UI, duplicate-automation detection.

---

### Phase 4 — Customer Service ⬜ — *est. 10–14 days*

Tickets/cases (new object type via the object model — documented path in `docs/01-architecture.md`), SLAs, omnichannel intake, knowledge base, self-service portal, ticket-to-lead conversion, 🆕 legal hold / e-discovery. Biggest single-phase jump in user-visible surface.

---

### Phase 5 — Marketing Automation ⬜ — *est. 10–14 days*

Campaigns, journeys (event → context → decision → action loop — the event bus is the substrate), segmentation (dynamic lists), A/B + attribution, landing pages/forms, 🆕 deliverability monitoring.

---

### Phase 6 — Analytics, Forecasting & BI 🧱 (~10%) — *est. 8–10 days*

Dashboard stats endpoint + pipeline aggregation shipped. Left: report builder, metrics library (CAC/LTV/churn), sales forecasting (weighted pipeline data is event-sourced and ready), predictive analytics v1, 🆕 data lineage.

---

### Phase 7 — CDP / Customer 360 ⬜ — *est. 10–12 days*

Identity resolution, real-time profiles, behavioral tracking, enrichment/governance, relationship graph v1, customer health engine, 🆕 right-to-portability export. Audit + events are the raw material.

---

### Phase 8 — AI Assistant Layer 🧱 (~5%) — *est. 10–14 days*

Non-agentic copilot: AI email/summary/report writing, call & meeting summarization, semantic search, AI scoring, explainability, 🆕 confidence scoring, 🆕 data firewall, 🆕 model router. Event + audit history is the context substrate; `ModelRoute`/`AIInsight` models to add.

---

### Phase 9 — AI Agent Platform ⬜ — *est. 12–16 days*

Agent builder (identity, knowledge, tools, permissions), risk-tiered actions (governance model already defined in `docs/04-permissions.md`), pre-built agents, AI audit trail, agent analytics, 🆕 kill switch, 🆕 testing lab, 🆕 cost metering.

---

### Phase 10 — Revenue Cloud ⬜ — *est. 12–16 days*

Product catalog, price books, CPQ, quotes + e-sign, orders, contracts + contract intelligence, subscriptions, invoices/payments/dunning, MRR/ARR. Deal amount/stage history already event-sourced.

---

### Phase 11 — Customer Success ⬜ — *est. 8–10 days*

Onboarding/success plans, product usage intelligence, churn prediction v2, NPS/CSAT/CES surveys, loyalty & advocacy.

---

### Phase 12 — Field Operations ⬜ — *est. 10–12 days*

Territory management, route/visit planning, GPS check-ins, offline mode, field service (work orders, dispatch), inventory & assets.

---

### Phase 13 — Ecosystem ⬜ — *est. 12–16 days*

No-code/low-code builders (object model already supports this), developer platform (SDKs, serverless functions), app/agent marketplace, partner & channel management, 🆕 change-impact analysis, 🆕 environment promotion with change sets.

---

### Phase 14 — Enterprise Security ⬜ — *est. 12–16 days*

SSO/MFA/SCIM, IP restriction, session/device management (DB sessions upgrade from signed cookies), encryption/masking, retention/deletion policies, GDPR/consent, 🆕 vendor transparency, 🆕 WCAG 2.2 AA, 🆕 status page, i18n + localization QA. Auth/permissions foundation shipped.

---

### Phase 15 — Differentiators ⬜ — *est. 14–20 days*

Business Brain, relationship graph v2, multi-agent orchestration, Deal X-Ray, Opportunity Radar, AI Deal Detective, **CRM Time Machine** (audit + events already provide the history substrate), Business Digital Twin, AI-built CRM/workflow/agent/report generators, Voice CRM + computer-use agent, Universal Business Query.

---

## What to build next (recommended order)

1. ~~**Phase 0 hardening**~~ — **done** (spec in `docs/09-spec-phase0-hardening.md`, report in `docs/11-phase0-build-report.md`): sandbox envs, feature flags, CSV merge UI, backup/restore.
2. ~~**Phase 0 completion**~~ — **done** (addendum in `docs/11-phase0-build-report.md` §9): CSV export, field-level permissions, data residency config, scheduled backups + retention, OAuth tokens + SSO. Phase 0 is **100% complete**.
3. ~~**Finish Phase 1**~~ — **done** (report in `docs/12-phase1-build-report.md`): lead routing (round-robin + manual override), account hierarchy UI, dynamic segments, public lead-capture forms, duplicate-merge UI. Phase 1 is **100% complete**.
3. **Phase 2-lite** (~3–4 days): multi-pipeline admin + email templates — the object model makes this the cheapest *new* capability.
4. **Phase 3-lite** (~8–10 days): workflow engine — unlocks `task.completed`, notifications, and every automation-dependent phase after it.

Dependencies: Phases 4, 5, 7, 8, 9 all consume the event bus + object model (done). Phase 8–9 AI work should wait until Phases 1–7 produce real data volume.

## How this report is maintained

- **Update trigger:** after any phase ships a user-visible capability, or when the spec for the current milestone changes.
- **Status icons:** ✅ fully shipped · 🧱 partial (with %) · ⬜ not started.
- **Verification rule:** an item only counts as shipped if it's verifiable in the repo (route/model/UI), not just planned in a doc.
- **Effort estimates:** rough one-developer build-days; revise as the current milestone progresses.
- To regenerate the "verified in repo" half quickly, ask Claude: *"Check PROGRESS.md against the code in this repo and update the shipped/left columns."*
