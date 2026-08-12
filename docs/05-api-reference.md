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

## Pipelines (Phase 2-lite multi-pipeline)

Per-org deal pipelines (org × environment scoped, ADR-008). The org's **default** pipeline is lazily seeded from the static registry on first access, so existing orgs get a working "Sales" pipeline without a migration. Deals reference a pipeline via `pipelineId` (NULL = the default pipeline). Writes are admin-only; reads are open to any authenticated user.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/pipelines` | Any auth. `{ items: [{ id, name, isDefault, stages: [{ key, label, probability, order }], dealCount }] }` — dealCount is live per pipeline. |
| POST | `/api/pipelines` | Admin. `{ name, stages: [{ key?, label, probability? }], isDefault? }`. Keys auto-slugified from labels; first pipeline for the org becomes default. Emits `pipeline.created`. |
| PATCH | `/api/pipelines/:id` | Admin. Rename / replace `stages` (wholesale) / `{ isDefault: true }` (demotes the current default). Emits `pipeline.updated`. |
| DELETE | `/api/pipelines/:id` | Admin. **Guards:** cannot delete the default pipeline, the only pipeline, or one that still has deals. Emits `pipeline.deleted`. |

**Deal pipeline semantics** (`POST/PATCH /api/opportunities`):
- `pipelineId` omitted on create → the org's default pipeline; a deal with `pipelineId: null` (legacy) belongs to the default pipeline in list filters.
- `stage` must exist in the deal's pipeline → otherwise 400; probability is **derived from the pipeline's stage definition** (not the static registry).
- Moving a deal between pipelines (`PATCH { pipelineId }`) keeps a valid stage, re-derives probability, and emits `deal.pipeline_changed` (`{ from, to }`).
- `GET /api/opportunities?pipelineId=<id>` filters the board; filtering by the default pipeline also returns legacy `null`-pipeline deals.

**Backfill:** `npm run backfill:pipeline` stamps pre-schema deals (which carry no `pipelineId` field) onto their org's default pipeline — required once after `db:push` on existing databases (same pattern as `backfill:env`).

## Email templates (Phase 2, flag `comm.email`)

Reusable `{ subject, body }` pairs with `{{variable}}` merge fields (`{{contact.firstName}}`, `{{account.name}}`, `{{deal.amount}}`…). Writes: admin + manager; reads: any authenticated user.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/email-templates` | `{ items }` — org's templates, newest updated first. |
| POST | `/api/email-templates` | `{ name, category?, subject, body, active? }`. Emits `template.created`. |
| PATCH | `/api/email-templates/:id` | Partial update (PATCH semantics). Emits `template.updated`. |
| DELETE | `/api/email-templates/:id` | Emits `template.deleted`. |

## Email (Phase 2, flag `comm.email`)

Org mailbox: outbound sends + inbound rows. Every outbound message gets a tracking token (open pixel + click redirect). Mock provider (`EMAIL_MOCK=1`) — nothing actually leaves the server (ADR-014).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/emails` | Query: `direction=in|out`, `contactId`, `opportunityId`, `accountId`, `q` (subject/body/addresses), pagination. `{ items, total }`. |
| GET | `/api/emails/:id` | Single message. |
| POST | `/api/emails` | `{ toEmail, subject, body, templateId?, contactId?, accountId?, opportunityId?, threadId? }`. With `templateId`, `body` is merged from the linked record. Returns `{ message, tracking: { openUrl, clickUrl } }`. Emits `email.sent`. |
| POST | `/api/emails/sync` | `?limit=` drains the mock inbound queue into the inbox (`email.received`). |
| POST | `/api/emails/:id/reply` | Simulates the recipient replying (mock) — new `in` row on the same thread, original flips to `replied`. Emits `email.replied`. |
| DELETE | `/api/emails/:id` | Emits `email.deleted`. |

**Tracking (public, token-scoped — ADR-014):** `GET /api/t/px/<token>` → 1×1 GIF, marks opened (`email.opened` on first open); `GET /api/t/click/<token>?u=<url>` → 302 to `<url>` (scheme-validated), marks clicked (`email.clicked`). Message status is the best state reached: `sent → opened → clicked → replied`.

## Calls (Phase 2, flag `comm.calling`)

