# 50 · Phase 15 Build Report — Differentiators (the "1-of-1" Layer)

> How Phase 15 (spec `docs/49-spec-phase15.md`, ADR-027) was built and
> verified. Everything below was verified live against a freshly booted +
> seeded stack (`db drop → db push → seed → server on :8787`) with
> **`verify-phase15.sh` — 90/90 checks green**, plus regressions
> `verify-phase14.sh` (106/106) and `verify-phase13.sh` (53/53) green on
> fresh stacks. This closes the blueprint: **all 16 phases (0–15) are now
> complete** — the "1-of-1" layer lands on top of the finished platform.

## What shipped

**Backend — one module per differentiator under `server/lib/` + one router
(`server/routes/brain.ts` mounted at `/api/brain`):**

- **Business Brain (`brain.ts`)** — the `BusinessBrainInsight` ledger
  (blueprint entity): `scanBrain()` runs 8 deterministic rule families
  (stalled deals, stale pipeline, outlier deals, unreasoned outcomes,
  at-risk accounts, expansion radar, expected closes, breached SLAs),
  upserts by fingerprint, prunes stale open insights, and emits
  `insight.generated` for new ones. Status lifecycle + a 6-hour engine
  ticker.
- **Deal X-Ray** — 0–100 health score from 5 explained factors (stage,
  activity, committee coverage via Graph v2, competition, age) with flags,
  coverage breakdown, recommendation, and confidence.
- **AI Deal Detective** — root-cause for won/lost/open deals: event timeline,
  per-stage durations, price concessions from audit diffs, and an explained
  factor list + verdict summary.
- **Opportunity Radar** — consolidation of Phase 11 expansion radar + churn
  risks + weak deals (x-ray < 50) + breached SLAs into one feed; new signals
  emit `opportunity.detected` / `risk.detected` (24h dedup).
- **Relationship Graph v2 (`graph.ts`)** — derived member roles
  (champion / economic_buyer / technical / blocker / coach), committee
  coverage %, and missing-role gaps, for both the deal and account views
  (layered on the untouched Phase 7 influence graph).
- **Organizational memory (`memory.ts`)** — event-bus learning rules
  (`email.replied`, `deal.stage_changed` won, `contract.signed`,
  `invoice.paid`, …), fingerprint dedup, TTL purge, manual record/forget,
  and `memory.recorded`. Machine-learned entries use the system actor
  (ADR-026 §5) — a real bug found during verification: the engine originally
  wrote the literal `"system"` into `OrgMemoryEntry.createdBy`, a
  `@db.ObjectId` column, so **every** learning attempt failed with Prisma
  P2023 ("Malformed ObjectID") and the "learned Won on …" memory never
  appeared. Fixed with the zero-ObjectId actor sentinel.
- **Multi-agent orchestration (`orchestrate.ts`)** — `AgentOrchestrator`
  rows fan a trigger out to child Phase 9 agents (sequential/parallel), each
  delegation recorded (`AgentDelegation` + `AgentRun.parentRunId` chain) and
  evented (`agent.delegated`); dry-run test endpoint; the engine triggers
  event-based orchestrators autonomously.
- **CRM Time Machine (`timemachine.ts`)** — audit-trail reconstruction
  as-of any date (`reconstruct`/`compare`) + durable `TimeMachineSnapshot`
  captures (full-org or per-record) with retention pruning
  (`settings.brain.timeMachineRetentionDays`, default 90) and
  `snapshot.created`.
- **Business Digital Twin (`simulate.ts`)** — 5 deterministic scenario models
  (pricing / discount / churn / hiring / mix) over real org data, params
  validated, `SimulationRun` history + `simulation.completed`.
- **AI-built generators (`builder.ts`)** — natural-language → custom field /
  workflow / agent / report through the existing registries, duplicate
  refusal, `builder.generated` + a generation ledger.
- **Universal Business Query (`ubq.ts`)** — natural language → real
  aggregation (`{ entity, metric, dimension, filters, limit }`) with
  evidence, over the object + revenue collections.
- **Voice & computer-use console (`command.ts`)** — risk-tiered intent
  execution (🟢 execute / 🟡 propose / 🔴 refuse), UBQ routing, navigation,
  and simulated UI actions.
- **Feature gates** — `diff.brain/graph/memory/orchestration/timemachine/
  simulator/builder/command/ubq` registered in `lib/features.ts`, all
  default-on, per-org × environment (ADR-008).
- **Seed** — demo org memory fact, the "Lead intake → qualification"
  orchestrator, and a record snapshot so the Time Machine has history on a
  fresh stack (brain insights + simulation history are produced live by the
  scan/run endpoints).

**Frontend (`src/pages/BrainPage.tsx`, `src/App.tsx`,
`src/components/Layout.tsx`)** — the **Brain page** (`/brain`, "Brain" nav
section, gated by the `diff.*` flags) with 11 tabs: Brain (overview ledger +
radar + retention), Graph v2, X-Ray, Radar, Memory, Orchestration, Time
machine, Simulator, Builder, Query, Console — role-aware (admin writes).

