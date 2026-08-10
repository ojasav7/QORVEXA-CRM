# 05 · API Reference

Base: `/api`. Authentication: signed httpOnly session cookie (`qorvexa.session`) set by login/register, **or** an `Authorization: Bearer <token>` API token (Phase 0 OAuth for integrations — tokens act as a role and are scoped per request like any session user; a `read`-scoped token is rejected on non-GET methods with 401). Errors: `{ "error": "message" }` with HTTP status; validation errors include `issues[]`. All JSON except CSV exports.

## Environments (ADR-008)

Every request may send an **`X-Environment` header** (default `production`) selecting the environment to operate in. The value must be one of the org's environments (default `["production", "sandbox"]`), else `400`. The client persists its choice in `localStorage` and sends it on every request; the session cookie is **not** involved. All data access (list, single-record, search, dashboard, events, import, custom fields, webhooks) is scoped to the selected environment.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/env` | any | `{ environment, environments }` — current env + the org's list. |
| POST | `/api/env/switch` | any | `{ environment }` — validates and returns the value the client should store. |
| POST | `/api/env/create` | admin + flag `environments.sandbox` | `{ name? }` (default `sandbox`). Appends to the org's environments. Emits `env.created`. |
| POST | `/api/env/reset` | admin | `{ environment, confirm? }` — deletes all records in that env. Production requires `confirm: "RESET-PRODUCTION"` **and** org setting `allowProductionReset: true`. Emits `env.reset`. |
| POST | `/api/env/promote` | admin + flag `promote` | `{ from, to, objectType?, ids? }` — copies records to the target env (new ids, references remapped, `promotedFrom` lineage written). Emits `env.promoted`. |

## Feature flags

Flags are server-owned (`server/lib/features.ts`). Effective state = `Organization.settings.featureFlags[key]` → `FeatureFlag` row (per org × environment) → known-key default. The API enforces flags via `requireFeature` middleware (403 when disabled) — the UI toggles are advisory.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/features` | any | `{ environment, features: { key: { enabled, plans, source } } }` for all known flags. |
| PUT | `/api/features/:key` | admin | `{ enabled, plans? }` — writes a `FeatureFlag` row for the current env. Emits `feature.updated`. |

Known flags: `import.merge` (gates POST `/api/import`), `environments.sandbox` (gates env create), `backups` (gates backup endpoints), `promote` (gates env promote).

## Backups (ADR-009)

Snapshots are per-collection JSON archives under `backups/<orgId>-<ts>/`. Restore **always** lands in a fresh sandbox environment (`sandbox-restored-<ts>`) — production restore is rejected by construction. **Scheduled snapshots:** the server snapshots each org's production env `SNAPSHOT_INTERVAL_HOURS` (default 24h) after boot and prunes archives older than `org.settings.backupRetentionDays` (default 30).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/backups` | admin + flag `backups` | List `BackupJob` rows (status, size, env, restoredToEnv). |
| POST | `/api/backup/create` | admin + flag `backups` | `{ environment?, note? }` — snapshots the given (or current) env. Emits `backup.created`. |
| POST | `/api/backup/restore` | admin + flag `backups` | `{ backupId, targetEnvironment: "sandbox" }` — restores into a fresh sandbox, appends it to the org's environments. Emits `backup.restored`. |

## OAuth SSO (provider sign-in)

Standard authorization-code flow. Provider buttons are only rendered for providers the server has credentials for; `GET /api/auth/oauth/providers` returns the list. SSO signs into **existing** accounts by email — no automatic provisioning (see `docs/08-decision-log.md` ADR-005 amendment).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/oauth/providers` | `{ providers: ["google", "github"] }` — which buttons to render (no auth). |
| GET | `/api/auth/oauth/:provider` | Starts the flow → 302 to the provider (state in a short-lived httpOnly cookie). |
| GET | `/api/auth/oauth/:provider/callback` | Exchanges the code, finds the user by profile email, sets the session cookie → redirects `/?oauth=success`. Unknown email → `/?oauth=error=no_account`. |

**Dev mode:** with `OAUTH_MOCK=1` (non-production only) the flow completes instantly as `admin@qorvexa.dev` (or `?mockEmail=`), no provider needed — `GET /api/auth/oauth/google` returns 302 `/?oauth=success` and sets the session.

## API tokens (admin)

Bearer tokens for integrations/scripts. Only the sha256 hash is stored; the raw token is returned **once** at creation. Tokens act as a role (`admin|manager|rep`), honor `X-Environment`, and are blocked when the flag `backups`/other gates apply — they are scoped exactly like session users.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/tokens` | List the org's tokens (name, prefix, role, scopes, last used — never the hash). |
| POST | `/api/tokens` | `{ name, role?, scopes?, expiresInDays? }` — `scopes: ["all"] | ["read"] | ...`. Returns `{ token, tokenId }` (raw once). Emits `token.created`. |
| DELETE | `/api/tokens/:id` | Revoke (row retained for audit). Emits `token.revoked`. |

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8787/api/contacts
```

## CSV export

Exports the **current environment's** records through the same central scoping as list views (tenant + visibility + environment), and only includes columns the acting role can **read** (field-level permissions are applied). Columns = core field keys + the org's active custom fields.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/export/:objectType` | `?q=&status=&stage=&ownerId=&sort=&pageSize=` (max 10 000 rows). `Content-Type: text/csv`, RFC 4180 (trailing newline). |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{ orgName, name, email, password }` | Creates org + admin user, sets cookie. Emits `org.created`. |
| POST | `/api/auth/login` | `{ email, password }` | Sets cookie. Emits `user.logged_in`. |
| POST | `/api/auth/logout` | — | Clears cookie. |
| GET | `/api/auth/me` | — | `{ user, org }` or `{ user: null }`. Used to restore sessions. |

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ status, db, time }` — `degraded` when DB unreachable. |

