# 08 · Decision Log (ADRs)

> Architecture Decision Records — the "why" behind the choices in `docs/01-architecture.md`.
> When a future phase proposes a different approach, read the relevant ADR first.
> **Status legend:** Accepted (in use) · Superseded (replaced) · Draft (proposed).

## How to read

Each ADR: **Context** (what we were solving) → **Decision** (what we chose) → **Consequences** (what it costs us / enables) → **Status**.

## ADR list

| # | Decision | Status |
|---|---|---|
| ADR-001 | Express 5 + REST API-first | Accepted |
| ADR-002 | MongoDB 7 + Prisma 6 | Accepted |
| ADR-003 | Generic Object service instead of per-feature tables | Accepted |
| ADR-004 | Event bus persisted from Day 1 | Accepted |
| ADR-005 | Signed-cookie sessions now; DB sessions at Phase 14 | Accepted |
| ADR-006 | Record-level RBAC (`org`/`owner`) from Day 1 | Accepted |
| ADR-007 | FieldDef registry as the no-code builder v1 | Accepted |
| ADR-008 | Environment as a scoping field (not a separate DB) | Accepted |
| ADR-009 | Backups = snapshots + restore-to-sandbox | Accepted |
| ADR-005-A | OAuth (tokens + provider SSO) brought forward to Phase 0 | Accepted |
| ADR-006-A | Field-level permissions shipped in Phase 0 (not Phase 14) | Accepted |
| ADR-009-A | Scheduled snapshots + retention pruning added | Accepted |
| ADR-010 | Lead routing = admin-configured round-robin pool, explicit owner always wins | Accepted |
| ADR-011 | Duplicate merge = master/merge with per-field choices | Accepted |
| ADR-012 | Public lead forms = unauthenticated + honeypot + rate limit + no-leak dedupe | Accepted |
| ADR-013 | Multi-pipeline = `Pipeline`/`PipelineStage` models, lazily seeded default, pipeline-derived probability | Accepted |
| ADR-014 | Phase 2 comm providers are mocked; tracking endpoints are public + token-scoped | Accepted |
| ADR-015 | Workflows = declarative `Automation` rows consumed by an event-bus subscriber; actions act as the workflow's creator | Accepted |
| ADR-016 | Tickets = generic object + thin helpdesk wrapper; SLA policy rows with a lazy seed + read-time status; legal hold = hard lock | Accepted |
| ADR-017 | Campaigns/journeys = declarative rows consumed by engine subscribers; sends reuse the Phase-2 email path; journeys add a time ticker to the event bus | Accepted |
| ADR-018 | BI metrics are derived (computed on read, never stored) so data lineage is first-class; forecasts persist as snapshots; predictive v1 is transparent arithmetic | Accepted |
| ADR-019 | CDP = deterministic rule-based identity resolution (email is the canonical key) + behaviors that mirror the event bus + derived graph/health (explained) + full-tenant portability bundles | Accepted |
| ADR-020 | Phase 8 AI = non-agentic copilot: deterministic-first generators (explained, audited, human-in-the-loop) + a model router with a data-residency pin + a data firewall that redacts PII before the model + confidence flagging | Accepted |
| ADR-021 | Phase 9 AI agents = declarative `Agent` rows (trigger + rules + tool allowlist + per-tool risk tiers) consumed by an event-bus engine; risk-tiered actions (🟢 auto / 🟡 approval / 🔴 admin) with kill switches, a dry-run testing lab, simulated cost metering, and the run row as the full AI audit trail | Accepted |
| ADR-023 | Phase 11 Customer Success = plans/usage/churn/surveys/loyalty as scoped rows with derived-on-read, explained scores; the event-bus usage mirror + an engine ticker; the churn factor list IS the playbook; negative feedback promotes into the roadmap | Accepted |
| ADR-024 | Phase 12 Field Operations = the same row-as-config + evented + RBAC discipline applied to physical work: territories/technicians/visits/work orders/assets/inventory as scoped rows, derived SLA/maintenance/reorder flags with an engine ticker, and offline sync as one deterministic last-write-wins endpoint | Accepted |
| ADR-025 | Phase 13 Ecosystem = the extensibility loop as scoped rows + one engine: marketplace listings whose install payloads apply into the existing engines (agent templates → Phase 9 agents, webhook events → webhooks), partners with derived-on-read commissions, change sets that diff + replay config/schema across environments, and change-impact analysis that refuses unsafe field deletions | Accepted |

---

## ADR-001 · Express 5 + REST API-first

**Status:** Accepted

**Context:** The blueprint is API-first: REST + webhooks + OAuth, with every feature exposing endpoints and every AI/integration layer consuming them. The sibling CMS (`01-cms`) used TanStack Start (SSR), which fuses UI and server code. For a CRM that must serve integrations, webhook consumers, and future agents, the API surface needed to be first-class and independent of the UI. The Part-1 README also specified "Supabase Postgres + Cloudinary + Node/Express or similar".

**Decision:** Express 5 REST API as the single backend, serving a React 19 SPA (built with Vite) from the same process in production. All clients — the UI, webhooks, future SDKs, future AI agents — use the same `/api/*` surface.

**Consequences:**
- (+) API is directly consumable and testable with curl; webhooks and integrations need no UI.
- (+) One deployable unit (Express serves `dist/`), simple hosting story.
- (−) SSR is lost; the SPA does client-side rendering (fine for an internal CRM).
- (−) Two frontend/backend contexts to keep consistent (mitigated by `src/lib/objects.ts` mirroring the server registry).

## ADR-002 · MongoDB 7 + Prisma 6

**Status:** Accepted

**Context:** The blueprint requires custom fields on every object (the no-code builder is "core, not an add-on") and an object model that must not be rebuilt. The user chose to match the sibling CMS's database. Relational normalization (EAV or per-tenant columns) would fight the dynamic-field requirement.

**Decision:** MongoDB 7 via Prisma 6. Custom fields live in per-record JSON; field definitions live in a registry collection.