## Verification highlights (from `verify-phase15.sh` — 90/90)

- **Seeds**: 1 org-memory fact, 1 orchestrator, 1 record snapshot,
  90-day retention.
- **RBAC**: 9 admin-only write surfaces → 403 for reps; reads + the
  collaborative memory record → 200/201.
- **Business Brain**: scan created insights (≥ 1 new), ledger ≥ 3 total,
  `insight.generated` persisted, acknowledge + dismiss lifecycle.
- **Deal X-Ray**: 0–100 score, exactly 5 explained factors, recommendation.
- **Deal Detective**: `verdict:"lost"` + `"won"`, root-cause factors, event
  timeline.
- **Graph v2**: deal committee with coverage 0–100 + missing-role gaps,
  derived member roles, account-level committee.
- **Radar**: scan emits ≥ 1 signal (weak_deal for a fresh deal),
  `risk.detected` persisted, feed non-empty.
- **Memory**: manual entry recorded/listed/forgotten; **event-bus learning**
  ("Won on …") after a deal moves to won (the P2023 fix).
- **Orchestration**: orchestrator created, dry-run test, real run delegated
  to the child Lead agent, `runCount` incremented, delegation row +
  `agent.delegated` persisted.
- **Time Machine**: past-state reconstruction (qualified), current state
  (negotiation), compare diff of the stage change, record + full snapshots,
  `snapshot.created`, list growth, **retention pruning** (≥ 1 expired
  snapshot pruned via the backdate script).
- **Simulator**: 5 models catalogued, pricing math exact (+10% → weighted
  pipeline × 1.1), 12-month churn projection, out-of-range params → failed
  run, history + `simulation.completed`.
- **Builder**: field built + duplicate → 400, workflow, agent, report,
  4-target catalog, `builder.generated`.
- **UBQ**: "total pipeline by owner" (sum, by owner, rows returned), "won
  deals this quarter" (stage filter), "top 5 accounts by MRR" (≤ 5), "how
  many contacts" (count), "average deal size" (avg).
- **Console**: 🟢 create_task executed, 🟢 query → UBQ, 🟡 draft proposed and
  **never sent**, 🔴 delete refused, 🟢 navigate, computer-use UI action,
  intent catalog.
- **Feature gates + sandbox**: `diff.ubq`/`diff.brain`/`diff.timemachine`
  off → 403; re-enable → 200; a production-only override leaves sandbox
  unaffected.

## Bugs found + fixed during verification

1. **Memory learning P2023** (`server/lib/memory.ts`) — the engine passed the
   literal `"system"` as `createdBy`/`actorId` into `@db.ObjectId` columns;
   every `deal.stage_changed`/`email.replied` learning attempt crashed inside
   Prisma and the memory was silently lost. Fixed with the ADR-026 §5
   zero-ObjectId system actor (`000000000000000000000000`).
2. **Graph v2 account crash** (`server/lib/graph.ts`) — `graphV2ForAccount`
   read `c.id`/`c.title` off nodes that nest the contact under `c.contact`
   (the deal variant was correct), so the account view 500'd on a
   `contactId: { in: [undefined, …] }` query. Fixed to `c.contact.id` +
   `c.contact.title`.
3. **`roles` Set serialization** (`server/lib/graph.ts`) — the v2 response
   returned a `Set` for `roles`, which JSON-serializes to `{}`; now
   `[...filled]`.
4. **Test-harness portability (verify-phase15.sh)** — (a) Git Bash on Windows
   mangles `\"` inside `python -c "…json.loads('''$JSON''')…"` args, so every
   JSON-embedding check that contained escaped quotes (insights, radar feed,
   snapshot list) failed to parse; converted all inline JSON checks to
   stdin piping. (b) em-dash deal-name matchers
   (`'Northwind — Retail Platform'`) failed to match under the Windows shell,
   silently producing empty deal ids → xray/detective hit
   `Cannot GET /api/brain/xray/`; switched to ASCII-safe matchers.
   (c) the full-org snapshot payload exceeds the Windows command-line limit →
   stdin. (d) the reconstruct-as-of-now check truncated to whole seconds,
   racing the audit entry's milliseconds; added a +2s buffer.

## Regression status

`verify-phase14.sh` 106/106 ✅ · `verify-phase13.sh` 53/53 ✅ (each on its own
fresh seeded stack) — the shared event-bus / engine / security infra is
unaffected. `npm run typecheck` + `npm run build` green.

## Related docs

Spec `docs/49-spec-phase15.md` · Business Brain methodology
`docs/51-business-brain-methodology.md` · Simulator assumptions
`docs/52-simulation-model-assumptions.md` · Time Machine retention policy
`docs/53-time-machine-retention-policy.md` · ADR-027
(`docs/08-decision-log.md`).
