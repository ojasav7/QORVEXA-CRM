# QORVEXA CRM — Build Progress Report

> Living report: how many of the blueprint's 16 phases are complete, and what's left.
> Status cross-references the blueprint (`QORVEXAThe intelligent operating system for business.md`)
> and what's actually verified in this repo. **Effort estimates are rough build-days for one developer.**

<!-- Last updated: 2026-08-12 (Phase 8 verified live: 49/49 + 53/53 + 44/44 + 65/65 + 61/61 + 34/34 + 45/45 + 29/29 + 30/30 green on one fresh stack) -->

## Summary

| Metric | Value |
|---|---|
| Phases complete | **9 / 16** (Phase 0 — Platform Foundations ✅ 100%, Phase 1 — Core CRM ✅ 100%, Phase 2 — Communication Core ✅ 100%, Phase 3 — Automation & Workflow Engine ✅ 100%, Phase 4 — Customer Service ✅ 100%, Phase 5 — Marketing Automation ✅ 100%, Phase 6 — Analytics, Forecasting & BI ✅ 100%, Phase 7 — CDP / Customer 360 ✅ 100%, Phase 8 — AI Assistant Layer ✅ 100%) |
| Phases substantially built | 0 |
| Phases partially built | 0 |
| Phases not started | 7 |
| Current focus | Phase 9-lite (AI agent groundwork — agent governance, risk-tiered actions) or Phase 10-lite (Revenue Cloud first slice over the event-sourced deal history) |

**Phases 0–8 are complete.** The platform backbone (object model, event bus, RBAC, audit, custom fields, sandboxes, feature flags, import/export with merge, scheduled backups, field-level permissions, data residency, OAuth tokens + SSO), the full core CRM (lead routing, account hierarchy UI, dynamic segments, public lead-capture forms, duplicate-merge UI), the entire Communication Core (email templates + send/sync/reply with open/click tracking, calling with recording, calendar/meetings, public booking pages, auto-logged record timeline), the **Automation & Workflow Engine** (visual trigger → condition → action builder over the event bus, `task.completed`, in-app notifications, run log, duplicate-workflow guard), the **Customer Service suite** (first-class tickets with SLAs, omnichannel intake incl. a public self-service portal, knowledge base, legal hold), the **Marketing Automation suite** (send-to-segment campaigns with A/B subjects + attribution/ROI, landing pages + public form capture, the journey orchestration engine with a time ticker, deliverability monitoring), the **Analytics, Forecasting & BI suite** (metrics library computed on read with data lineage, five dashboard kinds, weighted forecast + snapshot history, predictive v1, report builder, metric thresholds + alerts), the **CDP / Customer 360 suite** (deterministic identity resolution with unified profiles, behavioral tracking via API + an event-bus mirror, the 360 view, a derived relationship graph with influence scoring, an explained customer health engine, and the right-to-portability full-tenant export), and the **AI Assistant Layer** (a non-agentic copilot: model router with explainable routing + a data-residency pin, a data firewall that redacts PII before the model, summaries for records/calls/360 profiles, tone-controlled email drafts, explained AI scoring, sentiment + intent, natural-language semantic search with predicates + evidence, confidence scoring that flags low-confidence outputs with admin alerts, and short-term AI memory) are all shipped and live-verified. The object model + event bus mean every later phase starts from a solid, extensible base — and the workflow engine (ADR-015) automates tickets and landing traffic, the BI layer (ADR-018) and the CDP behavior mirror (ADR-019) read the same event-sourced pipeline/comm data, and the AI layer (ADR-020) generates only explained, audited, human-in-the-loop suggestions on top of it all.

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

**Verified by:** `npm run typecheck` + `npm run build` green; live curl smoke tests for round-robin cycling (full-id assertions), explicit-owner precedence, manual reassign, rep 403, public-form dedupe/routing/honeypot, segment counts + bad-field 400, hierarchy cycle guards, and merge field choices — plus three real bugs caught and fixed during verification (see `docs/12-phase1-build-report.md`). **Re-verified 2026-08-11** against a freshly booted stack: `verify-phase1.sh` (repeatable live smoke suite, 30/30 green), demo data left pristine (5 contacts / 4 leads / 4 accounts / 0 segments / 0 forms).

---