## Generic object CRUD

Applies to `/api/contacts`, `/api/accounts`, `/api/leads`, `/api/opportunities`, `/api/tasks`, `/api/notes`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/:type` | Query: `page`, `pageSize` (≤100), `q` (keyword), `stage`, `status`, `ownerId`, `sort`. Returns `{ items, total }` scoped by role + visibility. |
| GET | `/api/:type/:id` | Single record, `*Id_label` display names attached for relations (e.g. `accountId_label`). |
| POST | `/api/:type` | Create. Validates core + custom fields, duplicate check. Emits `<type>.created`. Returns 201 + row. **Owner:** an explicit `ownerId` (admin/manager only) always wins; otherwise leads are round-robin routed (when configured); otherwise the creator becomes owner. |
| PATCH | `/api/:type/:id` | Partial update (PATCH semantics — required fields validated against merged state). Stage changes on deals auto-set `probability` and emit `deal.stage_changed`. `ownerId` (admin/manager only) reassigns the owner and emits `lead.routed { mode: "manual" }` for leads. |
| DELETE | `/api/:type/:id` | Emits `<type>.deleted`. |

### Example: create a deal

```bash
curl -X POST http://localhost:8787/api/opportunities \
  -H "content-type: application/json" \
  -b cookies.txt \
  -d '{"name":"Acme — Expansion","amount":50000,"stage":"qualified","closeDate":"2026-12-01"}'
```
→ `probability` becomes `25` (pipeline-driven). Emits `deal.created` `{ stage: "qualified" }`.

## Custom fields (no-code builder)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/fields/:objectType` | `{ core: [...], custom: [...], permissions: [...] }` — core defs from registry + org's custom FieldDefs + per-field permission rows with the caller's effective `read`/`write` flags |
| POST | `/api/fields/:objectType` | Admin. `{ key, label, type, required?, options? }`. Type ∈ `text, number, date, boolean, select, multiselect, url, email`. Emits `schema.field_created`. |
| PATCH | `/api/fields/:objectType/:id` | Admin. Partial update. |
| DELETE | `/api/fields/:objectType/:id` | Admin. Emits `schema.field_deleted`. |

## Field-level permissions (admin)

One row per org × environment × object type × field key. Empty role arrays = everyone; **admin always passes**. Read gating hides the field in list/detail responses and exports; write gating rejects setting it (403) on create/update — enforced in `lib/object-service.ts`, not just the UI.

| Method | Path | Notes |
|---|---|---|
| PUT | `/api/fields/:objectType/permissions/:fieldKey` | `{ readRoles?, writeRoles? }` — role arrays (`admin|manager|rep`). Emits `schema.field_permissions_updated` + audit. |
| DELETE | `/api/fields/:objectType/permissions/:fieldKey` | Reset to open (everyone). Emits `schema.field_permissions_updated`. |

## Search

| Method | Path | Notes |
|---|---|---|
| GET | `/api/search?q=` | Cross-object keyword search across all registered types. Returns `{ items: [{ type, id, title, subtitle }] }`, max 25. (Semantic search: Phase 8.) |

## Dashboard

| Method | Path | Notes |
|---|---|---|
| GET | `/api/dashboard` | `{ stats, pipeline }` — counts + per-stage deal totals/probability, pipeline sum. |

## Events

| Method | Path | Notes |
|---|---|---|
| GET | `/api/events` | Query: `page`, `pageSize`, `type` filter. `{ items, total }` — newest first. |
| GET | `/api/events/feed` | Latest 15 events (dashboard panel). |

## Webhooks (admin)

Webhooks are **per-environment** — a hook created in `sandbox` only receives events from `sandbox`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/webhooks` | List the current environment's webhooks. |
| POST | `/api/webhooks` | `{ url, events: [...] }`. Returns the **signing secret once**. |
| PATCH | `/api/webhooks/:id` | Update url/events/active. |
| DELETE | `/api/webhooks/:id` | Remove. |
| POST | `/api/webhooks/:id/test` | Fire a `webhook.test` event through the pipeline. |

## Import (gated by flag `import.merge`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/import` | `{ objectType, csv, dryRun?, merge? }` — first row = headers (field keys). Returns `{ imported, merged, duplicates, failed, errors[], result: { rows } }`. |

