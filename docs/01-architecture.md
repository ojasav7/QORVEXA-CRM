# 01 · Architecture

## Stack decision

The blueprint demands an **API-first** platform (REST + webhooks + OAuth + event bus) where UI, integrations, and future AI agents all consume the same surface. That decided the shape:

- **Express 5 REST API** — the documented API surface (`docs/05-api-reference.md`). Webhooks and future SDKs hit the same endpoints the UI uses.
- **MongoDB 7 + Prisma 6** — chosen for the same reason as the sibling CMS (flexibility for the object model) and the user's preference. MongoDB documents map cleanly onto the blueprint's "Object with custom fields" concept.
- **React 19 + Vite 8 + Tailwind v4 SPA** served by the same Express process in production — one deployable unit.
- **Signed-cookie sessions** (HMAC, httpOnly) — no session table needed for Phases 0–1; upgraded to DB-backed sessions + device management in Phase 14.
- **No ORM middleware magic** — events and audit are written explicitly in the service layer, so every side-effect is visible and testable.

### MongoDB + Prisma constraints (important)

Prisma's MongoDB connector has three quirks the codebase accounts for:

1. **No relations** — every reference is an explicit `*Id` string (e.g. `Contact.accountId`). Joins happen in the service layer (`hydrate()` attaches `accountId_label`). This is *by design*: it mirrors the blueprint's generic Relationship model.
2. **No enums** — string columns validated at the service layer (`registry.ts`).
3. **No `@updatedAt`** — `updatedAt` is maintained manually on writes that need it.
4. **Replica set required** — Prisma uses transactions. The Docker setup runs Mongo as a single-node replica set (`docker-compose.yml`). **Do not run Mongo without it** — `prisma db push` / writes will fail with `P2031`.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  React SPA (src/)                                            │
│  pages → components/ui primitives → lib/api.ts (fetch)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ /api/* (same origin, session cookie)
┌──────────────────────────────▼──────────────────────────────┐
│  Express routes (server/routes/)                             │
│  object-routes.ts = one REST router factory                 │
├─────────────────────────────────────────────────────────────┤
│  Service layer (server/lib/)                                 │
│  object-service.ts  → generic CRUD engine (per object type)  │
│  auth.ts            → sessions + RBAC middleware             │
│  access.ts          → record-level visibility                │
│  registry.ts        → object/field/pipeline definitions      │
│  events.ts          → event bus (persist + fan-out + webhook)│
│  audit.ts           → field-diff audit writer                │
├─────────────────────────────────────────────────────────────┤
│  Prisma 6 → MongoDB 7 (replica set)                          │
└─────────────────────────────────────────────────────────────┘
```

## The generic object model

The blueprint's principle #1 ("never hard-code tables per feature") is realized as:

1. **`registry.ts`** — declarative `ObjectDef` per type: fields (type, required, searchable, list), options, pipeline. This is the *schema*.
2. **`object-service.ts`** — `createObjectService({ type })` returns list/get/create/update/remove for *any* type. It handles validation, required-field checks, duplicate detection (via `uniqueFields`), custom-field validation, events, and audit — once.
3. **`object-routes.ts`** — one `Router` factory mounting `/api/:type` REST endpoints from any service.

**Adding a new object type in Phase 2+** (e.g. `Ticket`):
1. Add the Prisma model (with `orgId`).
2. Add an `ObjectDef` in `registry.ts`.
3. Call `registerObject(...)` + mount the router in `server/index.ts`.
4. Add an entry to `src/lib/objects.ts` for the UI.
→ CRUD, events, audit, search, dedupe, permissions, and the REST API all exist.

## The event bus

`emitEvent()` (server/lib/events.ts) is called by the service layer after every mutation. It:

1. **Persists** to the `Event` collection (feeds the activity UI, audits, and the Phase-15 Time Machine).
2. **Fans out** to in-process subscribers (`onEvent(type, cb)` — the hook point for Phase 3 workflows / Phase 8 AI).
3. **Dispatches webhooks** asynchronously (fire-and-forget, HMAC-signed with `x-qorvexa-signature`, one retry, delivery rows in `WebhookDelivery`).

Because events are persisted, a consumer that comes online later (analytics, AI) can replay history — the blueprint's "subscribe to anything" property.

## Audit trail

`writeAudit()` records every mutation with `before`/`after` snapshots and a computed `changed` diff of the form `{ field: { from, to } }`. Combined with persisted events this gives full object history — the data foundation for the Phase-15 "CRM Time Machine".

## Folder map

```
server/
  index.ts            Express bootstrap, object registration, static serving
  db.ts               lazy Prisma singleton + health probe
  env.ts              centralised env access
  seed.ts             demo data generator (idempotent)
  lib/                services (above)
  routes/             auth, users, org, events, fields, webhooks, import,
                      search, dashboard, health, object-routes
src/
  main.tsx / App.tsx  bootstrap + auth-gated router
  lib/api.ts          fetch wrapper; lib/objects.ts UI object meta
  components/         Layout (sidebar + global search), ui primitives
  pages/              Login, Dashboard, ObjectPage (generic), DealsPage
                      (pipeline board), Activities, Events, Settings
prisma/schema.prisma  all models
scripts/build.mjs     cross-platform typecheck + vite build
```