### Phase 2 — Communication Core ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅** (see `docs/14-phase2-build-report.md` + `docs/14-communication-guide.md`)
- **Email sync, templates, tracking** — `EmailTemplate` CRUD (admin/manager, `{{variable}}` merge fields); `/api/emails` send with template merge + per-message tracking token (mock provider `EMAIL_MOCK=1`, ADR-014); mock inbox sync + simulated replies; **public open-pixel / click-redirect** endpoints (`/api/t/*`, token-scoped, scheme-validated) that flip `sent → opened → clicked → replied` and emit `email.opened` / `email.clicked`; tracking status badges in the Email UI.
- **Calendar / booking pages** — `/api/meetings` CRUD with date-range overlap queries + status lifecycle (`meeting.completed`); admin **booking pages** (slug, duration/buffer, availability days/hours, timezone, **round-robin host pool**) and a **public booking flow** at `/b/:slug` (honeypot + per-IP rate limit + server-side slot re-validation guarding double-booking); bookings create meetings owned by the assigned host (`booking.booked`).
- **Calling** — `/api/calls` log with direction/status/duration; optional **mock recording + transcript** when `settings.calling.recording` is enabled (ADR-014); `call.completed` / `call.logged` events.
- **Multi-pipeline engine (Phase 2-lite)** — see `docs/13-phase2-lite-build-report.md`: `Pipeline`/`PipelineStage` models (org × env, stages as JSON), `/api/pipelines` CRUD (reads open, writes admin-only) with guards (no default/last/with-deals deletion), per-org **default pipeline lazily seeded** from the registry, deals carry `pipelineId` (NULL = default; backfill script `npm run backfill:pipeline` stamps legacy deals), stage validated per pipeline + **probability derived from the pipeline's stage definition**, deals board with pipeline switcher + per-pipeline columns, Settings → Pipelines stage editor, `deal.pipeline_changed` + `pipeline.*` events.
- **Auto-logging** — `/api/timeline` aggregates notes + emails + calls + meetings per record; the record detail drawer renders the auto-logged activity stream.
- **Deal fields** — value/amount, pipeline-derived probability, close date, **competitors, and win/lost reasons** all editable on the deal form (blueprint Phase 2 field list complete).
- **Feature-gated** — `comm.email` / `comm.calling` / `comm.calendar` flags (all default-on) gate the API (`requireFeature`) and nav.
- **Blueprint docs** — communication integration guide (`docs/14-communication-guide.md`), calling/recording compliance notes (`docs/14-calling-compliance.md`), pipeline builder guide (`docs/14-pipeline-builder-guide.md`).

**Verified by:** `npm run typecheck` + `npm run build` green; live curl smoke suite `verify-phase2-comm.sh` (email templates CRUD, template-merge send with tracking, sync/reply, open+click tracking events, calls with recording, meetings lifecycle, booking-page CRUD + public slot/book flow incl. double-booking guard + honeypot + rate limit, timeline aggregation, rep 403s) plus `verify-phase2.sh` (29/29) and `verify-phase1.sh` (30/30) regressions — see the build report. **Re-verified 2026-08-12** against a freshly booted stack (clean DB drop → push → seed): `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30; demo data left pristine (5 contacts / 4 leads / 4 accounts / 7 deals / 0 segments / 0 forms / 2 pipelines / 3 templates / 2 messages / 1 call / 2 meetings / 1 booking page).

---

### Phase 3 — Automation & Workflow Engine ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅** (spec `docs/15-spec-phase3.md`, report `docs/16-phase3-build-report.md`)
- **Visual workflow builder** — trigger → condition → action over the event bus: `Automation` rows (org × env) + one `onEvent("*")` engine subscriber (`lib/automations.ts`). Triggers: `deal.stage_changed` (optional `to` stage), `deal.created/updated`, `lead.created`, `contact.created`, `task.completed`. Conditions: segment-style field filters (+ `payload.*`) validated at save time. Actions: `create_task` (with `{{field}}` merge), `notify` (in-app), `update_record` — task/record writes go through the generic object service (audit + events for free), acting as the workflow's creator (ADR-015).
- **`task.completed` event** — emitted on the `todo/in_progress → done` transition (the catalog reservation is fulfilled).
- **Notifications** — `Notification` model + `/api/notifications` (list/unread-count/read/read-all, user-scoped) + header bell with unread badge + dropdown.
- **Conflict-resolution UI + run log** — every evaluation writes an `AutomationRun` (matched or not, per-action `ok/skipped/failed` outcomes); the Workflows page renders run history and a synchronous **test endpoint** (`POST :id/test`) that runs a workflow against a real record.
- **Duplicate-automation detection** — 409 + `duplicateId` on an identical active workflow, `allowDuplicate` override, "Save anyway" UI banner. Loop protection: 30s in-memory cooldown per (workflow, entity, event).
- **Feature-gated** — `automation.workflows` flag (default-on) gates the APIs and nav; sandbox workflows never fire on production events.

**Verified by:** `npm run typecheck` + `npm run build` green; live smoke suite `verify-phase3.sh` (34/34) covering `task.completed`, CRUD + validation, duplicate 409/override, end-to-end trigger (won deal → runCount++ + task + notification + `automation.triggered`), test endpoint matched/unmatched, notifications scoping, sandbox isolation, and the feature gate — plus full regressions `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 green on the same stack (see the build report).

