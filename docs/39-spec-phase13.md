# 39 · Phase 13 Spec — Ecosystem (Marketplace, Partners, Change Sets, Schema Safety)

> The spec that drives Phase 13 of QORVEXA CRM. Goal (from the blueprint):
> **make the platform extensible** — an app/agent marketplace, partner &
> channel management, and the config/schema change discipline that makes a
> multi-environment platform safe to operate. The interesting architecture is
> not new UIs; it is **what installing an app actually does** (it applies a
> payload into the engines that already exist), **how commission is computed**
> without a payments ledger (derived at read), and **how schema/config moves
> between environments** when records already can (ADR-008). Same stack
> (Express 5 + Mongo via Prisma + React 19 SPA), same ADR discipline
> (row-as-config, derived-on-read, every state change evented), and the same
> rule of thumb: **reads are derived and explainable, writes are RBAC-gated,
> and installs/promotions/deletions are auditable end-to-end.**

## §0 · Current substrate (verified in repo)

- **Custom-field registry (Phase 0, ADR-003)** — `FieldDef` rows per org ×
  environment are the "no-code object builder" v1; Phase 13 adds the safety
  rail (change-impact analysis) that makes fields safe to *remove*, closing
  the create/remove loop.
- **Webhooks + dispatcher (Phase 0)** — the HMAC-signed, retried webhook
  pipeline is the integration seam; marketplace installs create `Webhook`
  rows through it.
- **AI Agent Platform (Phase 9, ADR-021)** — `Agent` rows + the template
  registry (`templateFor`) are how marketplace *agent* installs become real:
  an install applies a template and the Phase 9 engine picks it up.
- **Environments (ADR-008)** — `X-Environment` scoping + `env.promote`
  already move *records* between environments; Phase 13 extends the story to
  *config* with change sets.
- **RBAC + feature gating** — `requireRole` / `requireFeature` gate every
  route; the ecosystem adds its own flags (`ecosystem.marketplace`,
  `ecosystem.partners`, `ecosystem.changesets`, `ecosystem.schema`).
- **Event bus + notifications** — every lifecycle event lands in the `Event`
  collection and the Phase 3/9/11 notification pattern (push, not poll).

## §1 · Scope (what this phase ships)

### 1.1 Marketplace — `MarketplaceListing` + `App` (flag `ecosystem.marketplace`)

A **marketplace listing** is a declarative row: `slug` (stable id, unique per
org × env), `name`, `kind` (`app | agent | integration | template`),
`description`, `publisher`, `version`, `icon`, `active`, `installCount`, and
— the important part — a **`config` install payload**:

```json
{
  "agentTemplate": "lead",          // → creates a Phase 9 Agent via templateFor()
  "webhookEvents": ["deal.stage_changed"],  // → creates a Webhook row
  "flags": {}                        // reserved for future flag hints
}
```

**Installing** (`POST /api/ecosystem/apps/install { listingId }`, admin)
applies the payload into the existing engines — zero marketplace-specific
machinery:

1. `config.agentTemplate` → the Phase 9 template registry creates an `Agent`
   (or reuses one with the same `kind`); emits `agent.created` with
   `source: "marketplace"` — the agent then runs on the existing Phase 9
   engine.
2. `config.webhookEvents` → creates a `Webhook` subscribed to those events
   (Phase 0 dispatcher).
3. An `App` row records the install (`listingId`, `slug`, `kind`, `status`,
   `config` = what was applied, `installedBy`, `installedAt`); double-install
   → 400; `uninstall` flips status + stamps `uninstalledAt`.

Events: `marketplace.listing_created/updated/deleted`, `app.installed`,
`app.uninstalled`. Reads open; listing CRUD + install/uninstall admin-only.

### 1.2 Partners & channel management — `PartnerAccount` + `PartnerDeal` (flag `ecosystem.partners`)

- A **partner** is a row: `name`, `type` (`reseller | referral | technology |
  consultant`), contact fields, `commissionRate` (0–1, validated), `status`
  (`active | inactive`), `notes`.
- **Deal registration / co-selling**: `registerPartnerDeal` creates a
  `PartnerDeal` (`name`, `amount`, optional `opportunityId` link to a real
  CRM deal) with status `registered`; lifecycle `registered → approved →
  won | lost` (`won` stamps `wonAt`).
- **Commissions are DERIVED at read, never stored** (ADR-018 discipline):
  `commissionEarned = Σ won amount × rate`, `pipelineValue = Σ
  registered/approved amounts`. The `partner.commission_earned` event fires
  on the won transition for the audit trail + notifications, but the number
  itself is always recomputed — no drift, no reconciliation step.

Events: `partner.created/updated`, `partner.deal_registered`,
`partner.deal_updated`, `partner.commission_earned`. Reads open; writes
admin/manager.

