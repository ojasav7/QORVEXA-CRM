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

## Engineering note · Zod `.default()` leaks through `.partial()` on PATCH

Zod applies `.default(...)` even when a schema is used via `.partial()` — so a PATCH that omits a defaulted key silently resets it (we hit this on forms/segments/custom fields: a rename wiped `submitLabel`, `criteria`, `required`). **Rule going forward:** PATCH-facing schemas carry **no** `.default()`; defaults are applied explicitly at the create endpoint (`input.x ?? default`).
