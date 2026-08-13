# 32 · Phase 11 Spec — Customer Success, Retention & Expansion

> The spec that drives Phase 11 of QORVEXA CRM. Goal (from the blueprint):
> **keep customers successful so they renew and expand.** Phases 7–10
> established the substrate this phase composes: the CDP/360 + health engine
> (Phase 7) that already scores every account, the BI/metrics discipline
> (Phase 6), the event-sourced deal history + Revenue Cloud (Phase 10), and the
> AI layer's explainable, audited generation (Phase 8). Phase 11 adds the
> customer-success operating loop on top — the same stack (Express 5 + Mongo
> via Prisma + React 19 SPA), the same mock-provider discipline (ADR-014), and
> the same rule of thumb as every prior phase: **every score, prediction, and
> recommendation is deterministic, explained, and audited — no black boxes.**

## §0 · Current substrate (verified in repo)

- **Customer 360 + health (Phase 7)** — `IdentityProfile` + `HealthScore`
  (explained, 0–100) + `accountHealth()` are the input layer: a churn
  prediction or an at-risk plan flag starts from the health the platform
  already computes and explains.
- **Behavioral + product data (Phase 7 CDP)** — `BehaviorEvent` rows mirror
  the event bus; Phase 11 adds `UsageEvent` (product telemetry — feature
  adoption, seat usage, inactivity) as a *separate* ingestion surface with the
  same event-bus mirror pattern (`startSuccessEngine` maps system events →
  usage, exactly like the CDP mirror).
- **Event-sourced pipeline + Revenue Cloud (Phases 1, 10)** — `Deal`,
  `Subscription`, `Invoice`, `Payment` rows feed churn inputs (renewal
  windows, past-due, dunning) and the expansion radar (seat utilization,
  unadopted catalog features, upsell/cross-sell products).
- **BI metrics discipline (Phase 6)** — derived-on-read metrics with data
  lineage are the house style; survey results (NPS/CSAT/CES) follow it (score
  computed at read, formula lineage attached).
- **AI explainability (Phase 8)** — sentiment + intent + explanations carry
  the ADR-020 "deterministic-first, transparent" discipline; Phase 11 derives
  comment sentiment the same way and explains every churn factor.
- **Engine-subscriber pattern** — `startAutomationEngine` (3),
  `startJourneyEngine` (5), `startCdpEngine` (7), `startAgentEngine` (9)
  established `onEvent("*")` + ticker engines; `startSuccessEngine` follows.

## §1 · Scope (what this phase ships)

### 1.1 Success & onboarding plans — `SuccessPlan` (flag `cs.plans`)
A plan is a **declarative row** (the ADR-015/017 row-as-config pattern) tying
an account to a CSM and a timeline:
- `kind` — `onboarding` | `success` | `custom`; `status` — `draft` | `active`
  | `at_risk` | `completed` | `archived`.
- `milestones` — JSON array `[{ id, title, dueDate, status: open|done,
  completedAt }]`; added via `POST /api/success/plans/:id/milestones`, flipped
  via `POST /api/success/plans/:id/milestones/:mid` (`{ done }`). Completing a
  milestone emits `milestone.completed`.
- `qbrs` — JSON array `[{ id, date, title, attendees, notes }]` (QBR =
  quarterly business review), logged via `POST /api/success/plans/:id/qbrs`.
- `ownerId` — the CSM; the hydrated plan joins `ownerName`, `accountName`,
  `accountTier`, and **live** `healthScore` + `churnRisk` from Phase 7.
- **At-risk flagging (health-to-playbook)** — a plan whose account health is
  < 60 or whose churn tier is ≥ `high` hydrates with `atRisk: true` and its
  status *suggests* `at_risk`; the playbook (adoption re-engagement, QBR
  cadence) lives in the guide (`docs/34-customer-success-guide.md`).

### 1.2 Product usage intelligence — `UsageEvent` (flag `cs.usage`)
- **Two ingestion paths** — `POST /api/success/usage` (the product posts
  telemetry: `{ feature, type?, value?, accountId?, profileId? }` → `source:
  api`) and the **event-bus mirror** (`startSuccessEngine` maps system events
  → feature usage: `meeting.completed` → `meetings`, `email.sent` → `email`,
  `call.completed` → `calls`, `ticket.created` → `tickets`, `form.submitted`
  → `forms`, `deal.created` → `pipelines` — `source: event-bus`, the CDP
  mirror pattern).
- **Reads (derived, explained)** — `GET /api/success/usage` computes an
  overview: per-account `{ featuresUsed, lastActiveDays, activityTrend
  (rising|steady|declining), seatUtilization, adoption { feature, used,
  lastUsedDaysAgo } }` + `bySource` (api/event-bus/seed counts) + org totals.
- **Adoption-drop detection** — `runAdoptionAnalysis` compares each account's
  distinct features in the last 7 days vs the prior 14–21-day window; a drop
  ≥ 50% with ≥ 2 prior features emits **`usage.adoption_dropped`** and notifies
  the org's admins (kind `cs`) — the at-risk early warning.

### 1.3 Churn prediction v2 (explained) + expansion radar (flag `cs.churn`)
- **Explained, deterministic churn model** — `churnForAccount` scores each
  account 0–100 from five explained signal groups (Phase 7 health, usage
  trend/inactivity, support burden — open ticket age/breach, billing health —
  past-due subs, and survey sentiment), tiers `low | medium | high | critical`,
  and returns **factors** `[{ key, label, impact: +|-, detail }]` — the
  explanation (ADR-020 discipline; a real model slots in behind the same
  interface).
