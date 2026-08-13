# 29 · Phase 9 Spec — AI Agent Platform (Autonomous, Governed)

> The spec that drives Phase 9 of QORVEXA CRM. Goal (from the blueprint):
> **AI performs work, not just suggests it.** Phase 8 shipped the non-agentic
> copilot (model router, data firewall, explainable generators). Phase 9 takes
> the next step on the same stack (Express 5 + Mongo via Prisma + React 19 SPA)
> with the same mock-provider discipline (ADR-014): agents are **declarative
> rows** that propose **risk-tiered actions** (🟢 automatic / 🟡 approval
> required / 🔴 human required — blueprint §3.4), execute only what their
> governance allows, and record every decision in an **AI audit trail** with
> **cost metering**. The kill switch, the testing/simulation lab, and the
> approval queue make the autonomy **safe to operate**, not just capable.

## §0 · Current substrate (verified in repo)

- **Phase 8 AI layer** — the model router (`ModelRoute` + `routeModel` with
  explainable decisions), the data firewall (`redactContext` / `firewallPolicy`
  that scrub PII **before any model input**), and the `AiInsight` audit surface
  are the agent's context pipeline: an agent run assembles a firewalled
  context, meters simulated cost against the cheapest routed model, and writes
  auditable rows — the blueprint's "AI is a layer" principle applied to agents.
- **Event bus + object model** — `Event` rows are the trigger substrate
  (`lead.created`, `deal.stage_changed`, `ticket.created`, …), and the generic
  object service executes agent tools (create task / update record / create
  ticket) through the same audit + event path as users (ADR-003/015 pattern).
- **Engine-subscriber pattern** — `startAutomationEngine` (Phase 3) and
  `startJourneyEngine` (Phase 5) established `onEvent("*")` + ticker engines;
  the agent engine follows both.
- **Governance model already defined** — `docs/04-permissions.md` §"AI action
  risk tiers" codified the 🟢🟡🔴 table; this phase implements and enforces it.
- **Notifications + RBAC** — `Notification` rows (kind `agent`) carry the
  approval + kill-switch alerts; `requireRole` + `assertActiveUser` gate the
  admin-only write surfaces exactly like automations/campaigns.

## §1 · Scope (what this phase ships)

### 1.1 Agent builder — `Agent` (flag `ai.agents`)
An agent is a **declarative row** (the ADR-015/017 row-as-config pattern):
- `trigger` — `{ kind: "event", event: "lead.created" | "deal.stage_changed" |
  "ticket.created" | … }` or `{ kind: "manual" }` (run from the UI/API).
- `rules` — field filters over the triggering record (same vocabulary as
  segments/automations: eq/neq/gt/gte/lt/lte/contains/in/…), so an agent acts
  on *who/what* it's allowed to.
- `tools` — an **allowlist** of what the agent may do: `create_task`,
  `notify`, `create_ticket`, `update_record`, `send_email`. Anything outside
  the allowlist is filtered out of a run — the agent literally cannot propose
  it.
- `tierPolicy` — **per-tool risk overrides** on top of the default tier table
  (`TOOL_TIERS`): `{ tool: "green" | "yellow" | "red" }`. Defaults: read-only
  internals 🟢 (`create_task`, `notify`, `create_ticket`), customer-facing
  sends + record/stage changes 🟡 (`send_email`, `update_record`).
- `memoryEnabled`, `active`, `killSwitched` — memory toggle, on/off, and the
  **per-agent kill switch** (🆕 blueprint).
- Running stats on the row: `runCount`, `successCount`, `approveCount`,
  `costTotal` (cheap "is this agent alive/expensive" signals, like Phase 3
  `runCount` on automations).
- **Pre-built agents** (blueprint): Lead Agent (`lead.created` — qualifies
  inbound leads), Sales Agent (`deal.stage_changed` — wins/negotiations/
  losses), Customer Service Agent (`ticket.created` — SLA guard), Renewal
  Agent (`deal.stage_changed` — 30-day renewal window + customer-facing
  outreach). Seeded by `npm run seed`.

### 1.2 Risk-tiered action system (blueprint §3.4)
Every proposed action carries a tier; the engine enforces it:
- 🟢 **Automatic** — executes immediately, in-run, through the generic object
  service (audit + events for free). Read-only internals + internal tasks.
- 🟡 **Approval required** — persisted as `proposed`; the run lands in
  `waiting_approval`; an admin/manager approves (`POST /api/agents/actions/:id/
  approve`) to execute, or rejects. Covers customer-facing sends and
  stage/status changes.
- 🔴 **Human required** — like 🟡 but **admin-only** approval (refunds,
  deletions, contract changes, large discounts per the blueprint table).
  A red action is **never** auto-executed by any path.
- Runs with any yellow/red action emit `agent.action_proposed` and notify the
  org's admins (kind `agent`, link to the approvals queue) — the
  human-in-the-loop surface is push, not poll.

