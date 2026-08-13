# 35 · Phase 12 Spec — Field Operations (Territory, Field Service, Inventory)

> The spec that drives Phase 12 of QORVEXA CRM. Goal (from the blueprint):
> **support physical/field-based businesses.** The platform is built around
> desk work (pipeline, tickets, campaigns, success plans); Phase 12 puts the
> same object model + event bus + RBAC discipline into the field: territories
> that own accounts and technicians, scheduled visits with GPS check-ins and
> route planning, field-service work orders with dispatch and SLA deadlines,
> and serialized assets + inventory stock. Same stack (Express 5 + Mongo via
> Prisma + React 19 SPA), same ADR discipline (row-as-config, derived-on-read,
> every state change evented), and the same rule of thumb: **reads are derived
> and explainable, writes are RBAC-gated, and the offline client syncs through
> one deterministic conflict-resolution endpoint.**

## §0 · Current substrate (verified in repo)

- **Object model + event bus** — accounts/contacts (Phase 1) are the visit and
  work-order targets; `Event` rows + `onEvent("*")` subscribers are the
  notification + audit substrate; the CDP/health + success engines (7, 11)
  established the ticker pattern this phase reuses.
- **Revenue Cloud (Phase 10)** — `Product`/`InventoryItem` share the catalog
  mindset; the work-order completion path deducts `partsUsed` from inventory
  exactly like billing consumes subscription lines.
- **Engine-subscriber pattern** — `startAutomationEngine` (3),
  `startJourneyEngine` (5), `startCdpEngine` (7), `startSuccessEngine` (11)
  established `onEvent("*")` + ticker engines; `startFieldEngine` follows with
  the maintenance-due / SLA-breach / reorder ticker.
- **RBAC + feature gating + environments** — `requireRole` / `requireFeature` /
  `resolveEnvironment` gate every route (reads open for the planning surface,
  writes admin/manager, field-worker ops open to reps), and every row is
  org × environment scoped (ADR-008) so sandbox routes never leak.
- **Notifications** — `Notification` rows (kind `cs` / `field`) carry the
  push-based alerts (maintenance due, SLA breach, low stock).

## §1 · Scope (what this phase ships)

### 1.1 Territories — `Territory` (flag `field.territories`)
A territory is a **declarative row** (the ADR-015/017 row-as-config pattern)
that owns accounts + technicians:
- `name`, `region` (free text), `ownerId` (the manager), `active`, `notes`.
- `accountIds` — the accounts assigned to this territory (drives dispatch
  routing + the plan board).
- CRUD at `/api/field/territories` (reads open, writes admin/manager, delete
  admin-only). Events: `territory.created/updated/deleted`.

### 1.2 Technicians — `Technician` (dispatch surface)
A field technician is a row with `name`, optional linked `userId`, `phone`,
`skills` (JSON), `territoryId`, `status` (`available | on_route | off_duty`),
and `lat`/`lng` — the last reported GPS position (kept fresh by check-ins).
The read model derives each technician's **open work-order load** (count of
open/dispatched/in-progress orders) so dispatch sees capacity at a glance.

### 1.3 Visits + GPS check-ins + route planning — `Visit` (flag `field.visits`)
- A visit is a scheduled field visit: `title`, `scheduledAt`, optional
  `territoryId` / `accountId` / `contactId` / `technicianId`.
- **Lifecycle** — `planned → in_transit (start) → checked_in (GPS) →
  completed`, or `cancelled`. The **GPS check-in** (`POST
  /api/field/visits/:id/check-in` with `{ lat, lng }`) records `checkInAt` +
  coordinates, emits **`visit.checked_in`**, and updates the technician's last
  position + sets them `on_route`.
- **Route optimization** — `GET /api/field/routes/optimize?technicianId=`
  returns the technician's non-completed visits ordered by **greedy
  nearest-neighbor** from their last GPS position (deterministic; ties break
  by `scheduledAt`), with per-leg + cumulative haversine distances (km) — a
  v1 route planner a field app can follow.

### 1.4 Field service — `WorkOrder` (flag `field.workorders`)
- **Lifecycle** — `open → dispatched (assign technician) → in_progress
  (start) → completed`, with `on_hold` and `cancelled`.
- **SLA deadlines** — an optional `slaDueAt`; the read model derives
  `slaBreached` for any open/dispatched/in-progress order past its deadline,
  and the engine ticker emits **`workorder.sla_breached`** + notifies admins
  (kind `field`).
- **Parts consumption** — completing with `partsUsed: [{ sku, qty }]`
  **validates stock first** (insufficient → 400) then deducts each SKU
  (`inventory.consumed`), resets the serviced asset's maintenance clock, and
  frees the technician back to `available`. Emits **`workorder.completed`**.