---

### Phase 4 — Customer Service ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅** (spec `docs/17-spec-phase4.md`, report `docs/18-phase4-build-report.md`)
- **Tickets as a first-class object type** (ADR-016, ADR-003 path) — `Ticket` via the generic object service: CRUD + audit + events + search + custom fields for free. Thin wrapper adds the helpdesk surface: per-org `TKT-####` references, queue counts (`/api/tickets/queues`), reply threads (staff + `internal` flag), assignment (notifies the new owner), escalation, email intake, and convert-to-lead.
- **SLAs** — `SlaPolicy` rows (lazily seeded defaults `urgent 1h / high 4h / medium 8h / low 24h`), `slaDueAt` on create, read-time `slaStatus` (`ok/warning/breached`), an admin-triggered **breach sweep** that persists `breachedAt` + emits `ticket.sla_breached` + auto-escalates high/urgent breaches (`ticket.escalated` + notifications). Priority change restarts the clock; resolution sets `resolvedAt` + `firstResponseAt`.
- **Omnichannel intake** — manual (API/UI), **email → ticket** (`/api/tickets/intake/email`, auto-links/auto-creates the contact, race-safe), and a **public self-service portal** at `/p/<slug>`: submit (honeypot + per-IP rate limit 20/min, no auth) + **no-leak status lookup** (email + reference must match; public replies only). Portal pages are admin-configured (`PortalPage` per org × env).
- **Knowledge base** — `KnowledgeArticle` CRUD (admin writes, open reads), categories with counts, title/body search, slugs unique per org × env, published articles surface in the portal, `viewCount` on read.
- **Legal hold / e-discovery (🆕 blueprint)** — admin-only toggle; held tickets are locked down (no edit/delete/reply/assign/escalate for non-admins, deletion blocked for everyone).
- **Automation integration** — the workflow engine (Phase 3) gained `ticket.created`, `ticket.status_changed` (optional `to` status), `ticket.escalated` triggers — tickets are automatable like any object.
- **Feature-gated** — `service.tickets` (Tickets + portals + legal hold) and `service.knowledge` flags (default-on) gate the APIs and nav.

