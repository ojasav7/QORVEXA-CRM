# 49 · Phase 15 Spec — Differentiators (the "1-of-1" Layer)

> The spec that drives Phase 15 of QORVEXA CRM — the 16th and final blueprint
> phase. Goal (from the blueprint): **features no competitor combination
> currently offers as one coherent system** — the Business Brain, Relationship
> Graph v2, Customer/Organizational Memory, Multi-Agent Orchestration, Deal
> X-Ray, the Opportunity Radar, the AI Deal Detective, the CRM Time Machine,
> the Business Digital Twin (What-If simulator), AI-built generators, the
> Voice/Computer-Use console, and Universal Business Query. Same stack
> (Express 5 + Mongo via Prisma + React 19 SPA), same ADR discipline
> (row-as-config, derived-on-read, every state change evented — ADR-027), and
> the same rule of thumb that every prior AI phase followed (ADR-014/020/021):
> **everything is deterministic + explainable + evented, reads are open to
> authenticated users, and config writes are admin-only.**

## §0 · Current substrate (verified in repo)

- **The object model + event bus (Phase 0)** — every deal/ticket/account
  change is an audited, evented row. The Time Machine replays the **audit
  trail** (`AuditLog` — one row per field-level mutation with before/after
  snapshots); the Deal Detective + Memory engine consume the **event log**
  (`Event`); the Business Brain reads live rows + the event log.
- **Phase 8 AI discipline** — the model router, data firewall, and audited
  `AIInsight` trail established the pattern Phase 15 follows: outputs are
  derived deterministically with explicit evidence, never black-box.
- **Phase 9 agents** — the declarative `Agent` rows + risk-tiered action
  system (🟢 auto / 🟡 approval / 🔴 human) + the testing lab are the children
  that Multi-Agent Orchestration fans work out to (`agent.delegated`).
- **Phase 7 CDP** — the relationship graph v1 (influence scoring over real
  touchpoints) + the Customer 360 profiles are the substrate for Graph v2.
- **Phase 11 customer success** — `churnForAccount` (explained factor list),
  the expansion radar, and usage intelligence feed the Brain's at-risk +
  expansion scans and the Opportunity Radar.
- **Phase 14 security** — org × environment scoping (ADR-008), feature flags,
  RBAC, and the system-actor convention (`000000000000000000000000` — ADR-026
  §5) are reused unchanged.

## §1 · Scope (what this phase ships)

### 1.1 Business Brain (flag `diff.brain`)

The blueprint's *"org-wide AI layer synthesizing opportunities/risks/
anomalies/recommendations across every module"* — as a **`BusinessBrainInsight`
ledger** (blueprint entity), derived on read by `scanBrain()` rule scans:

- **Stalled deals** (risk) — an open deal with no recorded activity in ≥ 30d.
- **Stale pipeline** (risk) — an open deal ≥ 60d old at < 40% probability.
- **Outlier deal** (anomaly) — amount > 3× the org's average open deal.
- **Unreasoned outcomes** (recommendation) — won/lost without a recorded
  win/loss reason (feeds the Deal Detective).
- **At-risk accounts** (risk) — Phase 11 churn risk ≥ 70 (severity from the
  score, evidence = the churn factor list).
- **Expansion opportunities** (opportunity) — Phase 11 expansion radar items.
- **Expected closes** (opportunity) — ≥ 70% probability closing within 30d.
- **Breached SLAs** (risk) — open tickets with `breachedAt` set.

Every insight carries `category`, `severity`, `title`, `summary`, `source`,
`evidence` (explicit inputs), a `recommendation`, and a **fingerprint** — the
same scan **upserts** by fingerprint (never duplicates) and emits
`insight.generated` **only for new** ones. The scan also **prunes** open
insights whose fingerprint no longer matches reality (a stalled deal that
closed disappears). Status lifecycle: `open → acknowledged | actioned |
dismissed` via `POST /api/brain/insights/:id/:action`.

- `POST /api/brain/refresh` — admin-triggered scan (returns
  `{ created, updated, pruned, total }`); also run by the engine ticker
  (6-hourly, guarded, never at boot so a fresh stack is exact).

### 1.2 Relationship Graph v2 (flag `diff.graph`)

`server/lib/graph.ts` layers **derived roles + committee coverage** on top of
the Phase 7 influence graph (which stays untouched):

- **Roles** — each committee member is classified from title + involvement:
  `champion` (primary contact or influence ≥ 60), `economic_buyer`
  (owner/CxO/VP/head titles), `technical` (CTO/engineer/architect/IT),
  `blocker` (procurement/legal/compliance — or ≥ 2 open tickets), else `coach`.
- **Coverage** — % of the expected roles (`champion`, `economic_buyer`,
  `technical`, `coach`) that are filled (coaches don't count toward
  coverage).
- **Gaps** — the missing expected roles, so the rep sees *who isn't in the
  deal yet*.
