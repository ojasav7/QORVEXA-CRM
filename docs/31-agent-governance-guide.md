# 31 · Agent Governance Guide — AI Agent Platform (Phase 9)

> How to operate the Phase 9 agent platform safely: the governance policy, the
> risk-tier reference table, the agent build guide, the approval flow, the
> testing lab, and the cost-control runbook. The engine itself is
> `server/lib/agents.ts` (ADR-021); the API surface is under `/api/agents`
> (flag `ai.agents`, feature-gated).

## 1. Governance policy (one paragraph)

Agents may **propose** work freely, but may only **do** what their tool
allowlist + risk tier permits: 🟢 actions execute automatically, 🟡 actions
wait for a human (admin/manager) approval, 🔴 actions wait for an **admin**
(human required — never automatic). The org kill switch and per-agent kill
switches can freeze everything or one agent instantly. Every run is audited
(input → firewalled context → reasoning → proposed actions → approval →
result) and metered (simulated cost). A red-tier proposal is the lab's
**blocked** verdict — a signal to raise the tier or re-scope the agent before
go-live. This composes with RBAC (writes admin-only) rather than replacing it.

## 2. Risk-tier reference table (blueprint §3.4, enforced)

| Tier | Meaning | Default tools | Who may approve | Example |
|---|---|---|---|---|
| 🟢 **Automatic** | Executes immediately in-run | `create_task`, `notify`, `create_ticket` | — (no approval) | Lead Agent schedules a follow-up task; Service Agent pings the assignee |
| 🟡 **Approval required** | Proposed, waits in the queue | `send_email`, `update_record` | admin / manager | Renewal Agent proposes a customer-facing renewal email; a stage/status change |
| 🔴 **Human required** | Proposed, waits, admin-only | (none by default — set via `tierPolicy`) | **admin only** (manager → 400) | refunds, deletions, contract changes, large discounts |

Rules of thumb:
- Defaults are conservative: anything customer-facing or state-changing is 🟡
  at minimum. `tierPolicy` only **raises** an agent's bar per tool; it never
  lowers the blueprint default below 🟡 for `send_email`/`update_record`.
- The tool **allowlist** is a hard boundary: an action whose tool isn't on the
  list is filtered out before the run — the agent cannot propose it, tier or
  no tier.
- 🔴 is for things a human must personally own. The testing lab will flag an
  agent as **blocked** if its logic proposes a red action for a scenario — use
  that signal, don't approve around it.

## 3. Agent build guide

An agent is a declarative row — no code. Fields:

| Field | Meaning | Example |
|---|---|---|
| `name` / `kind` | Display name + template kind (`lead`/`sales`/`service`/`renewal`/`custom`) | `"Inbound Lead Agent"`, `"lead"` |
| `trigger` | `{ kind: "event", event }` or `{ kind: "manual" }` | `{ kind: "event", event: "lead.created" }` |
| `rules` | Field filters on the triggering record (segment op vocabulary) | `[{ field: "score", op: "gte", value: 70 }]` |
| `tools` | Allowlist of permitted actions | `["create_task", "notify", "update_record"]` |
| `tierPolicy` | Per-tool tier overrides | `{ send_email: "yellow", update_record: "red" }` |
| `memoryEnabled` | Persist per-entity memory after runs | `true` |
| `active` / `killSwitched` | On/off + per-agent kill switch | `true` / `false` |

Build steps:
1. **Pick a template** (Lead / Sales / Service / Renewal) or start custom —
   the template sets kind, trigger, and a sensible tool list.
2. **Trim the tools to the minimum** the job needs — the allowlist is your
   first safety boundary.
3. **Set the rules** so the agent only acts on the right records (e.g. a
   lead-scoring rule `score ≥ 70` for the hot-lead path).
4. **Review tiers** — accept the defaults, or raise per tool. If any proposed
   action should never run unattended, make it 🔴.
5. **Dry-run in the Testing lab** against real records: expect `passed`
   (all green/yellow) or `blocked` (a red action — decide consciously).
6. **Run manually** on a live record to watch green actions execute and
   yellow/red land in Approvals.
7. **Enable the event trigger** and watch the Runs tab: status, risk summary,
   cost, and the firewall redaction chips per run.

## 4. The approval flow (human-in-the-loop)

1. A run with 🟡/🔴 actions ends in `waiting_approval`; the org's admins get a
   notification (kind `agent`, link to `/agents` → Approvals).
2. The Approvals tab shows each waiting action with its **params** (exactly
   what would execute), its **reason** (why the agent proposed it), and its
   tier.
3. **Approve & execute** runs the action as the agent (the run closes
   `executed` when nothing is left waiting). **Reject** closes it `rejected`.
   🔴 actions show the admin-only marker — managers get a 400 if they try.
4. Every decision is recorded (`approvedBy` on the action, `agent.action_approved`
   / `agent.action_rejected` events) — the audit trail is complete either way.

## 5. The testing lab (dry-run before go-live)

`POST /api/agents/:id/test` with `{ entity, entityId, name }` runs the full
pipeline (rules → context → decider) **without executing**:
- `passed` — every proposed action is 🟢 or 🟡 → go-live safe.
- `blocked` — a 🔴 action was proposed → human required; not safe unattended.
- `failed` — no actions proposed or the rules didn't match.

Verdicts persist as `AgentTest` rows with the proposed actions, risk summary,
and predicted cost — keep a library of scenarios per agent and re-run after
every edit. A good go-live checklist: every scenario you care about is
`passed`, the kill switch is within reach, and the Approvals queue is
something you actually check.

## 6. Cost-control runbook (🆕 metering)

- **Where to look:** Agents page → Analytics tab (per-agent spend bars) and
  `GET /api/agents/metering` (total + per-entity breakdown). Cost is
  simulated: input/output tokens × the cheapest active `ModelRoute` price.
- **What drives spend:** the number of runs (event triggers fire on every
  matching event) and the size of the assembled context (record + recent
  events + memory).
- **Controls:**
  1. **Narrow triggers + rules** — a rule like `score ≥ 70` cuts cold-lead
     runs to the ones that matter.
  2. **Tighten tool lists** — fewer proposals = fewer metered outputs.
  3. **Disable agents** you're not actively tuning (`active: false`).
  4. **Per-agent kill switch** for a specific runaway; **org kill switch**
     for everything, instantly.
  5. Watch `approveCount` / escalation rate in Analytics — an agent that
     escalates constantly is costing human time, not just tokens.

## 7. Kill switches (emergency)

- **Per-agent:** `POST /api/agents/:id/kill` `{ on: true }` — freezes one
  agent (manual runs → 400; event runs → skipped). Toggle off to re-enable.
- **Org-wide:** `POST /api/agents/kill-switch` `{ on: true }` (admin) — freezes
  every agent in the org × environment; the Agents page header shows the
  engaged banner. Both emit `agent.killed`.
- A kill switch is checked **before** every run, event-triggered or manual —
  there is no path around it.

## 8. Data hygiene

- Every run's context is scrubbed by the Phase 8 data firewall **before the
  decider sees it** (PII → `[REDACTED]`), and the redaction log rides on the
  run — agent decisions are made and audited on the same privacy boundary as
  the copilot.
- Runs/actions/memory/tests are deleted with their agent
  (`DELETE /api/agents/:id`); agent memory is per-entity with a TTL and the
  engine ticker purges expired rows.