**Verified by:** `npm run typecheck` + `npm run build` green; live smoke suite `verify-phase4.sh` (**61/61**) covering ticket CRUD + references, queues, replies (incl. internal-flag portal visibility), assignment + notification, escalation, legal-hold lockout (rep 403 / admin lift / delete block), convert-to-lead, email intake, SLA create/sweep/breach + auto-escalate + warning status, KB CRUD/search/categories/viewCount, portal CRUD + public submit (honeypot, rate limit, auto-contact) + no-leak lookup, and workflow triggers on ticket events — plus full regressions `verify-phase3.sh` 34/34, `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 green on the same stack.

---

### Phase 5 — Marketing Automation ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅** (spec `docs/19-spec-phase5.md`, report `docs/20-phase5-build-report.md`)
- **Campaigns** — `Campaign` + `CampaignRecipient` (ADR-017): admin CRUD + **send-to-segment** (Phase-1 dynamic segment audience snapshot, A/B subject split, per-recipient `Message` rows through the Phase-2 email path with tracking + recipient links), idempotency guard, live stats (sent/opened/clicked + rates + per-variant), A/B winner declaration, **attribution/ROI** (won deal amounts on recipient contacts; `Lead.campaignId` core field tags landing-captured leads).
- **Landing pages + public capture** — admin CRUD with **globally unique slugs** (cross-tenant safety, same rule as Phase 4 portals) + public `/l/:slug`: honeypot + per-IP rate limit + **no-leak duplicates**, routed leads (`source: "Landing page"`, `campaignId` when linked), `form.submitted` + `intent.detected` (new leads only — engines never fire on empty entityIds).
- **Journey orchestration engine** — declarative `Journey` rows with event/segment triggers + steps (`wait` / `send_email` / `notify` / `create_task` / `update_record` / `condition` / `end`), event-bus subscriber + 60s **ticker** advancing due `wait` enrollments (**claim-guarded** against concurrent passes), per-step run log, `journey.enrolled/step_entered/completed` events, loop guard (one active enrollment per journey × entity), admin test endpoint + manual advance.
- **Deliverability monitoring (🆕 blueprint)** — derived metrics (sent/opened/click/bounce rates, unsubscribes, complaints, 0–100 health, status grades) + simulated provider events (`email.bounced/unsubscribed/complained`).
- **Segmentation** — dynamic segments (Phase 1) ARE the campaign/journey audience; the `in`/`not_in` array-filter bug that made array criteria match nothing was fixed (`segments.ts`).
- **Workflow integration** — the Phase 3 engine gained the `form.submitted` trigger (landing traffic automatable like any object).
- **Feature-gated** — `marketing.campaigns`, `marketing.journeys`, `marketing.landing`, `marketing.deliverability` flags (default-on) gate the APIs + a new **Marketing** nav section.

**Verified by:** `npm run typecheck` + `npm run build` green; live smoke suite `verify-phase5.sh` (**65/65**) covering campaign CRUD + send (58 recipients, A/B split, resend guard, `campaign.sent`), open-pixel rollup + A/B winner + attributed ROI ($42k won deal), landing CRUD + global-slug 400 + public submit (honeypot/rate limit/no-leak/duplicate) + `form.submitted`/`intent.detected`, journey CRUD + validation + event-trigger enrollment → wait → advance → step execution → completion + `journey.completed` + loop guard + test endpoint, deliverability metrics + simulated bounce, `form.submitted` workflow firing, feature gates (public landing unaffected), and sandbox isolation — plus full regressions `verify-phase4.sh` 61/61, `verify-phase3.sh` 34/34, `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 green on the same stack.

---

### Phase 6 — Analytics, Forecasting & BI ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅** (spec `docs/21-spec-phase6.md`, report `docs/22-phase6-build-report.md`)
- **Metrics library + dashboards (ADR-018)** — every metric is **derived, never stored**: computed on read from live rows + the event log, so it can't go stale. Five dashboard kinds (`sales` / `marketing` / `service` / `revenue` / `executive`) covering win rate, sales velocity, weighted pipeline, pipeline coverage, campaign ROI + open/click rates, SLA health, won 30/90-day revenue — with **data lineage** (`sources: [{ entity, query, note }]`) as a first-class output on every metric (the UI explains each number).
- **Sales forecasting** — the **weighted pipeline** (pipeline / weighted / commit / bestCase buckets + per-stage + per-owner rows) computed live; admin **refresh persists a `Forecast` snapshot** (history via `GET /api/analytics/forecast`) and emits `forecast.updated`.
- **Predictive analytics v1** — transparent arithmetic with documented inputs (no black box): conversion likelihood (stage probability + amount vs avg + age), churn risk (inactivity + open tickets + no open deals), LTV (won amounts × lifetime multiplier).
- **Report builder** — `Report` rows (saved `kind` + metric `keys`); `GET /:id/data` renders **live** metrics with lineage — a report can never show a stale number.
- **Thresholds + alerts (🆕)** — org-configurable metric thresholds (`settings.analytics.thresholds`) evaluated at refresh → admin notifications (`kind: metric`) + `metric.threshold_breached`.
- **Feature-gated** — `analytics.metrics` (dashboard/forecast/predictions) + `analytics.reports` flags (default-on) gate the APIs and a new **Analytics** nav section.

