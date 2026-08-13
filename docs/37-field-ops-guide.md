# 37 · Field Operations Guide

> How to run the Field Operations suite (Phase 12) for real: the playbooks,
> the SLA model, route planning, and the operational loop. Companion to the
> spec (`docs/35-spec-phase12.md`) and build report
> (`docs/36-phase12-build-report.md`); the offline-sync conflict-resolution
> contract has its own spec (`docs/38-offline-sync-spec.md`).

## The operating loop

1. **Organize** — create territories (they own accounts + technicians) and
   assign each account to one. Assign technicians to territories with their
   skills.
2. **Plan** — schedule visits against accounts/contacts (or let field apps
   create them offline and sync). Dispatch work orders to technicians; the
   open-load read shows capacity at a glance.
3. **Execute** — the technician starts the visit, checks in with GPS at the
   site (`visit.checked_in`), completes it. Work orders move
   open → dispatched → in_progress → completed; completing with `partsUsed`
   deducts inventory automatically.
4. **SLA** — every open order past `slaDueAt` is flagged at read and the
   ticker events `workorder.sla_breached` + notifies admins — the dispatch
   queue is the remediation surface.
5. **Maintain** — assets carry warranty + maintenance schedules; the ticker
   surfaces `asset.maintenance_due`; log maintenance to reset the clock.
6. **Stock** — inventory at/below `reorderLevel` triggers
   `inventory.reorder_triggered`; receive stock to restock.
7. **Offline** — field apps queue changes and sync via
   `POST /api/field/sync`; see the offline-sync spec.

## Territories — the dispatch backbone

- A territory owns `accountIds`; the hydrated read joins `accountNames` so the
  planning surface shows who is where. The manager (`ownerId`) is the
  escalation point.
- Assigning an account to a territory is the routing decision: visits and
  work orders inherit the territory for reporting, and the route planner
  works per technician (whose territory is the natural filter).
- Reads are open; creating/editing is admin/manager; deleting is admin-only
  (it doesn't cascade — unassign first).

## Route planning — how the optimizer works

`GET /api/field/routes/optimize?technicianId=<id>` returns the technician's
non-completed visits (`planned | in_transit | checked_in`) ordered by a
**greedy nearest-neighbor** walk:

1. Start at the technician's last reported position (`lat`/`lng` — kept fresh
   by every GPS check-in).
2. Always pick the nearest remaining visit (haversine, km).
3. Ties break by `scheduledAt` (deterministic — no server-side randomness).

Each returned visit carries `legKm` (distance from the previous stop) and
`cumulativeKm`; the route has a `totalKm`. This is a v1 planner (single
technician, no time windows); it exists to give a field app an ordered
itinerary, and the endpoint is the slot where a real optimizer lands later.
When no technician filter is passed it plans across all open visits from a
fixed hub — useful for territory-level day planning.

## Field service SLA model

- Every work order can carry `slaDueAt`. The rule is simple and derived at
  read: **an order is `slaBreached` when `slaDueAt < now` and its status is
  not `completed` or `cancelled`.**
- The engine ticker (or `POST /api/field/tick`) walks open orders each cycle
  and emits `workorder.sla_breached` + a `kind: "field"` admin notification
  ("N work order(s) past SLA — check dispatch."). Events fire per cycle — the
  read flag is the always-current truth, the event is the push alert.
- **Playbook** — breached orders sort to the top of the dispatch queue;
  re-dispatch to an available technician, or escalate priority; the parts +
  account context are on the order row.

## Assets & maintenance

- `maintenanceDue` is derived: `lastMaintenanceAt + maintenanceIntervalDays *
  86400000 < now`, or (interval set, never serviced) → due. `retired` assets
  are excluded.
- The ticker emits `asset.maintenance_due` once per cycle + notifies admins.
- **Logging maintenance** (`POST /api/field/assets/:id/maintenance`) sets
  `lastMaintenanceAt = now`, `status = active`, and emits
  `asset.maintenance_done` — the clock resets for the next interval.
- Completing a work order **against an asset** also resets that asset's clock
  (the work was the maintenance) — one less manual step in the field.

## Inventory & parts

- `lowStock` = `quantityOnHand <= reorderLevel` (derived at read); the ticker
  emits `inventory.reorder_triggered` once per cycle + notifies admins.
- **Stock moves are evented and validated** — `receive` must be positive
  (else 400), `consume` must not exceed on-hand (else 400, *before* any
  partial deduct). Work-order completion with `partsUsed` validates **all**
  parts first, then deducts each (`inventory.consumed`), so a failed
  completion never half-consumes.
- SKUs are unique per org × environment; duplicates → 400. Stock value is
  derived (on-hand × unit cost).

## RBAC + gates + environments

- **Reads open** — the Field page is a planning + dispatch surface.
- **Config writes admin/manager** — territory, technician, work-order,
  asset, and inventory-item create/edit; territory delete admin-only.
- **Field-worker ops open to reps** — visit start/check-in/complete, work
  order start/complete, stock consume, and offline sync (a rep on a job must
  be able to move it without a manager approving mid-visit).
- **Feature flags** — `field.territories`, `field.visits`,
  `field.workorders`, `field.inventory` gate their route groups
  (`PUT /api/features/<flag>`).
- **Environments** — everything is scoped by `X-Environment` (ADR-008): plan
  field routes in sandbox, run offline-sync tests there, then promote.

## Events

Full catalog in `docs/03-event-catalog.md`. The ones that drive the loop:
`visit.checked_in` (GPS arrival), `workorder.dispatched` (assignment),
`workorder.sla_breached` (escalation), `workorder.completed` (done + parts),
`asset.maintenance_due` / `asset.maintenance_done`, `inventory.received` /
`inventory.consumed` / `inventory.reorder_triggered`, and `<entity>.synced`
for every offline-applied change.
