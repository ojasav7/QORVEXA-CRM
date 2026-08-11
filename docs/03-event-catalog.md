# 03 · Event Catalog

Naming follows the blueprint's `object.action` convention. Events are persisted to the `Event` collection, fanned out to in-process subscribers, and dispatched to subscribed webhooks.

## Naming convention

`<object>.<action>` — lowercase object, verb in `past_tense`:

```
deal.stage_changed     contact.created      lead.created
task.completed         user.logged_in       schema.field_created
webhook.created        org.created
```

> **ADR-008 (environments):** every persisted event now carries an `environment` field (from the request's `X-Environment` header). Sandbox events are only dispatched to webhooks registered in the same environment.

## Phase 0 hardening events (ADR-008/009)

| Event | When | Payload |
|---|---|---|
| `env.created` | Admin creates a sandbox environment | `{ environment }` |
| `env.reset` | Admin wipes an environment's records | `{ environment, deleted }` |
| `env.promoted` | Admin copies records between environments | `{ from, to, objectType?, counts, copied, updated }` |
| `feature.updated` | Admin toggles a feature flag | `{ key, from, to, environment }` |
| `backup.created` | Snapshot taken | `{ archivePath, sizeBytes, note?, manifest }` |
| `backup.restored` | Snapshot restored into a fresh sandbox | `{ archivePath, targetEnvironment, restored }` |
| `contact.imported` (per type: `<type>.imported`) | CSV import creates a record | `{ row }` |
| `contact.merged` (per type: `<type>.merged`) | CSV import merges fields into an existing record | `{ row, fields, changes }` |
| `schema.field_permissions_updated` | Admin restricts/resets a field's read/write roles | `{ objectType, fieldKey, readRoles, writeRoles }` (empty arrays on reset) |
| `token.created` | Admin issues an API token | `{ name, role, scopes }` |
| `token.revoked` | Admin revokes an API token | `{ name }` |

> **OAuth SSO:** `user.logged_in` carries `{ via: "oauth" }` when the session was created through a provider flow instead of email/password.

## Phase 0 events

| Event | When | Payload |
|---|---|---|
| `org.created` | Workspace registered | — |
| `org.updated` | Org settings changed | — |
| `user.logged_in` | Successful login | — |
| `user.created` / `user.updated` / `user.deleted` | Team member lifecycle | `{ role?, active?, title? }` on update |
| `schema.field_created` / `field_updated` / `field_deleted` | Custom-field registry changed | `{ objectType, key }` |
| `webhook.created` | Webhook registered | — |
| `webhook.test` | Test button fired | `{ message }` |

## Phase 1 events

| Event | When | Payload |
|---|---|---|
| `contact.created` / `updated` / `deleted` | Contact lifecycle | created: the row |
| `account.created` / `updated` / `deleted` | Account lifecycle | — |
| `lead.created` / `updated` / `deleted` | Lead lifecycle | — |
| `lead.routed` | A lead got an owner from the round-robin pool **or** an admin/manager manually reassigned it | `{ from, to, mode: "round-robin" \| "manual" }` |
| `lead.captured` | A public lead-capture form created a lead | `{ formId, slug, formName }` |
| `deal.created` / `deleted` | Deal lifecycle | `{ stage }` on create |
| `deal.stage_changed` | Deal moved between pipeline stages | `{ from, to }` |
| `deal.updated` | Non-stage deal edit | — |
| `task.created` / `updated` / `deleted` | Task lifecycle | — |
| `note.created` / `updated` / `deleted` | Note lifecycle | — |
| `contact.merged` / `account.merged` (per type: `<type>.merged`) | A record was merged into another via the **merge UI** | `{ via: "records", masterId, mergeId, fieldsChanged }` (import-merge rows carry `{ via: "import", row, fields, changes }`) |
| `segment.created` / `updated` / `deleted` | Dynamic segment lifecycle (admin) | `{ objectType, name }` |
| `leadform.created` / `updated` / `deleted` | Public lead-capture form lifecycle (admin) | `{ name, slug }` |

## Phase 2-lite events (multi-pipeline)

| Event | When | Payload |
|---|---|---|
| `pipeline.created` | Admin creates a pipeline | `{ name, isDefault }` |
| `pipeline.updated` | Admin renames / edits stages / makes it default | `{ name, isDefault }` |
| `pipeline.deleted` | Admin deletes a pipeline (guarded) | `{ name }` |
| `deal.pipeline_changed` | A deal was moved between pipelines | `{ from, to }` (pipeline ids; `null` = was on the default) |

> `task.completed` is reserved: it will fire when a task moves to `done` (the service currently emits `task.updated`; the dedicated event lands with Phase 3 automation so listeners aren't overloaded).

## Consumers

1. **In-process** — `onEvent(type, cb)` in `lib/events.ts`. Phase 3 workflow engine and Phase 8 AI subscribe here.
2. **Webhooks** — see below.
3. **UI** — the Events page and dashboard feed read the `Event` collection via `GET /api/events`.

## Webhook delivery

- Subscribed events (exact type, or `*`) are POSTed to the registered `url` with `Content-Type: application/json`.
- **Signature:** header `x-qorvexa-signature: sha256=<hmac_sha256(payload, webhook.secret)>`. The secret is shown once at creation — store it.
- **Retry:** one immediate retry on failure; each attempt is recorded in `WebhookDelivery` (`status`, `statusCode`, `attempts`, `lastError`).
- **Timeouts:** 10s per attempt; delivery is fire-and-forget and never blocks the originating request.
- **Environment:** webhooks are registered per environment — a webhook created in `sandbox` only receives events whose `environment` is `sandbox` (a prod hook never sees sandbox events, and vice versa).

### Example payload

```json
{
  "id": "668f…",
  "orgId": "668e…",
  "environment": "production",
  "type": "deal.stage_changed",
  "entity": "opportunity",
  "entityId": "6690…",
  "actorId": "668f…",
  "payload": { "from": "proposal", "to": "negotiation" },
  "createdAt": "2026-08-10T11:40:36.450Z"
}
```
