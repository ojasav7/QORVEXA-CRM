# 23 · Phase 7 Spec — CDP / Customer 360

> The spec that drives Phase 7 of QORVEXA CRM. Goal (from the blueprint):
> **unify every customer touchpoint into one identity.** Everything in here is
> scoped to what can be built, verified live, and demoed on the existing stack
> (Express 5 + Mongo via Prisma + React 19 SPA) — deterministic identity
> resolution v1 (no external vendor), behavioral tracking off the event bus we
> already have, a derived relationship graph, an explained health engine, and
> the 🆕 right-to-portability full-tenant export.

## §0 · Current substrate (verified in repo)

- **Event bus with persistence** (`lib/events.ts`) — every `email.opened`,
  `form.submitted`, `ticket.created`, `call.completed`, `meeting.completed`
  already lands in the `Event` collection with `entityId` pointing at the
  record. Behavioral tracking can *mirror* this stream — no new code at the
  source (the Phase 5 journey engine already proved the subscriber pattern).
- **Contacts + leads** — every CRM record that represents a person already
  carries `email`, `phone`, `firstName/lastName`, `company/accountId`.
  Identity resolution consumes these directly.
- **Comm + support + marketing rows** — `Message` (contactId + opportunityId),
  `Call`, `Meeting`, `Ticket` (contactId), `CampaignRecipient` (contactId) are
  the raw material for the relationship graph and the health engine.
- **Derived-data precedents** — the Phase 6 metrics library computes on read
  with data lineage; the health engine and relationship graph follow the same
  discipline (derived, never stored, with explanation).

## §1 · Scope (what this phase ships)

### 1.1 Identity resolution + unified profiles — `IdentityProfile` (flag `cdp.profiles`)
- One profile per person per org × env. Members are the raw records identity
  resolution decided are the same person (`memberIds: ["contact:<id>",
  "lead:<id>", …]`). **Email is the canonical deterministic key** (lowercased,
  unique per org × env); phone and name+company are secondary rules surfaced
  for manual merge. Rules documented in `docs/25-cdp-guide.md`.
- **Real-time unification** — when a contact/lead is created (or a behavior
  arrives with an email), the engine resolves/creates the profile and attaches
  the record. Two records under one profile = one identity →
  `customer.identity_merged`.
- `POST /api/cdp/profiles/rebuild` (admin) reconciles every contact + lead
  (idempotent). `POST /api/cdp/profiles/merge` (admin) merges one profile into
  another — members, behaviors and health history move, the donor is deleted,
  lineage is kept in `mergedFromIds`, `customer.identity_merged` fires.
- Master-data preference: contact beats lead for name/account; lead supplies
  company.

### 1.2 Behavioral event tracking — `BehaviorEvent` (flag `cdp.profiles`)
- **Distinct from the system Event log**: it records what the *customer* did
  across web / product / purchase / support / ads, keyed to a profile.
  `{ type, profileId?, contactId?, entity?, value?, meta, source, occurredAt }`.
- Two ingestion paths:
  1. **API** — `POST /api/cdp/behaviors` (authenticated): websites/products
     call this with `{ type, email | contactId | profileId, value?, meta? }`.
     Identity resolves via profileId → contact/lead email → email.
  2. **Event-bus mirror** — `startCdpEngine` (boot subscriber, same pattern as
     automations/journeys) mirrors selected system events into behaviors:
     `email.opened/clicked/replied → email_*`, `form.submitted`,
     `ticket.created → support_ticket`, `call.completed`, `meeting.completed`.
- Advisory catalog: `page_view, product_use, purchase, ad_click, form_submitted,
  email_opened, email_clicked, email_replied, call_completed,
  meeting_completed, support_ticket` (the API accepts any type string).

