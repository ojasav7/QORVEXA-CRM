# 38 · Offline-Sync Conflict-Resolution Spec (Field app)

> The mobile/offline contract for Phase 12 Field Operations. A field app works
> against a local queue while offline and reconciles on reconnect through ONE
> endpoint — `POST /api/field/sync` — with deterministic, documented
> conflict resolution. This is the blueprint's "Offline-sync
> conflict-resolution spec" doc; the server implementation lives in
> `server/lib/field.ts` (`syncChanges`) and is mounted at `/api/field/sync`
> (auth: any active user; flag: `field.visits`).

## 1. The model

The server is the system of record. The device keeps a local mirror of the
rows it has touched (plus everything it pulled) and a **queue of pending
changes** it made while offline. Every entity row carries `updatedAt`
(server-side, set by Prisma on create/update).

**Syncable entities** (all org × environment scoped, ADR-008):
`territory`, `technician`, `visit`, `workOrder`, `asset`, `inventoryItem`.

## 2. The request

```jsonc
POST /api/field/sync
{
  "since": "2026-08-13T00:00:00Z",   // server rows changed after this come back
  "changes": [                        // the device's queued operations
    {
      "entity": "visit",
      "op": "create",                 // "create" | "update"
      "id": "…",                      // required for update
      "data": { "title": "…", "scheduledAt": "…" },
      "clientTs": 1786600000000       // device clock at change time (ms epoch)
    }
  ]
}
```

## 3. The response

```jsonc
{
  "pushed": 2,        // changes applied server-side
  "conflicts": [      // changes NOT applied, with reasons — the client must surface these
    { "entity": "visit", "id": "…", "reason": "server is newer (server wins)" }
  ],
  "pulled": [         // everything the device hasn't seen (updatedAt > since)
    { "entity": "visit", "id": "…", "updatedAt": "…", "data": { …full row… } }
  ]
}
```

## 4. Conflict resolution — last-write-wins

For each queued change:

| Case | Decision | Reason |
|---|---|---|
| `op: create`, no `id` | **Apply** — create the row with the client's `data` (+ org/env/actor). | New offline record |
| `op: update`, row missing on server | **Conflict** — `"missing on server (create locally instead)"` | Device believes it exists; server never saw it |
| `op: update`, `clientTs` > row `updatedAt` | **Apply** — overwrite with client `data` | The device changed it most recently (LWW) |
| `op: update`, `clientTs` < row `updatedAt` | **Conflict** — `"server is newer (server wins)"`; **do not apply** | Someone changed it after the device did |
| `op: update`, `clientTs` == row `updatedAt` | **Apply** (idempotent overwrite) | Same logical timestamp |
| Unknown entity / invalid op | **Conflict** — reason names the problem | Fail loud, never drop silently |
| Apply throws (validation) | **Conflict** — the error message | Surface to the user |

**Why last-write-wins?** Field data is mostly low-contention (one technician
owns a visit; one warehouse owns a bin). LWW is deterministic, cheap, and
auditable — every applied change emits `<entity>.synced` with `op` so the
event log reconstructs exactly what the server accepted. The losing side is
**never silently discarded**: it comes back as a `conflict` entry the client
must show ("Your edit was overridden by the server copy — keep yours?").

**What the server never does** — merges fields silently, auto-creates on a
missing update target, or applies out-of-order. If the device applied changes
in a different order than the server's `updatedAt` chronology, the oldest
loses — that's the documented LWW trade, and it's why clients should flush
their queue on every reconnect instead of batching across sessions.

## 5. Client obligations

1. **Clock discipline** — `clientTs` must be the device clock at change time.
   NTP-skewed devices will lose conflicts they should win (and win ones they
   shouldn't). Mitigation: a client that notices a large skew against `pulled`
   timestamps should surface a clock warning.
2. **Queue + flush** — buffer every mutation while offline; on reconnect,
   send the whole queue with `since` = the last successful pull timestamp;
   apply `pulled` to the local mirror.
3. **Conflict UX** — never silently discard a `conflict`: show the server
   value vs the device value and let the user choose (resubmit with a newer
   `clientTs` to force, or discard).
4. **Local ids** — the server is the id authority. For offline **creates**,
   use a temp id locally and remap after the response returns the server id
   (the create branch of `syncChanges` assigns the id).

## 6. Idempotency + safety

- Re-sending the same change twice is safe: the second send sees
  `clientTs <= updatedAt` (the first send already set it) and either applies
  an identical overwrite or reports a conflict the client can auto-dismiss
  when the values match.
- `since` is inclusive-of-newer: re-pulling returns rows the device already
  has; the client upserts by id (last row wins locally).
- Nothing in sync bypasses RBAC (any active user) or feature gates
  (`field.visits`); sandbox rows sync sandbox rows — the environment header
  scopes everything.

## 7. Events

Every applied change emits `<entity>.synced` `{ op: "create" | "update" }` —
the audit trail shows offline activity exactly like online activity, just
with the sync source.

## 8. Example flows

**Technician completes a visit offline, syncs on reconnect:**
```jsonc
POST /api/field/sync
{ "since": "2026-08-12T00:00:00Z",
  "changes": [{ "entity": "visit", "op": "update",
    "id": "…visitId…", "data": { "status": "completed", "notes": "done in field" },
    "clientTs": 1786610000000 }] }
// → pushed: 1, conflicts: [], pulled: [ …everything newer… ]
```

**Two devices edit the same visit — the older device loses:**
```jsonc
// device A synced first with clientTs 1000 (applied). Device B syncs with clientTs 500:
// → pushed: 0, conflicts: [{ entity: "visit", id: "…", reason: "server is newer (server wins)" }]
```
