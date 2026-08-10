# 02 · Data Model

The schema lives in `prisma/schema.prisma` (single source of truth). This document explains the design and how it maps to the blueprint's Section 3.

## Standard object shape (blueprint §3.2) → implementation

| Blueprint facet | Implementation |
|---|---|
| Core typed fields | Named columns per model (e.g. `Contact.email`) |
| Custom fields | `FieldDef` registry rows + per-record `custom` JSON |
| Relationships | `*Id` reference columns, joined in the service layer |
| Permissions | `visibility` column (`org`/`owner`) + user `role` |
| Events | `Event` collection, emitted by the service layer |
| Workflows | `Event` subscription points (`onEvent()`) — Phase 3 |
| AI context | Event + audit history — Phase 8 |
| Views / Reports | Phase 6 (same models) |
| Automation hooks | Pre/post hooks in `object-service.ts` |

## Entities (Phase 0 — platform)

| Model | Purpose |
|---|---|
| `Organization` | Tenant. `slug` unique; `settings` JSON (locale, feature flags, residency tags). |
| `User` | Member. `email` globally unique in Phases 0–1 (email-based login); `role` in `admin|manager|rep`; `active` for disabling. |
| `Event` | Event-bus persistence. `type` = `object.action`; payload JSON; indexed by org + created. |
| `AuditLog` | One row per mutation: `action`, `before`, `after`, `changed` (field diff), `actorId`, `ip`. |
| `Webhook` / `WebhookDelivery` | Outbound subscriptions + delivery attempts (`status`, `attempts`, `lastError`). |
| `FieldDef` | Custom-field registry: `objectType`, `key`, `label`, `type`, `required`, `options`, `order`, `active`. Per-environment. |
| `FeatureFlag` | Flag override per org × environment × key: `enabled`, `plans`. Unique on `(orgId, environment, key)`. |
| `BackupJob` | Snapshot/restore history (ADR-009): `status`, `archivePath`, `sizeBytes`, `environment`, `restoredToEnv`, `note`. |

## Entities (Phase 1 — core CRM)

| Model | Key fields | Notes |
|---|---|---|
| `Contact` | firstName, lastName, email, phone, title, source, status, tags | `email` unique per org → duplicate detection |
| `Account` | name, industry, website, phone, employees, tier | `parentId` supports hierarchy (Phase 1) |
| `Lead` | firstName, lastName, email, company, source, status, **score** (0–100) | Basic scoring in place; ML scoring is Phase 8 |
| `Opportunity` | name, stage, amount, probability, closeDate, win/lostReason, competitors | Pipeline in `registry.ts`; stage moves are event-sourced |
| `Task` | title, description, dueAt, status, priority | Linked to contact/deal via refs |
| `Note` | body, authorId, refs | Timeline on record detail views |

All Phase-1 objects share: `orgId`, `environment`, `ownerId`, `tags`, `custom`, `visibility`, `createdAt`, `updatedAt`. Object models also carry `promotedFrom` (id of the source record when copied by environment promotion).

## Environments (ADR-008)

Every data model (objects, events, audit, webhooks, field defs) carries an `environment` scoping field — `production` by default, or a sandbox name. It is enforced centrally in `lib/access.ts` exactly like `orgId` (`listConditions` / `assertCanAccess`): a sandbox-scoped query can never see production rows. The client sends the selected environment as the `X-Environment` header on every request.

> **Backfill:** `prisma db push` does not stamp existing documents. Run `npm run backfill:env` once after upgrading a database that has data (it operates at the raw level — Prisma SELECTs synthesize the schema default, so JS-side checks would miss unstamped docs).

## Custom fields (the no-code builder, v1)

1. Admin creates a field via `POST /api/fields/:objectType` (Settings → Custom fields).
2. A `FieldDef` row is stored; the event `schema.field_created` fires.
3. When creating/updating a record, `splitFields()` in `object-service.ts`:
   - routes known keys to core columns,
   - validates unknown keys against the org's active `FieldDef`s (type coercion, required check),
   - stores valid values in the record's `custom` JSON; unknown keys are dropped.
4. The UI (`ObjectForm`) renders custom fields dynamically from `GET /api/fields/:type`.

**Rules:** field keys must match `^[a-z][a-zA-Z0-9]*$`; select/multiselect types require options; a key can't be redefined per object type.

## Duplicate detection

Configurable per type via `uniqueFields` in `registerObject()`:
- `contact` → `email`
- `lead` → `email`
- `account` → `name`

On create/update, the service queries the **org × environment** for an existing record with the same (lowercased/trimmed) value and rejects with a 400 listing the offending field. The CSV import (`POST /api/import`) uses the same rule; its dry-run reports duplicates with a field diff, and per-row merge resolution applies a field-scoped patch onto the matched record (`<type>.merged`).

## Conventions

- Every document has `orgId` — **never query without scoping to it** (`listWhere()` from `lib/access.ts` enforces this for list endpoints; `assertAccess()` for single-record endpoints).
- Every document also has `environment` — scoped the same way (ADR-008).
- Restores (ADR-009) insert fresh ids and remap cross-record references (`accountId`, `contactId`, `opportunityId`, `parentId`, `promotedFrom`) so restored sandboxes stay internally consistent.
- Dates are stored as `DateTime` (ISO); the UI formats locally.
- `tags` and `custom` are always JSON arrays/objects, defaulted to `[]`/`{}`.
- No hard deletes are hidden: deletions are audit-logged and emit `<type>.deleted` events (Phase-15 Time Machine will restore from this trail).
