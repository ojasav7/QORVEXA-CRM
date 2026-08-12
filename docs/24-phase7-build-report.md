# 24 · Phase 7 Build Report — CDP / Customer 360

> What shipped to complete Phase 7 (the blueprint's "Customer Data Platform /
> Customer 360" phase) end-to-end, the decisions behind it, and the
> verification evidence. Spec: `docs/23-spec-phase7.md` · Guide:
> `docs/25-cdp-guide.md` · Decision: ADR-019 in `docs/08-decision-log.md`.
> Status overview in `PROGRESS.md`. All live checks below ran against the real
> server (`localhost:8787`, Mongo via Docker, freshly seeded demo org).

## What shipped

### 1. Identity resolution + unified profiles (`server/lib/cdp.ts`) — ADR-019
- One `IdentityProfile` per person per org × environment. **Email is the
  canonical deterministic key** (lowercased, unique per org × env — the same
  discipline Phase 1 duplicate detection uses, now applied continuously).
  Phone + name+company matching are secondary rules surfaced through the
  admin merge flow (rule documentation in `docs/25-cdp-guide.md`).
- The CDP engine subscribes to `contact.created` / `lead.created` and
  attaches records to their profile **in real time** — a contact and a lead
  with the same email become one identity, with a
  **`customer.identity_merged`** event carrying the lineage
  (`{ profileId, memberType, memberId, via }`).
- **Admin `rebuild`** (`POST /api/cdp/rebuild`) reconciles the whole org × env
  (attaches orphans, merges duplicates by email) — idempotent, returns a
  diff summary. **Admin `merge`** (`POST /api/cdp/profiles/:id/merge`) moves
  members + behaviors + health history into a target profile and records
  `mergedFromIds` lineage (self-merge → 400, rep → 403).

### 2. Behavioral event tracking
- `BehaviorEvent` rows are **what the customer did** (web / product / purchase
  / support / ads) — distinct from the system `Event` log (what the CRM did).
  Catalog: `page_viewed, email_opened, email_clicked, email_replied,
  form_submitted, ticket_created, call_completed, meeting_completed,
  purchase_completed, support_resolved`.
- **Two ingestion paths.** API ingest (`POST /api/cdp/behaviors`) resolves
  identity through `profileId → record email → email` and emits
  **`customer.behavior_tracked`**. And an **event-bus mirror**
  (`startCdpEngine`, wired in `server/index.ts`) maps `email.opened/clicked/
  replied`, `form.submitted`, `ticket.created`, `call.completed`,
  `meeting.completed` to behaviors automatically — touchpoint coverage by
  construction, zero code at the source (the engine self-dedupes by
  `sourceEventId`).

### 3. Customer 360 view
- `GET /api/cdp/overview` — headline numbers (profiles, records unified,
  behaviors tracked, merged identities, avg health, at-risk count).
- `GET /api/cdp/profiles` — searchable (name/email), every row carries
  derived `health` + `churnRisk` + member counts + last-touch.
- `GET /api/cdp/profiles/:id` — identity members (the unified person), the
  merged contact/account info, the **full touchpoint stream** (behaviors +
  messages + tickets, chronologically), the person's graph slice, health +
  churn + snapshot history.
- **Customers page** (`/customers`, new "Customer data" nav section) — KPI
  cards, search, health-bar profile cards, and a **360 drawer** with
  Overview / Touchpoints / Graph / Health tabs, plus admin Rebuild / Refresh
  health / Merge-into actions.

### 4. Relationship graph v1 (`server/lib/graph.ts`) — derived, never stored
- `GET /api/cdp/graph?accountId=` — account node + its people + deal
  involvement. `GET /api/cdp/graph?dealId=` — the **buying committee** ranked
  by influence.
- **Influence scoring** is transparent arithmetic over real touchpoints:
  email sent 1 → **replied 4**, call 3, meeting 5, ticket 2, primary-contact
  +10, capped at 100. Scoring table documented in `docs/25-cdp-guide.md`.
  The Phase 7 customers graph is the v1 that Phase 15's "relationship graph
  v2" (blueprint: full buying-committee mapping with influence scoring) will
  extend.

### 5. Customer health engine (`server/lib/health.ts`) — explained composite
- `score = engagement(40) + support(25) + revenue(25) + recency(10)`, each
  component 0–100 with documented formulas and raw inputs; `churnRisk =
  100 − score` (at-risk ≥ 70). Every component returns `{ score, formula,
  inputs }` — the UI shows exactly why a customer is at risk.
- `GET /api/cdp/health` (live, read) and admin
  `POST /api/cdp/health/refresh`, which persists one `HealthScore` snapshot
  per profile (history + deltas on the 360 view) and emits
  **`customer.health_changed`** / **`customer.churn_risk_changed`**.

### 6. Right-to-portability export (`server/lib/portability.ts`) — 🆕 blueprint
- One admin click (`POST /api/portability/export`) builds a **single
  downloadable JSON bundle of EVERY org × environment collection** — objects
  (accounts/contacts/leads/deals), comms (messages/templates/calls/meetings),
  tickets + KB + portal pages, campaigns + journeys + landing pages, reports
  + forecasts, the CDP rows (profiles/behaviors/health), plus the `Event` log
  and `AuditLog`. Staff users are included **minus password hashes** (the
  same rule the backup restore path uses for user secrets).
- `PortabilityExport` rows track status/size/date; the download streams the
  archived file, DELETE purges it. New **Portability** page in the "Customer
  data" nav section (enterprise-gated).

### 7. Feature gates + schema
- `cdp.profiles` (pro/enterprise) gates the CDP APIs + Customers page;
  `cdp.portability` (enterprise) gates the export APIs + Portability page.
- Prisma additions: `IdentityProfile`, `BehaviorEvent`, `HealthScore`,
  `PortabilityExport` (all org × env scoped; profiles unique on
  `(orgId, environment, email)`).

## Decisions (ADR-019)

Identity resolution is **deterministic + explainable**: email is the canonical
key (the CRM's own duplicate-detection rule, applied continuously by an
event-bus subscriber instead of batch jobs), and secondary rules only surface
through an explicit admin merge — no probabilistic guessing that silently
merges two people. **Behaviors are a separate log** from the system event bus:
the bus is the CRM's own history (already huge), behaviors are the customer's
journey; the CDP engine is a **mirror** subscriber so touchpoint coverage
grows automatically with every phase that emits events. The graph and health
are **derived on read** (ADR-018 discipline) — no stale graph, and the health
formula ships its own explanation. Portability is an **admin-triggered,
downloadable bundle of every scoped collection** with secrets stripped — the
right-to-portability requirement fulfilled without exposing a live data API.
See `docs/23-spec-phase7.md` §2 for the full rationale.

## Bugs found & fixed during verification

1. **The engine claimed real-time record attach but never subscribed to it**
   (found in final code review) — `startCdpEngine` only mirrored the behavior
   events; `contact.created` / `lead.created` never attached records to
   profiles in real time (attach only happened at admin rebuild or seed).
   Fixed: the engine now subscribes both creation events and attaches via
   `ensureProfileForRecord`, resolving the row by `entityId` scoped to the
   event's org × environment. Live-verified: a fresh API contact gets an
   auto-created profile, and a lead with a duplicate email auto-merges into
   the contact's profile with `customer.identity_merged`.
2. **Behavior ingest resolved `contactId`/`leadId` without tenant scoping**
   (found in final code review) — the lookups now filter by orgId +
   environment, so a caller can never resolve (or probe) another tenant's
   records.
3. **Phase-5 campaign A/B split treated `splitA` as an index cutoff, not a
   percentage** (pre-existing, surfaced by the Phase 7 regression run) — the
   documented contract is a 0–100 "split slider" (`docs/19-spec-phase5.md`),
   but `sendCampaign` used `recipientIndex < splitA` as an absolute count, so
   variant B never appeared for audiences smaller than `splitA`. Fixed in
   `server/lib/campaigns.ts`: `variantIndex` is now derived from the
   recipient index × (100 / audience size) — a 50/50 split of 3 recipients is
   A, B, A. Post-fix: `verify-phase5.sh` 65/65 green (A/B variants both
   present with a 58-recipient audience **and** the small-audience case).
2. **Verify-script bugs** (suite-side, not server): `jget` on arrays printed
   the whole list and broke integer comparisons — the graph assertions now
   extract with explicit array indexing.
3. **Server-library type fixes** during build: `z.record` arity (zod v4),
   `req.params.id` → `String(req.params.id)` (convention), `Json` casts on
   behavior `meta` and graph payloads (Prisma strict types).

## Verification evidence

- `npm run typecheck` ✅ · `npm run build` ✅ (production bundle, `dist/`).
- **Live smoke suite (`verify-phase7.sh`, 53/53 green):**
  - Identity: rebuild reconciles profiles (5 contacts + 5 leads → 9 profiles);
    a duplicate-email contact + lead auto-merge on create →
    **`customer.identity_merged`**; self-merge → 400; rep rebuild/merge → 403.
  - Behaviors: API ingest resolves the profile by email, unknown type → 400,
    `customer.behavior_tracked` emitted; event-bus mirror maps
    `email.opened` → behavior with `sourceEventId` dedupe.
  - 360: overview headline numbers correct; profile detail returns members,
    behaviors, messages, health history, and the person's graph slice.
  - Graph: account graph returns the account + its people with influence;
    deal graph returns the buying committee ranked (primary contact has the
    +10 boost); influence monotonic across touchpoint weights.
  - Health: score in range, `churnRisk = 100 − score` holds, all 4 components
    carry formulas + inputs, refresh persists a snapshot (history grows) and
    emits `customer.health_changed`.
  - Portability: export builds a 40-collection bundle; download contains
    profiles + audit logs + events; **password hashes excluded**; rep export
    → 403; download after DELETE → 404.
  - Feature gates: `cdp.profiles` + `cdp.portability` disable → 403 /
    re-enable → 200; sandbox profiles/behaviors invisible in production.
  - Cleanup: smoke behaviors deleted; demo data left pristine.
- **Regressions on the same fresh stack:** `verify-phase6.sh` 44/44,
  `verify-phase5.sh` 65/65, `verify-phase4.sh` 61/61, `verify-phase3.sh`
  34/34, `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29,
  `verify-phase1.sh` 30/30 — **all eight suites green in one sequence on one
  clean DB (361 checks).**

## Docs updated

`docs/23-spec-phase7.md` (spec, new), `docs/24-phase7-build-report.md` (this
report), `docs/25-cdp-guide.md` (identity rules, graph schema + influence
scoring, health formula — new), `docs/03-event-catalog.md` (Phase 7 events),
`docs/05-api-reference.md` (CDP + Portability sections),
`docs/08-decision-log.md` (ADR-019), `PROGRESS.md` (Phase 7 → ✅ 100%),
`docs/06-roadmap.md` (Phase 7 → ✅ shipped), `README.md` (Phase 7 feature
list), `docs/10-continuation-runbook.md` (Phases 0–7).
