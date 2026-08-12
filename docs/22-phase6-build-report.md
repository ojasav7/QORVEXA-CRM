# 22 · Phase 6 Build Report — Analytics, Forecasting & BI

> What shipped to complete Phase 6 (the blueprint's "Analytics, Forecasting &
> Business Intelligence" phase) end-to-end, the decisions behind it, and the
> verification evidence. Spec: `docs/21-spec-phase6.md` · Decision: ADR-018 in
> `docs/08-decision-log.md`. Status overview in `PROGRESS.md`. All live checks
> below ran against the real server (`localhost:8787`, Mongo via Docker,
> freshly seeded demo org).

## What shipped

### 1. Metrics library with data lineage (`server/lib/metrics.ts`) — ADR-018
- **Every metric is COMPUTED ON READ** from live rows + the event log (same
  discipline as `campaignStats` / deliverability) — a number on screen can
  never go stale. Nothing metric-shaped is stored.
- **Five dashboard groups** over the org × environment scope: `sales`
  (open deals, pipeline value, **weighted pipeline**, won amount, **win rate**,
  avg deal size, **sales velocity**, pipeline coverage), `marketing`
  (campaign recipients, open/click rates, **attributed campaign ROI**, landing
  leads, form submissions, leads-by-source, contacts), `service` (open tickets,
  SLA breached, **avg first-response hours**, escalated, **SLA health**),
  `revenue` (won 30/90-day, weighted pipeline, campaign ROI, revenue/contact),
  and `executive` (headline cards pulled across the other four).
- **Data lineage is a first-class output**: every metric carries
  `sources: [{ entity, query, note }]` — exactly which rows/events produced
  the number. The Analytics UI renders a per-metric "why is this number what
  it is" popover; `GET /api/analytics/sources` is the lineage dictionary.
- **Thresholds** (`winRate` / `pipelineCoverage` / `campaignsOpenRate` /
  `slaHealth`) — org-configurable via `Organization.settings.analytics
  .thresholds`, defaults in `DEFAULT_THRESHOLDS`. Evaluated by the forecast
  refresh; breaches write **admin notifications** (`kind: "metric"` → header
  bell) and emit **`metric.threshold_breached`**.

### 2. Sales forecasting (`server/lib/forecasts.ts`)
- **Live weighted forecast** — `pipeline` (raw open amounts), `weighted`
  (Σ amount × pipeline-derived probability), `commit` (stages ≥75%), `bestCase`
  (stages ≥50%) — plus **per-stage rows** and **per-owner rows** (owner names
  resolved against the user table, unknown/system actors labeled "System").
- **Snapshots are the durable record**: `POST /api/analytics/forecast/refresh`
  (admin) persists a `Forecast` row (buckets + stages + byOwner JSON) that
  doubles as **history** (`GET /api/analytics/forecast` returns the latest 10
  snapshots) and emits **`forecast.updated`**. Weighted pipeline is now
  computable for any past moment the snapshot was taken — the Phase 6-lite
  "weighted forecasts are ready to compute" substrate, formalized.

### 3. Predictive analytics v1
- Transparent arithmetic (documented inputs, no black box — every score
  returns an `inputs` breakdown the UI shows):
  - **Conversion likelihood** (0–100): stage probability (.5) + deal amount
    vs org average via sigmoid (.25) + deal age decay (.25).
  - **Churn risk** (0–100): inactivity since the entity's last event, 60-day
    grace (.5) + open tickets (.3) + no open deals (.2).
  - **LTV estimate**: Σ won amounts on the contact/account ÷ account contacts
    × lifetime multiplier (`settings.analytics.ltvMultiplier`, default 1.5).
- `GET /api/analytics/predictions` returns the top deals by conversion score,
  top contacts by churn risk, and top LTVs.

### 4. Report builder (`server/routes/reports.ts`, flag `analytics.reports`)
- A `Report` row is a saved dashboard config: `name` + `kind` + `keys`
  (metric keys). **`GET /:id/data` renders the LIVE metrics for exactly those
  keys with full lineage** — reports can never show a stale number.
- Reads open to any authenticated user; writes admin-only (org config like
  segments/automations). CRUD emits `report.created/updated/deleted`.
- Malformed/unknown report ids → 404 (ObjectId shape guard, post-verify fix).

### 5. Wiring + events
- `server/index.ts` mounts `/api/analytics` (flag `analytics.metrics`) and
  `/api/reports` (flag `analytics.reports`) — both default-on.
- Event catalog additions: `forecast.updated` (snapshot persisted),
  `metric.threshold_breached` (metric fell below its configured threshold),
  `report.created/updated/deleted`.

### 6. UI — two pages under a new **Analytics** nav section
- **Analytics** (`/analytics`): dashboard-kind tabs (Sales / Marketing /
  Service / Revenue / Executive) rendering the metric cards with format-aware
  values (currency/percent/number), a **lineage popover** per metric
  ("why is this number what it is"), the **forecast panel** (bucket tiles +
  per-stage bars + per-owner rows + snapshot history + admin refresh), the
  **predictions tab** (conversion/churn/LTV cards with their input
  breakdowns), and a **thresholds editor** (org settings) with breach
  notifications. Feature-gated by `analytics.metrics`.
- **Reports** (`/reports`): saved report cards, create/edit modal (pick a
  kind + metric keys), and live data rendering with lineage. Feature-gated by
  `analytics.reports`.

### 7. Seed
- A `Forecast` snapshot (so forecast history has a pre-refresh datapoint) and
  the "Sales deep dive" report (`kind: sales`, keys
  `openDeals, winRate, weightedPipeline, pipelineValue, salesVelocity`) — the
  Analytics + Reports pages have data on first login.

## Decisions (ADR-018)

Metrics are **derived, never stored** — computed on read from live rows + the
event log (ADR-004), which is what makes data lineage possible at all: a
number knows the exact rows/events that produced it. The **only** persisted
Phase-6 artifacts are `Forecast` snapshots (the durable forecast record +
history) and `Report` configs (the saved-view definition; `data` is always
live). Forecasting is the **weighted pipeline** — per-stage amount ×
pipeline-derived probability, bucketed (pipeline / weighted / commit /
bestCase) and rolled per owner. Predictive v1 is **transparent arithmetic**
with documented inputs — no black box, so a score is explainable and auditable.
Thresholds evaluate at refresh time (the same admin action that snapshots the
forecast) and surface through the existing notification + event surfaces. See
`docs/21-spec-phase6.md` §2 for the full rationale.

## Bugs found & fixed during verification

1. **`metric.threshold_breached` events never persisted** — the event's
   `entityId` was the metric key (`"winRate"`), which is not a valid Mongo
   ObjectId, so `Event.create` threw and `emitEvent` (which never throws to
   the caller) swallowed it — notifications appeared, events didn't. Fixed:
   the event now uses an all-zero ObjectId sentinel with the key in the
   payload (the `forecast.updated` event already used a real row id).
2. **Malformed report ids → 500 instead of 404** — `GET /api/reports/
   does-not-exist` (not a 24-hex ObjectId) made Prisma throw before
   `findFirst` could return null. Fixed: an ObjectId shape guard on every
   `:id` route → clean 404 (consistent with the "unknown → 404" contract).
3. **Verify-script bugs** (suite-side, not server): the opportunities filter
   param is `stage` not `status` (winRate arithmetic check compared against
   zero); the lineage grep needed `-F` (fixed-string, the pattern contained
   regex braces); the forced-threshold test set the winRate threshold **equal**
   to the current value, and `value < threshold` never fires on equality (it
   now sets threshold = value + 1); and the winRate string comparison hit the
   JSON-integer `90` vs Python-float `90.0` formatting mismatch (now a numeric
   tolerance comparison).

## Verification evidence

- `npm run typecheck` ✅ · `npm run build` ✅ (production bundle, `dist/`).
- **Live smoke suite (`verify-phase6.sh`, 44/44 green):**
  - Metrics: all five dashboard kinds render with ≥5 metrics; every metric
    carries `sources` lineage; **winRate matches live data arithmetically**
    (won ÷ won+lost, verified against the real records); the metrics endpoint
    returns all 4 groups.
  - Forecast: live buckets present, **weighted ≤ pipeline** sanity holds,
    per-owner rows resolve names; refresh persists a snapshot (history grows
    4 → 5), emits `forecast.updated`, and **rep refresh → 403**.
  - Predictions: conversion scores 0–100 with input breakdowns, churn 0–100,
    LTVs present.
  - Reports: create → read (rep 200) → **rep create 403** → data returns
    exactly the requested keys → rename PATCH → **malformed id 404** →
    missing-name 400.
  - Thresholds: forced threshold tripped a breach, **`metric.threshold_breached`
    event emitted with `key: winRate`**, admin notified (`kind: "metric"`).
  - Feature gates: `analytics.metrics` + `analytics.reports` disable → 403 /
    re-enable → 200.
  - Sandbox isolation: sandbox reports invisible in production + visible in
    sandbox; forecast snapshots are environment-scoped.
  - Cleanup: smoke reports deleted; demo data left pristine.
- **Regressions on the same stack:** `verify-phase5.sh` 65/65,
  `verify-phase4.sh` 61/61, `verify-phase3.sh` 34/34, `verify-phase2-comm.sh`
  45/45, `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 — all green.
- **Browser check** (login → Analytics nav → dashboard tabs with metric
  cards → lineage popovers → forecast panel + refresh → predictions →
  Reports page with the seeded report + live data): all rendered, zero console
  errors.

## Docs updated

`docs/21-spec-phase6.md` (spec, new), `docs/22-phase6-build-report.md` (this
report), `docs/03-event-catalog.md` (Phase 6 events), `docs/05-api-reference.md`
(Analytics / Reports sections), `docs/08-decision-log.md` (ADR-018),
`PROGRESS.md` (Phase 6 → ✅ 100%), `docs/06-roadmap.md` (Phase 6 → ✅ shipped),
`README.md` (Phase 6 feature list), `docs/10-continuation-runbook.md`
(Phases 0–6).