**Verified by:** `npm run typecheck` + `npm run build` green; live smoke suite `verify-phase6.sh` (**44/44**) covering all five dashboard kinds + lineage + arithmetic winRate check, live forecast (weighted ≤ pipeline, per-owner rows) + snapshot refresh (history grows) + `forecast.updated` + rep 403, predictions (0–100 with inputs), report CRUD + live data + role gates + malformed-id 404, forced threshold breach → `metric.threshold_breached` + admin notification, feature gates, and sandbox isolation — plus full regressions `verify-phase5.sh` 65/65, `verify-phase4.sh` 61/61, `verify-phase3.sh` 34/34, `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 green on the same stack (see the build report).

---

### Phase 7 — CDP / Customer 360 ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅** (spec `docs/23-spec-phase7.md`, guide `docs/25-cdp-guide.md`, report `docs/24-phase7-build-report.md`)
- **Identity resolution + unified profiles (ADR-019)** — one `IdentityProfile` per person per org × env; **email is the canonical deterministic key** (lowercased, unique per org × env; phone + name+company are secondary rules surfaced through the merge flow). The CDP engine subscribes to `contact.created`/`lead.created` and attaches records in real time — two records under one profile = one identity (`customer.identity_merged` with lineage). Admin `rebuild` reconciles everything (idempotent); admin `merge` moves members + behaviors + health history into the target with `mergedFromIds` lineage.
- **Behavioral event tracking** — `BehaviorEvent` (distinct from the system event log — what the customer did across web/product/purchase/support/ads). Two paths: API ingest (`POST /api/cdp/behaviors`, identity resolves profileId → record email → email) and an **event-bus mirror** (`startCdpEngine`) mapping `email.opened/clicked/replied`, `form.submitted`, `ticket.created`, `call.completed`, `meeting.completed` → behaviors — touchpoint coverage by construction, no code at the source.
- **Customer 360** — `/api/cdp/overview` headline numbers, searchable `/api/cdp/profiles` (every row carries derived health + churn), and `/api/cdp/profiles/:id` (identity members, unified contact/account info, the full touchpoint stream, the person's graph slice, health + churn + snapshot history). New **Customers** page (nav section "Customer data") with KPI cards, search, health-bar profile cards, and a 360 drawer (Overview / Touchpoints / Graph / Health tabs) including admin Rebuild / Refresh health / Merge-into actions.
- **Relationship graph v1** — derived on read (never stored): account node + people + deal involvement with **influence** scored from real touchpoints (email sent 1 → replied 4, call 3, meeting 5, ticket 2, primary +10, cap 100); `GET /api/cdp/graph?accountId=` and `?dealId=` (the buying committee ranked by influence). Schema + scoring documented in `docs/25-cdp-guide.md`.
- **Customer health engine** — explained composite `engagement(40) + support(25) + revenue(25) + recency(10)`, `churnRisk = 100 − score` (at risk ≥ 70); every component returns its raw inputs + formula. Live via `GET /api/cdp/health`; admin `POST /api/cdp/health/refresh` persists one `HealthScore` snapshot per profile (history + deltas) and emits `customer.health_changed` / `customer.churn_risk_changed`. Formula documented in `docs/25-cdp-guide.md`.
- **Right-to-portability export (🆕 blueprint)** — one admin click builds a **single downloadable JSON bundle of EVERY org × environment collection** (objects, comms, tickets, marketing, analytics, CDP rows, plus the `Event` log + `AuditLog`; staff users minus password hashes); `PortabilityExport` rows track status/size/date; download streams the file, DELETE purges. New **Portability** page in the "Customer data" nav section.
- **Feature-gated** — `cdp.profiles` (pro/enterprise) gates the CDP APIs + Customers page; `cdp.portability` (enterprise) gates the export APIs + Portability page.

**Verified by:** `npm run typecheck` + `npm run build` green; live smoke suite `verify-phase7.sh` (**53/53**) covering identity rebuild + duplicate-email unification (`customer.identity_merged`), self-merge 400 + rep 403s, behavior API ingest (profile resolved by email, open catalog, 400 on missing type) + `customer.behavior_tracked`, the 360 view (behaviors/messages/history/members), the relationship graph (account + deal buying committee with influence), the health engine (score range, churnRisk = 100 − score, 4 explained components, snapshot refresh + history + `customer.health_changed`), the portability bundle (40 collections, download contains profiles + audit + events, password hashes excluded, rep 403, purge 404), feature gates, and sandbox isolation — plus full regressions `verify-phase6.sh` 44/44, `verify-phase5.sh` 65/65, `verify-phase4.sh` 61/61, `verify-phase3.sh` 34/34, `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 green on the same fresh stack. (Also fixed during verification: the Phase-5 campaign A/B `splitA` percentage bug — see ADR-019 consequences.)