Call log entries (click-to-call is a client-side `tel:` link). Recording/transcript are mock-generated when org setting `settings.calling.recording` is true or `recording: true` is requested (ADR-014).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/calls` | Query: `contactId`, `opportunityId`, `accountId`, pagination. `{ items, total }`. |
| POST | `/api/calls` | `{ direction?, phone, durationSec?, status?, notes?, contactId?, recording? }`. `completed` emits `call.completed`; otherwise `call.logged`. |
| PATCH | `/api/calls/:id` | Update status/notes/duration. |
| DELETE | `/api/calls/:id` | Emits `call.deleted`. |

## Meetings (Phase 2, flag `comm.calendar`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/meetings` | Query: `from`, `to` (overlap), `ownerId`, `status`, pagination. `{ items, total }`. |
| POST | `/api/meetings` | `{ title, startsAt, endsAt, status?, location?, notes?, contactId?, accountId?, opportunityId?, ownerId? }`. Emits `meeting.scheduled`. |
| PATCH | `/api/meetings/:id` | Reschedule / change status. `completed` emits `meeting.completed`; other transitions `meeting.status_changed`. |
| DELETE | `/api/meetings/:id` | Emits `meeting.deleted`. |

## Booking pages (Phase 2, admin) + public booking

Admin-managed shareable scheduling links; bookings create meetings owned by the next round-robin host in the pool (mirrors lead routing).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/booking-pages` | Admin | List pages. |
| POST | `/api/booking-pages` | Admin | `{ name, slug, description?, durationMins, bufferMins?, hostPool?, availableDays?, startHour?, endHour?, timezone?, active? }`. Emits `booking.page_created`. |
| PATCH | `/api/booking-pages/:id` | Admin | Partial update (PATCH semantics). Emits `booking.page_updated`. |
| DELETE | `/api/booking-pages/:id` | Admin | Emits `booking.page_deleted`. |
| GET | `/api/public/booking/:slug` | **none** | Public page config `{ name, description, durationMins, bufferMins, timezone, startHour, endHour }` — 400 when inactive/unknown. |
| GET | `/api/public/booking/:slug/slots?date=YYYY-MM-DD` | **none** | `{ date, slots: [{ start, available }] }` — slot windows minus already-booked meetings. |
| POST | `/api/public/booking/:slug/book` | **none** | `{ name, email, startsAt, notes?, company_name? (honeypot) }`. Re-validates the slot (guards double-booking), assigns round-robin host, creates the meeting. Emits `meeting.scheduled (booking: true)` + `booking.booked`. Returns `{ ok, booked, meetingId, hostId, startsAt }`. |

**Public URL:** `/b/<slug>` (Vite SPA route). Honeypot + per-IP rate limit (20/min) protect the public endpoints, same shape as public lead forms.

## Record timeline (Phase 2)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/timeline` | Requires `contactId`, `accountId` or `opportunityId`. `{ items: [{ kind: note|email|call|meeting, id, title, subtitle, createdAt, meta? }] }`, newest first, `?limit=50`. |

## Workflows / Automations (Phase 3, flag `automation.workflows`)

A workflow is **trigger → condition → action**: `trigger` (an event, optionally filtered), `conditions` (field filters on the triggering record + `payload.*`), `actions` (create task / notify / update record). The engine (`server/lib/automations.ts`) subscribes to the event bus and evaluates matching workflows in-process (ADR-015). Writes are admin-only; reads open to any authenticated user. Actions run as the workflow's creator (org-level privilege), so field permissions never block automation.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/automations` | Any | `{ items: [{ id, name, description, trigger, conditions, actions, active, runCount, lastRunAt, createdByName }] }`. |
| POST | `/api/automations` | Admin | `{ name, description?, trigger, conditions?, actions?, active?, allowDuplicate? }`. Validates trigger/conditions/actions (400 on unknown event/field/action). **Duplicate guard:** an active workflow with the same normalized trigger+conditions+actions → `409 { error, duplicateId, duplicateName }` unless `allowDuplicate: true`. Emits `automation.created`. |
| GET | `/api/automations/:id` | Any | Single workflow. |
| PATCH | `/api/automations/:id` | Admin | Partial update (PATCH semantics; same validation + duplicate guard). Emits `automation.updated`. |
| DELETE | `/api/automations/:id` | Admin | Emits `automation.deleted`. |
| GET | `/api/automations/:id/runs` | Any | `{ items }` — the run log (matched or not, per-action outcomes), newest first, `?limit=` (≤100). |
| POST | `/api/automations/:id/test` | Admin | `{ entityId }` — synthesizes the trigger event for that record and runs the workflow synchronously (logged as `triggeredBy: "test"`). Returns `{ ok, matched, note, actions: [{ type, status, detail? }] }`. |

**Trigger catalog:** `deal.stage_changed` (optional `to` stage key), `deal.created`, `deal.updated`, `lead.created`, `contact.created`, `task.completed`, `ticket.created`, `ticket.status_changed` (optional `to` status), `ticket.escalated`, `form.submitted` (a public landing page created a lead).

**Condition ops:** `eq, neq, contains, not_contains, gt, gte, lt, lte, in, not_in`. Fields resolve against the triggering record; `payload.from` / `payload.to` reach the event payload (useful for stage filters).

