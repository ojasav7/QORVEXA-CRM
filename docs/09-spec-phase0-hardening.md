# 09 · Technical Spec — Phase 0 Hardening

> Implementation-ready spec for completing the Phase 0 enterprise backbone:
> sandbox environments, feature flags, CSV merge UI, backup/restore.
> Audience: future-you or an AI agent building this next. Follows ADR-008/009 in `docs/08-decision-log.md`.

---

## 1. Goal

Finish the Phase 0 items the blueprint marks as required before feature velocity matters: admins can safely experiment (sandbox), roll out capability gradually (feature flags), recover from bad imports (merge UI + backups), and never lose data (snapshots). **Done** = an admin can: create a sandbox env, enable a flag for their org, import-with-merge, and restore a backup into a sandbox — all from the Settings UI, with everything audit-logged.

**Non-goals (deferred):** true point-in-time event replay (that's the Phase-15 Time Machine), cross-region data residency UI (config slot only), change-set environment promotion (Phase 13), OAuth.

---

## 2. Architecture decisions (recorded as ADR-008/009)

### ADR-008 · Environment as a scoping field (not a separate DB)

**Decision:** `environment` column on every data model (`production` | `sandbox`), scoped centrally in `lib/access.ts` exactly like `orgId` today. The server resolves the current environment from a request header `X-Environment` (default `production`), whitelisted to the org's configured environments.

**Why:** the enforcement choke point already exists (`listConditions` / `assertCanAccess`); environment becomes one more `AND` clause. No multi-connection complexity, no Prisma client-per-env, promotion is a plain copy.

**Cost/risk:** isolation is only as good as the central scoping — which is why environment is added to `listConditions` and the *count* helpers too, and why a smoke test must verify a sandbox-scoped query can never see production rows.

### ADR-009 · Backups = snapshots + restore-to-sandbox

**Decision:** scheduled + manual `mongodump` archive snapshots stored in `backups/` (optional S3 later). Restore **always lands in a fresh sandbox environment**, never over production. Event log provides evidence of what changed since a snapshot.

**Why:** restore-into-prod is the highest-risk operation in a CRM; restoring into a sandbox is safe, and the audit/event trail lets an admin review "what would be lost" before touching prod. True PIT replay is explicitly Phase-15 scope.

---

## 3. Data model changes (`prisma/schema.prisma`)

| Model / field | Change | Notes |
|---|---|---|
| All object models (Contact, Account, Lead, Opportunity, Task, Note) | + `environment String @default("production")` | Index with `orgId` |
| `Event`, `AuditLog`, `Webhook`, `WebhookDelivery`, `FieldDef` | + `environment String @default("production")` | Sandbox events must not fire prod webhooks |
| `Organization.settings` | Documented keys: `environments: string[]`, `featureFlags: {key: {enabled, plans[]}}`, `backupRetentionDays: number` | JSON — no schema change needed |
| 🆕 `FeatureFlag` | `key`, `label`, `description`, `enabledDefault`, `plans[]`, `environment` | **The authoritative registry** of known flags, seeded with server-known keys. Effective state for an org = `FeatureFlag` row, overridden by `Organization.settings.featureFlags[key]` if present. UI is advisory; the API is the real gate. |
| 🆕 `BackupJob` | `status` (running/success/failed), `archivePath`, `sizeBytes`, `environment`, `restoredToEnv?`, `createdAt` | Every snapshot + restore is a row (audit-friendly) |
| 🆕 `Environment` (optional v1.5) | `orgId`, `name`, `createdAt` | Only if orgs need multiple named sandboxes; v1 can hardcode `sandbox` |
| `promotedFrom` on object models (optional) | `String?` — id of the source record when copied by promote | Only if promote should trace lineage; otherwise drop the `promoted_from` reference from §4 |

**Migration warning (Mongo):** `prisma db push` does not backfill existing documents. Use a one-off script (like `server/scripts/backfill-environment.mjs`) to set `environment: "production"` on existing docs, or `dropDatabase` + re-seed in dev.

---

## 4. API changes

| Method | Path | Auth | Body / Query | Events emitted |
|---|---|---|---|---|
| GET | `/api/env` | any | — returns current env + org's environments | — |
| POST | `/api/env/switch` | any | `{ environment }` — returns the value the client should store in `localStorage` and send as `X-Environment` | — |
| POST | `/api/env/create` | admin | `{ name }` (defaults `sandbox`) | `env.created` |
| POST | `/api/env/reset` | admin | `{ environment }` — wipes records in that env (never `production` without double-confirm) | `env.reset` |
| POST | `/api/env/promote` | admin | `{ from, to, objectType?, ids? }` — copies changed objects; writes `promoted_from` on target + audit row | `env.promoted` |
| GET | `/api/features` | any | — merged registry + org overrides for current env | — |
| PUT | `/api/features/:key` | admin | `{ enabled, plans? }` | `feature.updated` |
| POST | `/api/import` | any | **extended:** `{ objectType, csv, dryRun?, merge?: { [rowIndex]: { mode: "create"\|"merge", targetId?, fields?: string[] } } }` | `contact.merged` / `contact.imported` |
| POST | `/api/backup/create` | admin | `{ environment?, note? }` | `backup.created` |
| POST | `/api/backup/restore` | admin | `{ backupId, targetEnvironment: "sandbox" }` | `backup.restored` |
| GET | `/api/backups` | admin | — list BackupJob rows | — |

**Environment switching (single mechanism):** the client stores the chosen environment in `localStorage` and sends it on **every request as the `X-Environment` header**. The server resolves `req.headers["x-environment"]`, validates it against `Organization.settings.environments` (default `["production", "sandbox"]`), and threads it into `listConditions` / `assertCanAccess`. Unknown values → 400. The session cookie is **not** involved in env selection.

**Import dry-run contract:**
```json
{
  "dryRun": true,
  "objectType": "contact",
  "csv": "firstName,lastName,email\nAda,Lovelace,ada@acme.com",
  "result": {
    "rows": [{ "row": 2, "status": "duplicate", "existingId": "…", "matchedOn": "email", "changes": { "title": { "from": "Analyst", "to": "VP" } } }]
  }
}
```
Merge mode applies only the listed `fields` (or all changed fields) onto the target; unlisted row values go to `custom` only if a FieldDef exists.

---

## 5. UI changes (`src/`)

| Page | What |
|---|---|
| Settings → **Environments** | List envs, create/reset sandbox, env switcher (persisted in `localStorage`, sent as `X-Environment`), promote (pick from/to + object types) |
| Settings → **Feature flags** | Registry table with toggle per flag + plan checkboxes; shows effective state for current env |
| Settings → **Backups** | "Create snapshot now", list of jobs with status/size, "Restore into sandbox…" flow with target-env picker (prod restore disabled) |
| New page **Import** (`/import`) | Upload CSV → client parses → dry-run call → preview table (new / duplicate with diff) → per-row resolve (create / merge into X) → confirm → result summary |

**Client plumbing:** `lib/api.ts` gains a default header from `localStorage.env`; `App` fetches `/api/env` on boot. Feature flags gate nav items (e.g. hide Import until flagged) via a `useFeature(key)` hook.

---

## 6. Events & audit

New events (all persisted + webhook-deliverable): `env.created`, `env.reset`, `env.promoted`, `feature.updated`, `backup.created`, `backup.restored`, `contact.merged`, `contact.imported`.

Audit additions: every env switch, flag change, backup/restore, and import/merge writes an `AuditLog` row with before/after (e.g. feature flag `{enabled: false → true}`; backup restore `{archivePath, targetEnv}`).

**Sandbox webhook rule:** events with `environment: "sandbox"` only dispatch to webhooks registered in the same environment. (Webhook rows get the `environment` column.)

**Restore mechanics (spelled out):** because ADR-008 uses a single database with an `environment` discriminator, restore does **not** target a separate database. `POST /api/backup/restore` runs `mongorestore` from the archive into the same DB, then runs an update across the restored collections to set `environment = "sandbox-restored-<timestamp>"`, and records `restoredToEnv` on the `BackupJob`. The UI only offers sandbox targets; `targetEnvironment: "production"` is rejected server-side. The restored docs are thus isolated by the same central scoping as everything else.

---

## 7. Edge cases & risks

1. **Environment leak = data breach.** Mitigation: env is added to `listConditions`, `assertCanAccess`, dashboard/search/count queries, and the *event feed* — plus a required smoke test asserting cross-env invisibility.
2. **Mongo backfill on `db push`** — new non-nullable `environment` column breaks reads of old docs (`P2032`). Run the backfill script before serving; document in `docs/07-setup.md`.
3. **`mongodump` while writes happen** — acceptable for v1 (dump during low traffic); note `--oplog` for point-in-time is Phase-15 scope.
4. **Restore overwriting an active sandbox** — restores always create a *fresh* sandbox env name (`sandbox-restored-<timestamp>`) rather than clobbering.
5. **Feature flag forgotten in a code path** — keep the flag registry server-side (`FeatureFlag`) so UI gating is advisory and the API is the real gate (`requireFeature` middleware).
6. **Import merge data-loss** — merge is field-scoped and shows diffs in the dry run; nothing is written until confirm; audit logs before/after.
7. **Prisma client + `X-Environment`** — environment is applied in *our* access layer, not Prisma — no per-request client needed (that's the point of ADR-008).

---

## 8. Acceptance criteria

- [ ] Admin can create a sandbox env, add records there, and **not see them** in production (and vice versa) — verified by API + UI + automated smoke test.
- [ ] Admin can reset a sandbox; resetting production requires double-confirm and is blocked unless explicitly enabled via org setting.
- [ ] A flag created in Settings appears/disappears in the UI and gates an API route within the same request.
- [ ] CSV import shows a dry-run preview with duplicate diffs; merge writes the chosen fields, emits `contact.merged`, and audit shows before/after.
- [ ] Creating a snapshot produces a `BackupJob` row + archive file; restoring it creates a fresh sandbox populated from the archive.
- [ ] `npm run typecheck` and `npm run build` pass; existing smoke tests still green.
- [ ] `docs/03-event-catalog.md` and `docs/05-api-reference.md` updated with the new events/endpoints.

---

## Suggested implementation order (one developer)

1. **Foundation:** `environment` column + `X-Environment` threading through access layer + backfill script + leak smoke test (1–1.5 days).
2. **Feature flags:** registry + middleware + Settings UI (1 day).
3. **Import merge:** dry-run contract + merge logic + Import page (1.5–2 days).
4. **Backups:** snapshot script + `BackupJob` + create/restore API + Settings UI (1.5–2 days).
5. **Environments UI + promote:** env switcher, reset, promote-copy (1–1.5 days).
6. **Docs & verification:** update event catalog, API reference, acceptance test pass (0.5–1 day).