---

### Phase 8 — AI Assistant Layer ✅ **COMPLETE (100%)**

**Blueprint items verified shipped ✅** (spec `docs/26-spec-phase8.md`, guide `docs/28-ai-guide.md`, report `docs/27-phase8-build-report.md`)
- **Model router (ADR-020)** — `ModelRoute` catalog (4 default models per org × env: `mock-fast` / `mock-balanced` / `eu-mock` / `mock-premium`) + org-configurable routing policy (`defaultModel`, `preference: cost|quality|latency`, `preferredRegion`). Every generation returns an explainable `decision` (picked model + candidates + English reason) — and the 🆕 **data-residency pin** (`preferredRegion: "eu"`) routes to the EU-resident model with the reason stated. Admin catalog CRUD via `/api/models`.
- **Data firewall (🆕 blueprint)** — every prompt is server-built and passed through `redactContext` **before the model sees it**: emails, phones, cards, long numbers → `[REDACTED]`, with a redaction **log** that rides in the insight and is shown in the UI. Policy (`maskMode` + per-type toggles) is org-configurable; a **receipt endpoint** (`/api/ai/firewall/check?text=`) lets callers verify redaction before sending. Reads open, writes admin-only.
- **Explainable generators** — every output is an `AIInsight` (audited) + a `decision` (explained) + a redaction log. Record summaries (deal/contact/account/ticket), **call summaries from transcripts**, **Customer-360 profile summaries** (reading the Phase 7 graph + health), tone-controlled **email drafts**, and **explained AI scoring** (lead: 5 components, deal: 4 — each with value + weight + why).
- **Sentiment + intent** — `POST /api/ai/sentiment` (positive/negative/neutral + matched terms) and `POST /api/ai/intent` (buying/churning/researching/inactive from real behaviors).
- **Natural-language semantic search** — `GET /api/ai/search?q=` — "won deals over 50k" parses to a `{ field, op, value }` **predicate** via a transparent keyword parser, ranks hits across all object types with `evidence` (matched terms + reason) + confidence, and persists every query as an audited insight.
- **Confidence scoring + flagging (🆕)** — every generator ships confidence 0–100; below threshold → `lowConfidence`, **`ai.confidence_flagged`** event + **admin notification** (kind `ai`) — the header bell surfaces "Low AI confidence ⚠️ — review before acting."
- **Short-term AI memory** — `AIMemory` rows (org/user scoped, TTL, updatedAt) — the assistant's scratchpad; user-scoped memory is private (cross-user write → 400).
- **Feature-gated** — `ai.assistant` (pro/enterprise) gates the generators + search + memory + firewall and the **Copilot** page; `ai.modelRouter` (admin) gates the catalog + policy and the **Model router** admin page. New **AI** nav section.

