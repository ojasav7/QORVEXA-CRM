# 11 · Phase 0 Hardening — Build Report

> Status of `docs/09-spec-phase0-hardening.md` as implemented and verified on **2026-08-10**.
> Every item below is backed by a passing API smoke test (evidence in §5), `npm run typecheck`, and `npm run build`.

---

## 1. Executive summary

Phase 0 hardening is implemented **end-to-end** across the four spec workstreams:

| # | Workstream | Status |
|---|---|---|
| 1 | Environments (ADR-008 `environment` field + `X-Environment`) | ✅ shipped + leak-tested |
| 2 | Feature flags (server-owned registry + API gate) | ✅ shipped + gate-tested |
| 3 | CSV import with dry-run + per-row merge | ✅ shipped + diff-tested |
| 4 | Backups (snapshot + restore-to-sandbox, ADR-009) | ✅ shipped + round-trip tested |
| 5 | Environments UI (switcher, create, reset, promote) | ✅ shipped |
| 6 | Docs (event catalog, API reference, PROGRESS) | ✅ updated |

An admin can now: create a sandbox env, flip a flag that gates an API route in the same request, import CSV with a dry-run preview and field-scoped merges, snapshot the database, and restore a backup into a fresh sandbox — all from Settings, all audit-logged and event-sourced.

## 2. What was built

### 2.1 Environments (ADR-008)

- **Schema:** `environment String @default("production")` added to every data model — `Contact`, `Account`, `Lead`, `Opportunity`, `Task`, `Note`, `Event`, `AuditLog`, `Webhook`, `WebhookDelivery`, `FieldDef`. Object models also gained `promotedFrom String?` for promotion lineage.
- **Access layer (`lib/access.ts`):** `environment` is threaded through `listConditions` / `assertCanAccess` exactly like `orgId`. A sandbox-scoped query can never see production rows, and cross-environment single-record access returns 404 (no existence leak).
- **Resolution (`lib/environment.ts`):** the client sends `X-Environment` on every request; the server validates it against `Organization.settings.environments` (default `["production", "sandbox"]`), unknown values → 400.
- **Scoped everywhere:** object CRUD, search, dashboard counts, event feed, custom fields, webhooks, import, env/backup/feature endpoints.
- **Backfill (`npm run backfill:env`):** one-off raw-level `updateMany` stamping `environment: "production"` on legacy docs. *Note:* it must run at the raw level — Prisma SELECTs synthesize the schema default for missing fields, so JS-side checks silently see "production" while WHERE filters still miss the docs (caught and fixed during verification; ~47 legacy demo docs stamped).
- **Webhooks:** per-environment — sandbox events never dispatch to production hooks (and vice versa).
- **Events & audit:** every persisted event / audit row carries `environment`.

### 2.2 Feature flags

- **Server-owned registry (`lib/features.ts`):** known flags `import.merge`, `environments.sandbox`, `backups`, `promote` with labels, descriptions, plan tiers, and defaults.
- **Effective state** = `Organization.settings.featureFlags[key]` → `FeatureFlag` row (unique per org × env × key) → known-key default.
- **API gate (`requireFeature`):** `POST /api/import`, `/api/env/create`, `/api/env/promote`, and the backup endpoints are middleware-gated; a disabled flag returns 403 in the same request cycle. The UI toggles are advisory by design.
- **Endpoints:** `GET /api/features`, `PUT /api/features/:key` (admin, writes the env-scoped row, emits `feature.updated`).

### 2.3 CSV import with merge