**Dry-run** (`dryRun: true`) writes nothing and returns per-row analysis: `{ row, status: "new" | "duplicate" | "failed", existingId?, matchedOn?, changes? }` where `changes` is a field diff against the existing record.

**Merge resolution** (`merge: { [rowNumber]: { mode: "create" | "merge", targetId?, fields? } }`, keyed by the 1-based row number incl. header) applies per row: `merge` updates only the listed `fields` (default: all CSV fields) onto `targetId` (default: the auto-detected duplicate) and emits `<type>.merged`; everything else creates and emits `<type>.imported`. No writes happen without `dryRun: false`.

```json
{
  "objectType": "contact",
  "dryRun": true,
  "csv": "firstName,lastName,email,title\nAda,Lovelace,ada@acme.com,Analyst",
  "result": { "rows": [{ "row": 2, "status": "duplicate", "existingId": "…", "matchedOn": "email", "changes": { "title": { "from": "Analyst", "to": "VP" } } }] }
}
```

## Team (admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/users` | List org members. |
| POST | `/api/users` | `{ name, email, password, role, title? }`. Emits `user.created`. |
| PATCH | `/api/users/:id` | `{ role?, active?, title? }`. Self-disable blocked. |
| DELETE | `/api/users/:id` | Self-delete blocked. |

## Org settings

| Method | Path | Notes |
|---|---|---|
| GET | `/api/org` | `{ org }` |
| PATCH | `/api/org` | Admin. `{ name?, settings? }` (settings = JSON; locale/timezone/feature flags). |

## Lead routing (Phase 1)

Config lives in `Organization.settings.leadRouting`: `{ mode: "manual" | "round-robin", pool: string[] (user ids), cursor }`. In `round-robin` mode, new leads **without an explicit owner** cycle through the ACTIVE pool members (disabled users skipped; cursor persisted across restarts). Admins retain full authority — an explicit `ownerId` on create or PATCH always wins (reps get a 403 trying to set one).

| Method | Path | Notes |
|---|---|---|
| PATCH | `/api/org` | Admin. `{ settings: { leadRouting: { mode, pool, cursor } } }` — configure the pool & mode (Settings → Lead routing). |

## Segments (Phase 1)

Dynamic lists — membership is computed **on read** against the segment's criteria (org + environment + visibility scoped), so counts stay live. Criteria: `{ filters: [{ field, op, value }] }` with `op ∈ eq, ne, gt, gte, lt, lte, contains, in, is_set`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/segments` | List with live `memberCount`. Any authenticated user. |
| POST | `/api/segments` | Admin. `{ name, objectType, criteria?, active? }`. Emits `segment.created`. |
| GET | `/api/segments/:id/members` | Paginated membership (`?page=&pageSize=`) with `ownerName` attached. |
| PATCH | `/api/segments/:id` | Admin. Partial update (PATCH semantics — criteria/active only change when sent). |
| DELETE | `/api/segments/:id` | Admin. Emits `segment.deleted`. |

## Lead-capture forms (Phase 1)

Admin-configured public forms that create **routed** leads in the org's production env. Form `fields` must be real lead core fields. Public endpoints are deliberately unauthenticated, protected by a honeypot field + a per-IP rate limit (10/min); duplicate emails are rejected without leaking that the lead exists.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/lead-forms` | Admin | List forms. |
| POST | `/api/lead-forms` | Admin | `{ name, slug, fields: [{ key, label, required?, type? }], submitLabel?, active? }`. Emits `leadform.created`. |
| PATCH | `/api/lead-forms/:id` | Admin | Partial update (PATCH semantics). |
| DELETE | `/api/lead-forms/:id` | Admin | Emits `leadform.deleted`. |
| GET | `/api/public/forms/:slug` | **none** | Public config `{ name, fields, submitLabel }` — 404/400 when inactive. |
| POST | `/api/public/forms/:slug/submit` | **none** | `{ firstName, lastName, email, phone?, company?, company_website? (honeypot) }`. Creates a lead (`source: "Website"`) → `{ ok, duplicate, leadId? }`. Duplicate email → `{ ok: true, duplicate: true }` (no existence leak). Emits `lead.captured` + routing events. |

**Embed:** point any page/form at `POST /api/public/forms/<slug>/submit` — the Settings → Lead capture tab shows a ready-to-paste snippet.

## Duplicate merge (Phase 1)

Merges two records of the same type into a master, choosing per-field which record wins.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/merge` | `{ objectType, masterId, mergeId, fieldChoices? }` — `fieldChoices: { [field]: "master" | "merge" }` (default: master wins all). The merge record is deleted; non-conflicting fields come from the master unless overridden. Emits `<type>.merged { via: "records" }` + audit. UI: pick-two checkboxes on list pages. |

## Status codes

`200` success · `201` created · `400` validation/duplicate/conflict · `401` unauthenticated · `403` role/visibility denied · `404` missing (also returned for cross-tenant access to avoid leaking existence) · `500` unexpected.
