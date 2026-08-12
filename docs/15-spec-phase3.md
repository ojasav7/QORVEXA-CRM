# 15 · Technical Spec — Phase 3: Automation & Workflow Engine

> Implementation-ready spec for Phase 3 (the blueprint's "Automation & Workflow
> Engine"): a visual workflow builder over the event bus — **trigger →
> condition → action** — plus the reserved `task.completed` event, in-app
> notifications, a per-run action log (conflict resolution), and duplicate
> automation detection.
> Audience: future-you or an AI agent building this next. Follows ADR-015 in
> `docs/08-decision-log.md`. Companion reports: `docs/16-phase3-build-report.md`
> (verification evidence).

---

## 1. Goal

Let an admin compose **workflows** — "when <event happens>, if <conditions
hold>, do <actions>" — from a builder UI, with every execution logged and
every action's outcome visible, so conflicting or misbehaving automations are
discoverable instead of mysterious. The trigger substrate already exists:
`onEvent(type, cb)` in `server/lib/events.ts` fans every persisted event to
in-process subscribers (ADR-004).

**Done** = an admin can: create a workflow ("when a deal moves to `won`, if
`amount ≥ 50 000`, notify the deal owner and create a follow-up task"), toggle
it on/off, test it against a record, see a run log with per-action outcomes,
and be blocked (with an override) from creating a workflow that duplicates an
existing one. A rep sees in-app notifications and can mark them read.

**Non-goals (deferred):** sequences (multi-step scheduled journeys), escalations
(SLA timers), webhook as an action, per-action user confirmation, workflow
versioning/history, formula conditions. The action set and condition operators
are deliberately small and are the extension seams.

---

## 2. Architecture decision (recorded as ADR-015)

### ADR-015 · Workflows = declarative rows consumed by an event-bus subscriber

**Decision:** an `Automation` row holds the whole definition as JSON
(`trigger`, `conditions`, `actions`); a single engine subscriber
(`onEvent("*")` in `server/lib/automations.ts`) matches each event to active
automations for the org × environment, evaluates conditions in-process, and
executes actions **through the generic object service** (so task/note writes
get audit + events + field validation for free) or direct `Notification`
writes. Actions act as an org-level admin actor (the automation's `createdBy`
is the audit subject), not the triggering user — a rep's field permissions
never silently block or privilege an automation.

**Why:** the event bus already exists (ADR-004) and is the blueprint's stated
substrate; storing workflows as rows (like `Segment.criteria`, ADR-003
philosophy) means no code deploy per workflow and the generic service keeps
one write path for all object mutations.

**Cost/risk:** in-process evaluation is synchronous with the event — heavy
workflows slow the triggering request (acceptable at Phase-0–3 scale; a queue
worker is the documented upgrade path). Loop protection is an in-memory
cooldown per (automation, entity, eventType) triple; see §7.

---

## 3. Data model changes (`prisma/schema.prisma`)

| Model | Shape | Notes |
|---|---|---|
| 🆕 `Automation` | `orgId`, `environment`, `name`, `description?`, `trigger Json`, `conditions Json`, `actions Json`, `active Bool`, `runCount Int`, `lastRunAt?`, `createdBy`, `createdAt`, `updatedAt` | `trigger` = `{ kind: "event", event: "deal.stage_changed", to?: "won" }`. `conditions` = `[{ field, op, value }]`. `actions` = `[{ type, ...params }]` (shapes below). Indexed `[orgId, environment]`. |
| 🆕 `AutomationRun` | `orgId`, `environment`, `automationId`, `eventType`, `entity`, `entityId`, `matched Bool`, `actions Json` (per-action outcome), `error?`, `triggeredBy` (`event` \| `test`), `createdAt` | One row per evaluation (matched or not — unmatched runs show the workflow *considered* the event). `actions` outcome = `[{ type, status: "ok"\|"skipped"\|"failed", detail?, entityId? }]`. Indexed `[orgId, automationId, createdAt]`. |
| 🆕 `Notification` | `orgId`, `environment`, `userId`, `title`, `body?`, `kind` (`automation` \| `system`), `link?`, `read Bool`, `createdAt` | In-app notifications (bell). Indexed `[orgId, userId, read]`. |

**Migration warning (Mongo):** `prisma db push` adds new collections only —
no backfill needed for new models. Existing data is untouched.

### Action shapes (v1)

```json
{ "type": "create_task",  "title": "Follow up on {{name}}", "description": "...", "dueInDays": 3, "priority": "high" }
{ "type": "notify",       "title": "Deal won 🎉", "body": "{{name}} closed for {{amount}}", "target": "owner" }
{ "type": "update_record", "field": "status", "value": "customer" }
```

- `create_task` — creates a `Task` linked to the triggering record (contact/
  opportunity where the fields exist), owner = the triggering record's owner,
  title/description support `{{field}}` merge from the record + event payload.
- `notify` — `target`: `"owner"` (record owner) | `"actor"` (event actor) |
  `"user"` (+ `userId`). Creates a `Notification`.
- `update_record` — sets one core field on the triggering record via the
  generic service (validation + `*_updated` events for free).

### Condition model

```json
{ "field": "amount", "op": "gte", "value": 50000 }
```

`field` resolves against the triggering record first, then the event payload
(`payload.from` / `payload.to` …). Operators: `eq, neq, contains, not_contains,
gt, gte, lt, lte, in, not_in` (same set as segments). Unknown fields fail the
workflow save (400) — never silently true/false at runtime.

### Trigger catalog (v1)

| Event | Extra filter | Notes |
|---|---|---|
| `deal.stage_changed` | `to` (stage key) optional | the flagship trigger |
| `deal.created` / `deal.updated` | — | |
| `lead.created` | — | |
| `contact.created` | — | |
| `task.completed` | — | the reserved event (see §4) |

---

## 4. The `task.completed` event

Today the generic service emits `task.updated` for every task PATCH. Per the
event catalog's reservation, `server/lib/object-service.ts` now emits
**`task.completed`** (with the task row as payload) when a task transitions
`before.status ≠ done → after.status = done`; all other task updates still
emit `task.updated`. This is a listener-visible contract change — the catalog
is updated, and the workflow trigger list exposes it.

---

## 5. API changes

All routes behind `requireFeature("automation.workflows")` (default on).

### Automations (admin writes; reads open to any authenticated user)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/automations` | `{ items }` — org's workflows with `runCount`, `lastRunAt`, `createdByName`. |
| POST | `/api/automations` | `{ name, description?, trigger, conditions?, actions?, active? }`. Validates trigger/condition/action shapes (400). **Duplicate detection:** an active automation with the same normalized trigger+conditions+actions → `409 { error, duplicateId }` unless `allowDuplicate: true`. Emits `automation.created`. |
| GET | `/api/automations/:id` | Single workflow. |
| PATCH | `/api/automations/:id` | Partial update (PATCH semantics, no `.default()`s — ADR engineering note). Same validation + duplicate guard. Emits `automation.updated`. |
| DELETE | `/api/automations/:id` | Emits `automation.deleted`. |
| GET | `/api/automations/:id/runs` | `{ items, total }` — `AutomationRun` log, newest first, `?limit=`. |
| POST | `/api/automations/:id/test` | `{ entityId }` — synthesizes the trigger event for that record and runs the engine (marked `triggeredBy: "test"`, emits `automation.triggered`). Lets admins verify a workflow before real events flow. |

### Notifications (any authenticated user — own rows only)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/notifications` | `?unreadOnly=` — the caller's notifications, newest first, `{ items, total, unread }`. |
| GET | `/api/notifications/unread-count` | `{ unread }` — for the header bell badge. |
| POST | `/api/notifications/:id/read` | Mark one read (owner only; 404 otherwise). |
| POST | `/api/notifications/read-all` | Mark all of the caller's notifications read. |

### Events emitted

`automation.created / updated / deleted`, `automation.triggered` (payload:
`{ automationId, name, eventType, entity, entityId, matched, actionCount }`),
`notification.created` (`{ userId, kind, title }`), and now `task.completed`
(`{ task }`).

---

## 6. UI changes (`src/`)

| Surface | What |
|---|---|
| New page **Workflows** (`/workflows`, gated by `automation.workflows`) | Card grid of automations (name, trigger summary, active toggle, run count, last run). **Builder modal**: trigger select (with conditional stage picker when `deal.stage_changed`), condition rows (field/op/value with the segment-style controls), action rows (type + per-type fields, `{{field}}` merge hint), duplicate-conflict banner with "Create anyway". **Runs drawer** per automation: table of runs with per-action status chips. **Test** button that samples records of the trigger's object type and runs the workflow against a pick. |
| Header bell (Layout) | Unread badge (`/api/notifications/unread-count`), dropdown with latest notifications, click-to-read + "Mark all read". |
| Nav | New "Automation" section: **Workflows** link (feature-gated); the bell lives in the header. |
| Settings → Feature flags | `automation.workflows` appears automatically via the known-flags registry (no Settings-specific work). |

---

## 7. Edge cases & risks

1. **Infinite loops** — an action's emitted event (e.g. `update_record` → `deal.updated`) could re-trigger the same automation forever. Mitigation: an in-memory cooldown — skip a run if the same `(automationId, entityId, eventType)` executed in the last 30s; runs are still logged (`status: "skipped"`-style `matched: true` row is not written; a skipped notice is recorded). Documented as accepted v1 protection; a durable dedupe key lands with the queue worker.
2. **Automation acting as admin** — actions bypass the *triggering user's* field permissions (they act with org-level privilege, attributed to the automation's creator). Documented in ADR-015; the audit trail names the creator, so it's not anonymous.
3. **Trigger condition field typos** — validated at save time against the object's registry def (400), never silently true.
4. **Deleted entities** — the engine resolves the entityId to a row; if it's gone, the run logs `matched: false` + a note instead of crashing the request (the engine never throws to the event emitter).
5. **Run log growth** — `AutomationRun` rows accumulate; v1 keeps them (they *are* the conflict-resolution surface). Retention pruning is deferred with the queue worker.
6. **Notifications** are org-scoped rows owned by `userId` — list/read endpoints scope by `userId`, so users can never read each other's notifications.
7. **Sandbox isolation** — workflows are org × environment rows (ADR-008): a workflow built in a sandbox only fires on sandbox events, exactly like webhooks. The engine filters by the event's `environment`.
8. **`task.completed` contract change** — anyone subscribing to `task.updated` for completion signals must switch to `task.completed` (the only in-process consumer today is the workflow engine itself).

---

## 8. Acceptance criteria

- [ ] Moving a task to `done` emits `task.completed` (and no longer only `task.updated`).
- [ ] Admin creates "deal won → notify owner + create follow-up task"; moving a seeded deal to `won` (with a matching condition) fires the automation: a `Notification` for the owner + a `Task` appear, an `AutomationRun` row is logged with per-action `ok`, and `automation.triggered` is emitted.
- [ ] A non-matching event (e.g. stage `proposal`) logs a run with `matched: false` and creates nothing.
- [ ] Creating an exact duplicate workflow → 409 with `duplicateId`; `allowDuplicate: true` succeeds.
- [ ] `POST /api/automations/:id/test` with a real `entityId` runs the workflow synchronously and returns per-action outcomes.
- [ ] A rep hitting `/api/automations` POST gets 403; a rep can read workflows and sees only their own notifications; marking someone else's notification read → 404.
- [ ] Disabling the `automation.workflows` feature flag 403s the automation + notification APIs.
- [ ] Workflows built in a sandbox environment never fire on production events.
- [ ] `npm run typecheck` and `npm run build` pass; new smoke suite `verify-phase3.sh` green; `verify-phase1.sh` (30), `verify-phase2.sh` (29), `verify-phase2-comm.sh` (45) still green.
- [ ] `docs/03-event-catalog.md`, `docs/05-api-reference.md`, `docs/08-decision-log.md` (ADR-015), `PROGRESS.md`, `docs/06-roadmap.md` updated.

---

## Suggested implementation order (one developer)

1. **Models + event:** `Automation` / `AutomationRun` / `Notification` in schema → `db push`; `task.completed` in `object-service.ts` (~0.5 day).
2. **Engine:** `server/lib/automations.ts` — trigger matching, condition evaluation, action executors (create_task / notify / update_record), run logging, cooldown guard, `automation.triggered` (~1.5 days).
3. **API:** `routes/automations.ts` (CRUD + runs + test + duplicate guard) + `routes/notifications.ts`; wire in `index.ts` behind `requireFeature("automation.workflows")`; add the flag to `KNOWN_FEATURES` (~1 day).
4. **UI:** Workflows page + builder modal + runs drawer + test; header bell + nav (~2 days).
5. **Seed:** two demo workflows + one notification (~0.5 day).
6. **Docs & verification:** event catalog, API reference, ADR-015, PROGRESS, roadmap; `verify-phase3.sh` + full regression pass (~1 day).
