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

## Phase 9 — AI Agent Platform ✅ **COMPLETE**

- **Agent builder — ✅** (flag `ai.agents`, ADR-021): declarative `Agent` rows (trigger event/manual + rules field filters + **tool allowlist** + per-tool `tierPolicy` risk overrides + `memoryEnabled`/`active`/per-agent `killSwitched`). CRUD at `/api/agents` — reads open (the page is a governance surface), writes admin-only.
- **Risk-tiered action system — ✅** (blueprint §3.4): 🟢 auto (`create_task`/`notify`/`create_ticket` — executes in-run through the generic object service), 🟡 approval (`send_email`/`update_record` — persists `proposed`, admin/manager approves), 🔴 human required (**admin-only**, never automatic). Runs with 🟡/🔴 notify the org's admins (kind `agent`, link to the approvals queue).
- **Pre-built agents — ✅**: Lead (`lead.created`), Sales (`deal.stage_changed`), Customer Service (`ticket.created`), Renewal (`deal.stage_changed`, seeded with the 🟡 `send_email` override). Deterministic per-kind deciders — every proposal carries an English reason, the run ships the joined `reasoning` (no black box).
- **AI audit trail — ✅**: `AgentRun` (firewalled context + recent events + memory + reasoning + `riskSummary` + cost) + `AgentAction` rows (tool, tier, params, reason, status, result, `approvedBy`); evented `agent.action_proposed/approved/executed/rejected` + `agent.created/updated/deleted`.
- **Agent analytics — ✅**: per-agent success rate, **escalation rate** (yellow/red share), waiting approvals, cost + org totals (`GET /api/agents/analytics`).
- **🆕 Kill switch — ✅**: org-wide (`POST /api/agents/kill-switch`, header banner) + per-agent (`POST /api/agents/:id/kill`); checked before every run, emits `agent.killed`.
- **🆕 Testing / simulation lab — ✅**: `POST /api/agents/:id/test` dry-runs a scenario with NO execution → `passed` / `blocked` (🔴 action) / `failed`, persisted as `AgentTest` rows with predicted cost.
- **🆕 Cost metering — ✅**: simulated tokens × cheapest `ModelRoute` price per run/test; `Agent.costTotal` + `GET /api/agents/metering` (total, per-agent, per-entity).
- **Agent memory — ✅**: `AgentMemory` per-entity scratchpad (TTL-purged by the engine ticker), fed into future context.
- **UI — ✅**: **Agents** page (`/agents`, "AI" nav section) — Agents / Approvals / Runs / Testing lab / Analytics tabs + agent detail drawer (manual run, memory, recent actions). Engine: `startAgentEngine` event-bus subscriber + memory ticker.

See `docs/29-spec-phase9.md` + `docs/31-agent-governance-guide.md` + `docs/30-phase9-build-report.md`.

## Phase 10 — Revenue Cloud ✅ **COMPLETE**

- **Product catalog + price books — ✅**: `Product` rows (SKU, listPrice, cost, taxable, bundle `components`), price books with entries + per-product discounts, lazy default-book seeding, templates.
- **CPQ — ✅**: `/api/quotes/preview` server-side pricing (bundle expansion, book discounts, tax), quotes with approval → e-sign → order, manual orders.
- **Contracts + billing — ✅**: contract analyzer (effective dates, auto-renew, payment terms, governing law), dunning loop, subscriptions (renew/cancel), invoices (issue/pay/void, tax), payments (succeed/fail/refund).
- **Revenue metrics — ✅**: derived MRR/ARR/activeSubs/newMrr/churnedMrr/outstanding/paidThisMonth with lineage (`GET /api/revenue/metrics`), per-account MRR, `revenue.*` events, engine tick.
- **UI — ✅**: **Revenue** page (`/revenue`, "Finance" nav section) — metrics, quotes, orders, contracts, subscriptions, invoices. Verified live **109/109** (`verify-phase10.sh`, regression-green on the same stack as Phase 11).

## Phase 11 — Customer Success ✅ **COMPLETE**

