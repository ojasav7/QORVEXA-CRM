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

## Phase 2 events (Communication Core)

| Event | When | Payload |
|---|---|---|
| `template.created` / `updated` / `deleted` | Email template lifecycle (admin/manager) | `{ name, category? }` |
| `email.sent` | An email was sent (mock provider) | `{ to, subject, trackingToken, contactId?, opportunityId? }` |
| `email.received` | Mock inbox sync pulled an inbound message | `{ from, subject }` |
| `email.replied` | Simulated reply received | `{ threadId, subject, contactId? }` |
| `email.opened` | Tracking pixel first fired for a message | `{ to, subject, contactId? }` |
| `email.clicked` | Tracking link first clicked | `{ to, subject, url, contactId? }` |
| `email.deleted` | A message row was deleted | `{ subject }` |
| `call.completed` | A completed call was logged | `{ phone, durationSec, direction, contactId?, opportunityId? }` |
| `call.logged` | A non-completed call was logged | `{ phone, status }` |
| `call.deleted` | A call log entry was deleted | `{ phone }` |
| `meeting.scheduled` | A meeting was scheduled (incl. booking pages, `booking: true`) | `{ title, startsAt, contactId?, booking? }` |
| `meeting.completed` | A scheduled meeting moved to completed | `{ title, contactId? }` |
| `meeting.status_changed` | Meeting status changed (non-completion transitions) | `{ from, to }` |
| `meeting.deleted` | A meeting was deleted | `{ title }` |
| `booking.page_created` / `updated` / `deleted` | Booking-page lifecycle (admin) | `{ name?, slug }` |
| `booking.booked` | A public booking created a meeting | `{ slug, name, email, hostId, startsAt }` |

## Phase 3 events (Automation & Workflow Engine)

| Event | When | Payload |
|---|---|---|
| `task.completed` | A task transitions `todo/in_progress → done` (was reserved; now shipped — other task updates still emit `task.updated`) | `{ task }` |
| `automation.created` / `updated` / `deleted` | Workflow lifecycle (admin) | `{ name, trigger? }` |
| `automation.triggered` | A workflow matched an event and executed its actions | `{ automationId, name, eventType, entity, entityId, matched, actionCount }` |
| `notification.created` | The `notify` action (or any code) created an in-app notification | `{ userId, kind, title }` |

## Phase 4 events (Customer Service / Helpdesk)

| Event | When | Payload |
|---|---|---|
| `ticket.created` | A ticket was created (any channel — manual, portal, email intake) | `{ ticket }` |
| `ticket.updated` | A non-status ticket edit | — |
| `ticket.deleted` | A ticket was deleted | — |
| `ticket.status_changed` | A ticket changed status (`new → open → pending → resolved/closed`) — the workflow engine's `ticket.status_changed` trigger | `{ from, to }` |
| `ticket.assigned` | Admin/manager assigned a ticket to a user | `{ reference, from, to }` (user ids) |
| `ticket.replied` | A staff reply was added to the thread | `{ reference, internal, replyId }` |
| `ticket.escalated` | A ticket was escalated (manual or by the SLA sweep) | `{ reference, reason? }` |
| `ticket.sla_breached` | The SLA sweep marked an open ticket past its response deadline | `{ reference, priority, slaDueAt }` |
| `ticket.converted` | A ticket was converted into a lead | `{ reference, leadId }` |
| `ticket.captured` | An intake path created a ticket (email intake / public portal) | `{ reference, channel, from?, slug? }` |
| `knowledge.created` / `updated` / `deleted` | Knowledge-article lifecycle (admin) | `{ title, published? }` |
| `portal.created` / `updated` / `deleted` | Public portal-page lifecycle (admin) | `{ name, slug }` |

> The Phase 3 workflow engine's trigger catalog now includes `ticket.created`,
> `ticket.status_changed` (optional `to` status filter), and `ticket.escalated`
> — tickets are automatable like any other object.

## Phase 5 events (Marketing Automation & Journey Orchestration)

