# 53 · CRM Time Machine — Data Retention Policy

> The Time Machine (Phase 15, spec `docs/49-spec-phase15.md`) reconstructs
> the full historical state of any record as of any date. It has two
> mechanisms with different retention semantics, documented here so it is
> clear what data is kept, for how long, and how it can be purged.

## 1. The two mechanisms

### 1.1 Audit-trail reconstruction (derived, no extra storage)

`GET /api/brain/timemachine/reconstruct?entity=&id=&asOf=` replays the
**existing `AuditLog`** — one row per field-level mutation with before/after
snapshots (Phase 0) — to the last audit write ≤ `asOf` and returns that
state. `compare` diffs two dates (`{ changed, removed, added }`).

**Retention:** governed entirely by the audit trail's own lifecycle. The
Time Machine adds **no copies**; it cannot outlive the underlying audit rows.
If an org's audit retention (Phase 14 `RetentionPolicy` / future
`audit.retention` settings) deletes old audit rows, reconstruction for dates
before the retained window returns the oldest surviving state — this is
expected and documented behavior, not data loss from the Time Machine itself.

### 1.2 Durable snapshots (`TimeMachineSnapshot`, blueprint entity)

`POST /api/brain/timemachine/snapshot` captures either the **full org**
(`scope: "full"` — every object/comm/revenue collection, up to 20k rows per
collection) or **one record** (`scope: "record"`). Each snapshot carries a
`retentionUntil` and emits `snapshot.created`.

**Retention:** `retentionUntil = now + settings.brain.timeMachineRetentionDays`
(**default 90 days**, `Organization.settings.brain`). Pruning runs:
- on **every capture** (`deleteMany` where `retentionUntil < now`), and
- on the **daily engine tick** (which also backfills a full snapshot per
  org × environment if none was captured in the last 24h).

Expired snapshots are hard-deleted; the capture response reports
`{ pruned }` so the pruning is observable.

## 2. What this means operationally

| Question | Answer |
|---|---|
| How far back can I reconstruct a record? | As far as the audit trail goes (see 1.1). |
| How long are snapshots kept? | `timeMachineRetentionDays` (default 90) from capture; pruned automatically. |
| Can I extend retention? | Yes — raise `settings.brain.timeMachineRetentionDays`; new captures honor it (existing rows keep their original `retentionUntil`). |
| Can I force a purge? | Delete rows directly (admin) or set a short retention window and wait for the next capture/tick. |
| Does the Time Machine copy PII? | Snapshots mirror the org's own collections (same data as the record). They are org × environment scoped like every other collection; DSR delete/export and Phase 14 retention policies that touch source collections do **not** automatically cascade to existing snapshots — snapshot retention is governed by this policy (an operational note, not a claim of deep-link compliance). |

## 3. Design notes

- **Snapshots never block writes** — captures are point-in-time reads; a
  record mutated mid-capture may appear in either state, which is inherent to
  any snapshot.
- **The engine does NOT capture at boot** — on a fresh stack the seeded state
  stays exact; the daily tick maintains cadence on long-running instances.
- **Verified live** by `verify-phase15.sh`: past-state reconstruction
  (qualified → negotiation stage change), compare diffs, record + full
  captures, `snapshot.created` events, and retention pruning of an expired
  snapshot (≥ 1 pruned) via the `q15-backdate` script.