**Actions:**
- `{ "type": "create_task", "title": "…", "description"?, "dueInDays"?, "priority"? }` — creates a task owned by the record's owner, linked to the triggering record, with `{{field}}` templating (`{{name}}`, `{{amount}}`…).
- `{ "type": "notify", "title": "…", "body"?, "target": "owner" | "actor" | "user", "userId"? }` — writes a `Notification` (target `user` requires `userId`).
- `{ "type": "update_record", "field": "…", "value": … }` — sets one core field on the triggering record via the generic service.

**Loop protection:** an in-memory cooldown skips repeat runs of the same `(automation, entity, eventType)` within 30s, so an action's own emitted event can never re-fire the same workflow endlessly.

## Notifications (Phase 3, flag `automation.workflows`)

In-app notifications — written by the `notify` action, read via the header bell. Rows are owned by `userId`; every endpoint scopes by the caller.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/notifications` | `?unreadOnly=&page=&pageSize=` — `{ items, total, unread }`, the caller's rows newest first. |
| GET | `/api/notifications/unread-count` | `{ unread }` — the bell badge. |
| POST | `/api/notifications/:id/read` | Mark one of the caller's rows read (404 for another user's row). |
| POST | `/api/notifications/read-all` | `{ ok, updated }` — mark all of the caller's rows read. |

## Tickets (Phase 4, flag `service.tickets`)

Tickets are a **first-class object type**: the generic object service powers CRUD + audit + events + search + custom fields (it emits `ticket.created/updated/deleted/status_changed`). The thin wrapper adds the helpdesk surface — per-org reference numbers (`TKT-####`), SLA deadlines from `server/lib/slas.ts` (priority → response-hours table, org-configurable), reply threads, assignment, escalation, legal hold, email intake, and convert-to-lead. Rows carry read-time `slaStatus` (`ok | warning | breached`) and `assigneeName`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/tickets/queues` | Any | `{ items: [{ key, label, count }] }` — All / My tickets / New / Open / Pending / Resolved / Closed / SLA breached / Escalated (the page tabs). |
| GET | `/api/tickets` | Any | Generic object list (`page`, `pageSize`, `q`, `status`, `ownerId`, `sort`) enriched with `slaStatus`, `assigneeId`, `assigneeName`. |
| POST | `/api/tickets` | Any | `{ subject, description?, priority?, channel?, source?, contactId?, accountId?, assigneeId?, slaDueAt? }`. Assigns the next reference + SLA deadline (`responseHoursFor(priority)`). Emits `ticket.created`. |
| GET | `/api/tickets/:id` | Any | Single ticket (enriched). |
| PATCH | `/api/tickets/:id` | Any | Partial update. **Legal hold:** non-admin PATCH on a held ticket → 403 (only an admin can lift the hold). `priority` change restarts the SLA clock. Moving to a resolved status sets `resolvedAt`. Emits `ticket.updated` / `ticket.status_changed`. |
| DELETE | `/api/tickets/:id` | Any | **Blocked while on legal hold** (403 for everyone). Emits `ticket.deleted`. |
| GET | `/api/tickets/:id/replies` | Any | `{ items }` — the thread (authorName attached), oldest first. |
| POST | `/api/tickets/:id/reply` | Any | `{ body, internal? }` — staff reply; sets `firstResponseAt`; `new → open`; `internal: true` is hidden from the public portal. Emits `ticket.replied`. Locked on legal hold. |
| POST | `/api/tickets/:id/assign` | Admin + manager | `{ assigneeId }` — must be an active org member; notifies the new owner. Emits `ticket.assigned`. Locked on legal hold. |
| POST | `/api/tickets/:id/escalate` | Any | `{ reason? }` — flags `escalated: true`, bumps priority, notifies assignee + managers. Emits `ticket.escalated`. |
| POST | `/api/tickets/:id/legal-hold` | Admin | `{ legalHold }` — toggle the compliance lock (blocks edit/delete/reply/assign/escalate for non-admins). |
| POST | `/api/tickets/:id/convert-to-lead` | Any | Creates a lead from the ticket's contact (auto-named "Support Lead" when unlinked). Emits `ticket.converted` + `lead.created`. |
| POST | `/api/tickets/intake/email` | Any | `{ from, subject, body?, contactId? }` — email → ticket (`channel: email`, `source: email`), contact linked by address and auto-created when unknown (race-safe). Emits `ticket.captured`. The Phase-2 mock inbox seam can POST here when a real sync lands. |
| POST | `/api/tickets/sla/check` | Admin | Runs the breach sweep: past-due open tickets → `slaStatus: breached` + `breachedAt` + auto-escalate (assignee + managers notified). Returns `{ breached, escalated, matched }`. Emits `ticket.sla_breached` / `ticket.escalated`. |