### 1.3 Customer 360 view (flag `cdp.profiles`)
- `GET /api/cdp/profiles` — searchable list (name/email/company) with derived
  health + churn per row. `GET /api/cdp/profiles/:id` — the full 360:
  identity members (contacts + leads), unified contact/account info, the
  touchpoint stream (behaviors + emails + calls + meetings + tickets), the
  person's relationship-graph slice, health + churn + history.
- UI — **Customers** page (new nav section "Customer data"): KPI cards from
  `/api/cdp/overview` (profiles, records unified, behaviors tracked, at-risk
  count, avg health), search, profile cards with health bars + merged-identity
  badges, and a 360 drawer with tabs (Overview / Touchpoints / Graph / Health)
  including admin Rebuild + Refresh + Merge-into actions.

### 1.4 Relationship graph v1 — derived (flag `cdp.profiles`)
- Nodes: account, contacts (employment edge via `accountId`), deals
  (`accountId`); involvement edges contact→deal. **Influence** is scored from
  real touchpoints between the contact and the deal:
  email sent=1 · opened=2 · clicked=3 · replied=4 (best state per message),
  call completed=3, meeting completed=5, ticket=2 (deal view), deal.contactId
  (primary) = +10; capped at 100. Schema + scoring documented in
  `docs/25-cdp-guide.md`.
- `GET /api/cdp/graph?accountId=` (account node + people + deal involvement)
  and `?dealId=` (the buying committee ranked by influence).
- Derived on read — never stored; manual edge curation deferred.

### 1.5 Customer health engine — `HealthScore` snapshots (flag `cdp.profiles`)
- **Explained composite**, computed on read: `score(0–100) = engagement(≤40) +
  support(≤25) + revenue(≤25) + recency(≤10)`:
  - engagement — `min(40, touchpoints30 × 4)` (behaviors + emails + calls +
    meetings in 30 days);
  - support — `max(0, 25 − 8·open − 10·breached − 5·escalated)`;
  - revenue — `min(25, (won90 + ½·openWeighted) ÷ $10k)`;
  - recency — `max(0, 10 − daysSinceLastActivity)`.
  `churnRisk = clamp(100 − score)`; `churnRisk ≥ 70` ⇒ at risk. Every component
  returns its raw inputs + the formula (full documentation in
  `docs/25-cdp-guide.md`).
- `GET /api/cdp/health?profileId=` — live score. `POST /api/cdp/health/refresh`
  (admin) persists one `HealthScore` row per profile (history + deltas via
  `previousScore`), emits `customer.health_changed` (every profile) and
  `customer.churn_risk_changed` (churnRisk ≥ 70).

### 1.6 Right-to-portability full-tenant export — `PortabilityExport` (flag `cdp.portability`)
- 🆕 blueprint item: one admin click produces a **single downloadable JSON
  bundle with EVERY org × environment collection** — object rows, comms,
  tickets, marketing, analytics, the Phase-7 CDP rows, plus `Event` log and
  `AuditLog` trail. Staff `User` rows are included without `passwordHash`.
- `POST /api/portability/export` (admin) builds + writes the bundle under
  `backups/portability/`, tracks a `PortabilityExport` row, emits
  `portability.exported`. `GET /api/portability` lists; `GET
  /api/portability/:id/download` streams it; `DELETE /api/portability/:id`
  (admin) purges row + file (path-traversal-safe).
- UI — **Portability** page (nav section "Customer data"): Export button,
  history table with size/status/date, download + purge.