- **Success & onboarding plans — ✅** (flag `cs.plans`): `SuccessPlan` rows (kind onboarding/success/custom) with **milestones** + **QBRs**, owner + timeline, hydrated with live Phase 7 health/churn, **health-to-playbook at-risk flagging** (health < 60 or churn tier ≥ high → `atRisk`).
- **Product usage intelligence — ✅** (flag `cs.usage`): `UsageEvent` via API ingest + **event-bus mirror** (meeting.completed → meetings, email.sent → email, …), derived overview (features, last-active, activity trend, seat utilization, `bySource`), **adoption-drop detection** (≥ 50% drop → `usage.adoption_dropped` + admin notify).
- **Churn prediction v2 + expansion radar — ✅** (flag `cs.churn`): explained deterministic score (health / usage / support / billing / survey signals, factor list = playbook), **snapshot history** (`churn.risk_scored` on tier escalation + notify), **expansion radar** (seat upsell ≥ 90% utilization, plan upsell, cross-sell — `expansion.opportunity_detected`).
- **Surveys + feedback → roadmap — ✅** (flag `cs.surveys`): NPS/CSAT/CES with per-kind score validation, derived sentiment, results computed at read with lineage, negative feedback auto-promotes to `RoadmapItem` with votes + triage.
- **Loyalty / advocacy — ✅** (flag `cs.loyalty`): programs (tiers/rewards/pointsRules), members with **derived tiers**, points awards (`loyalty.points_awarded`), referral lifecycle pending → contacted → converted|expired (`referral.converted` awards the referrer).
- **Engine + UI — ✅**: `startSuccessEngine` (event-bus usage mirror + ticker: adoption scan, churn refresh, referral/loyalty checks); **Success** page (`/success`, "Customer success" nav) — Plans / Usage / Churn / Surveys / Loyalty tabs + roadmap + expansion radar. Verified live **71/71** (`verify-phase11.sh`).

See `docs/32-spec-phase11.md` + `docs/34-customer-success-guide.md` + `docs/33-phase11-build-report.md`.

## Phase 12 — Field Operations ✅ **COMPLETE**