**SLA semantics (v1):** `slaDueAt` = `createdAt + responseHoursFor(priority)` (defaults `urgent 1h / high 4h / medium 8h / low 24h`, overridable per org via `SlaPolicy.targets`). Read-time `slaStatus`: past `slaDueAt` → `breached`; within 20% of the window → `warning`; else `ok`. **Legal hold** is the Phase-4 compliance feature: any held ticket is locked down for everyone but admins, and deletion is blocked entirely.

## Knowledge base (Phase 4, flag `service.knowledge`)

Articles with categories, tags, slugs and search. Writes are admin-only (KB content is org config, like templates); reads are open to any authenticated user. **Published** articles are also served by the public portal.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/knowledge` | Any | `?q=&category=&published=` — `{ items }` with `authorName`, newest updated first (≤200). |
| GET | `/api/knowledge/categories` | Any | `{ items: [{ category, count }] }` — distinct categories with article counts. |
| GET | `/api/knowledge/:id` | Any | Single article; reading a **published** article bumps its `viewCount`. |
| POST | `/api/knowledge` | Admin | `{ title, body, category?, tags?, published?, slug? }` — slug is title-derived unless provided; unique per org × env. Emits `knowledge.created`. |
| PATCH | `/api/knowledge/:id` | Admin | Partial update (PATCH semantics — no `.default()`s). Emits `knowledge.updated`. |
| DELETE | `/api/knowledge/:id` | Admin | Emits `knowledge.deleted`. |

## Portals (Phase 4, flag `service.tickets`) + public portal

Admin-managed **public self-service portals** — a landing config (`PortalPage` per org × env) with a slug, plus an unauthenticated intake that creates tickets. Protected like every public surface: honeypot field + per-IP rate limit (20/min shared across submit + lookup), no existence leaks.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/portals` | Any | List the org's portal pages. |
| POST | `/api/portals` | Admin | `{ name, slug, description?, autoCreateContact?, active? }`. Emits `portal.created`. |
| PATCH | `/api/portals/:id` | Admin | Partial update (slug unique per org × env). Emits `portal.updated`. |
| DELETE | `/api/portals/:id` | Admin | Emits `portal.deleted`. |
| GET | `/api/public/portal/:slug` | **none** | Public config `{ name, description, slug, articles }` — published KB articles included. 400 when inactive/unknown. |
| POST | `/api/public/portal/:slug/tickets` | **none** | `{ name, email, subject, body?, favorite_color? (honeypot) }` — creates the ticket (`channel: web`, `source: portal`, `priority: low`) as the portal page's actor, auto-creating/ linking the contact by email when `autoCreateContact`. Returns `{ ok, reference }` (201). Emits `ticket.captured`. |
| POST | `/api/public/portal/:slug/lookup` | **none** | `{ email, reference }` — **no-leak** status check: the ticket's linked contact email must match, else `{ found: false, ticket: null }`. On match: `{ found: true, ticket: { reference, subject, status, priority, resolved, updatedAt, replies } }` — **public (non-internal) replies only**. |

**Public URL:** `/p/<slug>` (Vite SPA route). Honeypot + rate limit shape identical to public lead forms (ADR-012) and booking.

## Campaigns (Phase 5, flag `marketing.campaigns`)

