# 30 · Phase 9 Build Report — AI Agent Platform

> What shipped to complete Phase 9 (the blueprint's "AI Agent Platform —
> Autonomous, Governed") end-to-end, the decisions behind it, and the
> verification evidence. Spec: `docs/29-spec-phase9.md` · Guide:
> `docs/31-agent-governance-guide.md` · Decision: ADR-021 in
> `docs/08-decision-log.md`. Status overview in `PROGRESS.md`. All live checks
> below ran against the real server (`localhost:8787`, Mongo via Docker,
> freshly seeded demo org).

## What shipped

### 1. Agent builder (`Agent` — `server/lib/agents.ts`, `server/routes/agents.ts`)
An agent is a **declarative row** (the ADR-015/017 row-as-config pattern, like
`Automation` / `Journey`): `trigger` (event or manual), `rules` (field filters
over the triggering record — the segment/automation field-op vocabulary),
`tools` (an **allowlist**: `create_task`, `notify`, `create_ticket`,
`update_record`, `send_email` — anything not listed is filtered before a run
can even propose it), `tierPolicy` (per-tool risk overrides), `memoryEnabled`,
`active`, `killSwitched`, and running stats (`runCount`, `successCount`,
`approveCount`, `costTotal`).

- CRUD at `/api/agents` (reads open — the page is a monitoring + governance
  surface; create/edit/delete admin-only, same as automations/campaigns).
- Event-triggered agents fire through the **event-bus subscriber**
  (`startAgentEngine` — `onEvent("*")`, like the workflow engine) and manual
  runs through `POST /api/agents/:id/run`.
- **Pre-built agents seeded** (blueprint): Lead (`lead.created`), Sales
  (`deal.stage_changed`), Customer Service (`ticket.created`), Renewal
  (`deal.stage_changed`) — plus one seeded demo run on the Sales Agent so the
  audit trail + metering have data on first login.

### 2. Risk-tiered action system (blueprint §3.4 — 🟢🟡🔴)
`TOOL_TIERS` defaults: `create_task` / `notify` / `create_ticket` 🟢,
`send_email` / `update_record` 🟡. Agents override per tool via `tierPolicy`.
Enforcement is mechanical: 🟢 executes in-run through the generic object
service (audit + events for free); 🟡 persists `proposed` → the run lands in
`waiting_approval` → admin/manager approve to execute; 🔴 is **admin-only**
(manager approval → 400) and never auto-executes. Every proposal carries an
English reason, and yellow/red runs **notify the org's admins** (kind
`agent`, link straight to the approvals queue).

### 3. AI audit trail (`AgentRun` + `AgentAction`)
The blueprint's "input → data used → reasoning → action → result → approval"
is the run row: the **firewalled context** (Phase 8 `redactContext` — PII
never enters the decision), recent events, agent memory, the decider's
`reasoning`, `riskSummary { green, yellow, red }`, and the metered cost. Each
proposal is an `AgentAction` (tool, tier, params, reason, status, result,
`approvedBy`). The lifecycle is evented end-to-end:
`agent.action_proposed → action_approved / action_rejected → action_executed`,
plus `agent.created/updated/deleted` and `agent.killed`.

### 4. Deciders — deterministic + explainable per kind
`decideActions(agent, record, event)` runs per-kind rule tables: Lead (score ≥
70 → fast follow-up task 🟢 + owner ping 🟢 + promote-to-qualified 🟡), Sales
(win → celebrate + referral task 🟢; negotiation/proposal → prep task 🟢; lost →
analysis task 🟢), Service (high/urgent → SLA-guarded response task 🟢 +
assignee ping 🟢), Renewal (≤30 days → prep task 🟢 + customer-facing renewal
email 🟡 + reminder 🟢; no close date → set-one task; passed → review task),
and a baseline notify for custom agents. Every action ships a reason; the run
ships the joined reasoning.

### 5. Kill switches (🆕 blueprint) — org-wide + per-agent
- Org-wide: `Organization.settings.agents.killSwitched` via
  `POST /api/agents/kill-switch` (admin) — freezes **every** agent (manual runs
  → 400 "Agent is kill-switched"; event-bus runs → skipped), emits
  `agent.killed` (`scope: "org"`), and is surfaced as a header banner on the
  Agents page.
- Per-agent: `Agent.killSwitched` via `POST /api/agents/:id/kill` (admin) —
  freezes one agent, emits `agent.killed` (`scope: "agent"`).

