# 36 · Phase 12 Build Report — Field Operations

> **Status: COMPLETE — 100% of the Phase 12 spec (docs/35-spec-phase12.md)
> shipped and live-verified.** Typecheck + production build green; live smoke
> suite `verify-phase12.sh` **69/69** green on a fresh seeded stack, with the
> Phase 10 Revenue Cloud regression **109/109** and Phase 11 Customer Success
> regression **71/71** green on the same code (each suite on its own fresh
> seeded stack — the standard convention for these suites).

## What shipped

### Territories (`field.territories`)
- `Territory` rows (name, region, owner, active, notes) with **account
  assignment** (`accountIds` → hydrated `accountNames`), CRUD at
  `/api/field/territories` (reads open, writes admin/manager, delete
  admin-only), `territory.created/updated/deleted`. Verified: seeded
  Northeast (Northwind + Initech) + West (Globex) with joined account names;
  create/delete; empty name → 400; rep create → 403.

### Technicians (dispatch surface)
- `Technician` rows (name, optional linked user, phone, skills, territory,
  status `available | on_route | off_duty`, last lat/lng) with **derived open
  work-order load** per technician. Verified: skills seeded, load computed,
  status updated by check-ins and dispatch.

### Visits + GPS check-ins + route planning (`field.visits`)
- `Visit` lifecycle `planned → in_transit → checked_in → completed |
  cancelled` with the **GPS check-in** endpoint recording `checkInAt` +
  coordinates, emitting **`visit.checked_in`**, and updating the technician's
  last position. Verified live: seed has a checked-in visit with coordinates;
  schedule → start → check-in (lat persisted) → complete; cancel; check-in on
  a cancelled visit → 400.
- **Route optimization** — `GET /api/field/routes/optimize` orders
  non-completed visits by greedy nearest-neighbor from the technician's last
  position with haversine per-leg + cumulative km (deterministic, ties by
  scheduledAt). Verified: ordered list + legKm + totalKm returned.

### Field service — work orders (`field.workorders`)
- `WorkOrder` lifecycle `open → dispatched → in_progress → completed` with
  `on_hold` / `cancelled`, priority, and `slaDueAt`. Verified: create with
  priority persisted; dispatch (unknown technician → 400); start; complete.
- **SLA breach** — `slaBreached` derived at read for past-due open orders;
  the ticker emits **`workorder.sla_breached`** + admin notification (kind
  `field`). Verified: a seeded past-SLA order flags at read, the tick reports
  it, the event fires, notifications are written.
- **Parts consumption** — completing with `partsUsed` validates stock first
  (insufficient → 400 — verified with a 9999-qty attempt), deducts each SKU
  (`inventory.consumed`, verified 12 → 10), persists `partsUsed` on the order,
  resets the asset's maintenance clock, frees the technician to `available`,
  and emits **`workorder.completed`**.

### Assets + maintenance (`field.inventory`)
- `Asset` rows (name, serial, type, status, warranty, location,
  `lastMaintenanceAt` + `maintenanceIntervalDays`) with **maintenanceDue
  derived at read**; the ticker emits **`asset.maintenance_due`** once per
  cycle + notifies admins; logging maintenance resets the clock and emits
  `asset.maintenance_done`. Verified: seeded POS terminal (90-day interval,
  95 days since) derives due; tick reports it; the event fires; logging
  maintenance clears the flag.

### Inventory (`field.inventory`)
- `InventoryItem` rows (unique SKU per org × env, on-hand, reorder level,
  unit cost, location) with `lowStock` derived at read; the ticker emits
  **`inventory.reorder_triggered`** + notifies. `receive` (+qty, non-positive
  → 400) and `consume` (−qty, insufficient → 400) emit
  `inventory.received/consumed`. Verified: seeded RX-ROUTER-100 (2 on hand,
  reorder 5) derives low; tick reports reorders; receive increments; zero-qty
  receive → 400.

### Offline sync (`POST /api/field/sync` — docs/38-offline-sync-spec.md)
- Push/pull sync with **last-write-wins** conflict resolution across all six
  entities: client changes with `clientTs` > row `updatedAt` apply (pushed=1);
  stale changes (clientTs 1) are NOT applied and return a `conflicts` entry
  with reason "server is newer (server wins)"; offline **creates** work; the
  PULL returns everything changed since `since`; applied changes emit
  `<entity>.synced`. All verified live.

### Engine, RBAC, gates
- `startFieldEngine` wired in `server/index.ts` (maintenance / SLA / reorder
  ticker once per org × env per boot) + `POST /api/field/tick` on demand
  (admin only — rep → 403 verified). RBAC verified: reps read 200, rep
  territory/work-order create + dispatch + tick → 403, rep stock-consume →
  200 (field-worker op). Feature gates verified: `field.visits` disabled →
  403, re-enabled → 200. Environment scoping verified: sandbox territories
  + visits invisible in production.

## Delivered files
- **Schema** — `prisma/schema.prisma`: `Territory`, `Technician`, `Visit`,
  `WorkOrder`, `Asset`, `InventoryItem` (org + environment scoped, indexed).
- **Server** — `server/lib/field.ts` (all logic — derived reads, lifecycle
  transitions, route planner, sync, ticker, ~850 lines), `server/routes/field.ts`
  (27 endpoints), wired in `server/index.ts` (routes + `startFieldEngine`);
  `server/lib/features.ts` (4 flags: `field.territories` / `field.visits` /
  `field.workorders` / `field.inventory`); `server/seed.ts` (2 territories, 2
  technicians, 2 visits incl. a GPS check-in, 2 work orders incl. parts, 2
  assets incl. one maintenance-due, 2 inventory items incl. one low-stock).
- **UI** — `src/pages/FieldPage.tsx` (Overview / Territories / Visits &
  routes / Work orders / Assets & inventory tabs), route `/field` in
  `src/App.tsx`, "Field ops" nav section in `src/components/Layout.tsx`.
- **Docs** — this report, spec `docs/35-spec-phase12.md`, guide
  `docs/37-field-ops-guide.md`, offline-sync spec `docs/38-offline-sync-spec.md`,
  plus updated event catalog, API reference, roadmap, decision log (ADR-024),
  and `PROGRESS.md`.
- **Verification** — `verify-phase12.sh` (69 live checks).

## Verification

```
npm run typecheck  → green
npm run build      → green
verify-phase12.sh  → 69 passed, 0 failed  ✅ ALL GREEN  (fresh seeded stack)
verify-phase10.sh  → 109 passed, 0 failed ✅ ALL GREEN  (regression, fresh stack)
verify-phase11.sh  → 71 passed, 0 failed  ✅ ALL GREEN  (regression, fresh stack)
```