**Consequences:**
- (+) Documents map cleanly onto "object with custom fields"; no migration treadmill for new fields.
- (+) Single-node replica set in Docker works locally; Atlas is replica-set by default.
- (−) **No relations in Prisma-Mongo** — all joins are manual `*Id` refs resolved in the service layer (by design, mirrors the blueprint's generic Relationship model).
- (−) **No enums** — validated strings (registry.ts).
- (−) **No real migrations** — `prisma db push` only; schema changes need care with existing docs (adding non-nullable fields to collections with data will fail reads — drop/re-seed or make nullable).
- (−) Replica set is **mandatory** (Prisma transactions) — forgetting it gives cryptic `P2031`.
- (−) No `@updatedAt` — maintained manually where needed.

## ADR-003 · Generic Object service instead of per-feature tables

**Status:** Accepted

**Context:** Blueprint principle #1: "never hard-code tables per feature." Contacts, deals, tickets, invoices, custom objects must all behave identically (fields, permissions, events, workflows, audit).

**Decision:** One `createObjectService({ type })` factory in `lib/object-service.ts` provides list/get/create/update/remove for any registered type, handling validation, dedupe, events, and audit centrally. New types = Prisma model + `registry.ts` def + one `registerObject()` line + router mount. Object-specific behavior is declared (not coded): unique fields, pipeline stages, owner column.

**Consequences:**
- (+) Adding Phase 2+ objects (ticket, campaign, quote) is hours, not weeks.
- (+) Cross-cutting concerns (permissions, audit, events) can't be forgotten per-feature.
- (−) Exceptions need config hooks (e.g. `ownerField: "authorId"` for notes) rather than ad-hoc code.
- (−) The factory is the critical file — changes there ripple everywhere (mitigated by the smoke-test suite).

## ADR-004 · Event bus persisted from Day 1

**Status:** Accepted

**Context:** Blueprint principle #2: every state change emits an event that any workflow, AI agent, integration, or analytics pipeline can subscribe to. Retrofitting events after features exist is a rewrite.

**Decision:** `emitEvent()` in `lib/events.ts` is called by the service layer on every mutation. Events are (1) persisted to the `Event` collection, (2) fanned out to in-process subscribers (`onEvent(type, cb)`), (3) delivered to matching webhooks asynchronously with HMAC signatures and one retry.

**Consequences:**
- (+) Activity feed, audit history, webhooks, and the future Time Machine all read the same stream.
- (+) Later consumers can replay history — subscribe-then-read works.
- (−) Event payloads are untyped JSON — drift risk (mitigated by `docs/03-event-catalog.md` as the contract).
- (−) Every mutation pays a write + webhook scan (cheap at Phase-0–1 scale; revisit with queues at Phase 3+).

## ADR-005 · Signed-cookie sessions now; DB sessions at Phase 14

**Status:** Accepted

**Context:** Blueprint Phase 14 requires SSO, MFA, session/device management. Phases 0–1 only need "who is this user" with reasonable security.

**Decision:** HMAC-signed httpOnly cookies (`qorvexa.session`) containing `{id, orgId, email, name, role, exp}`. No server-side session table. `secure` flag set in production; the server refuses to boot with the default secret in production.

**Consequences:**
- (+) Zero session infrastructure; logout is stateless.
- (−) Role changes wait for the next `assertActiveUser()` DB check per request (fresh role is fetched, so revocations take effect immediately — good).
- (−) No device list/revocation — acceptable until Phase 14, where a `Session` model replaces the cookie payload.

## ADR-006 · Record-level RBAC (`org`/`owner`) from Day 1

**Status:** Accepted

**Context:** Blueprint principle #3: permissions are field/record-level from day 1, not bolted on. The object model touches every record, so access must be enforced in one place.

**Decision:** Roles (`admin`/`manager`/`rep`) + per-record `visibility` (`org`/`owner`), enforced centrally in `lib/access.ts`: `assertCanAccess()` on single-record ops, `listConditions()` on queries (ANDed with filters, never overwritten). Cross-tenant access returns 404 to avoid leaking existence.

**Consequences:**
- (+) One enforcement point; routes can't forget permissions.
- (+) Reps see org records + their own private ones (verified in smoke tests).
- (−) Field-level masks are not yet enforced (Phase 14) — but `FieldDef` rows are the natural attach point.

## ADR-007 · FieldDef registry as the no-code builder v1

**Status:** Accepted

**Context:** Blueprint principle #5: the no-code object builder is core. Building a full visual builder in Phase 0 was judged too risky (it's the hardest part of the plan, per the original analysis).

**Decision:** v1 = a `FieldDef` collection (key, label, type, required, options, order) + `POST/PATCH/DELETE /api/fields/:objectType` + dynamic form rendering in the UI. Validation happens in the service layer; unknown keys are dropped. The full drag-and-drop builder is Phase 13 scope.

**Consequences:**
- (+) Custom fields work end-to-end today (add → validate → render → search).
- (+) The registry is the seam where the Phase-13 visual builder plugs in.
- (−) No per-field permissions, no field-level visibility yet — deferred with a documented path.

---

## ADR-008 · Environment as a scoping field (not a separate DB)

**Status:** Accepted

**Context:** The blueprint requires sandbox/staging environments per org (Phase 0). Two ways to isolate: a per-record `environment` column scoped centrally, or a separate MongoDB database per environment (which needs Prisma client-per-env and manual promotion).

**Decision:** `environment` column (`production` | `sandbox`) on every data model, threaded through `lib/access.ts` (`listConditions` / `assertCanAccess`) exactly like `orgId`. The request header `X-Environment` selects it; the client persists the choice.

**Consequences:**
- (+) One DB, one client, one enforcement point — environment is just another `AND` clause.
- (+) Promotion is a plain document copy (no cross-DB plumbing).
- (−) Isolation quality depends on the central scoping discipline — requires a cross-env leak smoke test.
- (−) `db push` won't backfill existing docs; a one-off backfill script is required.

## ADR-009 · Backups = snapshots + restore-to-sandbox

**Status:** Accepted

**Context:** The blueprint lists backup/point-in-time recovery under Phase 0, but true point-in-time replay is the Phase-15 Time Machine. Restoring directly over production is the riskiest operation in a CRM.

**Decision:** Scheduled + manual `mongodump` archive snapshots; restore **always** lands in a fresh sandbox environment, never production. Event/audit history gives evidence of what changed since a snapshot.

**Consequences:**
- (+) Safe restore path by construction — you cannot clobber prod from the UI.
- (+) Snapshots are cheap to implement and understandable to ops.
- (−) No true point-in-time restore until Phase 15 (accepted; documented).

---

## Amendments (2026-08-10 — Phase 0 completion)

> The blueprint lists OAuth under Phase 0; the hardening spec (`docs/09`) and ADR-005 deferred it. On completion of Phase 0, the user chose to ship **both** OAuth shapes, so the deferrals below were lifted. Each amendment supersedes the corresponding deferral note in its base ADR.

## ADR-005-A · OAuth for integrations + provider SSO (brought forward)

**Status:** Accepted (supersedes ADR-005's "SSO at Phase 14" deferral)

**Context:** The blueprint requires OAuth under Phase 0. The user explicitly chose **both** shapes: machine-to-machine tokens *and* human provider sign-in.

**Decision:**
- **API tokens (`ApiToken`):** admins issue bearer tokens (sha256-hashed at rest, raw shown once) that act as a role (`admin|manager|rep`) and are scoped per request exactly like session users — `X-Environment` still applies, `read`-scope is rejected on non-GET methods. Used by integrations/scripts.
- **Provider SSO (`OAuth 2.0` authorization-code):** Google + GitHub. State in a short-lived httpOnly cookie, CSRF-checked at the callback; profile email must match an **existing** active user — SSO does **not** auto-provision accounts (registration stays email/password; documented limitation). `OAUTH_MOCK=1` (non-production) completes the flow as `admin@qorvexa.dev` for demos/tests.

**Consequences:**
- (+) Both blueprint OAuth shapes exist and are verified end-to-end.
- (−) No auto-provisioning — new users must be invited first (deliberate v1; SCIM comes with Phase 14).
- (−) No refresh-token rotation / PKCE yet (providers are called with `client_secret`; acceptable for Phase 0, revisit at Phase 14).
- (+) Signed cookies remain the session mechanism; OAuth only *creates* the same session cookie (ADR-005 core stands).

## ADR-006-A · Field-level permissions (brought forward)

**Status:** Accepted (supersedes ADR-006/ADR-007 "field perms at Phase 14" deferrals)

**Context:** Blueprint principle #3 requires field- *and* record-level permissions from day 1. `FieldDef` rows were the natural attach point and the record-level enforcement layer already existed.

**Decision:** `FieldPermission` rows (org × environment × object type × field key) with `readRoles` / `writeRoles` (empty = everyone; admin always passes). Read gating masks fields in list/detail responses **and** CSV exports; write gating rejects 403 on create/update. Enforcement lives in `lib/object-service.ts` (`splitFields` / `maskRow`) and `routes/export.ts` — the UI only reflects it. Changes emit `schema.field_permissions_updated` + audit rows.

**Consequences:**
- (+) Field- and record-level permissions both exist in Phase 0, per the blueprint.
- (+) One enforcement point — routes can't forget it.
- (−) Role-based only (no per-user overrides) — enough for Phase 0; fine-grained ACLs remain Phase 14.

## ADR-009-A · Scheduled snapshots + retention pruning

**Status:** Accepted (extends ADR-009)

**Context:** ADR-009 said "scheduled + manual"; the hardening pass shipped manual snapshots only. The blueprint's "never lose data" goal needs unattended coverage.

**Decision:** An in-process scheduler snapshots each org's production env `SNAPSHOT_INTERVAL_HOURS` (default 24h, first run 60s after boot) when the `backups` feature is enabled, then prunes archives older than `Organization.settings.backupRetentionDays` (default 30). Kill switch: `SNAPSHOTS_ENABLED=false`.

**Consequences:**
- (+) Unattended backups with a retention policy — no human dependency.
- (−) In-process `setInterval` — resets on deploy/restart and doesn't survive multi-instance hosting (fine for Phase 0; a queue-based cron lands with Phase 3 infrastructure).

---

## Amendments (2026-08-10 — Phase 1 completion)

> Phase 1 finishing shipped lead routing, the account-hierarchy UI, first-class segments, public lead-capture forms, and the duplicate-merge UI. The user chose **admin-authoritative routing with round-robin** and asked for the merge UI to be included.

## ADR-010 · Lead routing — admin round-robin pool, explicit owner wins

**Status:** Accepted

**Context:** New leads need an owner. The user chose: "full authority to admin whom he can assign, and also give all the algorithms required like round robin."

**Decision:** Routing config lives in `Organization.settings.leadRouting` (`{ mode: "manual" | "round-robin", pool, cursor }`). In `round-robin` mode the service's `assignOwner` hook cycles new leads through the pool's **active** users (inactive skipped), persisting the cursor so rotation survives restarts. Explicit `ownerId` on create **always** wins over routing (and does not consume a slot); PATCH `ownerId` reassigns at any time — both restricted to `admin`/`manager` (reps get 403; they receive routing or default to themselves). Owner changes emit `lead.routed` with `mode: "round-robin"` or `"manual"`.

**Consequences:**
- (+) Blueprint's "routing/territory" (Phase 1) exists in a simple, admin-controlled form; round-robin is the first algorithm, more plug in behind the same `assignOwner` hook.
- (+) Manual override is a first-class operation (audited + evented), not a DB edit.
- (−) No territory/rule-based routing yet — the hook is the extension point (Phase 12 field ops).

## ADR-011 · Duplicate merge — master/merge with per-field choices

**Status:** Accepted

**Context:** Import already merged by field; the user asked for a UI to merge two duplicate records directly.

**Decision:** `POST /api/merge` takes `{ objectType, masterId, mergeId, fieldChoices? }`. Non-conflicting fields come from the master unless `fieldChoices` picks the merge record's value; the merge record is deleted; `<type>.merged` (with `via: "records"`) + audit rows are written. The UI surfaces two selectable records on list pages with a per-field picker.

**Consequences:**
- (+) Destructive operation with an explicit, reviewable choice per field — no blind field-merge.
- (+) Same event family as import-merge (`via` disambiguates provenance).
- (−) Merge is pairwise v1; n-way dedupe workflows are Phase 7 CDP scope.

## ADR-012 · Public lead forms — unauthenticated by design, hardened

**Status:** Accepted

**Context:** Lead-capture forms must be embeddable on external sites — they cannot require a session. Abusers will find them.

**Decision:** Public endpoints (`GET/POST /api/public/forms/:slug`) are unauthenticated. Protections: a hidden honeypot field (`company_website`) that silently swallows bots, an in-memory per-IP rate limit (10/min), slug-scoped lookup, and duplicate-email handling that reports `{ ok: true, duplicate: true }` **without leaking whether the lead exists**. Submissions act as a system actor (the form id) in the org's production env, so org field-permission restrictions never block capture; created leads go through normal duplicate detection + routing.

**Consequences:**
- (+) Embeddable anywhere, works without auth, and abuse is mitigated cheaply.
- (−) In-memory rate limit resets on restart and is per-instance (fine for Phase 1; a shared limiter lands with Phase 3 infrastructure).
- (−) No CAPTCHA/email verification yet — revisit if spam volume demands it.

---

## Amendments (2026-08-11 — Phase 2-lite completion)

> Phase 2-lite shipped the multi-pipeline engine (pipeline CRUD + per-org config), the cheapest new capability on the roadmap — the registry already parameterized the pipeline, so this formalized it into first-class per-org data.

## ADR-013 · Multi-pipeline — Pipeline/PipelineStage models, lazily seeded default, pipeline-derived probability

**Status:** Accepted

**Context:** The blueprint (Phase 2) lists `Pipeline`/`PipelineStage` as entities and calls for a multi-pipeline engine (sales, renewal, expansion, partner, custom). The registry's static `PIPELINE` was already the pipeline source for deals — but it was global, not per-org, and stages couldn't be edited.

**Decision:**
- **Models:** `Pipeline` (org × environment, name, isDefault) with stages as a JSON array on the row (`PipelineStage` shape `{ key, label, probability, order }`) — MongoDB/no-relations convention (same collapse as `LeadForm.fields` / `Segment.criteria`).
- **Default seeding:** the org's **default** pipeline is lazily created from the static registry `PIPELINE` on first access (`ensureDefaultPipeline`) — existing orgs and new orgs both get a working "Sales" pipeline with zero migrations; the registry PIPELINE remains the fallback seed source, not a runtime authority.
- **Deals:** `Opportunity.pipelineId` (ObjectId, NULL = the org's default pipeline). The generic service gained a `resolveDeal` config hook (same pattern as Phase 1's `assignOwner`): it resolves pipeline (explicit → else default), validates the stage exists in that pipeline (400 otherwise), and **derives probability from the pipeline's stage definition** — the registry's `stageProbability()` is no longer consulted for deals.
- **Guards:** can't delete the default pipeline, the only pipeline, or one that still has deals.
- **Backfill:** `npm run backfill:pipeline` stamps pre-schema deals (missing `pipelineId` field) onto the default at the RAW level (`$runCommandRaw` + `$oid` — Prisma WHERE filters don't match missing fields, and `$oid` matches how Prisma stores ObjectIds).

**Consequences:**
- (+) Every org owns its pipeline shape; the deals board + form + dashboard all read from it (dashboard snapshot uses the default pipeline's stages).
- (+) `deal.pipeline_changed` (`{ from, to }`) is event-sourced for later forecasting/BI (Phase 6).
- (+) Probability consistency: a stage's number lives in one place (the pipeline), not duplicated in registry + seed + UI.
- (−) Stages are JSON, not a relational table — pipeline CRUD replaces the whole array (fine; atomic and simple at this scale).
- (−) Legacy deals need the backfill before pipeline-scoped filters show them (documented in `docs/05-api-reference.md` and the runbook).

---

## Amendments (2026-08-11 — Phase 2 completion)

> Phase 2 (Communication Core) shipped email (templates + send/sync/reply with
> tracking), calling, calendar/meetings, public booking pages, and the auto-logged
> record timeline. Real providers (SMTP, telephony) were intentionally mocked so
> every surface — data model, events, webhooks, timeline, UI — is fully
> exercisable without external accounts.

## ADR-014 · Phase 2 comm providers are mocked; tracking endpoints are public + token-scoped

**Status:** Accepted

**Context:** Phase 2 needs email sending, open/click tracking, inbox sync, and call
recording/transcription. Real providers require accounts, API keys, and callbacks
(SMTP credentials, telephony SDKs, webhook verification) that a local demo cannot
assume — and the blueprint's goal for this phase is the *behavior*, not the
vendor integration. Email recipients are also never logged in, so tracking needs
an unauthenticated surface without leaking tenant data.

**Decision:**
- **Mock providers behind one swap point** (`server/lib/comm.ts`): `EMAIL_MOCK=1`
  simulates send (row + tracking token), a per-org inbound queue for sync, and
  simulated replies. Call recording/transcription generate placeholder assets
  when the org setting `settings.calling.recording` is enabled. When a real
  provider lands, only these helpers change — storage, events, webhooks, and UI
  already use the real implementation.
- **Tracking endpoints are public by design** (`/api/t/px/:token`, `/api/t/click/:token`):
  security rests on an unguessable 24-byte per-message token; responses expose no
  org data (a 1×1 GIF and a scheme-validated 302 — `javascript:`/`data:` targets
  are rejected). First open/click emit `email.opened` / `email.clicked`;
  `openedCount` increments on every load.
- **Public booking follows the lead-form playbook** (ADR-012): no auth, honeypot
  (`company_name`) + per-IP rate limit (20/min), slot re-validation server-side
  to guard double-booking races.

**Consequences:**
- (+) Every Phase 2 surface is live and verifiable locally with zero external
  accounts — the demo tells the full story.
- (+) The provider seam is documented (`docs/14-communication-guide.md`); the
  swap to SMTP/telephony SDKs is localized.
- (−) Open/click rates and "deliverability" are simulated, not real — acceptable
  for this phase; the data model (status, timestamps, counts) is unchanged by
  the provider swap.
- (−) In-memory rate limits reset on restart (same accepted trade-off as ADR-012).

---

## Amendments (2026-08-12 — Phase 3 completion)

> Phase 3 (Automation & Workflow Engine) shipped the visual workflow builder over
> the event bus — trigger → condition → action — plus the reserved
> `task.completed` event, in-app notifications, a per-run action log, and
> duplicate-workflow detection. The full spec is `docs/15-spec-phase3.md`; the
> verification evidence is `docs/16-phase3-build-report.md`.

## ADR-015 · Workflows = declarative rows consumed by an event-bus subscriber

**Status:** Accepted

**Context:** The blueprint's Phase 3 needs a workflow engine where admins compose
"when X happens, if Y, do Z" without code. The event bus (ADR-004) is the stated
substrate — `onEvent(type, cb)` already fans every persisted event to in-process
subscribers. The design question was how workflows are *defined* and *executed*.

**Decision:**
- **Definition:** an `Automation` row (org × environment) holds the whole
  workflow as JSON: `trigger` (an event, optionally filtered, e.g.
  `deal.stage_changed → to: "won"`), `conditions` (field filters on the
  triggering record + `payload.*`), and `actions` (`create_task` / `notify` /
  `update_record`). Same philosophy as `Segment.criteria` (ADR-003): workflows
  are data, not code — no deploy per workflow.
- **Execution:** one engine subscriber (`onEvent("*")` in
  `server/lib/automations.ts`) matches events to active workflows for the
  org × environment, evaluates conditions in-process, and runs actions.
  `create_task` and `update_record` go **through the generic object service**
  (validation + audit + events for free); `notify` writes `Notification` rows.
- **Actor model:** actions act as the workflow's `createdBy` (an admin) with
  org-level privilege — a rep's field permissions never silently block or
  privilege an automation, and the audit trail names a real person. Each
  evaluation writes an `AutomationRun` row (matched or not, per-action
  outcomes) — the conflict-resolution surface.
- **Duplicate guard:** creating/updating a workflow whose normalized
  trigger+conditions+actions match another **active** one → 409 with
  `duplicateId` unless `allowDuplicate: true`.
- **Loop protection:** an in-memory cooldown skips repeat runs of the same
  `(automationId, entityId, eventType)` within 30s — an action's own emitted
  event (e.g. `update_record` → `deal.updated`) can never re-fire the same
  workflow endlessly.

**Consequences:**
- (+) Admins compose real automation without code; every execution is
  inspectable (run log + `automation.triggered`).
- (+) The event bus (ADR-004) finally has its flagship consumer — later phases
  (marketing journeys, agent triggers) reuse the same engine.
- (−) In-process evaluation is synchronous with the event: heavy workflows add
  latency to the triggering request. Accepted at Phase-0–3 scale; a queue
  worker + durable dedupe is the documented upgrade path.
- (−) Cooldown is in-memory (per instance, resets on restart) — fine for v1;
  a durable run-key lands with the queue worker.
- (−) Workflows can't act as non-admin users yet — the actor model is fixed to
  the creator. Per-action user impersonation is future scope.

---

## Amendments (2026-08-12 — Phase 4 completion)

> Phase 4 (Customer Service) shipped tickets as a first-class object type with
> SLAs, omnichannel intake (manual, email, and a public self-service portal),
> a knowledge base, and legal hold / e-discovery. The full spec is
> `docs/17-spec-phase4.md`; the verification evidence is
> `docs/18-phase4-build-report.md`.

## ADR-016 · Tickets = generic object + thin helpdesk wrapper; SLA policy rows with a lazy seed; legal hold = hard lock

**Status:** Accepted

**Context:** The blueprint's Phase 4 needs tickets/cases with SLAs, omnichannel
intake, a knowledge base, a self-service portal, and legal hold. Principle #1
(ADR-003) says never hard-code a table per feature — a ticket should behave
exactly like a deal (CRUD, audit, events, search, custom fields, workflows). But
a helpdesk has service-specific behavior the generic engine must not absorb:
per-org reference numbers, SLA deadlines, reply threads, legal hold, and intake
that acts on behalf of unauthenticated customers.

**Decision:**
- **Tickets are a generic object.** `Ticket` registered in `registry.ts` with
  `eventPrefix: "ticket"` → the generic service emits `ticket.created` /
  `updated` / `deleted` / `status_changed`, and audits every mutation. The thin
  wrapper (`routes/tickets.ts`) layers the helpdesk surface on top: `TKT-####`
  references, queue counts, replies (`TicketReply` rows with an `internal`
  flag), assignment, escalation, legal hold, email intake, and
  convert-to-lead. Same shape as lead forms (public-leads.ts) and booking.
- **SLAs are policy rows.** `SlaPolicy` (org × environment, `targets` JSON)
  lazily seeded with defaults (`urgent 1h / high 4h / medium 8h / low 24h`).
  Create sets `slaDueAt` = now + `responseHoursFor(priority)`; read-time
  `slaStatus` is always computed from the clock (never stored, so it can't go
  stale); an admin-triggered **breach sweep** persists `breachedAt`, emits
  `ticket.sla_breached`, and auto-escalates high/urgent breaches. Priority
  changes restart the clock; resolution sets `resolvedAt` + `firstResponseAt`.
- **Public intake follows the ADR-012 playbook.** The portal is an
  unauthenticated surface guarded by a honeypot + per-IP rate limit, with a
  **no-leak status lookup** — email + reference must both match, else a generic
  "not found"; only non-internal replies are ever exposed. Submissions act as
  the portal page's id (a system actor), so org field permissions never block
  capture; contacts are auto-created/linked by email (`autoCreateContact`).
- **Legal hold is a hard lock.** Admin-only toggle. While held: the generic
  PATCH is blocked for non-admins (only an admin can lift the hold), and
  delete/reply/assign/escalate are blocked for everyone.
- **`slaDueAt` normalization lives in the wrapper.** The generic service stores
  raw values; a string `slaDueAt` would be stored as a string and Mongo `$lt`
  (Date) comparisons in the sweep would never match it. The PATCH wrapper
  converts to a `Date` before the service writes (same discipline as
  `merge.ts`'s `validateFieldValue`).

**Consequences:**
- (+) Tickets get audit, events, search, custom fields, and workflow automation
  (Phase 3 triggers `ticket.created` / `status_changed` / `escalated`) for free
  — the generic engine earned its keep on a second object family.
- (+) SLA status can never show a stale "on track" — it's derived from the
  clock, and the sweep is the durable breach record.
- (−) The sweep is admin-triggered (in-process), not a background scheduler —
  at Phase-0–4 scale that's fine; a queue worker + cron lands with Phase 3+
  infrastructure upgrades.
- (−) Priority-change restarts the SLA clock (documented v1 semantics) — no
  partial-credit model yet.
- (−) Reply threads are `TicketReply` rows joined by `ticketId`, not an
  embedded array — consistent with the repo's no-relations convention
  (ADR-002), but list-reads are two queries.

---

## Amendments (2026-08-12 — Phase 5 completion)

> Phase 5 (Marketing Automation & Journey Orchestration) shipped campaigns
> (send-to-segment with A/B subjects, open/click tracking rollup, attribution /
> ROI), landing pages + public form capture, the journey orchestration engine
> (event → wait → action with a ticker), and deliverability monitoring. The full
> spec is `docs/19-spec-phase5.md`; the verification evidence is
> `docs/20-phase5-build-report.md`.

## ADR-017 · Campaigns/journeys = declarative rows consumed by engine subscribers; journeys add time to the event bus

**Status:** Accepted

**Context:** The blueprint's Phase 5 needs campaigns, landing pages, and customer
journeys — full-funnel marketing without a separate tool. The platform already
had the ingredients: dynamic segments (Phase 1) are the audience definition, the
Phase-2 email path (tracking token, `email.sent`/open/click events) is the send
pipeline, and the Phase-3 workflow engine proved the "declarative row consumed by
an event-bus subscriber" pattern. The design questions were how campaigns send,
how journeys differ from workflows, and how public capture stays safe.

**Decision:**
- **Definition:** `Campaign` and `Journey` are declarative rows (org ×
  environment), same philosophy as `Automation` (ADR-015) and `Segment.criteria`
  (ADR-003) — data, not code; no deploy per campaign/journey. A campaign holds
  subject/body + A/B config + an `audienceSegmentId`; a journey holds a trigger
  (an event, or a segment) and an ordered step list.
- **Sending reuses the Phase-2 email path.** `sendCampaign` resolves the
  audience from the segment (org + environment scoped, snapshot at send time),
  splits A/B, and writes one `Message` row per recipient (tracking token,
  `email.sent`) plus a `CampaignRecipient` link with the variant + open/click
  state. Stats/ROI are computed on read from recipient rows (never stale);
  attribution v1 = sum of `won` deal amounts on recipient contacts; landing
  submissions tag `Lead.campaignId` (a core field) for attribution.
- **Journeys = workflows + time.** The engine subscribes to the event bus like
  workflows but adds a **ticker**: `wait` steps flip an enrollment to `waiting`
  with a `nextRunAt`, and a 60s in-process pass advances due enrollments. Every
  step executes through the same helpers as workflows (generic object service
  for create_task/update_record, the email path, Notification rows) and logs a
  `JourneyStepRun` — the journey's run log. Loop guard: one active enrollment
  per (journey, entity); the ticker claims each due enrollment with a
  conditional update before advancing, so concurrent passes can't double-run a
  step. An admin `POST /api/journeys/advance` runs a manual pass (deterministic
  tests); `POST :id/test` runs synchronously against a real contact.
- **Public capture follows the ADR-012 playbook.** Landing pages are
  unauthenticated: honeypot + per-IP rate limit, no-leak duplicates, and
  `form.submitted` emitted **only when a lead is created** (the workflow/journey
  engines must never fire against an empty entityId). Landing slugs are
  **globally unique** — the public router is org-blind, so a per-org check would
  let a second tenant shadow a page (same rule as Phase 4 portals).
- **Deliverability is derived + simulated.** Metrics compute from `Message` rows
  in the current environment (never stale); provider events (bounce /
  unsubscribe / complaint) are simulated via an admin endpoint (ADR-014).

**Consequences:**
- (+) Campaigns and journeys compose real marketing without code; every send
  and every journey step is inspectable (recipients, run log, events).
- (+) The event bus now feeds a second engine family — later phases (agent
  triggers, BI attribution) reuse the same row+subscriber pattern.
- (−) Audience size is capped at 1 000 recipients per send (v1 snapshot
  pagination); segmented sends beyond that need a queue worker.
- (−) Ticker + cooldowns are in-memory (per instance, resets on restart) — fine
  for v1; durable scheduling lands with the documented queue-worker upgrade.
- (−) Attribution is first-touch-ish (won deals on recipient contacts) — no
  multi-touch credit model yet; the `CampaignRecipient` links make that a data
  question, not a rewrite.

---

## Amendments (2026-08-12 — Phase 6 completion)

> Phase 6 (Analytics, Forecasting & BI) shipped the metrics library with
> **data lineage**, five dashboard kinds, the weighted forecast + snapshot
> history, predictive v1 (conversion / churn / LTV), the report builder, and
> metric thresholds (`metric.threshold_breached` + admin notifications). The
> full spec is `docs/21-spec-phase6.md`; the verification evidence is
> `docs/22-phase6-build-report.md`.

## ADR-018 · Metrics are derived (computed on read) so lineage is first-class; forecasts persist as snapshots; predictive v1 is transparent arithmetic

**Status:** Accepted

**Context:** The blueprint's Phase 6 needs dashboards, a standard metrics
library (win rate, sales velocity, CAC/LTV, churn…), sales forecasting, and
predictive analytics v1 — "replace spreadsheets for reporting". The platform
already computes dashboard stats on read, the event log (ADR-004) records
every state change, and pipeline stages carry the probabilities a weighted
forecast needs. The design questions were whether metrics are stored or
derived, what gets persisted, and how "predictive" stays honest.

**Decision:**
- **Metrics are derived, never stored.** Every metric is computed on read
  from live rows + the event log (same discipline as Phase-5 stats). Because
  the number is *produced* by a query, that query IS the lineage: each metric
  carries `sources: [{ entity, query, note }]` describing exactly which
  rows/events produced it — data lineage for free, impossible with a stored
  metric (a stored number can't explain itself). The Analytics UI renders the
  lineage per metric; `GET /api/analytics/sources` is the dictionary.
- **The only persisted Phase-6 artifacts are `Forecast` snapshots and
  `Report` configs.** An admin refresh writes one `Forecast` row (buckets +
  per-stage + per-owner JSON) that doubles as history; `Report` rows are
  saved dashboard configs (`kind` + `keys`) whose `data` endpoint renders
  LIVE metrics — a report can never go stale because nothing in it is stored.
- **Forecasting = the weighted pipeline.** `pipeline` (raw open amounts),
  `weighted` (Σ amount × pipeline-derived probability), `commit` (≥75%),
  `bestCase` (≥50%) — bucketed and rolled per owner. Same source of truth as
  the dashboard and the deals board (the pipeline's stage definitions).
- **Predictive v1 is transparent arithmetic** with documented inputs and a
  score formula — no black box. Conversion likelihood from stage probability
  + amount vs org average + age; churn from inactivity (60d grace) + open
  tickets + no open deals; LTV from won amounts ÷ account contacts × a
  configured lifetime multiplier. Every score returns its `inputs` breakdown
  for the UI to show.
- **Thresholds evaluate at refresh time.** The admin action that snapshots
  the forecast also checks the org's configured thresholds (winRate /
  pipelineCoverage / campaignsOpenRate / slaHealth) against the current
  metrics; breaches write admin notifications + emit
  `metric.threshold_breached`.

**Consequences:**
- (+) Lineage is structurally guaranteed — every displayed number can answer
  "where does this come from?".
- (+) Reports and dashboard numbers can never be stale; forecast history is
  the durable record (the Phase 6-lite "weighted forecasts are ready to
  compute" substrate, formalized).
- (−) Derived metrics pay query cost on every read — fine at Phase-0–6 scale;
  a precompute/materialization layer is the documented scale-up path.
- (−) Snapshot history only exists where admins refresh; no automatic
  scheduling yet (same in-process-limitations trade-off as ADR-009-A /
  ADR-017 — a queue worker + cron is the shared upgrade path).
- (−) Predictive v1 is heuristic arithmetic, not fitted models — intentional
  (explainable + no training data), with the formula surfaced in the UI so
  nobody mistakes it for ML.

---

---

## Amendments (2026-08-12 — Phase 7 completion)

> Phase 7 (CDP / Customer 360) shipped deterministic identity resolution
> (unified `IdentityProfile`s over contacts + leads), behavioral event tracking
> (API ingest + an event-bus mirror), the customer 360 view, a derived
> relationship graph with influence scoring, an explained health engine with
> snapshot history, and the 🆕 right-to-portability full-tenant export. The
> full spec is `docs/23-spec-phase7.md`; the identity rules / graph schema /
> health formula are in `docs/25-cdp-guide.md`; the verification evidence is
> `docs/24-phase7-build-report.md`.

## ADR-019 · CDP = deterministic identity resolution + behaviors that mirror the event bus + derived graph/health + portability bundles

**Status:** Accepted

**Context:** The blueprint's Phase 7 needs identity resolution, real-time
profiles, behavioral tracking, a relationship graph, a customer health engine,
and right-to-portability export. The platform already has the raw material:
every contact/lead carries email + phone + name, and the event bus (ADR-004)
persists every touchpoint (`email.opened`, `form.submitted`, `ticket.created`,
`call.completed`, `meeting.completed`). The design questions were how identity
resolution stays honest without ML, how behaviors get collected without
instrumenting every source, and what gets persisted vs derived.

**Decision:**
- **Identity resolution v1 is deterministic and rule-based.** Email is the
  canonical key (lowercased, unique per org × env); phone + name+company are
  secondary rules surfaced through the merge flow, never auto-merged without
  email evidence. Records attach to a profile on creation (the CDP engine
  subscribes to `contact.created`/`lead.created`); two records under one
  profile = one identity → `customer.identity_merged` with lineage. Admin
  `rebuild` reconciles everything idempotently; admin `merge` moves members +
  behaviors + health history and records `mergedFromIds`. No ML, no vendor:
  every merge is explainable and auditable (Phase 8/9 AI owns fuzzy matching).
- **Behaviors are a separate collection that MIRRORS the event bus.**
  `BehaviorEvent` (type, profileId, entity, value, meta, source) records what
  the *customer* did across web/product/purchase/support/ads — distinct from
  the system `Event` log. Two ingestion paths: an authenticated API
  (`POST /api/cdp/behaviors` — websites/products) and a boot subscriber that
  mirrors selected system events (email.open/click/reply, form.submitted,
  ticket.created, call/meeting.completed) by resolving the record row — no
  code at the source, no double-send (the automation/journey engine pattern).
- **The relationship graph and health are DERIVED on read** (ADR-018
  discipline) and every number explains itself. Influence = weighted real
  touchpoints (email 1–4, call 3, meeting 5, ticket 2, primary +10, cap 100).
  Health = engagement(40) + support(25) + revenue(25) + recency(10), with
  churnRisk = 100 − score; each component returns its raw inputs + formula.
  The only persisted artifacts are `HealthScore` snapshots (history + deltas,
  written by an admin refresh that emits `customer.health_changed` /
  `customer.churn_risk_changed`) and `PortabilityExport` rows.
- **Portability is a full-tenant bundle** (🆕 blueprint item): one admin click
  builds a single downloadable JSON with EVERY org × environment collection
  (objects, comms, tickets, marketing, analytics, CDP rows, plus `Event` +
  `AuditLog`), written under `backups/portability/` with a tracking row;
  staff users are included minus password hashes. Downloads stream the file;
  DELETE purges row + file (path-traversal-safe).

**Consequences:**
- (+) Identity merges are explainable and auditable end-to-end (rules +
  events + lineage) — the trust mechanism for the whole CDP.
- (+) Touchpoint coverage is complete by construction (the event bus is the
  source of truth) instead of per-integration instrumentation.
- (+) Graph + health can't go stale and are self-documenting (inputs +
  formula in every response); the 360 UI shows exactly why a customer scores
  what they do.
- (+) GDPR-shaped portability with a real download/purge lifecycle.
- (−) No ML resolution / device-ID stitching — anonymous records are tracked
  but not unified (deferred to Phase 8/9, documented).
- (−) Health snapshots only persist on admin refresh (same in-process
  limitation as ADR-009-A / ADR-017 / ADR-018; the queue-worker + cron
  upgrade path is shared).
- (−) The 360 view runs several queries per profile — fine at demo scale; a
  materialized profile store is the documented scale-up path.
- (−) Also fixed during verification: the Phase-5 campaign A/B split treated
  `splitA` (a 0–100 **percentage**) as an absolute index cutoff, so variant B
  never appeared for audiences smaller than `splitA` — now
  `index/audience.length × 100 ≥ splitA` (the same drive-by-fix spirit as the
  Phase-5 segment `in/not_in` fix).

---

## ADR-020 · Phase 8 AI = non-agentic copilot: deterministic-first generators + model router + data firewall + confidence flagging

**Status:** Accepted

**Context:** The blueprint's Phase 8 is the "AI Assistant Layer (Non-Agentic
AI)": AI email/summary/report writing, call & meeting summarization, semantic
search, AI scoring, explainability, and (🆕) confidence scoring, a data
firewall, and a model router. The blueprint is explicit that Phase 8 is a
**copilot** — it suggests; it does not act. Phases 1–7 already produced a rich
substrate: real event/audit history, unified customer profiles (Phase 7), and
explained health/graph data — the exact context an assistant needs.

**Decision:**

1. **Non-agentic, human-in-the-loop.** Every AI capability is a read-only
   generator returning an **explained, audited, reversible suggestion** —
   nothing writes to the CRM without a human clicking. Agentic autonomy is
   Phase 9+ (where the governance model in `docs/04-permissions.md` applies).
2. **Deterministic-first models.** Routing, scoring, sentiment, intent, and
   semantic search are transparent arithmetic/keyword rules so every output
   ships its inputs + reasons (the ADR-018 discipline applied to AI). The
   model-router layer is where a real LLM provider plugs in later **without
   changing the API contract** — `runAi` already returns `{ insight,
   decision }` with model + latency metadata.
3. **Model router = data + policy.** `ModelRoute` rows (catalog) + an
   org-configurable policy (`defaultModel`, `preference: cost|quality|latency`,
   `preferredRegion`). `preferredRegion: "eu"` pins routing to the EU-resident
   model — the 🆕 data-residency-aware routing item, fulfilled without
   multi-region hosting because the pin is a routing rule. Every decision is
   explainable (`{ picked, reason, candidates }`).
4. **Every prompt is server-built and firewalled.** The context for every
   generator is assembled server-side and passed through `redactContext`
   **before the model sees it**; the redaction log rides in the insight and is
   rendered in the UI. PII never leaves the tenant boundary except as the
   caller already authorized (a real provider integration keeps this contract).
5. **Everything is audited.** `AIInsight` rows + `ai.*` events make every AI
   output a first-class, searchable, deletable record — the explainability and
   audit-trail requirements in one mechanism. `AIInsight` also carries the
   router decision's model + latency so cost/quality is reviewable.
6. **Confidence is a first-class output.** Every generator computes confidence
   0–100; below threshold → `lowConfidence` + `ai.confidence_flagged` +
   an admin notification (kind `ai`) — the same alerting pattern as Phase 6
   metric thresholds, so the header bell surfaces risk without polling.

**Consequences:**
- (+) Every AI output is explainable + auditable + deletable; no black box.
- (+) Real LLM providers slot in behind the router/firewall without API churn.
- (+) Data-residency routing shipped as a config rule, not infrastructure.
- (−) Deterministic-first means the "AI" is bounded by its rule tables — the
  deliberate trade for explainability; ML scoring is Phase 9+.
- (−) Firewall redaction is regex + allowlist-based (robust at this scale;
  a provider-side PII scrubber is the documented upgrade path).
- (−) Memory is in-process row storage with TTL — fine at demo scale; a
  vector store is the documented scale-up path (Phase 9 groundwork).

---

## ADR-021 · Phase 9 AI agents = governed autonomous actions (declarative rows + risk tiers + kill switch + testing lab + metering)

**Status:** Accepted

**Context:** Phase 8 shipped the non-agentic copilot. The blueprint's Phase 9
("AI performs work, not just suggests it") adds autonomy, but autonomy without
rails is how a CRM hurts a customer. The governance model was already
codified in `docs/04-permissions.md` (🟢 automatic / 🟡 approval required / 🔴
human required — blueprint §3.4), and the Phase 8 router + data firewall +
insight audit trail established the context pipeline. The questions were:
how are agents defined (code vs data), how is the tier table enforced, and
how do the 🆕 kill switch, testing lab, and cost metering become real.

**Decision:**

1. **Agents are declarative rows, not code** — the ADR-015/017 pattern
   (like `Automation` / `Journey`): `Agent { trigger, rules, tools, tierPolicy,
   memoryEnabled, active, killSwitched }`, consumed by one event-bus engine
   (`startAgentEngine` — `onEvent("*")` like workflows) + a manual/test
   endpoint. The engine is the only code; an admin edits rows via `/api/agents`.
   Governance composes with RBAC (config writes admin-only) instead of
   replacing it.
2. **The tool allowlist + tier table are the safety boundary** — actions
   whose tool isn't on the agent's `tools` list are filtered before the run;
   per-agent `tierPolicy` overrides the default table (`send_email` /
   `update_record` default 🟡; `create_task`/`notify`/`create_ticket` 🟢).
   🟢 executes in-run through the generic object service (audit + events for
   free); 🟡 persists `proposed` → admin/manager approval; 🔴 is admin-only
   and never automatic.
3. **Deterministic, explainable deciders** — per-kind rule tables (lead /
   sales / service / renewal / custom) return `{ actions, reasoning }`;
   every proposal carries an English reason. Same ADR-020 trade as Phase 8:
   a real LLM planner slots in behind the same firewall + audit trail.
4. **The run row IS the audit trail** — `AgentRun` (firewalled context,
   reasoning, riskSummary, cost, status) + `AgentAction` rows (tool, tier,
   params, reason, result, approvedBy) + the `agent.*` event lifecycle.
5. **Safety rails ship with the autonomy** — the org-wide + per-agent kill
   switches (checked before every run, event or manual), the dry-run testing
   lab (`passed` / `blocked`), the approval queue (push-notified), and
   simulated cost metering (tokens × cheapest `ModelRoute` price) are
   first-class features of the phase, not add-ons.

**Consequences:**
- (+) Autonomy is auditable end-to-end and stoppable in one click — the
  governance table is enforced mechanically, not by convention.
- (+) Agents reuse the object model + event bus + Phase 8 firewall/router,
  so later phases (multi-agent orchestration, marketplace, Business Brain)
  build on the same substrate.
- (−) Deciders are bounded by rule tables until a real planner lands (the
  documented Phase 15 path); planning quality is deliberately traded for
  explainability, same as ADR-020.
- (−) Cost metering is simulated dollars against catalog prices — real
  token billing arrives with real model providers / the usage-billing phase.
- (−) Agent memory is per-entity TTL rows at demo scale; a vector store is
  the documented scale-up path (ADR-020).

---

## ADR-023 · Phase 11 Customer Success = derived, explained, evented (plans as rows + usage mirror + churn factor list as playbook + feedback → roadmap)

**Status:** Accepted

**Context:** Phase 7 shipped the health engine (an explained 0–100 score per
account) and Phase 10 the Revenue Cloud (subscriptions, invoices, dunning).
The blueprint's Phase 11 adds the customer-success operating loop — plans,
usage intelligence, churn v2, surveys, loyalty. The questions were: where does
product-usage data come from, how is churn scored without a black box, and
how do "listen to customers" and "reward advocates" stay composable with the
event bus + RBAC + environment scoping the platform already has.

**Decision:**

1. **Plans/usage/churn/surveys/loyalty are scoped rows, not code** — the
   ADR-015/017/021 pattern: `SuccessPlan`, `UsageEvent`, `Survey`(+`Response`),
   `RoadmapItem`, `LoyaltyProgram`/`LoyaltyMember`/`ReferralRecord`, and
   `ChurnScore` are Prisma models keyed by `orgId` + `environment` (ADR-008),
   consumed by one engine (`startSuccessEngine` — `onEvent("*")` + a ticker,
   like workflows/journeys/agents) and a REST surface. Reads open, writes
   admin/manager, every area feature-flagged (`cs.plans` … `cs.loyalty`).
2. **Usage has two ingestion paths — an API and an event-bus mirror** —
   `POST /api/success/usage` (the product posts telemetry) plus the engine
   mapping system events → feature usage (`meeting.completed` → meetings,
   `email.sent` → email, …), the exact Phase 7 CDP mirror pattern. One
   `UsageEvent` row serves feature adoption, seat utilization, and inactivity
   — no separate per-signal tables.
3. **Churn v2 is derived at read and explained; the factor list IS the
   playbook** — the score is computed from five signal groups (Phase 7 health,
   usage trend/inactivity, support burden, billing health, survey sentiment)
   with per-factor `{ key, label, impact, detail }`; a refresh (or the ticker)
   persists `ChurnScore` snapshots under one `refreshId`, and only tier
   *escalations* emit `churn.risk_scored` (no steady-state noise). Same
   ADR-020 trade as AI: a learned model slots in behind the same interface
   later; today every number is auditable arithmetic.
4. **Survey results are computed at read with lineage** (NPS =
   %promoters − %detractors, formula attached — the ADR-018 discipline) and
   **negative feedback promotes into the roadmap** (`RoadmapItem` with votes)
   — the blueprint's feedback → roadmap pipeline is a first-class row flow,
   not a manual copy-paste chore.
5. **Loyalty tiers are derived, referrals are evented** — tier = highest
   `tier.minPoints` ≤ points at read; `converted` referrals award the referrer
   (`loyalty.points_awarded`) and the engine ticker can detect conversion.

**Consequences:**
- (+) The success loop composes with what exists: health (Phase 7), billing
  (Phase 10), events + notifications + RBAC + environments all reused; the
  Success page and the bell surface the same stream (adoption drops, churn
  escalations, referral conversions → `kind: "cs"` notifications).
- (+) Explained scores + snapshots give the UI history and the CSM a
  playbook, not a number.
- (−) Sentiment + churn v2 are keyword/arithmetic models (ADR-020 discipline)
  until real NLU/ML lands — bounded, transparent, and upgradeable.
- (−) Usage events only exist where the product posts them or the mirror
  covers the event; deep product instrumentation is a Phase 12+ concern.
- (−) Loyalty rewards are config + points, not a redemption/fulfillment flow;
  that's a later slice (spec §3).

---

## ADR-024 · Phase 12 Field Operations = the same discipline applied to physical work (rows + events + derived flags + one sync contract)

**Status:** Accepted

**Context:** The blueprint's Phase 12 supports physical/field-based
businesses: territory management, route/visit planning with GPS check-ins,
offline mode, field service (work orders, dispatch, technician scheduling),
and inventory & asset management. Everything prior was desk work (pipeline,
tickets, campaigns, success plans); field work adds two genuinely new
problems the platform hadn't faced — **location** (where is the technician,
what order should they visit) and **disconnected operation** (a field app
cannot wait for the network). The questions were: how do territories/work/
assets stay composable with the event bus + RBAC + environment scoping, and
how does offline sync resolve conflicts without a central coordinator.

**Decision:**

1. **Field entities are scoped rows, not code** — the ADR-015/017/021/023
   pattern: `Territory`, `Technician`, `Visit`, `WorkOrder`, `Asset`, and
   `InventoryItem` are Prisma models keyed by `orgId` + `environment`
   (ADR-008), consumed by one engine (`startFieldEngine` — a ticker, like the
   success engine) and a REST surface. Reads open (planning surface), config
   writes admin/manager, **field-worker ops open to reps** (a technician must
   be able to move their own visit/work order from the field), every area
   feature-flagged (`field.territories` … `field.inventory`).
2. **State changes are evented; statuses are derived at read** — the visit
   lifecycle (`visit.checked_in` with GPS), work-order dispatch/complete
   (`workorder.dispatched/completed`), asset maintenance
   (`asset.maintenance_due/done`), and inventory moves
   (`inventory.received/consumed/reorder_triggered`) all write `Event` rows;
   SLA breach, maintenance-due, and low-stock are computed at read time and
   the ticker events them once per cycle (the Phase 11 success-engine
   pattern). Parts consumption validates stock before any deduction so a
   failed completion never half-consumes.
3. **Route planning is deterministic and explainable v1** — greedy
   nearest-neighbor from the technician's last reported GPS position with
   haversine distances, ties by `scheduledAt`. Not a real optimizer; the
   endpoint is the slot where one lands later (same ADR-020 discipline:
   transparent arithmetic now, better model later).
4. **Offline sync is ONE deterministic endpoint with last-write-wins** —
   `POST /api/field/sync` pushes the client's queued `{ entity, op, data,
   clientTs }` operations and pulls everything newer than `since`. A change
   applies when `clientTs` > the row's `updatedAt`; losers return as
   `conflicts` with reasons — **never silently dropped**. LWW is chosen over
   merge/CRDT machinery because field data is low-contention (one technician
   owns a visit) and the trade is documented, auditable (every applied change
   emits `<entity>.synced`), and simple for a mobile client to implement.

**Consequences:**
- (+) The field loop composes with the platform: accounts/contacts are visit
  targets, work orders consume Phase-10-style catalog inventory, notifications
  (kind `field`) reuse the bell, environments sandbox field routing.
- (+) Every state change is reconstructable from the event log, and every
  status flag (SLA/maintenance/low-stock) is derived — no drift between the
  stored state and the displayed truth.
- (−) Route v1 ignores travel time windows and multi-technician balancing;
  offline sync is LWW, so a genuinely concurrent edit of the same row loses
  one side by design (the conflict entry surfaces it, the client UX owns the
  resolution).
- (−) GPS is check-in-only (no continuous position streams, no geofencing)
  and inventory is quantity-level (no per-serial bin tracking) — both are
  documented Phase 12+ extension paths (spec §3).

---

## ADR-025 · Phase 13 Ecosystem = the extensibility loop as rows + one engine (marketplace installs apply into existing engines, derived partner commissions, change sets for env promotion, change-impact analysis)

**Status:** Accepted

**Context:** The blueprint's Phase 13 makes the platform extensible: an
app/agent marketplace, partner & channel management, and the no-code/low-code
builder layer. The interesting architectural questions were not UI — they
were (1) what does "installing an app" actually DO in this codebase, (2) how
is partner commission computed without a payments ledger, and (3) how does
schema/config change safely between environments when records already can
(ADR-008 `env.promote`).

**Decision:**

1. **Marketplace entities are scoped rows; installs apply payloads into the
   EXISTING engines** — `MarketplaceListing` (kind: app | agent | integration
   | template) carries a `config` install payload that `installApp` applies
   with zero marketplace-specific machinery: `config.agentTemplate` creates a
   Phase 9 `Agent` through the same template registry the seed uses (the
   agent then runs on the Phase 9 engine), `config.webhookEvents` creates a
   `Webhook` (Phase 0 dispatcher). `App` rows record installed/uninstalled +
   what was applied. This is the ADR-015/017/021/023/024 row-as-config
   pattern applied to extensibility itself: the marketplace is data, and the
   only code is `lib/ecosystem.ts`.
2. **Partner commissions are derived at read, never stored** — a won
   `PartnerDeal` computes commission = `amount × commissionRate` on read;
   the `partner.commission_earned` event fires on the won transition for
   audit/notifications but the number itself is always recomputed (ADR-018
   discipline — no drift, no reconciliation step). Deal registration
   (`opportunityId` optional) lets partners precede the CRM deal.
3. **Change sets make the ADR-008 environment story cover CONFIG, not just
   records** — a `ChangeSet` is a bundle of `{ entity, op, key, data }`
   items over the config surface (fieldDef, agent, featureFlag). `diff`
   proposes items by comparing two environments; `promote` replays them
   (create/update/delete, per-item errors recorded, `changeset.promoted`
   evented). Promote is deterministic and replayable — the same discipline
   as `env.promote` but for schema/config instead of records.
4. **Schema deletion is a governed operation, not a footgun** —
   `fieldImpact` scans every config surface that can reference a custom
   field (segments, workflows, agents, lead forms, reports, field
   permissions) plus stored record values; `safeDeleteField` refuses a field
   in use and emits `schema.field_deleted` (`via: "safe-delete"`). This
   closes the loop on the Phase 0 custom-field registry (ADR-003): fields
   are now safe to CREATE and safe to REMOVE.

**Consequences:**
- (+) Install is auditable end-to-end (`app.installed` + whatever the payload
  created, e.g. `agent.created` with `source: "marketplace"`), and later
  marketplace features (versioned installs, upgrade paths, a public
  cross-tenant catalog) build on the same rows.
- (+) Commissions and change sets compose with what exists: partner deals
  can link to real opportunities, promotions reuse environments + the event
  log, and schema safety builds directly on the FieldDef registry.
- (−) The marketplace is org-scoped (a public cross-tenant catalog is a
  Phase 13+ extension); install payloads are v1 (agent template + webhook
  events — no arbitrary scripts, by design); the developer platform (SDKs,
  serverless functions) remains a documented extension path.

---

## Engineering note · Zod `.default()` leaks through `.partial()` on PATCH

Zod applies `.default(...)` even when a schema is used via `.partial()` — so a PATCH that omits a defaulted key silently resets it (we hit this on forms/segments/custom fields: a rename wiped `submitLabel`, `criteria`, `required`). **Rule going forward:** PATCH-facing schemas carry **no** `.default()`; defaults are applied explicitly at the create endpoint (`input.x ?? default`).

---

## ADR-026 · Phase 14 Security = one central module + one enforcement middleware (MFA/sessions/IP/consent/retention/status as rows, everything evented)

**Status:** Accepted

**Context:** The blueprint's Phase 14 is Enterprise Security, Compliance &
Governance: SSO/MFA/SCIM, IP restriction, session/device management, data
masking, retention/deletion policies, GDPR/consent tooling, vendor
transparency, a status page, and i18n. The architecture questions were
(1) how to upgrade authentication from signed cookies to revocable sessions
without breaking every existing route, (2) how to enforce network-level
policy without scattering checks across controllers, (3) how to make
compliance artifacts (consent, DSRs, retention, alerts, uptime) first-class
rows that compose with the event bus, and (4) how SCIM provisioning can reuse
the token machinery without becoming a backdoor to the whole API.

**Decision:**

1. **One `lib/security.ts` owns the whole surface; one middleware enforces
   the org policy.** `enforceSecurityPolicy` mounts after
   `loadSession`/`loadTokenAuth` and evaluates the org's IP allowlist on
   EVERY `/api/*` request — no per-route scattering. The MFA/session/consent/
   retention/status/i18n logic lives in the same module so the discipline is
   central (the ADR-015/017/021/023/024 row-as-config pattern).
2. **Sessions become DB rows; cookies stay the transport.** The HMAC cookie
   now embeds a `SecuritySession` id; `resolveSession` re-checks the row
   (revoked/expired) on every request. Legacy pre-Phase-14 cookies still
   verify via the old payload, so the upgrade is zero-downtime. Device
   management = the rows themselves.
3. **Compliance artifacts are evented rows, not features.** `SecurityAlert`
   (blueprint entity), `ConsentRecord` (+`consent.updated`),
   `DataSubjectRequest` (access/export/delete/rectify),
   `RetentionPolicy` (delete/anonymize → `retention.policy_applied`),
   `UptimeEvent`/`StatusIncident`, `SubProcessor`, `TranslationEntry` — each
   is an org × environment row with its lifecycle evented. Derived numbers
   (uptime %, completeness %, alert counts) are computed on read (ADR-018).
4. **SCIM rides the token scope, confined.** A bearer `ApiToken` gains a
   `scim` scope; `loadTokenAuth` treats a scim-only token as NON-session (it
   never becomes `req.sessionUser`), so SCIM 2.0 endpoints authenticate via
   `scimAuth` and the token cannot touch the rest of the API. Groups map
   displayName → role and apply membership roles.
5. **System actors are the zero ObjectId, not free text.** Every
   `@db.ObjectId` field (actorId, entityId, createdBy) must hold a real id;
   service actors use `SYSTEM_ACTOR_ID`/`SCIM_ACTOR_ID`
   (`000000000000000000000000`) so event persistence can never fail on a
   malformed ObjectId.

**Consequences:**
- (+) MFA is a real two-step handshake (no session cookie at the password
  step), session revocation is immediate and verified, IP restriction blocks
  + alerts, and every compliance action is auditable in the event log.
- (+) Feature flags (`sec.*`, `i18n.localization`) gate each area per org ×
  environment (ADR-008), and the Security page is a single governance
  surface for the whole discipline.
- (−) IPv6 support is CIDR-lite (exact + `/0`); encryption at-rest/in-transit
  remain documented posture flags until multi-region hosting lands; i18n
  ships the catalog + QA scaffold, not full string translation of every page.

## ADR-027 · Phase 15 Differentiators = the same discipline applied to the "1-of-1" layer (deterministic + explainable + evented, one router per differentiator)

**Status:** Accepted

**Context:** The blueprint's Phase 15 (the 16th and final phase) is a list of
one-of-one differentiators — Business Brain, Relationship Graph v2,
organizational memory, multi-agent orchestration, Deal X-Ray, the Opportunity
Radar, the AI Deal Detective, the CRM Time Machine, the Business Digital Twin
(What-If simulator), AI-built generators, a voice/computer-use console, and
Universal Business Query. These are the most "AI-shaped" features in the
blueprint, which raises the architecture questions the previous phases
already answered: (1) how to synthesize across every module without a black
box, (2) how to reuse the audit trail + event log as a historical substrate
instead of copying data, (3) how agents that already have a risk-tiered
platform (ADR-021) compose into orchestrations, and (4) how the 12 features
ship as one coherent surface without 12 new routers.

**Decision:**

1. **The Business Brain is a deterministic, derived insight ledger, not an
   LLM.** `scanBrain()` runs 8 rule families (stalled deals, stale pipeline,
   outliers, unreasoned outcomes, at-risk accounts, expansion, expected
   closes, breached SLAs) over live rows + the event log, upserts by
   fingerprint, prunes open insights whose fingerprint stopped matching
   reality, and emits `insight.generated` only for new ones. Evidence is a
   first-class field on every row (ADR-018 derived-on-read + ADR-020
   explainability discipline).
2. **The Time Machine reads the audit trail; snapshots are durable
   point-in-time copies with a retention window.** Reconstruction is derived
   from the existing `AuditLog` (every mutation is already audited) — no
   second history store; `TimeMachineSnapshot` (blueprint entity) captures
   full-org or per-record states with `retentionUntil` pruning. Same
   row-as-config pattern as ADR-009/015/017.
3. **Orchestration = rows that fan events out to the Phase 9 agents.**
   `AgentOrchestrator` (trigger, childAgentIds, mode, runCount) + an
   `AgentDelegation` parent→child chain that reuses `AgentRun`; the engine
   subscribes to the event bus like ADR-015/021/023/024 engines. No new
   execution machinery — the children keep their 🟢🟡🔴 governance.
4. **Generators target existing registries.** The natural-language builder
   emits working rows into the Phase 3 workflow, Phase 9 agent, Phase 6
   report, and Phase 0 custom-field registries — it creates config, never a
   parallel system.
5. **System actors stay the zero ObjectId (ADR-026 §5).** The memory engine
   learns from the event bus as the system actor; a first verification bug
   (literal `"system"` into an ObjectId column → Prisma P2023, silent memory
   loss) was fixed with the sentinel.
6. **One router, one page.** All twelve differentiators mount under
   `/api/brain` with per-area `diff.*` gates (ADR-008) and render on the
   Brain page's 11 tabs; reads are open to authenticated users, config writes
   admin-only — the same governance as every prior phase.

**Consequences:**
- (+) Every differentiator is explainable (factor lists, evidence arrays,
  model assumptions in `docs/52-…`, methodology in `docs/51-…`) and evented
  (`insight.generated`, `snapshot.created`, `simulation.completed`,
  `memory.recorded`, `opportunity.detected`, `risk.detected`,
  `agent.delegated`, `builder.generated`).
- (+) The audit/event substrate means the Time Machine + Deal Detective +
  memory add no data copies and stay correct by construction.
- (+) 90/90 live smoke checks (`verify-phase15.sh`) + Phase 14 (106/106) and
  Phase 13 (53/53) regressions green — all 16 blueprint phases (0–15) are now
  complete.
- (−) Graph-v2 roles are derived heuristics (title + involvement), not
  curated; the simulator is deterministic arithmetic, not probabilistic; UBQ
  answers the phrasings its parser understands rather than hallucinating.

## ADR-028 · Phase 16 = real provider integrations behind the same adapter shape, mock-first (no external dependency is ever required to boot)

**Status:** Accepted

**Context:** Phase 15 completed the 16-phase blueprint, but every communication,
AI, and telephony surface still runs on the ADR-014 mock discipline — email is
`EMAIL_MOCK=1` (no real sends), the model router *decides* without ever
calling a model, call recording/transcripts are placeholders. The natural next
phase is real providers (email: Resend/SendGrid, AI: OpenAI, telephony:
Twilio) — but the repo's verification story (15 verify scripts, fresh seeded
stacks, CI-friendly) depends on zero external credentials, and the blueprint's
multi-tenant design means provider choice is a deployment concern, not an org
setting. The architecture question: how to add real integrations without
breaking mock mode, without a dependency explosion, and without per-org
provider state.

**Decision:**

1. **Providers are env-driven, not org state.** `EMAIL_PROVIDER`,
   `AI_PROVIDER`, and the Twilio vars are environment configuration (the
   ADR-014 pattern extended): `mock` is always the default, a missing key
   means mock, and no org row or feature flag changes. `GET
   /api/integrations/status` (admin) surfaces the active providers without
   ever exposing a secret.
2. **One narrow adapter interface per capability, REST-over-`fetch`.**
   `sendEmail({ from, to, subject, body, headers }) → { providerMessageId }`
   for email (mock / resend / sendgrid); call-create + status/recording
   callbacks for Twilio; `maybeCallLlm(...) → { text, modelId, latencyMs,
   usage } | null` for AI. No new npm dependencies (Node 24's global
   `fetch`); a provider SDK can later replace an adapter without touching
   callers.
3. **Real sends are a post-create side effect, never a precondition.** Every
   outbound email site creates the `Message` row first (unchanged behavior),
   then `sendOutboundWithProvider` fires the real provider: success stores
   `providerMessageId`, failure flips the row to `failed` + emits the new
   `email.failed` event. The API contract (201 + tracking payload) is
   identical in mock and real mode; delivery is asynchronous by nature.
4. **Provider webhooks are public + capability-proofed.** Providers can't
   log in, so `POST /api/integrations/email/webhook` and
   `POST /api/integrations/twilio/status/:callId` are unauthenticated, with
   signature verification when secrets are configured (SendGrid
   `X-Twilio-Email-Event-Webhook-Signature`, Resend svix, Twilio
   `X-Twilio-Signature`) AND a capability proof in dev: the payload must
   reference a real row by its unguessable `trackingToken`/`providerMessageId`/
   `callId`. Forged payloads can only touch rows whose token the attacker
   already knows — no additional exposure. `enforceSecurityPolicy` (ADR-026)
   skips unauthenticated requests, so IP allowlists never block webhooks.
5. **Real AI is a strict enhancement behind the existing router.**
   `provider: "openai"` `ModelRoute` rows become executable via
   `maybeCallLlm`, seeded lazily when `OPENAI_API_KEY` is set; summaries +
   drafts call the real model with the already-firewalled context, and any
   miss (no key, mock provider, network/parse failure) falls back to the
   deterministic generator. The AIInsight row still records `modelId` +
   `latencyMs` + the redaction log — ADR-020's explainability/audit contract
   holds for real models.

**Consequences:**
- (+) Mock mode is byte-for-byte unchanged: all 15 verify suites + the demo
  run with zero credentials; `verify-phase16.sh` proves the platform works
  before any key is configured.
- (+) Real integrations are additive — a missing key is a graceful fallback,
  never a crash or a boot failure; the app refuses nothing.
- (+) The event bus keeps working: provider events (open/click/bounce/
  unsubscribe/complaint/delivered, call completed) emit the same `email.*` /
  `call.completed` events, so Phase 7 CDP mirroring, Phase 5 deliverability
  metrics, Phase 15 memory learning, and Phase 11 success signals all light up
  with real data with zero extra code.
- (+) No dependency or schema churn: `fetch`-based adapters + two nullable
  `Message` fields (additive).
- (−) Real sends/deliveries are asynchronous — a send failure surfaces as
  `status: failed` + `email.failed`, not a synchronous API error; inbound
  email routing, provider SDKs, and non-AI LLM features remain non-goals
  (documented in `docs/54-spec-phase16.md` §5).