Config entities like segments/automations: reads open, writes admin-only. Sending resolves the audience from a Phase-1 dynamic **Segment** (snapshot at send time), splits recipients A/B, and writes one `Message` per recipient through the Phase-2 email path (tracking + events free) plus a `CampaignRecipient` link. Stats/ROI are computed on read from recipient rows so they can never go stale.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/campaigns` | Any | `{ items: [{ id, name, status, channel, subject, ab, winner, audienceSegmentId, audienceName, sentCount, openedCount, clickedCount, openRate, roi }] }` — stats are live. |
| POST | `/api/campaigns` | Admin | `{ name, description?, subject, body, templateId?, audienceSegmentId?, ab?, sendAt?, status? }`. `ab: { enabled, splitA, subjectB }` (A/B needs `subjectB`). Emits `campaign.created`. |
| GET | `/api/campaigns/:id` | Any | `{ campaign, stats: { sent, opened, clicked, openRate, clickRate, roi, wonDealIds, byVariant } }`. |
| PATCH | `/api/campaigns/:id` | Admin | Partial update (PATCH semantics). Emits `campaign.updated`. |
| DELETE | `/api/campaigns/:id` | Admin | Emits `campaign.deleted`. |
| POST | `/api/campaigns/:id/send` | Admin | Sends now to the segment audience. **Idempotency guard:** a `sent` campaign → 400 unless `{ force: true }`. Returns `{ ok, sent, recipients }`. Emits `campaign.sent`. |
| POST | `/api/campaigns/:id/declare-winner` | Admin | `{ variant: "A" | "B" }` — persist the A/B winner. Emits `campaign.winner_declared`. |
| GET | `/api/campaigns/:id/recipients` | Any | `{ items: [{ contactId, contactName, contactEmail, variant, status, openedAt, clickedAt }], total }`. |
| GET | `/api/campaigns/:id/audience-preview` | Admin | `{ count, contacts: [{ id, name, email }] }` — segment member preview (member PII, admin-only). |

**Attribution (v1):** ROI = sum of `won` deal amounts whose contact was a recipient of the campaign. Lead `campaignId` (core field) tags landing-captured leads for attribution.

## Landing pages (Phase 5, flag `marketing.landing`) + public landing

Admin-managed public capture pages; a page can be linked to a Campaign for attribution. **Slugs are globally unique** (the public router is org-blind — cross-tenant safety, same rule as portals).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/landing-pages` | Any | `{ items }`. |
| POST | `/api/landing-pages` | Admin | `{ name, slug, headline, subtext?, ctaLabel?, successMessage?, theme?, campaignId?, fields?, active? }`. Duplicate (global) slug → 400. Emits `landing.created`. |
| PATCH | `/api/landing-pages/:id` | Admin | Partial update (PATCH semantics; slug uniqueness re-checked). Emits `landing.updated`. |
| DELETE | `/api/landing-pages/:id` | Admin | Emits `landing.deleted`. |
| GET | `/api/public/pages/:slug` | **none** | Public config `{ name, headline, subtext, ctaLabel, successMessage, theme, fields }` — 400 when inactive/unknown. |
| POST | `/api/public/pages/:slug/submit` | **none** | `{ firstName, lastName, email, phone?, company?, website? (honeypot) }` — creates a **routed lead** (`source: "Landing page"`, `campaignId` when linked) as the page's actor. Honeypot → fake success; per-IP rate limit (20/min); duplicate email → `{ ok: true, duplicate: true }` (no existence leak). Returns `{ ok, duplicate, leadId? }`. Emits `form.submitted` + `intent.detected` **only for new leads**. |

**Public URL:** `/l/<slug>` (Vite SPA route).

## Journeys (Phase 5, flag `marketing.journeys`)

The journey orchestration engine (ADR-017): a declarative `Journey` row with a trigger and ordered steps, consumed by an event-bus subscriber + a 60s ticker. Triggers: an event (`lead.created`, `contact.created`, `deal.created`, `deal.stage_changed`, `task.completed`, `ticket.created`, `ticket.status_changed`, `form.submitted`) or a segment. Steps: `wait` (hours/days), `send_email`, `notify`, `create_task`, `update_record`, `condition`, `end`. Loop guard: one active enrollment per journey × entity.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/journeys` | Any | `{ items: [{ id, name, trigger, steps, active, enrolledCount, triggerLabel }] }`. |
| POST | `/api/journeys` | Admin | `{ name, description?, trigger, steps?, active? }`. Validates trigger + every step (400 on unknown step type / branch-to-self / bad field). Emits `journey.created`. |
| GET | `/api/journeys/:id` | Any | Single journey. |
| PATCH | `/api/journeys/:id` | Admin | Partial update (re-validates trigger+steps). Emits `journey.updated`. |
| DELETE | `/api/journeys/:id` | Admin | Emits `journey.deleted`. |
| GET | `/api/journeys/:id/enrollments` | Any | `{ items: [{ entity, entityId, entityName, entityEmail, currentStep, status, nextRunAt, enteredAt, completedAt }], total }`. |
| GET | `/api/journeys/:id/runs` | Any | `{ items }` — the per-step run log (`stepIndex`, `stepType`, `status`, `detail`), newest first, `?limit=` (≤100). |
| POST | `/api/journeys/:id/test` | Admin | `{ entityId }` — synchronous run against a real contact (waits treated as zero-delay). Returns `{ ok, outcomes: [{ stepIndex, stepType, status, detail }] }`. |
| POST | `/api/journeys/advance` | Admin | One manual ticker pass — advances every `waiting` enrollment whose `nextRunAt` is due (claim-guarded against concurrent passes). Returns `{ ok, advanced }`. |

## Deliverability (Phase 5, flag `marketing.deliverability`)

Derived metrics + a mock-provider event seam (ADR-014). Computed from `Message` rows in the current environment — never stale.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/deliverability` | Any | `{ metrics: { sent, opened, openedRate, clicked, clickRate, bounced, bounceRate, unsubscribed, complaints, health (0–100), grades }, recent: [...] }`. |
| POST | `/api/deliverability/simulate` | Admin | `{ messageId, kind: "bounce" | "unsubscribe" | "complaint" }` — marks the message + emits `email.bounced` / `email.unsubscribed` / `email.complained`. |