### 6. Testing / Simulation Lab (🆕 blueprint) — `AgentTest`
`POST /api/agents/:id/test` dry-runs a scenario against a real record with
**zero execution** and reports `passed` (every proposed action green or
yellow — go-live safe), `blocked` (a 🔴 action was proposed — human required),
or `failed` (no actions / rules didn't match). Each simulation persists
(scenario name, proposed actions + tiers, risk summary, predicted cost) and
the lab tab keeps the history.

### 7. Cost metering (🆕 blueprint)
Every run/test meters simulated cost: input tokens (context) + output tokens
(proposals) × the cheapest active `ModelRoute` price. `Agent.costTotal` rolls
up per agent; `GET /api/agents/metering` reports total, per-agent bars, and a
per-entity breakdown (groupBy `AgentRun.entity`). `GET /api/agents/analytics`
adds success rate + escalation rate (yellow/red share) per agent.

### 8. Agent memory + analytics
- `AgentMemory` — per-entity scratchpad (key `last.decision` = reasoning +
  proposed tools), written after runs, fed into future context, TTL-purged by
  the engine ticker (60s, same as Phase 8 `AiMemory`).
- `GET /api/agents/analytics` — per-agent success rate, escalation rate,
  waiting approvals, spend; org totals. The Analytics tab renders both.

### 9. Feature gates + UI
- `ai.agents` (enterprise) gates the whole `/api/agents` surface and the new
  **Agents** page (`/agents`, "AI" nav section, next to Copilot + Model
  router).
- **Agents page** — five tabs: **Agents** (template cards + create modal with
  per-tool tier pickers, the org kill switch, per-agent rows with run/cost
  stats + kill/delete), **Approvals** (the human-in-the-loop queue with
  params + reasons + admin-only red markers), **Runs** (the audit trail with
  risk-summary dots, model, cost, firewall redaction chips), **Testing lab**
  (simulation runner + history), **Analytics** (success/escalation stats +
  cost metering). An agent **detail drawer** adds the manual-run picker,
  recent runs, memory, and recent actions.
- The UI was wired into the app (route + nav) and typecheck-fixed as part of
  this phase's end-to-end pass (the page existed but was unreachable).

## Decisions (ADR-021)

1. **Agents are declarative rows, not code** — the ADR-015/017 pattern;
   governance composes with RBAC rather than replacing it.
2. **The allowlist + tier table are the safety boundary** — tools outside the
   list are filtered pre-run; per-agent `tierPolicy` overrides defaults.
3. **Deterministic, explainable deciders** — ADR-020 discipline: rule tables
   now, real-model planning later behind the same firewall + audit trail.
4. **The run row IS the audit trail** — input (firewalled) → reasoning →
   actions → approval → result, persisted + evented.
5. **Safety rails ship with the autonomy** — kill switch, dry-run lab,
   approval queue are first-class, not afterthoughts.
6. **Feature-gated** — `ai.agents` (enterprise), like every phase.

## Verification evidence

**Fresh-stack live suite `verify-phase9.sh` — 72/72 GREEN** (alongside
`verify-phase8.sh` 49/49 regression on the same stack; `npm run typecheck` +
`npm run build` green). Highlights:

- Seeds: 4 agents + 4 templates + tier defaults (`send_email` → yellow) +
  org kill switch off.
- RBAC: rep list 200; rep create / kill-switch / approval → 403; unknown tool
  → 400.
- Lead Agent manual run on a hot lead (score 80): `waiting_approval`,
  `green:2 yellow:1 red:0`; green `create_task` + `notify` executed (task +
  notification verified); yellow `update_record` queued; `agent.action_proposed`
  + `agent.action_executed` events.
- Approval: manager approves the 🟡 action → executed, lead → `qualified`, run
  → `executed`, `agent.action_approved`; reject path → run `rejected` +
  `agent.action_rejected`.
- Red tier: custom agent with `tierPolicy { update_record: "red" }` — lab
  test `blocked`; live run proposes 🔴; manager approval → 400; admin approval
  → executed.
- Engine trigger: creating a cold lead auto-ran the Lead Agent
  (`lead.created`, `executed`, green:1) — the event-bus path.
- Testing lab: Sales Agent on the seeded won deal → `passed` with the
  governance note; `AgentTest` history persisted.
- Kill switches: per-agent kill → run 400; org kill → engaged flag + run 400 +
  `agent.killed`; both released cleanly.
- Analytics/metering: totals ≥ seed + smoke runs, escalation rate, per-entity
  cost; agent memory `last.decision` with reasoning.
- Feature gate `ai.agents` off → 403 / on → 200; sandbox isolation: sandbox
  agent + its task invisible in production; production list clean.
- Cleanup: smoke agents + leads deleted; demo data left pristine.

## Docs produced

- Spec `docs/29-spec-phase9.md` · Guide `docs/31-agent-governance-guide.md`
  · ADR-021 in `docs/08-decision-log.md` · event-catalog + API-reference
  updates · `PROGRESS.md` Phase 9 → ✅ 100%.

## What's next (Phase 9 groundwork for later phases)

The governance layer — risk tiers, the kill switch, the dry-run lab, the audit
trail, metering — is exactly the substrate Phase 15 needs for multi-agent
orchestration and the Business Brain; Phase 13's agent marketplace will reuse
the template mechanism (`AGENT_TEMPLATES`), and real-model planning slots in
behind the firewall + decider interface without touching the rails above.