- `GET /api/brain/graph?dealId=` returns the deal's committee with roles +
  `coverage` + `gaps`; `?accountId=` returns the account-level committee.

### 1.3 Organizational / customer memory (flag `diff.memory`)

`OrgMemoryEntry` rows — *"persistent AI memory across every interaction"*:

- **Learning rules** — the memory engine subscribes to the whole event bus
  (`onEvent("*")`) and learns deterministic facts/observations: `email.replied`
  → "prefers email", `email.bounced` → stale address, `meeting.completed` →
  met on date X, `ticket.created` → reached out for support,
  `deal.stage_changed` (won) → "Won on …", `invoice.paid` → pays on time,
  `contract.signed` / `subscription.renewed` → renewal date.
- **Dedup** — each entry carries a fingerprint (scope + sourceEvent +
  content), so the same lesson is never learned twice.
- **TTL** — entries carry `expiresAt` (per-rule windows) and the ticker
  purges expired rows.
- **Manual entries** — any authenticated user can record org/account/contact/
  opportunity/lead/ticket memory (`POST /api/brain/memory`); forget via
  `DELETE /api/brain/memory/:id`. Every entry emits `memory.recorded`
  (machine-learned entries use the system actor, ADR-026 §5).

### 1.4 Multi-agent orchestration (flag `diff.orchestration`)

`AgentOrchestrator` rows fan a trigger out to **child Phase 9 agents**:

- Trigger `event | manual`; `childAgentIds`; `mode: sequential | parallel`;
  `active`; `runCount`.
- `POST /api/brain/orchestrators/:id/run` runs the orchestrator against an
  entity — each child gets an `AgentDelegation` row (`parentRunId` chain) and
  the child's `AgentRun`; `agent.delegated` fires per delegation.
- `POST /api/brain/orchestrators/:id/test` dry-runs without executing
  (`wouldRun` children), and `GET .../delegations` lists the chain.
- The engine subscribes to the event bus and triggers event-based
  orchestrators autonomously (e.g. the seeded **Lead intake → qualification**
  orchestrator fans every `lead.created` out to the Lead + Sales agents).

### 1.5 Deal X-Ray (flag `diff.brain`)

Explainable, evidence-backed **deal health scoring** (`GET /api/brain/xray/:dealId`):

- Score 0–100 = weighted sum of 5 explained factors:
  `stage` (probability, 30%), `activity` (events in the last 14/30 days, 25%),
  `committee coverage` (Graph v2, 20%), `competition` (competitor present,
  10%), `age` (15%).