- `POST /api/import` now accepts `dryRun` and a per-row `merge` map keyed by the 1-based row number shown in the preview.
- **Dry run** writes nothing: every row is classified `new` / `duplicate` (with `matchedOn` + a field diff `changes: { from, to }`) / `failed`.
- **Merge resolution:** per row — `create`, or `merge` into `targetId` (default: auto-detected duplicate) applying only the listed `fields`. Merges emit `<type>.merged` (with the applied diff) and are audited before/after; creates emit `<type>.imported` in addition to `<type>.created`.
- **Duplicate detection** is environment-scoped (a sandbox import is not flagged against production records).
- **New `/import` page:** object picker, paste/upload CSV, dry-run preview table with per-row create/merge controls and per-field merge toggles, run button, and a result summary. Nav item gated on `import.merge`.

### 2.4 Backups (ADR-009)

- **Snapshot (`lib/backup.ts`):** per-collection JSON archives under `backups/<orgId>-<ts>/` with a `meta.json` manifest. *Deviation:* the spec suggested `mongodump`; a portable JSON archive was chosen so no external binary is required and archives are human-inspectable (same isolation model — this is a single-DB discriminator, not a separate database).
- **`BackupJob` model:** every create/restore records `status`, `archivePath`, `sizeBytes`, `environment`, `restoredToEnv`, `note`.
- **Restore:** always lands in a **fresh** `sandbox-restored-<ts>` environment name (never clobbers, never touches production — `targetEnvironment: "production"` is rejected with 400). Because ids are globally unique per collection (ADR-008 keeps one collection), restored records get **new ids** and cross-record references (`accountId`, `contactId`, `opportunityId`, `parentId`, `promotedFrom`) are **remapped** so the restored sandbox is internally consistent. The fresh env is appended to the org's environments so the UI switcher can select it.
- **Endpoints:** `GET /api/backups`, `POST /api/backup/create`, `POST /api/backup/restore` (mounted at both `/api/backup/*` and `/api/backups` per the spec's table).

### 2.5 Environments UI + promote

- **Header switcher** (persisted in `localStorage`, sent as `X-Environment` on every request via `lib/api.ts`).
- **Settings → Environments:** env list with current badge, switch, create sandbox, reset (production requires a typed `RESET-PRODUCTION` confirmation), and a promote card (from → to → object type).
- **Settings → Feature flags:** registry table with toggles, plan chips, and the effective-state source badge.
- **Settings → Backups:** create-snapshot button, job list (status/size/env/restoredTo), restore-into-sandbox action.

## 3. Deviations from the spec (all documented)

| Spec | Implemented as | Why |
|---|---|---|
| `mongodump` archives | Per-collection JSON archives (`backups/`) | No binary dependency; inspectable; same single-DB restore model |
| Restore preserving ids | New ids + reference remapping | Ids are globally unique per collection — preserving them collides with live production rows |
| `contact.imported` per created row | Emitted in addition to `contact.created` | Import provenance stays explicit |
| `FeatureFlag.environment` column | Rows are unique per org × environment | Flags are per-environment by construction (matches the "effective state for current env" UI) |

No ADR amendments were required — ADR-008/009 are implemented as recorded.

## 4. Acceptance criteria

- [x] Admin can create a sandbox env, add records there, and **not see them** in production (and vice versa) — verified by API + automated smoke (production: 5 seeded contacts, sandbox: 0 → create in sandbox → sandbox 1, production still 5; search & dashboard agree).
- [x] Admin can reset a sandbox; production reset requires double-confirm + org setting (`allowProductionReset`).
- [x] A flag flipped in Settings disables the API route within the same request (PUT `import.merge=false` → `POST /api/import` 403 → re-enable → 200).
- [x] CSV import shows a dry-run preview with duplicate diffs; merge writes only the chosen fields, emits `contact.merged`, and the audit trail records before/after.
- [x] Creating a snapshot produces a `BackupJob` row + archive file; restoring it creates a fresh `sandbox-restored-*` env populated from the archive with remapped references; production is untouched.
- [x] `npm run typecheck` and `npm run build` pass; existing smoke flows (auth, CRUD, deals, events) remain green.
- [x] `docs/03-event-catalog.md` and `docs/05-api-reference.md` updated with the new events/endpoints.

## 5. Verification evidence (live API smoke run)

```
GET  /api/env (default)          → { environment: "production", environments: ["production","sandbox"] }
GET  /api/env (x-env: sandbox)   → { environment: "sandbox", ... }
GET  /api/env (x-env: bogus)     → 400 { error: "Unknown environment: \"bogus\"" }
GET  /api/contacts (prod)        → total 5      (seeded)
GET  /api/contacts (sandbox)     → total 0      ← cross-env leak test
POST /api/contacts (sandbox)     → 201, environment: "sandbox"
GET  /api/contacts (prod again)  → total 5      ← no leak
PUT  /api/features/import.merge false → 200
POST /api/import                 → 403 { error: "Feature \"import.merge\" is disabled..." }
PUT  /api/features/import.merge true  → 200
POST /api/import dryRun          → rows: [ {row 2, duplicate, matchedOn: "email",
                                          changes: { title: { from: "VP Operations", to: "VP Ops" } } },
                                           {row 3, new} ]
POST /api/import with merge      → { imported: 1, merged: 1, duplicates: 0, failed: 0 }
                                 → merged contact title updated; contact.merged event persisted
POST /api/backup/create          → BackupJob success, 12.8 KB archive under backups/
POST /api/backup/restore         → restored 27 records into sandbox-restored-1786382504586
                                 → restored contact's accountId resolves ONLY in the restored env
                                   (GET /api/accounts/:remappedId in restored env → 200 Northwind Traders;
                                   same id in production → 404) — references are fully re-isolated
POST /api/backup/restore (prod)  → 400 { error: "Restores must target a sandbox environment..." }
POST /api/env/promote            → { copied: 1, updated: 0 } (idempotent: second run updated: 1)
                                 → promoted copy carries promotedFrom lineage
POST /api/env/reset (sandbox)    → { ok, deleted } — production untouched
GET  /api/events                 → env.created, backup.created, backup.restored, feature.updated,
                                   contact.merged, contact.imported, env.promoted, env.reset all present
```

## 6. Files touched

**Schema / scripts:** `prisma/schema.prisma` · `server/scripts/backfill-environment.ts` · `package.json` (backfill:env) · `.gitignore` (backups/)
**Server libs:** `lib/environment.ts` (new) · `lib/features.ts` (new) · `lib/backup.ts` (new) · `lib/access.ts` · `lib/object-service.ts` · `lib/events.ts` · `lib/audit.ts`
**Server routes:** `routes/env.ts` (new) · `routes/features.ts` (new) · `routes/backup.ts` (new) · `routes/import.ts` · `routes/object-routes.ts` · `routes/search.ts` · `routes/dashboard.ts` · `routes/events.ts` · `routes/webhooks.ts` · `routes/fields.ts` · `index.ts`
**Client:** `lib/api.ts` (X-Environment header) · `App.tsx` (env + features in session, /import route) · `components/Layout.tsx` (env switcher, gated Import nav) · `pages/SettingsPage.tsx` (3 new tabs) · `pages/ImportPage.tsx` (new)
**Docs:** `docs/02-data-model.md` · `docs/03-event-catalog.md` · `docs/05-api-reference.md` · `docs/07-setup.md` · `PROGRESS.md` · this report

## 7. Remaining Phase 0 gaps

> All blueprint Phase 0 items are now shipped (addendum in §9). What remains is *scoped out by design*:

- **True point-in-time replay** stays Phase-15 (Time Machine) scope — snapshots capture a moment; they are not an event-replay store.
- **SSO auto-provisioning** — provider sign-in requires an existing account (documented limitation; SCIM lands with Phase 14).

## 8. How to demo it

```bash
npm run mongo:up && npm run dev        # seed already applied; login admin@qorvexa.dev / password123
```
1. Header switcher → **sandbox** → create a contact → switch back to **production** → it's not there.
2. **Settings → Feature flags** → toggle `import.merge` off → open Import → it's hidden / 403s.
3. **Import** → paste a CSV with an existing email → Preview → see the diff → merge just the changed field → Run.
4. **Settings → Backups** → Create snapshot now → Restore into sandbox → switch to `sandbox-restored-*`.
5. **Settings → Environments** → Promote sandbox → production, then Reset a sandbox.
6. **Contacts → Export CSV** → opens a `.csv` of the current environment. **Settings → Custom fields** → shield icon on a field → restrict `email` read to admin/manager → log in as a rep → the column disappears and writes 403.
7. **Settings → API tokens** → Issue token → `curl -H "Authorization: Bearer <token>" /api/contacts`. Issue a `read`-scope token → any POST 401s.
8. **Log out → Continue with Google** (dev: `OAUTH_MOCK=1` completes instantly as `admin@qorvexa.dev`) → back in the dashboard.

---

## 9. Addendum — Phase 0 completion (2026-08-10)

> Completes the remaining blueprint Phase 0 items on top of the hardening work above. Everything below is verified by live API smoke tests (§9.5), `npm run typecheck`, and `npm run build`.

### 9.1 CSV export

- `GET /api/export/:objectType` (`routes/export.ts`) — streams CSV of the **current environment** through the same central scoping as list views (tenant + visibility + environment), headers = core field keys + active custom fields, `q/status/stage/ownerId/sort/pageSize` filters, max 10 000 rows, RFC 4180 (quoted fields, trailing newline).
- **Field-permission aware:** columns are filtered by what the acting role can read — a rep's export omits admin-restricted fields entirely.
- Client: `downloadCsv()` in `lib/api.ts` (keeps `X-Environment` + cookie) + **Export CSV** buttons on every list page and the deals board.

### 9.2 Field-level permissions (blueprint principle #3)

- **`FieldPermission`** model: one row per org × environment × object type × field key with `readRoles` / `writeRoles` (empty arrays = everyone; **admin always passes**).
- **Enforcement in the service layer**, not the UI: `lib/field-permissions.ts` (`fieldPermMap`, `canRead/canWrite`, `maskRow`) — `lib/object-service.ts` masks list/detail responses and rejects writes to non-writable fields with 403; `routes/export.ts` filters columns. The UI (list columns, forms, detail) only *reflects* the effective flags from `GET /api/fields/:type`.
- **Settings → Custom fields** shield icon opens a read/write role picker per field; changes emit `schema.field_permissions_updated` + audit rows.
- Verified: restrict `contact.email` → rep list omits the key, rep create with email → 403, rep export has no email column, admin unaffected.

### 9.3 Data residency configuration

- `Organization.settings.dataResidency = { region, policy }` (`region-lock` | `flexible`) via `PATCH /api/org`; **Settings → Environments** residency card. Config only — enforcement (region-locked hosting, AI routing) lands with multi-region infrastructure in a later phase.

### 9.4 Backups — scheduled snapshots + retention

- In-process scheduler (`runScheduledSnapshots` in `lib/backup.ts`): snapshots each org's production env `SNAPSHOT_INTERVAL_HOURS` (default 24h, first run 60s after boot) when the `backups` feature is enabled, then **prunes** archives older than `Organization.settings.backupRetentionDays` (default 30) — archive directory + `BackupJob` row. Kill switch `SNAPSHOTS_ENABLED=false`.
- Verified live: server restarted → scheduled run created a `success` job; a 40-day-old fixture was pruned (retention 30d).

### 9.5 OAuth (both blueprint shapes — user decision)

- **API tokens** (`ApiToken` model, `routes/tokens.ts`, `lib/tokens.ts`): admins issue bearer tokens — sha256 at rest (raw shown once), `prefix` for display, act as `admin|manager|rep`, scopes `all|read|write` (read-only is rejected on non-GET with 401), optional expiry, revoked = deactivated (row retained for audit). `loadTokenAuth` middleware authenticates `Authorization: Bearer <token>`; tokens are scoped per request exactly like session users (org + `X-Environment` + role). Settings → API tokens tab (issue modal shows the raw token once, copy button, revoke).
- **Provider SSO** (`routes/oauth.ts`): Google + GitHub authorization-code flows — state in a short-lived httpOnly cookie (CSRF-checked at callback), code → token exchange, profile email must match an **existing active user** (no auto-provisioning; failure redirects `/?oauth=error=no_account`), success sets the normal session cookie and redirects `/?oauth=success`. Login page renders provider buttons from `GET /api/auth/oauth/providers` (only for configured providers) with brand marks; `RequireAuth` preserves the `?oauth=…` query so errors surface on the login card. **Dev mode** `OAUTH_MOCK=1` (non-production) completes the flow instantly as `admin@qorvexa.dev` or `?mockEmail=…` — no provider credentials needed.
- Verified live: providers list, mock Google login → 302 `/?oauth=success` + working session cookie (`/api/auth/me` = admin), unknown email → `/?oauth=error=no_account`, read-only token 401 on POST / 200 on GET, revoked token → 401.
- ADR amendments recorded in `docs/08-decision-log.md` (ADR-005-A, ADR-006-A, ADR-009-A).

### 9.6 Schema & other changes

- `prisma/schema.prisma`: `FieldPermission`, `ApiToken` models; `User.oauthProvider` / `User.oauthId`; synced via `db:generate` + `db:push`.
- `scripts/build.mjs`: Windows fix — `spawnSync(..., shell: process.platform === "win32")` so `npx.cmd` resolves (the `npm run build` script silently exited 1 on Windows before this).
- `server/env.ts`: OAuth + snapshot config vars (see `docs/07-setup.md`).

### 9.7 Acceptance criteria (Phase 0 completion)

- [x] Any list page and the deals board can export the current environment as RFC 4180 CSV; restricted columns are omitted for roles that can't read them.
- [x] A field restricted in Settings disappears from a rep's list/detail/export, and a rep write to it returns 403; admins are never affected.
- [x] Data residency region + policy persist via the org settings UI.
- [x] Scheduled snapshots run unattended and old archives are pruned per `backupRetentionDays`.
- [x] API tokens authenticate integrations, honor role/scopes/environment, and are revocable; read-only tokens can't write.
- [x] Google/GitHub SSO sign-in works end-to-end (mock-verified), errors surface on the login page, and it only signs into existing accounts.
- [x] `npm run typecheck` + `npm run build` green; demo DB left pristine (prod 5 seeded contacts, sandbox empty, no leftover flags/tokens/permissions/jobs).

### 9.8 Files touched (addendum)

**Schema:** `prisma/schema.prisma`
**Server libs:** `lib/tokens.ts` (new) · `lib/field-permissions.ts` (new) · `lib/backup.ts` (scheduler + prune) · `lib/auth.ts` (bearer middleware) · `lib/object-service.ts` (mask + write-reject) · `env.ts`
**Server routes:** `routes/export.ts` (new) · `routes/tokens.ts` (new) · `routes/oauth.ts` (new) · `routes/fields.ts` (permission endpoints) · `index.ts` (mounts + scheduler)
**Client:** `lib/api.ts` (`downloadCsv`) · `pages/Login.tsx` (SSO buttons + oauth error state) · `pages/SettingsPage.tsx` (API tokens tab, field-permission picker, residency card) · `pages/ObjectPage.tsx` (Export CSV + column masking) · `pages/DealsPage.tsx` (Export CSV) · `App.tsx` (RequireAuth preserves oauth query)
**Build:** `scripts/build.mjs` (Windows npx fix)
**Docs:** `docs/03-event-catalog.md` · `docs/05-api-reference.md` · `docs/07-setup.md` · `docs/08-decision-log.md` (ADR amendments) · `PROGRESS.md` (Phase 0 = 100%) · this report