- **Territories — ✅** (flag `field.territories`): `Territory` rows that own accounts + technicians (region, manager, active), hydrated with `accountNames`.
- **Visits + GPS check-ins + route planning — ✅** (flag `field.visits`): scheduled visits with the `planned → in_transit → checked_in → completed | cancelled` lifecycle; **GPS check-in** records coords + emits `visit.checked_in`; **route optimization** (greedy nearest-neighbor from the technician's last position, haversine per-leg + total km).
- **Field service — ✅** (flag `field.workorders`): work orders with priority + `slaDueAt`, dispatch (unknown technician → 400), start/complete/cancel; **SLA breach** derived at read + `workorder.sla_breached` on the ticker; completion with `partsUsed` validates + deducts inventory, resets asset maintenance, emits `workorder.completed`.
- **Assets + maintenance — ✅** (flag `field.inventory`): serialized assets with warranty + `maintenanceIntervalDays`; `maintenanceDue` derived at read, `asset.maintenance_due` on the ticker, `asset.maintenance_done` on logging.
- **Inventory — ✅**: SKU stock with reorder levels, `lowStock` derived, `inventory.received/consumed` moves (validation → 400), `inventory.reorder_triggered` on the ticker.
- **Offline sync — ✅**: `POST /api/field/sync` push/pull with **last-write-wins** conflict resolution (spec `docs/38-offline-sync-spec.md`).
- **Engine + UI — ✅**: `startFieldEngine` ticker (maintenance / SLA / reorder scans + `kind: field` notifications); **Field** page (`/field`, "Field ops" nav) — Overview / Territories / Visits & routes / Work orders / Assets & inventory. Verified live **69/69** (`verify-phase12.sh`) + Phase 10 (109/109) and Phase 11 (71/71) regression green.

See `docs/35-spec-phase12.md` + `docs/37-field-ops-guide.md` + `docs/38-offline-sync-spec.md` + `docs/36-phase12-build-report.md`.

## Phase 13 — Ecosystem ✅ **COMPLETE**

- **Marketplace — ✅** (flag `ecosystem.marketplace`, ADR-025): `MarketplaceListing` rows (app / agent / integration / template with slug, publisher, version, icon, `config` install payload). **Install applies the payload**: `config.agentTemplate` creates a Phase 9 agent (emits `agent.created` with `source: "marketplace"`), `config.webhookEvents` creates a webhook — `App` rows track installed/uninstalled + applied config, `app.installed` / `app.uninstalled` events, install-count rollups.
- **Partners & channel management — ✅** (flag `ecosystem.partners`): `PartnerAccount` (reseller / referral / technology / consultant, commission rate, active) with **deal registration** (`PartnerDeal`: registered → approved → won|lost; `opportunityId` optional link). Commissions **derived at read** (won × rate); `won` emits `partner.commission_earned`; pipeline value = registered/approved amounts.
- **Change sets + env promotion — ✅** (flag `ecosystem.changesets`): `ChangeSet` bundles `{ entity, op, key, data }` items (fieldDef / agent / featureFlag); **env diff** (`POST /api/ecosystem/changesets/diff`) proposes items automatically; **promote** replays them into a target environment (creates/updates/deletes, per-item errors recorded) and emits `changeset.promoted` — the ADR-008 env story gains schema/config promotion.
- **Schema change safety — ✅** (flag `ecosystem.schema`): **change-impact analysis** (`GET /api/ecosystem/schema/impact?objectType=&key=`) scans segments, workflows, agents, lead forms, reports, field permissions + stored record values; **safe delete** refuses fields in use (`Field is in use: N config reference(s), M record value(s)`) and emits `schema.field_deleted` with `via: "safe-delete"` (spec `docs/43-schema-change-safety.md`).
- **UI — ✅**: **Ecosystem** page (`/ecosystem`, new "Ecosystem" nav section) — Overview / Marketplace / Apps / Partners / Change sets / Schema tabs. Verified live **53/53** (`verify-phase13.sh`) + Phase 10 (109/109), Phase 11 (71/71), Phase 12 (69/69) regression green.

See `docs/39-spec-phase13.md` + `docs/41-developer-platform.md` + `docs/42-marketplace-publishing-guide.md` + `docs/43-schema-change-safety.md` + `docs/40-phase13-build-report.md`.

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
8. ~~**Phase 9**~~ — done (AI Agent Platform: declarative agents with risk-tiered actions, kill switches, dry-run testing lab, cost metering, AI audit trail, approval queue). Spec `docs/29-spec-phase9.md`, guide `docs/31-agent-governance-guide.md`, report `docs/30-phase9-build-report.md`.
9. ~~**Phase 10**~~ — done (Revenue Cloud: product catalog + price books + discounts, CPQ quote/order pricing, contracts + dunning, subscriptions + invoices + payments, derived MRR metrics with lineage). Verified **109/109** (`verify-phase10.sh`).
10. ~~**Phase 11**~~ — done (Customer Success, Retention & Expansion: success plans + milestones + QBRs, product usage intelligence with adoption-drop detection, explained churn prediction v2 + expansion radar, NPS/CSAT/CES with feedback → roadmap, loyalty/referrals). Spec `docs/32-spec-phase11.md`, guide `docs/34-customer-success-guide.md`, report `docs/33-phase11-build-report.md`.
11. ~~**Phase 12**~~ — done (Field Operations: territories, visits + GPS check-ins + route optimization, work orders + dispatch + SLA, serialized assets + maintenance, inventory + reorder levels, offline sync with conflict resolution). Spec `docs/35-spec-phase12.md`, guide `docs/37-field-ops-guide.md`, offline-sync spec `docs/38-offline-sync-spec.md`, report `docs/36-phase12-build-report.md`.
12. ~~**Phase 13**~~ — done (Ecosystem: app/agent marketplace with install payloads wired into the Phase 9 engine, partner & channel management with deal registration + derived commissions, change sets + env diff/promote, schema change-impact analysis + safe delete). Spec `docs/39-spec-phase13.md`, guides `docs/41-developer-platform.md` + `docs/42-marketplace-publishing-guide.md` + `docs/43-schema-change-safety.md`, report `docs/40-phase13-build-report.md`.
13. **Phase 14-lite** — Enterprise Security first slice (MFA + SCIM) — or Phase 15-lite (Business Brain / multi-agent orchestration groundwork).