| Event | When | Payload |
|---|---|---|
| `campaign.created` / `updated` / `deleted` | Campaign lifecycle (admin) | `{ name }` |
| `campaign.sent` | A campaign was sent to its segment audience | `{ name, sent, ab }` |
| `campaign.winner_declared` | An A/B winner was declared | `{ name, winner }` |
| `landing.created` / `updated` / `deleted` | Landing-page lifecycle (admin) | `{ name, slug }` |
| `form.submitted` | A public landing page created a **new** lead (duplicates are no-leak and emit nothing) — the workflow engine's `form.submitted` trigger | `{ slug, campaignId?, email, duplicate: false }` |
| `intent.detected` | A landing submission signaled buying intent | `{ leadId, signal: "landing_page_submit", slug, campaignId? }` |
| `journey.created` / `updated` / `deleted` | Journey lifecycle (admin) | `{ name, trigger? }` |
| `journey.enrolled` | An entity entered a journey (event or segment trigger) | `{ name, entity, entityId, source: event|segment }` |
| `journey.step_entered` | A journey step executed | `{ journeyName, stepIndex, stepType, entity, entityId, matched? }` |
| `journey.completed` | An enrollment reached the `end` step (or ran off the list) | `{ name, entity, entityId }` |
| `email.bounced` | A simulated provider bounce marked a message | `{ to, subject, contactId?, campaignId? }` |
| `email.unsubscribed` | Simulated unsubscribe | `{ to, subject, contactId?, campaignId? }` |
| `email.complained` | Simulated complaint (tracked with unsubscribes in v1 metrics) | `{ to, subject, contactId?, campaignId? }` |

> The Phase 3 workflow engine's trigger catalog also gained `form.submitted`
> (a landing submission created a lead) — landing traffic is automatable like
> any other object.

## Phase 6 events (Analytics, Forecasting & BI)

| Event | When | Payload |
|---|---|---|
| `forecast.updated` | An admin snapshot persisted a weighted forecast (or the report/BI refresh ran) | `{ buckets, byOwnerCount }` |
| `metric.threshold_breached` | A configured metric fell below its threshold (evaluated at forecast refresh) | `{ key, label, value, threshold, direction: "below" }` |
| `report.created` / `updated` / `deleted` | Saved report (dashboard config) lifecycle (admin) | `{ name, kind? }` |

> Threshold breaches also write an admin **notification** (`kind: "metric"`),
> so the header bell surfaces a metric alert without waiting for a page view.

## Phase 7 events (CDP / Customer 360)

| Event | When | Payload |
|---|---|---|
| `customer.identity_merged` | Two records unified under one profile — a record was attached to an existing profile (`source: "record"`) or an admin merged two profiles (`source: "manual"`) | `{ email?, from?, into?, memberRef?, memberIds, memberCount, source, mergedFromCount? }` |
| `customer.profiles_rebuilt` | Admin rebuild reconciled every contact + lead into profiles | `{ contacts, leads, created, attached, merged }` |
| `customer.behavior_tracked` | A customer behavior was ingested via the API | `{ type, profileId? }` |
| `customer.health_changed` | Health refresh scored a profile | `{ score, churnRisk, components: [{ key, value }], refreshId }` |
| `customer.churn_risk_changed` | Health refresh scored a profile with churnRisk ≥ 70 | `{ score, churnRisk, atRisk, refreshId }` |
| `portability.exported` | An admin created a full-tenant portability bundle | `{ path, sizeBytes, collections, totalRows }` |

> **Behavior mirror:** the CDP engine subscribes to `email.opened/clicked/replied`,
> `form.submitted`, `ticket.created`, `call.completed`, and `meeting.completed`
> and mirrors them into `BehaviorEvent` rows (source `event-bus`) — the customer
> touchpoint stream is built from the same event bus, with no code at the source.

## Phase 8 events (AI Assistant Layer)

| Event | When | Payload |
|---|---|---|
| `ai.summary_generated` | A record/call/profile summary or email draft was generated | `{ feature, entity, entityId?, modelId?, confidence }` |
| `ai.score_computed` | An explained lead/deal AI score was computed | `{ entity, entityId, score, modelId, confidence }` |
| `ai.confidence_flagged` | A generator returned below-threshold confidence | `{ feature, entity?, confidence, threshold }` |
| `model.created` / `updated` / `deleted` | Model-catalog lifecycle (admin) | `{ name, tier, active? }` |
| `ai.policy_updated` | Admin changed the routing policy | `{ preference, defaultModel, preferredRegion? }` |
| `ai.firewall_updated` | Admin changed the data-firewall policy | `{ maskMode, redactEmails, redactPhones, redactCards, redactLongNumbers }` |

> **Confidence flagging** also writes an admin **notification** (`kind: "ai"`),
> so the header bell surfaces "Low AI confidence ⚠️" without waiting for a page
> view — same pattern as Phase 6 metric alerts.

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