- **Dispatch** — assigning a technician (re-)sets the order to `dispatched`
  and the technician to `on_route`; unknown technician → 400.

### 1.5 Assets + maintenance — `Asset` (flag `field.inventory`)
A serialized customer asset: `name`, `serialNumber`, `type`, `status`
(`active | maintenance | retired`), `warrantyUntil`, `location`, and the
maintenance schedule (`lastMaintenanceAt` + `maintenanceIntervalDays`).
- `maintenanceDue` is **derived at read** (last + interval < now, or never
  serviced with an interval set); the ticker emits **`asset.maintenance_due`**
  once per cycle + notifies admins.
- Logging maintenance (`POST /api/field/assets/:id/maintenance`) resets the
  clock + sets status `active`, emitting `asset.maintenance_done`.

### 1.6 Inventory — `InventoryItem` (flag `field.inventory`)
Stock with `sku` (unique per org × env), `name`, `quantityOnHand`,
`reorderLevel`, `unitCost`, `location`. `lowStock` is derived (on-hand ≤
reorder); the ticker emits **`inventory.reorder_triggered`** once per cycle.
Stock moves: `receive` (+qty, non-positive → 400) and `consume` (−qty,
insufficient → 400) emit `inventory.received/consumed`; work-order completion
deducts via the same path.

### 1.7 Offline sync — `POST /api/field/sync` (see docs/38-offline-sync-spec.md)
The mobile client works offline and syncs on reconnect:
- **PUSH** — the client sends its queued operations
  `{ entity, op: create|update, id?, data, clientTs }` (entities: territory,
  technician, visit, workOrder, asset, inventoryItem). Each applies with
  **LAST-WRITE-WINS** conflict resolution: a change wins if `clientTs` > the
  row's `updatedAt`; losing changes return as **conflicts** (with a reason),
  never silently dropped. Unknown entities / invalid ops → conflict entries.
- **PULL** — everything with `updatedAt > since` returns so the device
  catches up (`{ pushed, conflicts, pulled }`).
- Every applied change emits `<entity>.synced` for the audit trail.

### 1.8 Engine + RBAC + feature gating
- `startFieldEngine` — the ticker runs `runFieldTicker` once per org × env per
  boot (maintenance-due scan → `asset.maintenance_due`, SLA scan →
  `workorder.sla_breached`, reorder scan → `inventory.reorder_triggered`, each
  with a `kind: "field"` admin notification). `POST /api/field/tick` runs one
  pass on demand (admin).
- Reads open (the page is a planning + dispatch surface); config writes
  (territory/technician/work-order/asset/inventory create/edit) are
  admin/manager; **field-worker ops** (visit start/check-in/complete, work
  order start/complete, stock consume, sync) are open to reps.
- **Events** — full catalog in `docs/03-event-catalog.md`:
  `territory.*`, `technician.*`, `visit.scheduled / visit.checked_in /
  visit.completed / visit.cancelled`, `workorder.created / workorder.dispatched
  / workorder.sla_breached / workorder.completed / workorder.cancelled`,
  `asset.maintenance_due / asset.maintenance_done`, `inventory.received /
  inventory.consumed / inventory.reorder_triggered`, `<entity>.synced`.

## §2 · UI — Field page (`/field`, "Field ops" nav section)

Five tabs:
- **Overview** — stat cards (territories, technicians, visits planned/today,
  open work orders + SLA breaches, stock value + low-stock) and a
  "needs attention" panel (breached SLA, maintenance due, low stock) + the
  engine-tick action.
- **Territories** — territory cards with region, owner, assigned accounts;
  create/delete.
- **Visits & routes** — visit list with the lifecycle actions (start / check
  in / complete / cancel), a technician filter, and the **Optimize route**
  button that shows the ordered route with per-leg distances.
- **Work orders** — dispatch (assign technician), start, complete with
  parts-used prompt (inventory consumption), cancel; SLA-breached orders are
  highlighted.
- **Assets & inventory** — serialized assets with warranty + maintenance
  schedule + "log maintenance" action, and inventory items with receive /
  consume and low-stock flags.

## §3 · Out of scope (later phases)

- Real GPS tracking (continuous position streams, geofencing) — v1 is the
  explicit check-in; a telemetry pipeline is the documented extension.
- Offline-first storage (SQLite/WatermelonDB on the device) — the API +
  conflict-resolution contract ships; the client-side store is an
  implementation detail.
- Route optimization v2 (multi-technician, time windows, traffic) — v1 is
  single-technician greedy nearest-neighbor; the planner is the slot.
- Inventory serialized-per-unit tracking (bin-level, barcode) — v1 is
  quantity + SKU; serial-number-per-unit is a later slice.