## Analytics (Phase 6, flag `analytics.metrics`)

The BI surface: metric groups **computed on read** (never stored — ADR-018) with **data lineage** on every metric (`sources: [{ entity, query, note }]`), the live weighted forecast + snapshot history, predictive v1 scores, and threshold evaluation. Reads open to any authenticated user; writes admin-only.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/analytics/dashboard?kind=` | Any | `kind ∈ sales \| marketing \| service \| revenue \| executive`. `{ kind, group: { kind, label, metrics: [{ key, label, value, format, sources }] }, forecast: { buckets, stages, byOwner, dealCount } }` — metrics carry full lineage. |
| GET | `/api/analytics/metrics` | Any | `{ groups: MetricGroup[] }` — every metric across all 4 groups (report data source). |
| GET | `/api/analytics/forecast` | Any | `{ live: { buckets: { pipeline, weighted, commit, bestCase }, stages: [{ stage, probability, count, amount, weighted }], byOwner: [{ ownerId, ownerName, pipeline, weighted, commit, bestCase }], dealCount }, snapshots: [...] }` — live + latest 10 persisted snapshots (history). |
| POST | `/api/analytics/forecast/refresh` | Admin | Snapshots the current weighted forecast (persists a `Forecast` row = history), then evaluates the org's metric thresholds. Emits `forecast.updated`; each breach writes admin notifications + emits `metric.threshold_breached`. Returns `{ saved, breaches }` (201). |
| GET | `/api/analytics/predictions?limit=` | Any | `{ conversions: [{ dealId, name, stage, score, inputs }], churn: [{ contactId, name, score, inputs }], ltvs: [{ contactId, name, value, inputs }] }` — predictive v1 (transparent arithmetic, documented inputs). |
| GET | `/api/analytics/sources` | Any | The lineage dictionary — `{ entities: [{ entity, note }] }` describing each data source. |

**Thresholds** live in `Organization.settings.analytics.thresholds` (defaults `winRate: 30`, `pipelineCoverage: 1.0`, `campaignsOpenRate: 20`, `slaHealth: 70`); a metric value below its threshold at refresh time = breach.

**Forecast buckets:** `pipeline` = raw open amounts, `weighted` = Σ amount × pipeline-derived probability, `commit` = stages ≥75% probability, `bestCase` = stages ≥50%.

**Predictive inputs:** conversion = stage probability (.5) + amount vs org average (.25) + deal age decay (.25); churn = inactivity since last event with 60d grace (.5) + open tickets (.3) + no open deals (.2); LTV = Σ won on contact/account ÷ account contacts × `settings.analytics.ltvMultiplier` (default 1.5).

## Reports (Phase 6, flag `analytics.reports`)

Saved dashboard configs (ADR-018): a `Report` row holds `kind` + `keys` (metric keys); `GET /:id/data` renders the **live** metrics for exactly those keys with full lineage. Reads open; writes admin-only (org config like segments/automations).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/reports` | Any | `{ items: [{ id, name, description, kind, keys, active, createdByName, createdAt }] }`. |
| POST | `/api/reports` | Admin | `{ name, description?, kind?, keys?, active? }` (`kind` default `sales`; `keys` = metric keys, empty = all in the kind). Emits `report.created`. |
| GET | `/api/reports/:id` | Any | Single report. Malformed/unknown id → 404. |
| GET | `/api/reports/:id/data` | Any | `{ report, metrics: [{ key, label, value, format, sources }], kindLabel }` — LIVE metrics for the report's keys. |
| PATCH | `/api/reports/:id` | Admin | Partial update (PATCH semantics — no `.default()`s). Emits `report.updated`. |
| DELETE | `/api/reports/:id` | Admin | Emits `report.deleted`. |

## CDP / Customer 360 (Phase 7, flag `cdp.profiles`)