### 1.3 AI audit trail — `AgentRun` + `AgentAction`
The blueprint's "input → data used → reasoning summary → action → result →
approval" is the run row:
- `AgentRun`: trigger, eventType, entity/entityId, **context** (the firewalled
  input + recent events + agent memory + model id), `reasoning` (the decider's
  explanation), `status` (`proposed → waiting_approval | executed | rejected |
  failed | skipped`), `riskSummary` `{ green, yellow, red }`, `cost`.
- `AgentAction`: tool, riskTier, params, reason, status, result, `approvedBy`,
  cost share.
- Events: `agent.action_proposed` / `agent.action_approved` /
  `agent.action_executed` / `agent.action_rejected` — the full lifecycle is in
  the same event log every other phase writes (webhooks + feed + future Time
  Machine for free).

### 1.4 Deciders — deterministic, explainable (per kind)
No black box (ADR-020 discipline). `decideActions(agent, record, event)` runs
kind-specific rule tables that return `{ actions, reasoning }`:
- **Lead** — score ≥ 70 = hot: fast follow-up task 🟢, owner ping 🟢,
  promote-to-qualified 🟡.
- **Sales** — `deal.stage_changed` to won/negotiation/proposal/lost: celebrate +
  referral task 🟢, prepare-next-artifact task 🟢, lost-deal analysis task 🟢.
- **Service** — high/urgent ticket: SLA-guarded response task 🟢 + assignee
  ping 🟢.
- **Renewal** — close date ≤ 30 days: renewal prep task 🟢, customer-facing
  renewal email 🟡 (seeded with the yellow override), owner reminder 🟢.
- **Custom** — baseline: notify the owner 🟢.
Every proposal carries an English `reason`; the run's `reasoning` is the
joined explanation — the UI shows why each action was proposed.

### 1.5 Kill switches (🆕 blueprint) — org-wide + per-agent
- **Org-wide** — `Organization.settings.agents.killSwitched`, toggled by
  `POST /api/agents/kill-switch` (admin), surfaced in the header of the Agents
  page, emits `agent.killed` (`scope: "org"`). Freezes **every** agent in the
  org × environment instantly (route-level 400 + engine-level skip).
- **Per-agent** — `Agent.killSwitched`, toggled by `POST /api/agents/:id/kill`
  (admin), emits `agent.killed` (`scope: "agent"`). Freezes one agent.
- The event-bus subscriber checks both before any run — a kill switch can
  never be bypassed by an event trigger.

### 1.6 Testing / Simulation Lab (🆕 blueprint) — `AgentTest`
`POST /api/agents/:id/test` dry-runs a scenario against a real record
**without executing anything**: it loads the record, matches rules, runs the
decider, and reports:
- `passed` — every proposed action is green or yellow (go-live safe),
- `blocked` — a 🔴 red-tier action was proposed (human required → not safe),
- `failed` — no actions proposed / rules didn't match / record missing.
Each simulation persists an `AgentTest` row (scenario name, entity, proposed
actions + tiers, risk summary, **predicted cost**) and the lab tab keeps the
history — the blueprint's "replay historical scenarios before go-live".

### 1.7 Cost metering (🆕 blueprint)
Every run and test meters a **simulated cost**: input tokens (the assembled
context) + output tokens (the proposals) × the cheapest active `ModelRoute`
price (per-1k in/out). `Agent.costTotal` rolls up per agent; the metering
endpoint (`GET /api/agents/metering`) reports total spend, per-agent bars, and
a **per-entity** breakdown (`byEntity` from `AgentRun` groupBy) — the
blueprint's "tokens/cost per agent/user/workflow/customer" v1.

### 1.8 Agent memory — `AgentMemory`
The agent's durable per-entity scratchpad (distinct from Phase 8's per-user
`AiMemory`): keyed by (agent, entity, entityId), written after a run
(`last.decision` = reasoning + proposed tools), fed into the next run's
context when enabled, TTL-purged by the engine ticker (60s).

### 1.9 Agent performance analytics
`GET /api/agents/analytics` — per agent: runs, success runs + **success rate**,
waiting approvals, actions, **escalation rate** (share of yellow/red actions),
cost; plus org totals. The blueprint's "success rate, escalation rate, cost"
dashboard on the Analytics tab.

### 1.10 UI — **Agents** page (nav "AI" section)
Five tabs:
- **Agents** — template cards (create from Lead/Sales/Service/Renewal/custom),
  the org kill switch, per-agent rows (tools + tiers, runs, cost, kill toggle,
  delete), live run results with per-action outcomes.
- **Approvals** — the human-in-the-loop queue (🟡/🔴 waiting actions with
  params + reasons; Approve & execute / Reject; red actions show admin-only).
- **Runs** — the audit trail (status, risk summary dots, model, cost, firewall
  redactions, reasoning).
- **Testing lab** — the simulation runner + test history (passed/blocked).
- **Analytics** — success/escalation stats + the cost metering view.
Plus an agent **detail drawer** (tools, manual run picker, recent runs,
memory, recent actions).