### 1.7 Demo data (`npm run seed`)
- Profiles built from the demo contacts + leads; a **duplicate-identity lead**
  (same email as Elena's contact, sourced from a landing page) is unified into
  her profile (`customer.identity_merged` demo — the Customers page shows
  "unified ×2").
- Behavioral events (source `seed`): page views, product use, a purchase (the
  won Support Add-on), campaign opens, a support ticket, an ad click.
- A persisted health snapshot so health history exists on first login.

## §2 · Key decisions (becomes ADR-019)

1. **Identity resolution v1 is deterministic and rule-based** — email is the
   canonical key (unique per org × env), phone + name+company are secondary
   rules surfaced through rebuild/merge. No ML, no vendor: every merge is
   explainable and auditable (`customer.identity_merged` with lineage).
2. **Behavioral events mirror the event bus** — the system already persists
   every touchpoint event; the mirror (a boot subscriber, like the automation
   and journey engines) turns them into profile-keyed behaviors. No code at
   the source, no double-send.
3. **The graph and health are derived on read** — same discipline as the
   Phase 6 metrics library: they can't go stale, and every number explains
   itself (inputs + formula). The only persisted Phase-7 artifacts are
   `HealthScore` snapshots (history + `customer.health_changed` events) and
   `PortabilityExport` rows.
4. **Portability is a full-tenant bundle** — one file, every collection,
   download + purge, GDPR-shaped. The org admin is the requester; users
   (staff) are included minus password hashes.
5. **Feature-gated** — `cdp.profiles` (pro/enterprise) and `cdp.portability`
   (enterprise) gate the APIs and nav, exactly like every earlier phase.

## §3 · Events added (catalog `docs/03-event-catalog.md`)

| Event | When | Payload |
|---|---|---|
| `customer.identity_merged` | Two records unified under one profile (record attach to an existing profile, or manual merge) | `{ email?, from?, into?, memberIds, memberCount, source: record\|manual }` |
| `customer.profiles_rebuilt` | Admin rebuild reconciled contacts + leads | `{ contacts, leads, created, attached, merged }` |
| `customer.behavior_tracked` | A behavior was ingested via the API | `{ type, profileId? }` |
| `customer.health_changed` | Health refresh scored a profile | `{ score, churnRisk, components, refreshId }` |
| `customer.churn_risk_changed` | Health refresh scored a profile with churnRisk ≥ 70 | `{ score, churnRisk, atRisk, refreshId }` |
| `portability.exported` | A full-tenant bundle was created | `{ path, sizeBytes, collections, totalRows }` |

## §4 · Non-goals (deferred, documented)

- ML-based identity resolution / fuzzy name matching (Phase 8/9 AI layer).
- Anonymous-profile stitching via device/beacon IDs; consent management
  (Phase 14 GDPR tooling owns `ConsentRecord`).
- Manual graph edge curation + relationship graph v2 with influence scoring
  (Phase 15 differentiators).
- Per-channel preference center (blueprint 🆕 — Phase 14).
- Behavioral ingestion from unauthenticated beacons (v1 requires the org's
  API token/session — mirrors the Phase 1/4/5 public-intake posture).

## §5 · Verification plan (`verify-phase7.sh`)

- **Identity** — rebuild creates a profile per seeded contact + lead; the
  duplicate-email lead unifies into Elena's profile (memberCount 2, merged
  count ≥ 1); `customer.identity_merged` event present; merge moves members +
  behaviors + health (verify via counts) and self-merge 400; rep rebuild 403.
- **Behaviors** — ingest via API resolves the profile by email; unknown type
  accepted; list filtered by profile/type; `customer.behavior_tracked` event.
- **360** — overview numbers sane (profiles ≥ records with emails, behaviors
  ≥ 8 on a fresh seed); profile list rows carry `health`; the 360 returns
  profile + behaviors + history + graphs.
- **Graph** — account graph returns contacts + deals; deal graph returns a
  buying committee with influence scores; primary contact gets the +10 bonus.
- **Health** — live score in [0,100], churnRisk = 100 − score; refresh
  persists a snapshot per profile, history grows, `customer.health_changed`
  emitted; rep refresh 403.
- **Portability** — export creates a success row + file; download returns a
  bundle with every collection (events + audit present); rep export 403;
  DELETE purges; sandbox export invisible in production.
- **Feature gates** — `cdp.profiles` / `cdp.portability` 403/restore.
- **Full regressions** — phases 1–6 suites green on the same stack.