- Outputs the factor inputs, **flags** ("no activity in 30 days", "thin buying
  committee", "competitor present", …), the coverage breakdown, a plain
  `recommendation`, and a confidence score (activity + coverage).

### 1.6 Opportunity Radar / early-warning system (flag `diff.brain`)

`GET /api/brain/radar` (feed) + `POST /api/brain/radar/scan` (admin; emits
events): a consolidated signal feed of:

- **Expansion** — Phase 11 upsell / cross-sell opportunities.
- **Churn risk** — accounts scoring ≥ 70 (Phase 11) with the playbook detail.
- **Weak deals** — open deals scoring < 50 on Deal X-Ray, with the reasons.
- **Breached SLAs** — open tickets past their deadline.

New signals emit `opportunity.detected` / `risk.detected` (24-hour dedup by
fingerprint). The Brain overview surfaces the feed as by-kind counts.

### 1.7 AI Deal Detective (flag `diff.brain`)

Root-cause investigation for won/lost (and at-risk open) deals
(`GET /api/brain/detective/:dealId`): walks the deal's **event + audit trail**
into an explained timeline, per-stage durations, amount changes (price
concessions from audit diffs), and root-cause **factors** — win/loss reason,
price pressure, competition, stall signals, long stages — plus a one-line
summary with the verdict.

### 1.8 CRM Time Machine (flag `diff.timemachine`)

Two complementary mechanisms (blueprint entity `TimeMachineSnapshot`):

1. **Reconstruction (derived on read)** — `GET /api/brain/timemachine/reconstruct?entity=&id=&asOf=` replays the audit trail to the **last audit
   write ≤ asOf** and returns that state (exact because every mutation is
   audited). `compare` diffs two dates (`{ changed, removed, added }`).
2. **Snapshots (durable)** — full-org (`scope: full`, every object/comm/
   revenue collection) or per-record (`scope: record`) captures with a
   **retention window** (`settings.brain.timeMachineRetentionDays`, default
   90) — pruned on every capture + by the daily engine tick;
   `snapshot.created` per capture.

### 1.9 Business Digital Twin / What-If simulator (flag `diff.simulator`)

`SimulationRun` rows (blueprint entity) — deterministic scenario models over
**real org data**, never mutating anything (runs recompute derived metrics and
persist):

| Scenario | Params | What it answers |
|---|---|---|
| `pricing` | `priceChangePct` (−50…100) | weighted pipeline if every open deal's amount moves ±pct |
| `discount` | `discountPct` (0…60) | weighted pipeline after an average concession |
| `churn` | `churnRatePct` (0…30), `months` (1…36) | MRR/ARR projected month-by-month at a churn rate |
| `hiring` | `newReps` (1…50) | per-rep pipeline load after hiring |
| `mix` | `shiftStage` (10…100), `shiftPct` (0…100) | stage-mix probability shift |

Every run persists `{ name, scenario, params, results, summary, status }`,
emits `simulation.completed`, and **states its assumptions** (see
`docs/52-simulation-model-assumptions.md`). Out-of-range params are validated
→ the run is recorded as `failed` with the reason.

### 1.10 AI-built generators (flag `diff.builder`)

Natural language → **working configuration** (`POST /api/brain/builder`):
a deterministic prompt parser targets the existing registries — custom
**fields** (`FieldDef`), **workflows** (Phase 3 `Automation`),
**agents** (Phase 9 `Agent`), and **reports** (Phase 6 `Report`). Duplicate
generation is refused (400). Emits `builder.generated` and keeps a
`{ entityType, id, prompt, applied }` ledger; `GET /api/brain/builder/catalog`
lists the 4 targets.

### 1.11 Voice CRM & computer-use console (flag `diff.command`)

`POST /api/brain/command` — operate the CRM by natural language (voice
transcript) or simulated computer-use actions, with the **risk-tier
discipline** (ADR-021): 🟢 intents (`create_task`, `query` → UBQ, `navigate`,
`computer_use` UI actions) execute as the calling user; 🟡 (`draft_email`,
`update_record`) **proposes but never sends**; 🔴 (destructive) is refused.
`GET /api/brain/command/catalog` lists the intents.

### 1.12 Universal Business Query (flag `diff.ubq`)

`GET /api/brain/ubq?q=` — one search bar answering cross-object questions.
A transparent parser maps natural language to
`{ entity, metric (sum|count|avg|max), dimension, filters, limit }` and runs
the real aggregation against live rows with evidence:
"total pipeline by owner", "won deals this quarter", "top 5 accounts by MRR",
"how many contacts", "average deal size". No query → example list.

## §2 · New entities / events

**Entities (Prisma):** `BusinessBrainInsight`, `TimeMachineSnapshot`,
`SimulationRun`, `OrgMemoryEntry`, `AgentOrchestrator`, `AgentDelegation`
(plus `AgentRun.parentRunId` for the delegation chain).

**Events:** `insight.generated`, `snapshot.created`, `simulation.completed`,
`memory.recorded`, `opportunity.detected`, `risk.detected`,
`agent.delegated`, `builder.generated` (all org × environment scoped,
ADR-008).

## §3 · Permissions & risk tiers

- **Reads** (`overview`, `insights`, `xray`, `detective`, `radar`, `graph`,
  `memory`, `orchestrators`, `timemachine/*` reads, `simulations`, `ubq`,
  `command` 🟢 execution) — any authenticated user.
- **Writes** (`refresh`, `radar/scan`, `orchestrators` CRUD + run,
  `timemachine/snapshot`, `simulate`, `builder`) — **admin-only**
  (`requireRole("admin")`); reps get 403 (verified).
- **Risk tiers** — the console + agents keep the 🟢🟡🔴 discipline: 🟢
  executes, 🟡 proposes (approval queue), 🔴 never automatic.
- **Feature gates** — `diff.brain/graph/memory/orchestration/timemachine/
  simulator/builder/command/ubq`, all default-on, per-org × environment
  (ADR-008); sandbox overrides never affect production and vice versa
  (verified).

## §4 · UI surface

The **Brain page** (`/brain`, "Brain" nav section) with 11 tabs — Brain
(overview: insight ledger by category/severity + radar by kind + retention),
Graph v2, X-Ray, Radar, Memory, Orchestration, Time machine, Simulator,
Builder, Query, Console. Role-aware (admins see the write actions).

## §5 · Configuration

- `Organization.settings.brain.timeMachineRetentionDays` (default 90).
- Feature-flag overrides per org × environment (`/api/features`).

## §6 · Known limitations / deferred

- Graph v2 roles are **derived** (title + involvement heuristics), not
  curated — manual role overrides are deferred.
- The simulator models are deterministic arithmetic (no probabilistic Monte
  Carlo); assumptions are documented per model.
- Memory learning is rule-based (deterministic event → fact mapping), not
  generative summarization.
- The voice/computer-use console accepts **text transcripts** (voice
  transcription itself + real browser automation are provider/device
  concerns, mocked per ADR-014).
- UBQ covers the object + revenue collections it parses; novel phrasings fall
  back to the example list rather than hallucinating a query.