### 1.11 Demo data (`npm run seed`)
The four pre-built agents (Lead/Sales/Service/Renewal — Renewal carries the
🟡 `send_email` override), plus one seeded demo run on the Sales Agent (a won
deal) so the Runs + Analytics tabs have data on first login.

## §2 · Key decisions (becomes ADR-021)

1. **Agents are declarative rows, not code** — the ADR-015/017 pattern: a
   trigger + rules + tools + tier policy that an admin edits via the API/UI;
   the engine is the only "code". Governance composes with RBAC (write
   surfaces admin-only; approval is a separate admin/manager gate) instead of
   replacing it (blueprint: "governance composes with RBAC rather than
   replacing it").
2. **The action allowlist + tier table are the safety boundary** — tools not
   on the agent's list are filtered before execution; a tool's default tier
   can only be *raised* per-agent (override), never silently lowered below the
   blueprint defaults for customer-facing actions.
3. **Deterministic, explainable deciders** — same ADR-020 trade as Phase 8:
   rule tables now, real-model planning later behind the same firewall +
   audit trail. Every proposal ships a reason; every run ships the reasoning +
   the firewalled context.
4. **The run row IS the audit trail** — input → data used (firewalled context)
   → reasoning → proposed actions → approval → result, all persisted + evented.
5. **Safety rails are first-class** — the kill switch (org + per-agent), the
   dry-run lab, and the approval queue ship with the autonomy, not after it.
6. **Feature-gated** — `ai.agents` (enterprise), like every phase before it.

## §3 · Events added (catalog `docs/03-event-catalog.md`)

| Event | When | Payload |
|---|---|---|
| `agent.created` / `updated` / `deleted` | Agent lifecycle (admin) | `{ name, kind }` |
| `agent.action_proposed` | A run proposed an action | `{ runId, actionId, tool, riskTier, entity, entityId, reason }` |
| `agent.action_approved` | An admin/manager approved a 🟡/🔴 action | `{ actionId, runId, tool, status, result }` |
| `agent.action_executed` | A 🟢 action executed (or a 🟡/🔴 action after approval) | `{ runId, actionId, tool, status, result }` |
| `agent.action_rejected` | A 🟡/🔴 action was rejected | `{ actionId, runId, tool }` |
| `agent.killed` | Org-wide or per-agent kill switch toggled | `{ scope: "org" \| "agent", name?, on }` |

## §4 · Non-goals (deferred, documented)

- Real model-driven planning / tool use — deciders are deterministic rule
  tables; a real LLM planner slots in behind the same firewall + audit trail
  (Phase 9 groundwork is the governance, not the model).
- Multi-agent orchestration / agent-to-agent delegation (Phase 15).
- Long-term/organizational memory (Phase 15); memory here is per-entity, TTL,
  in-process rows (vector-store scale-up path documented in ADR-020).
- True per-user/customer billing — metering is simulated dollars against
  `ModelRoute` prices; invoicing is the blueprint's usage-billing phase.
- Agent permissions beyond the org-level role gates (per-agent RBAC is a
  Phase 13/14 item).

## §5 · Verification plan (`verify-phase9.sh`)

- **Seeds** — 4 pre-built agents + 4 templates + tier defaults
  (`send_email` → yellow) + org kill switch initially off.
- **RBAC** — reads open (rep list 200); agent create / kill-switch / approval
  admin-gated (rep → 403); unknown tool → 400.
- **Risk tiers** — Lead Agent on a hot lead (score 80): green `create_task` +
  `notify` execute immediately (task + notification exist), yellow
  `update_record` waits; run = `waiting_approval`, risk summary
  `green:2 yellow:1 red:0`; `agent.action_proposed` / `action_executed` events.
- **Approval** — manager approves the 🟡 action → executed, lead becomes
  `qualified`, run closes `executed`, `agent.action_approved` event; reject
  path closes a run `rejected` (+ `agent.action_rejected`).
- **Red tier** — a custom agent with `tierPolicy: { update_record: "red" }`
  tests `blocked` in the lab; a live run proposes the 🔴 action; manager
  approval → 400; admin approval → executed.
- **Engine trigger** — creating a cold lead auto-runs the seeded Lead Agent
  (`lead.created`, green:1) — the event-bus subscriber path.
- **Testing lab** — Sales Agent on a won deal → `passed` with the governance
  note; test history persists.
- **Kill switches** — per-agent kill → run rejected 400; org kill switch →
  engaged flag + run rejected 400 + `agent.killed`; both released.
- **Analytics + metering** — totals (runs ≥ seed + smoke), escalation rate,
  per-entity cost breakdown; agent memory (`last.decision`) present.
- **Feature gate** — `ai.agents` off → 403, on → 200; **sandbox isolation** —
  sandbox agents invisible in production, sandbox side-effects (tasks) never
  leak into production.
- **Full regressions** — phases 1–8 suites green on the same stack.