- **Snapshot history + escalation events** — `POST /api/success/churn/refresh`
  (admin/manager, or the engine ticker) persists one `ChurnScore` per account
  per `refreshId`; when an account's tier **escalates** vs its previous score,
  it emits **`churn.risk_scored`** and notifies admins (kind `cs`) — the
  blueprint's event. `GET /api/success/churn` returns the live overview
  (current scores + factors + history per account); `GET
  /api/success/churn?accountId=` filters one.
- **Expansion radar** — `GET /api/success/churn/expansion` scans accounts for
  revenue opportunities with reasons: **seat upsell** (utilization ≥ 90% of
  licensed seats → suggest adding seats), **license/plan upsell** (a catalog
  plan tier above the account's current spend), and **cross-sell** (catalog
  features the account doesn't use yet). Every opportunity carries
  `{ kind, accountName, reason, value }` and emits **`expansion.opportunity_detected`**
  per new opportunity.

### 1.4 Surveys (NPS/CSAT/CES) + feedback → roadmap (flag `cs.surveys`)
- `Survey` — `{ name, kind: nps|csat|ces, question, active, targetSegmentId? }`.
  Response scores are **validated per kind** (nps 0–10, csat 1–5, ces 1–7;
  out-of-range → 400). `SurveyResponse` stores `{ score, comment }`;
  `sentiment` is **derived at read** (transparent keyword analysis,
  ADR-020/028 discipline).
- **Results are computed at read with lineage** — `GET
  /api/success/surveys/:id/results` returns `{ nps | csat | ces, responses,
  breakdown }` where NPS = `%promoters − %detractors` with the formula
  attached (the Phase 6 "derived metrics with lineage" style). Every response
  emits `survey.response_submitted`.
- **Feedback → roadmap pipeline** — a negative (or any) survey comment can be
  promoted into a `RoadmapItem` (`POST /api/success/roadmap` with
  `{ source: "survey", surveyResponseId, title, description? }`; the response's
  sentiment pre-fills the description). Items have `status: new | triaged |
  planned | in_progress | shipped | declined`, `category`, and **votes**
  (`POST /api/success/roadmap/:id/vote`) so the backlog self-prioritizes.

### 1.5 Loyalty / advocacy — `LoyaltyProgram` + `LoyaltyMember` + `ReferralRecord` (flag `cs.loyalty`)
- **Program** — `{ name, tiers: [{ key, name, minPoints, benefits }], rewards:
  [{ key, name, pointsCost, description }], pointsRules: { referral, survey,
  review, … } }` (JSON config, the SlaPolicy/PriceBook pattern).
- **Members** — one row per program × contact (enforced in the service layer —
  Mongo nulls are not unique-safe). Tier is **derived at read** from points
  against the tier bands. Points are awarded (`POST
  /api/loyalty/members/:id/award`, non-positive → 400) and every award emits
  **`loyalty.points_awarded`**.
- **Referrals** — a member refers a business email; lifecycle `pending →
  contacted → converted | expired` with invalid transitions rejected (400).
  `converted` awards the referrer `pointsRules.referral` and emits
  **`referral.converted`**; conversion can be declared manually or detected by
  the engine ticker (the referred contact becomes a customer).

### 1.6 Engine + RBAC + feature gating
- `startSuccessEngine` — `onEvent("*")` **usage mirror** (system events →
  `UsageEvent`) + the **ticker** (runs `runSuccessTicker`: adoption-drop
  scan, churn refresh, referral/conversion + loyalty checks, expansion
  detection) — the workflow/journey/agent engine pattern.
- Reads are open (the page is a monitoring + playbook surface); writes
  (create/edit plans, surveys, programs, churn refresh, tick) are
  admin/manager; `requireRole` + `requireFeature` gate every route.
- **Events** — `success_plan.created/updated/deleted`, `milestone.added/
  completed`, `qbr.logged`, `usage.tracked`, `usage.adoption_dropped`,
  `churn.risk_scored`, `expansion.opportunity_detected`,
  `survey.created/updated/deleted`, `survey.response_submitted`,
  `roadmap.created/updated`, `loyalty.program_created/updated`,
  `loyalty.member_enrolled`, `loyalty.points_awarded`, `referral.created`,
  `referral.converted` (full catalog in `docs/03-event-catalog.md`).

## §2 · UI — Success page (`/success`, "Customer success" nav section)

Five tabs, one per blueprint area:
- **Plans** — plan list + detail (milestones with check-off, QBR log, live
  health/churn chips, at-risk banner), create/edit plan.
- **Usage** — per-account feature adoption bars, activity trend, seat
  utilization, last-active + adoption-drop alerts.
- **Churn** — account scores with explained factor lists, tier chips,
  snapshot history + delta, escalation alerts, and the **expansion radar**
  (upsell/cross-sell opportunities with reasons + values).
- **Surveys** — survey list + results (NPS/CSAT/CES with lineage), response
  viewer with derived sentiment, **roadmap** sub-view (votes, triage actions).
- **Loyalty** — programs, members with derived tiers + points, referrals
  lifecycle, points-award action.

## §3 · Out of scope (later phases)

- Multi-survey automation (send-to-segment survey delivery, reminders) — the
  blueprint's marketing automation already owns sends; surveys here are
  capture + analysis.
- Paid loyalty (rewards redemption flow, external points ledger) — tiers +
  points + referrals ship; redemption UI is a later slice.
- Churn model v3 (ML/LLM scoring) — v2 is the explained deterministic model;
  the ADR-020 interface is where a learned model slots in later.
