# 16 · Phase 3 Build Report — Automation & Workflow Engine

> What shipped to complete Phase 3 (the blueprint's "Automation & Workflow
> Engine") end-to-end, the decisions behind it, and the verification evidence.
> Spec: `docs/15-spec-phase3.md` · Decision: ADR-015 in `docs/08-decision-log.md`.
> Status overview in `PROGRESS.md`. All live checks below ran against the real
> server (`localhost:8787`, Mongo via Docker, freshly seeded demo org).

## What shipped

### 1. `task.completed` event (the reservation is now fulfilled)
- The generic object service (`server/lib/object-service.ts`) now emits
  **`task.completed`** (`{ task }`) when a task transitions
  `todo/in_progress → done`; other task updates still emit `task.updated`.
  The event catalog's "reserved" note is replaced by the shipped row.

### 2. Workflow engine — `server/lib/automations.ts`
- **Trigger catalog:** `deal.stage_changed` (optional `to` stage), `deal.created`,
  `deal.updated`, `lead.created`, `contact.created`, `task.completed`.
- **Conditions:** `eq / neq / contains / not_contains / gt / gte / lt / lte / in /
  not_in` over the triggering record's fields or `payload.*` paths — validated
  at save time against the object's registry def (400 on typos, never silently
  true).
- **Actions:** `create_task` (title/description with `{{field}}` merge, due-in
  days, priority, owned by the record's owner, linked to the record),
  `notify` (target = record owner | actor | a chosen user → `Notification`
  row), `update_record` (sets a core field via the generic service). Task/record
  writes run **through the generic object service** — audit + events + field
  validation for free, attributed to the workflow's creator.
- **Run log:** every evaluation writes an `AutomationRun` row — matched or not,
  with a note explaining why not, and per-action outcomes
  (`ok / skipped / failed` + detail). This is the conflict-resolution surface:
  nothing a workflow does is invisible.
- **Loop protection:** in-memory cooldown per `(automation, entity, eventType)`
  (30s) so an action's own emitted event can't re-fire the same workflow.
- **Duplicate detection:** creating/updating a workflow identical (normalized
  trigger + conditions + actions) to another **active** one → `409` with
  `duplicateId` unless `allowDuplicate: true` (UI: "Save anyway" banner).

### 3. API — `/api/automations` + `/api/notifications`
- Automations: CRUD (reads open, writes admin), `GET :id/runs`, and
  `POST :id/test` — runs a workflow against a real record synchronously,
  logged as `triggeredBy: "test"`, so admins verify before events flow.
- Notifications: `GET /`, `GET /unread-count`, `POST :id/read`,
  `POST /read-all` — all scoped by `userId` (users can't see or read each
  other's rows; cross-user read → 404).
- Both route groups sit behind `requireFeature("automation.workflows")`
  (default-on, registered in `server/lib/features.ts`, so it appears in
  Settings → Feature flags automatically).

### 4. UI
- **Workflows page** (`/workflows`, nav under a new "Automation" section,
  feature-gated): card grid with active toggle, run count + last run, trigger
  badges; a **builder modal** (trigger select with stage picker, condition
  rows, per-type action editors with `{{field}}` hint); a **run-history
  drawer** with per-action status chips; a **test modal** that samples records
  of the trigger's object type and runs the workflow live. Duplicate conflict
  shows a "Save anyway" banner.
- **Header bell**: unread badge (polled every 30s), dropdown with the latest
  notifications, click-to-read + "Mark all read".

### 5. Seed
- Two demo workflows: **"Celebrate won deals"** (`deal.stage_changed → won`,
  amount ≥ $50k → notify owner + create a handover task) and
  **"Hot lead follow-up"** (`lead.created`, score ≥ 70 → notify owner) — plus
  a welcome notification so the bell has content on first login.

## Decisions (ADR-015)

Workflows are **declarative rows**, consumed by one `onEvent("*")` subscriber
in-process; actions act as the workflow's **creator** (org-level privilege) so
field permissions never block automation and the audit trail names a real
person. Loop protection is a 30s in-memory cooldown; heavy-workflow latency and
cooldown reset-on-restart are accepted v1 trade-offs with a queue worker as the
documented upgrade path. See `docs/15-spec-phase3.md` §2 for the full rationale.

## Bugs found & fixed during verification

1. **TS narrowing on trigger kind** — `trigger.kind !== "event"` narrowed the
   trigger to `never`; switched to a `{ kind?: string }` cast + `String()` check.
2. **`ApiError` dropped 409 bodies** — the duplicate guard's `duplicateId`
   wasn't reachable from the UI because `ApiError` only kept `error`/`issues`;
   it now carries the raw `data` (used by the "Save anyway" flow).
3. **`??`/`||` mixing** in the test modal's record-title helper — parenthesized
   (TS5076).

## Verification evidence

- `npm run typecheck` ✅ · `npm run build` ✅ (production bundle, `dist/`).
- **Live smoke suite (`verify-phase3.sh`, 34/34 green):**
  - `task.completed`: create task → mark done → event emitted with the task id.
  - Workflow CRUD: seeded workflows listed; rep create → 403; rep read → 200;
    unknown trigger event → 400; unknown condition field → 400.
  - **Duplicate guard:** exact duplicate → 409 with `duplicateId`;
    `allowDuplicate: true` → created.
  - **End-to-end trigger:** moving a seeded ≥ $50k deal to `won` fired the
    seeded "Celebrate won deals" workflow — `runCount` 0 → 1, a
    "Handover follow-up…" task created, a "Deal won" notification written,
    and `automation.triggered` emitted.
  - **Test endpoint:** matched a won deal, executed `create_task`, logged a
    `triggeredBy: "test"` run; non-won deal → `matched: false`.
  - **Notifications:** unread-count works; mark-one read → 200; another user's
    notification → 404; read-all works.
  - **Sandbox isolation:** a workflow created in `sandbox` never fired on a
    production `lead.created` event and stays invisible in the production list
    (ADR-008 discipline holds for workflows).
  - **Feature gate:** disabling `automation.workflows` 403s both APIs; re-enable
    restores 200.
  - Cleanup: smoke workflows/tasks deleted; demo data left pristine.
- **Regressions on the same stack:** `verify-phase1.sh` 30/30,
  `verify-phase2.sh` 29/29, `verify-phase2-comm.sh` 45/45 — all green.
- Production bundle smoke: SPA serves at `/`; the bundle contains the Workflows
  page, bell ("Mark all read"), `unread-count` calls, the
  `automation.workflows` gate, and the seeded workflow names.

## Docs updated

`docs/15-spec-phase3.md` (spec, new), `docs/16-phase3-build-report.md` (this
report), `docs/03-event-catalog.md` (Phase 3 events + `task.completed` shipped),
`docs/05-api-reference.md` (Workflows + Notifications sections),
`docs/08-decision-log.md` (ADR-015), `PROGRESS.md` (Phase 3 → ✅ 100%),
`docs/06-roadmap.md` (Phase 3 → ✅ shipped).
