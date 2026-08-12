# 21 · Phase 6 Spec — Analytics, Forecasting & Business Intelligence

> The spec that drives Phase 6 of QORVEXA CRM. Goal (from the blueprint):
> **replace spreadsheets for reporting.** Everything in here is scoped to what
> can be built, verified live, and demoed on the existing stack (Express 5 +
> Mongo via Prisma + React 19 SPA).

## §0 · Current substrate (verified in repo)

- **Dashboard endpoint** (`server/routes/dashboard.ts`) — headline counts
  (contacts/accounts/leads/open+won deals/tasks/overdue) + a per-stage pipeline
  snapshot with amounts and weighted totals.
- **Pipeline aggregation** (`server/lib/pipelines.ts`) — per-org default
  pipeline (stage key/label/probability/order), lazily seeded; deals carry
  `pipelineId` (null = default) and pipeline-derived probability.
- **Event-sourced history** — every `deal.stage_changed`, `lead.created`,
  `ticket.*`, `campaign.*`, `email.*` lands in the `Event` collection
  (ADR-004). Weighted forecasts, conversion metrics, and churn signals all
  derive from data that already exists.
- **Metrics precedents** — `campaignStats`/`deliverabilityMetrics`
  (`server/lib/campaigns.ts`) already compute engagement metrics **on read**
  so they can never go stale. Phase 6 generalizes that idea into a
  first-class metrics library.

## §1 · Scope (what this phase ships)

### 1.1 Metrics library — `server/lib/metrics.ts` (flag `analytics.metrics`)
One function `computeMetrics(orgId, environment, kind)` returns a group of
computed metrics for a dashboard kind. **Every metric carries data lineage**
(the 🆕 blueprint item): `{ key, label, value, format, sources: [{ entity,
query, note }] }` describing exactly which rows/events produced it, so a number
on screen is never mysterious.

**Sales dashboard:**
| Key | Value | Lineage |
|---|---|---|
| `openDeals` | open deal count | `Opportunity` rows, stage ∉ won/lost |
| `pipelineValue` | sum of open deal amounts | same rows, `amount` |
| `weightedPipeline` | Σ amount × stage probability | probability from the deal's pipeline stage |
| `wonDeals` / `wonAmount` | won count + amount | `stage: "won"` |
| `winRate` | won / (won + lost) | won + lost counts |
| `avgDealSize` | mean of won deal amounts | won rows |
| `salesVelocity` | avg deal size × winRate ÷ avg cycle days | + `Event` `deal.stage_changed` timestamps per deal (won only) |
| `pipelineCoverage` | weightedPipeline ÷ 90-day target (default: pipelineValue × 4) | derived, documented |

**Marketing dashboard:**
| Key | Value | Lineage |
|---|---|---|
| `campaignsSent` / `campaignsOpenRate` / `campaignsClickRate` | campaign sends + aggregate open/click rates | `CampaignRecipient` rows (live) |
| `campaignRoi` | Σ won deals on recipient contacts | attribution model (ADR-017) |
| `landingLeads` | leads with `source: "Landing page"` | `Lead` rows |
| `formSubmissions` | `Event` count for `form.submitted` | event-sourced |
| `leadsBySource` | lead counts grouped by `source` | `Lead` rows |

**Service dashboard:**
| Key | Value | Lineage |
|---|---|---|
| `openTickets` | tickets ∉ resolved/closed | `Ticket` rows |
| `breachedTickets` | `slaStatus` breached (read-time) | clock-derived + `breachedAt` |
| `avgFirstResponseHours` | mean time to first staff reply | `Ticket.firstResponseAt − createdAt` |
| `escalatedTickets` | `escalated: true` count | `Ticket` rows |
| `slaHealth` | 100 − 20×breachedRate (clamped 0–100) | derived, documented |

**Revenue dashboard:**
| Key | Value | Lineage |
|---|---|---|
| `wonAmount30d` / `wonAmount90d` | Σ won deal amounts in window | `won` rows + `Event` `deal.stage_changed → to won` timestamps |
| `openPipeline` | open weighted + raw pipeline | sales metrics |
| `activeCampaignRoi` | Σ campaign ROI | marketing attribution |
| `revenuePerContact` | wonAmount ÷ contacts | `Contact` count |

**Executive dashboard** = sales + marketing + service headline cards on one
screen (open pipeline, weighted pipeline, win rate, MRR-ish 30d revenue, open
tickets, campaigns open rate).

### 1.2 Forecasting — `server/lib/forecasts.ts` + `Forecast` model
- **Weighted forecast from the live pipeline:** per stage `amount ×
  probability`, summed into `Forecast` buckets:
  - `pipeline` — Σ open deal amounts (raw).
  - `weighted` — Σ amount × probability.
  - `commit` — Σ amounts of stages with probability ≥ 75% (negotiation, won).
  - `bestCase` — Σ amounts of stages with probability ≥ 50% (proposal+).
- **Per-owner forecast** — the same buckets grouped by deal `ownerId`
  (rep-level view the UI renders as a table).