The customer data platform: one **`IdentityProfile`** per person (org × env) unifying contact/lead records by canonical email, behavioral touchpoint tracking, the relationship graph, and the explained health engine. Reads open to any authenticated user; writes (rebuild / merge / health refresh) admin-only. Identity rules + graph schema + health formula are documented in `docs/25-cdp-guide.md` (ADR-019).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/cdp/overview` | Any | CDP headline numbers: `{ profiles, contacts, leads, records, merged, behaviors, behaviorByType, avgHealth, atRisk, lastHealthRefresh, behaviorCatalog }`. |
| GET | `/api/cdp/profiles` | Any | `?q=&limit=&offset=` — searchable list (name/email/company) where every row carries its derived `health` (score/churnRisk/atRisk/components). |
| GET | `/api/cdp/profiles/:id` | Any | The full **360 view**: `{ profile (with member contacts/leads + account), behaviors, messages, calls, meetings, tickets, lastActivity, health, history (HealthScore snapshots), graphs (the person's deal involvement) }`. |
| POST | `/api/cdp/profiles/rebuild` | Admin | Idempotent reconciliation of every contact + lead into profiles. Returns `{ contacts, leads, created, attached, merged }`. Emits `customer.profiles_rebuilt`. |
| POST | `/api/cdp/profiles/merge` | Admin | `{ fromId, intoId }` — unify two profiles: members, behaviors + health history move into the target, donor deleted, lineage kept (`mergedFromIds`). Emits `customer.identity_merged { from, into }`. Self-merge → 400. |
| POST | `/api/cdp/behaviors` | Any | Ingest one behavior: `{ type, email? \| contactId? \| leadId? \| profileId?, entity?, entityId?, value?, meta?, occurredAt? }`. Identity resolves profileId → record email → email (anonymous rows still stored). Emits `customer.behavior_tracked`. |
| GET | `/api/cdp/behaviors` | Any | `?profileId=&type=&limit=` — the touchpoint stream, newest first. |
| DELETE | `/api/cdp/behaviors/:id` | Admin | Purge one touchpoint (data governance). |
| GET | `/api/cdp/graph` | Any | `?accountId=` → `{ account, deals, contacts: [{ contact, deals: [{ dealId, influence, touches, primary }], totalInfluence }] }`; `?dealId=` → the **buying committee** `{ deal, account?, committee: [{ contact, influence, touches, primary }] }`. Influence = weighted touchpoints (email 1–4, call 3, meeting 5, ticket 2, primary +10), capped 100. No id → 400. |
| GET | `/api/cdp/health` | Any | `?profileId=` — the **explained** health score computed live: `{ health: { score, churnRisk, atRisk, components: [{ key, label, weight, value, inputs }], lastActivityAt } }`. |
| GET | `/api/cdp/health/history` | Any | `?profileId=` — persisted `HealthScore` snapshots (deltas via `previousScore`), newest first. |
| POST | `/api/cdp/health/refresh` | Admin | Persists one snapshot per profile (one `refreshId` pass), emits `customer.health_changed` (all) + `customer.churn_risk_changed` (churnRisk ≥ 70). Returns `{ refreshed, refreshId, avgScore, atRisk, churnWarnings }` (201). |

**Health formula:** `score = engagement(≤40; min(40, touchpoints30×4)) + support(≤25; 25−8·open−10·breached−5·escalated) + revenue(≤25; (won90+½·openWeighted)÷$10k) + recency(≤10; 10−days)`; `churnRisk = 100 − score`, at risk ≥ 70.

**Behavior catalog (advisory — any type string is accepted):** `page_view, product_use, purchase, ad_click, form_submitted, email_opened, email_clicked, email_replied, call_completed, meeting_completed, support_ticket`. The event-bus mirror auto-records `email.opened/clicked/replied`, `form.submitted`, `ticket.created`, `call.completed`, `meeting.completed` (source `event-bus`).

## Portability (Phase 7, flag `cdp.portability`)

The right to data portability (🆕 blueprint): one admin action produces a **single downloadable JSON bundle** with every org × environment collection — object rows, comms, tickets, marketing, analytics, CDP rows, plus the `Event` log and `AuditLog` trail. Staff users are included minus `passwordHash`. Bundles are written under `backups/portability/` and tracked by `PortabilityExport` rows. Reads open; writes admin-only.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/portability` | Any | `{ items: [{ id, status, path, sizeBytes, createdAt, completedAt, error }] }` — export history, newest first. |
| POST | `/api/portability/export` | Admin | Builds the full-tenant bundle (40 collections) + `PortabilityExport` row. Returns `{ export, counts }` (201). Emits `portability.exported`. |
| GET | `/api/portability/:id/download` | Any | Streams the bundle JSON (`attachment`). 400 when not ready; 404 for other orgs/envs. |
| DELETE | `/api/portability/:id` | Admin | Purges the row + file (path-traversal-safe). |

## AI Assistant (Phase 8, flag `ai.assistant`)

The **non-agentic copilot**: every generation returns `{ insight, decision }` — `insight` is the persisted, audited `AIInsight` (content, confidence 0–100, `lowConfidence` flag, `redacted` log, `modelId`, `latencyMs`, `payload`), `decision` is the router's explainable pick (`{ picked, reason, candidates }`). Generations emit `ai.summary_generated` / `ai.score_computed` / `ai.confidence_flagged`. Reads open to any authenticated user; the firewall policy write and insight deletion are admin-only.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/ai/catalog` | Any | `{ items: [{ feature, capability, model, candidates }] }` — the AI feature catalog. |
| POST | `/api/ai/summarize` | Any | `{ entity: contact|account|opportunity|lead|ticket, entityId }` — record summary (stage, amount, owner, age…). 201. |
| POST | `/api/ai/summarize/call` | Any | `{ callId }` — summary from the call transcript + notes (201). |
| POST | `/api/ai/summarize/meeting` | Any | `{ meetingId }` — summary from notes + attendees (201). |
| POST | `/api/ai/summarize/profile` | Any | `{ profileId }` — the AI Customer-360 summary card (reads the Phase 7 graph + health) (201). |
| POST | `/api/ai/draft` | Any | `{ contactId, dealId?, tone?: follow_up|proposal|casual|formal }` — tone-controlled email draft; body is firewalled, `payload.recipientEmail` carries the To: (201). |
| POST | `/api/ai/score` | Any | `{ entity: lead|opportunity, entityId }` — explained score (lead: 5 components, deal: 4, each with value + weight + why) (201). |
| POST | `/api/ai/sentiment` | Any | `{ text }` — lexicon sentiment → `{ label, score, terms }` (201). |
| POST | `/api/ai/intent` | Any | `{ profileId }` — buying / churning / researching / inactive from real behaviors (201). |
| GET | `/api/ai/search?q=` | Any | Natural-language search. "won deals over 50k" → `{ predicate: { field, op, value }, items: [{ type, title, score, confidence, evidence }], decision }` — ranked, explained, persisted as an insight. |
| GET | `/api/ai/insights` | Any | `{ items, total }` — AI output history (audit + explainability). `?kind=` / `?entity=` / `?entityId=` / `?limit=` (≤100). |
| DELETE | `/api/ai/insights/:id` | Admin | Remove one AI output (governance, like behaviors). |
| GET | `/api/ai/memory?scopeType=&scopeId=` | Any | Short-term AI memory rows (defaults to the caller for user scope). |
| POST | `/api/ai/memory` | Any | `{ key, value, scopeType?, scopeId?, ttlSeconds? }` — write memory; user-scoped memory defaults to the caller and is private (cross-user → 400) (201). |
| DELETE | `/api/ai/memory/:id` | Any | Forget one memory row. |
| GET | `/api/ai/firewall` | Any | `{ policy, recent }` — the data-firewall policy + recent redaction receipts. |
| GET | `/api/ai/firewall/check?text=` | Any | Redaction receipt — `{ original, redacted, redactions }` for the given text. |
| PUT | `/api/ai/firewall` | Admin | Edit the policy (`maskMode: full|partial`, `redactEmails/Phones/Cards/LongNumbers`, `allowlist`). Emits `ai.firewall_updated`. Rep → 403. |

> **Confidence flagging:** any generator below the 40% threshold returns
> `lowConfidence: true` and writes an admin notification (kind `ai`) — the
> header bell surfaces "Low AI confidence ⚠️".

## Model router (Phase 8, flag `ai.modelRouter`)

The model catalog is **data** (`ModelRoute` rows): name, provider, tier, capabilities, cost per 1k in/out, latency, region, routing weight. The org routing policy (`defaultModel`, `preference: cost|quality|latency`, `preferredRegion`) decides every generation — `preferredRegion: "eu"` pins to the EU-resident model (data-residency routing). Writes admin-only.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/models` | Any | `{ items, policy }` — the catalog + the org's routing policy (default models lazily seeded). |
| GET | `/api/models/route?feature=` | Any | Dry-run the routing decision for a feature — `{ decision: { picked, reason, candidates } }` (explainable before any call). |
| PUT | `/api/models/policy` | Admin | Set the routing policy. Emits `ai.policy_updated`. |
| POST | `/api/models` | Admin | Add a model to the catalog (201). Emits `model.created`. |
| PUT | `/api/models/:id` | Admin | Edit cost/latency/capabilities/weight/region. Emits `model.updated`. |
| DELETE | `/api/models/:id` | Admin | Remove from the catalog. Emits `model.deleted`. |

## Duplicate merge (Phase 1)

Merges two records of the same type into a master, choosing per-field which record wins.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/merge` | `{ objectType, masterId, mergeId, fieldChoices? }` — `fieldChoices: { [field]: "master" | "merge" }` (default: master wins all). The merge record is deleted; non-conflicting fields come from the master unless overridden. Emits `<type>.merged { via: "records" }` + audit. UI: pick-two checkboxes on list pages. |

## Status codes

`200` success · `201` created · `400` validation/duplicate/conflict · `401` unauthenticated · `403` role/visibility denied · `404` missing (also returned for cross-tenant access to avoid leaking existence) · `500` unexpected.