**Verified by:** `npm run typecheck` + `npm run build` green; live smoke suite `verify-phase8.sh` (**49/49**) covering the seeded catalog + cost/quality/residency routing (EU pin → `eu-mock` with reason), firewall redaction on summaries (PII kept out of output) + rep 403 + the receipt endpoint, deal/call/360 summaries + `ai.summary_generated`, draft tone + firewalled body + redaction log, lead (5) / deal (4) explained scores + `ai.score_computed` + rep 201, sentiment + intent, "won deals over 50k" predicate (≥ 50000) with evidence + plain-name all-types search + persisted search insight, low-confidence flagging (`ai.confidence_flagged` + admin notification), memory write/list/delete + cross-user write **and read** 400s (privacy held both ways), feature gates, and sandbox isolation — plus full regressions `verify-phase7.sh` 53/53, `verify-phase6.sh` 44/44, `verify-phase5.sh` 65/65, `verify-phase4.sh` 61/61, `verify-phase3.sh` 34/34, `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 green on the same fresh stack (410 checks).

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
3. ~~**Phase 2-lite: multi-pipeline**~~ — **done** (report in `docs/13-phase2-lite-build-report.md`).
4. ~~**Phase 2: Communication Core**~~ — **done** (report in `docs/14-phase2-build-report.md`): email + templates + tracking, calling, calendar/meetings, public booking pages, auto-logged record timeline. Phase 2 is **100% complete**.
5. ~~**Phase 3: Automation & Workflow Engine**~~ — **done** (spec `docs/15-spec-phase3.md`, report `docs/16-phase3-build-report.md`): visual trigger → condition → action builder over the event bus, `task.completed`, in-app notifications, run log + test endpoint, duplicate-workflow guard. Phase 3 is **100% complete**.
5. ~~**Phase 4: Customer Service**~~ — **done** (spec `docs/17-spec-phase4.md`, report `docs/18-phase4-build-report.md`): tickets as a first-class object with SLAs (deadline + breach sweep + auto-escalate), queues + reply threads, omnichannel intake (manual, email, public portal with no-leak lookup), knowledge base, legal hold, convert-to-lead, ticket automation triggers. Phase 4 is **100% complete**.
5. ~~**Phase 5: Marketing Automation**~~ — **done** (spec `docs/19-spec-phase5.md`, report `docs/20-phase5-build-report.md`): campaigns with A/B + attribution/ROI, landing pages + public capture, the journey orchestration engine (event → wait → action with a ticker), deliverability monitoring. Phase 5 is **100% complete**.
6. ~~**Phase 6: Analytics, Forecasting & BI**~~ — **done** (spec `docs/21-spec-phase6.md`, report `docs/22-phase6-build-report.md`): metrics library with data lineage, five dashboards, weighted forecast + snapshot history, predictive v1 (conversion/churn/LTV), report builder, metric thresholds + alerts. Phase 6 is **100% complete**.
7. ~~**Phase 7: CDP / Customer 360**~~ — **done** (spec `docs/23-spec-phase7.md`, report `docs/24-phase7-build-report.md`, guide `docs/25-cdp-guide.md`): deterministic identity resolution + unified profiles over the event log, behavioral tracking (API + event-bus mirror), the Customer 360 view, a derived relationship graph with influence scoring, an explained customer health engine, and the right-to-portability full-tenant export. Phase 7 is **100% complete**.
8. ~~**Phase 8: AI Assistant Layer**~~ — **done** (spec `docs/26-spec-phase8.md`, report `docs/27-phase8-build-report.md`, guide `docs/28-ai-guide.md`): the non-agentic copilot — model router (cost/quality/latency preference + EU data-residency pin, every route explained), the data firewall (PII redacted before the model, redaction log + receipt endpoint), summaries (records/calls/360 profiles), tone-controlled email drafts, explained AI scoring (lead 5 / deal 4 components), sentiment + intent, natural-language semantic search with predicates + evidence, confidence scoring with low-confidence flagging + admin alerts, and short-term AI memory. Phase 8 is **100% complete**.
9. **Phase 9-lite or Phase 10-lite** (~6–8 days): Phase 9 groundwork (agent governance — risk-tiered actions, the kill switch, the testing lab) over the Phase 8 model router — or the Phase 10 Revenue Cloud first slice (product catalog, price books, quotes, orders over the event-sourced deal amount/stage history).

Dependencies: Phases 6, 7, 8, 9 all consume the event bus + object model + the workflow + journey engines + the CDP behavior mirror (done). Phase 9 AI agent work builds directly on the Phase 8 model router, firewall, and insight audit trail; Phase 10 builds on the event-sourced deal pipeline history.

## How this report is maintained

- **Update trigger:** after any phase ships a user-visible capability, or when the spec for the current milestone changes.
- **Status icons:** ✅ fully shipped · 🧱 partial (with %) · ⬜ not started.
- **Verification rule:** an item only counts as shipped if it's verifiable in the repo (route/model/UI), not just planned in a doc.
- **Effort estimates:** rough one-developer build-days; revise as the current milestone progresses.
- To regenerate the "verified in repo" half quickly, ask Claude: *"Check PROGRESS.md against the code in this repo and update the shipped/left columns."*