### 1.3 Change sets + environment promotion — `ChangeSet` (flag `ecosystem.changesets`)

A **change set** bundles config/schema changes from one environment and
replays them in another (dev → staging → prod):

- `items` = `[{ entity, op: create|update|delete, key, data }]` over the
  config surface — `fieldDef` (custom fields), `agent` (Phase 9), `featureFlag`.
- **Diff mode** — `POST /api/ecosystem/changesets/diff { from, to }`
  compares two environments and proposes items automatically (fieldDefs
  absent in the target, agents absent in the target) — one click from
  "diff" to "bundle".
- **Promote** — `POST /api/ecosystem/changesets/:id/promote { to }` replays
  every item into the target environment: `create` inserts when absent,
  `update` patches when present, `delete` removes + emits
  `schema.field_deleted` with `via: "changeset"`. Per-item failures are
  recorded in the change set's `error` (all-or-nothing only when nothing
  applied); re-promoting an already-promoted change set → 400. Emits
  `changeset.promoted` with `{ fromEnv, toEnv, applied, errors }`.

This extends ADR-008: records already move via `env.promote`; change sets
make **config** (fields, agents, flags) movable too, with the same
deterministic, replayable, evented discipline.

### 1.4 Schema change safety — change-impact analysis + safe delete (flag `ecosystem.schema`)

Before a custom field is deleted, **change-impact analysis**
(`GET /api/ecosystem/schema/impact?objectType=&key=`) scans every surface
that could reference it:

| Surface | What's checked |
|---|---|
| `segment` | `criteria.filters[].field` |
| `automation` | `conditions[].field` + action JSON containing the key |
| `agent` | `rules[].field` |
| `leadForm` | `fields[].key` |
| `report` | `keys[]` + dotted key references |
| `fieldPermission` | a permission row exists for `objectType.fieldKey` |
| record values | `custom[key]` non-empty on real records of that object type |

**Safe delete** (`POST /api/ecosystem/schema/safe-delete { id }`, admin)
refuses when `references.length > 0 || recordValues > 0` — `Field is in use:
N config reference(s), M record value(s). Remove references first` — and
otherwise deletes + emits `schema.field_deleted` with `via: "safe-delete"`.
The full operational playbook lives in `docs/43-schema-change-safety.md`.

### 1.5 Engine + RBAC + feature gating

- **No ticker** — unlike Phases 11/12, the ecosystem is a management
  surface: everything is either a row (listings, partners, change sets) or a
  derived read (commissions, impact). The only "engine" is the install
  payload applier, which is synchronous in `installApp`.
- Reads open (the page is a management + governance surface); marketplace,
  change-set, and schema writes admin-only; partner writes admin/manager.
- **Events** — full catalog in `docs/03-event-catalog.md`:
  `marketplace.listing_*`, `app.installed/uninstalled`, `partner.*` +
  `partner.commission_earned`, `changeset.created/promoted`,
  `schema.field_deleted` (via safe-delete or changeset).

## §2 · UI — Ecosystem page (`/ecosystem`, "Ecosystem" nav section)

Six tabs:
- **Overview** — stat cards (listings, installed apps, active partners,
  registered deals, commission earned, pipeline value, change sets) + the
  "ecosystem loop" explanation.
- **Marketplace** — listing cards (icon, kind badge, publisher/version,
  install count) with **Install** (or *Installed*) and, for admins, publish
  + delete. Publishing opens a modal (slug/name/kind/description/publisher).
- **Apps** — installed/uninstalled app rows showing what the install
  payload applied (`agentId`, `webhookId`…) with uninstall for admins.
- **Partners** — partner cards with commission rate, derived earned +
  pipeline, deal list with lifecycle actions (won/lost), register-deal
  modal, add-partner modal.
- **Change sets** — the environment diff builder (`from → to` selects +
  Diff → Save as change set), and the change-set list with per-item
  create/update/delete rows + Promote.
- **Schema** — object-type picker → custom fields with **Impact** (the
  analysis panel: config references by surface + record values, with the
  "safe to delete" verdict) and **safe delete** (blocked fields surface the
  reason).

## §3 · Out of scope (later phases)

- **Public cross-tenant marketplace** — v1 listings are org-scoped; a shared
  catalog (publish once, install anywhere) is the documented extension.
- **Developer platform** — SDKs, serverless functions, custom code
  execution: install payloads are v1 (agent template + webhook events),
  deliberately *no arbitrary scripts*.
- **Commission payments** — v1 derives commission amounts; an actual payout
  ledger (invoices, settlement) is a Finance extension.
- **Change-set workflow** — approvals, scheduling, rollback of a promotion
  (v1 promotes immediately and records per-item errors; a rollback bundle is
  a natural follow-up).