- `POST /api/analytics/forecast/refresh` (admin) snapshots a `Forecast` row
  (org × env, the buckets + per-owner breakdown + the stage detail) and emits
  `forecast.updated`. `GET /api/analytics/forecast` returns the latest snapshot
  + a small **history** (previous snapshots, so the UI can show "vs last
  refresh"). Forecasts are also computed **on read** (live) for the dashboard
  so the numbers never go stale — the snapshot is the durable record.
- **Predictive v1** (statistical, documented, no external ML):
  - `conversionLikelihood(deal)` — a logistic-ish score from stage
    probability, deal age, and amount: `0.5 + 0.35·(prob/100) +
    0.15·sigmoid((amount−avgAmount)/avgAmount)` clamped 0–100.
  - `churnRisk(contact/account)` — a 0–100 score from inactivity (days since
    last event), unresolved ticket count, and no open deals.
  - `ltvEstimate(contact)` — Σ won deal amounts on the contact's account ÷
    active contacts, × an expected-lifetime multiplier (default 1.5, org
    setting `settings.analytics.ltvMultiplier`).
  These power the Predictions panel; each score explains its inputs.

### 1.3 Report builder — `Report` model + routes (flag `analytics.reports`)
- `Report` (org × env): `{ name, kind (sales|marketing|service|revenue), keys:
  string[] (metric keys), groupBy?, period? }` — a saved dashboard config.
- CRUD: reads open, writes admin-only (like segments/automations).
- `GET /api/reports/:id/data` — computes the live metrics for the report's
  keys/kind and returns `{ report, metrics }` with lineage — the UI renders
  metric cards from any saved report.

### 1.4 Thresholds → `metric.threshold_breached`
- The forecast refresh evaluates a small set of **thresholds** (defaults in
  `server/lib/metrics.ts`, overridable via `Organization.settings.analytics.
  thresholds`): `winRate < 30%`, `pipelineCoverage < 1.0`, `campaignsOpenRate
  < 20%`, `slaHealth < 70`.
- Each breached threshold writes a `Notification` (kind `metric`, for admins)
  and emits `metric.threshold_breached { key, value, threshold, direction }`.
  Notifications are read-only — no loops (no engine subscribes to it).

### 1.5 UI — Analytics section (nav: Dashboards + Reports)
- **Analytics page** (`/analytics`, flag `analytics.metrics`):
  - Dashboard kind tabs (Sales / Marketing / Service / Revenue / Executive).
  - Metric card grid — each card shows value + a **lineage popover**
    (sources: entity, query, note) — the data-lineage 🆕 surface.
  - **Forecast panel** — live weighted/commit/best-case/pipeline buckets, the
    per-owner table, history delta, and an admin "Refresh forecast" button
    (snapshot + `forecast.updated`).
  - **Predictions panel** — top conversion-likelihood deals, top churn-risk
    contacts, and LTV estimates.
  - **Threshold alerts** — recent `metric.threshold_breached` notifications
    shown inline.
- **Reports page** (`/reports`, flag `analytics.reports`): saved-report cards,
  create/edit modal (name, kind, metric-key multi-select), and a "View" mode
  rendering the report's live metric cards (from `/data`).

## §2 · Key decisions (becomes ADR-018)

1. **Metrics are computed on read from live rows + the event log — never
   stored.** Same discipline as `campaignStats`/`deliverabilityMetrics`: a
   number on screen can't go stale. The only persisted artifacts are
   `Forecast` snapshots (the durable forecast record + history) and `Report`
   configs.
2. **Data lineage is a first-class output.** Every metric returns its
   `sources` (entity, query, note) so the UI can show "this came from 12 won
   deals × 4 pipeline rows" — the blueprint's 🆕 lineage item, and the
   trust mechanism for the whole dashboard.
3. **Forecasting = weighted pipeline + snapshots.** The live weighted pipeline
   is the forecast; `refresh` snapshots it (with per-owner + stage detail)
   and emits `forecast.updated`. v1 models are transparent arithmetic (stage
   probability, sigmoid conversion, recency-based churn) — documented inputs,
   no black box.
4. **Reports are saved dashboard configs** (kind + metric keys), same
   row-as-config philosophy as segments/automations/journeys (ADR-003/015/017).
5. **Thresholds alert through the existing notification surface** — no new
   delivery machinery; `metric.threshold_breached` is cataloged but nothing
   subscribes to it (no loops).

## §3 · Events added (catalog `docs/03-event-catalog.md`)

| Event | When | Payload |
|---|---|---|
| `forecast.updated` | Admin refreshes a forecast snapshot | `{ buckets: { pipeline, weighted, commit, bestCase }, byOwnerCount }` |
| `metric.threshold_breached` | Forecast refresh trips a threshold | `{ key, value, threshold, direction }` |

## §4 · Non-goals (deferred, documented)

- Drag-and-drop dashboard canvas (Phase 13 no-code builder surface).
- Predictive models beyond the transparent v1 scores (Phase 8/9 AI layer owns
  real ML; the `ModelRoute`/`AIInsight` models land there).
- Export of reports (CSV export already covers object rows; report export is a
  small follow-up).

## §5 · Verification plan (`verify-phase6.sh`)

- Metrics library: each dashboard kind returns its keys with values + lineage;
  numbers match hand-computed expectations against seeded demo data (e.g.
  winRate = won/(won+lost), weightedPipeline = Σ amount×prob).
- Forecast: live buckets correct; refresh persists a `Forecast` row + emits
  `forecast.updated`; history lists snapshots; per-owner rows present; rep 403
  on refresh.
- Predictions: conversion/churn/LTV endpoints return scores with input
  explanations; values within [0,100] where applicable.
- Reports: CRUD + validation + admin gating; `/data` returns live metrics for
  the saved keys; rep read 200 / write 403.
- Thresholds: forcing a breached value (e.g. deleting won deals to sink win
  rate) trips `metric.threshold_breached` + an admin notification.
- Feature gates: `analytics.metrics` / `analytics.reports` flags 403/restore.
- Sandbox isolation: sandbox forecast/reports invisible in production.
- Full regressions: phases 1–5 suites green on the same stack.
