# 41 · Developer Platform Guide — Extending QORVEXA

> How the Phase 13 ecosystem is put together, and how a developer (or a
> partner, or your own team) extends the platform through it. Everything here
> is the ADR-015/017/021 row-as-config pattern applied to extensibility
> itself: **the marketplace is data, the only code is the applier.**

## The model in one picture

```
MarketplaceListing (a row)
  ├─ kind: app | agent | integration | template
  └─ config: the INSTALL PAYLOAD
       ├─ { "agentTemplate": "lead" }        → creates a Phase 9 Agent
       └─ { "webhookEvents": ["deal.stage_changed"] } → creates a Webhook
            ↓ install (admin)
App (a row)  ← records what was applied (config), who, when
```

There is no separate "marketplace runtime." Installing an app means the
platform performs a small set of **payload-applier actions** against engines
that already exist:

| Payload key | Action | Result |
|---|---|---|
| `agentTemplate` | `templateFor(kind)` → create/reuse an `Agent` | The agent runs on the Phase 9 engine (risk tiers, kill switch, audit trail, all of it) |
| `webhookEvents` | Create a `Webhook` | Phase 0 dispatcher starts POSTing subscribed events (HMAC-signed, retried) |

Anything else is a future payload type — and because `App.config` records
what was applied, a new applier lands without touching installed rows.

## Publishing to the marketplace (org-scoped)

1. **Admin** → Ecosystem → Marketplace → **Publish listing**.
   - `slug` is the stable id (url-safe, unique per org × env).
   - `kind` is one of `app | agent | integration | template` — it is
     advisory metadata plus a UI badge; the *behavior* comes from `config`.
   - `config` is a free-form JSON object. Today the recognized keys are
     `agentTemplate` and `webhookEvents`.
2. Installers see the listing with an **Install** button; installs are
   admin-only. Double-install → 400; uninstall flips the App row to
   `uninstalled` (history kept).

**Example — an agent listing that qualifies inbound leads:**

```json
POST /api/ecosystem/marketplace
{
  "slug": "lead-qualifier",
  "name": "Lead Qualifier Agent",
  "kind": "agent",
  "publisher": "Qorvexa Labs",
  "config": { "agentTemplate": "lead" }
}
```

Installing it creates a Phase 9 `lead` agent (or reuses the seeded one) —
see the Agents page, where it immediately participates in the risk-tiered
action system.

**Example — an integration that pipes deal stages out:**

```json
{
  "slug": "webhook-studio",
  "name": "Webhook Studio",
  "kind": "integration",
  "config": { "webhookEvents": ["deal.stage_changed"] }
}
```

Installing creates a webhook subscribed to `deal.stage_changed`; the secret
is returned at creation (store it) and every event is HMAC-signed.

## Extending the platform (the pattern)

To add a *new* marketplace capability, follow the existing steps:

1. **Model it as a row** — a new Prisma model (org × env scoped, ADR-008),
   or reuse one (agents, webhooks, fieldDefs…).
2. **Write the logic in `lib/`** — one file, like `lib/ecosystem.ts`; the
   route file stays a thin validation + RBAC + feature-gate surface.
3. **Add the applier** — extend `installApp` with the new `config` key. The
   install stays synchronous, evented, and recorded in `App.config`.
4. **Emit events** — every lifecycle change lands in the `Event` collection
   (catalog in `docs/03-event-catalog.md`).
5. **Gate + scope** — a feature flag (`ecosystem.*`), role checks, and the
   environment header, same as every other phase.

## Reusing the engines (cheat sheet)

| You want… | Use | Docs |
|---|---|---|
| An agent that performs governed work | Phase 9 agent (marketplace `agentTemplate`) | `docs/31-agent-governance-guide.md` |
| Outbound event delivery | Phase 0 webhook (marketplace `webhookEvents`) | `docs/05-api-reference.md` → Webhooks |
| A custom field on an object | Phase 0 `FieldDef` registry | `docs/05-api-reference.md` → Custom fields |
| A safe removal of that field | Phase 13 impact analysis + safe delete | `docs/43-schema-change-safety.md` |
| A config bundle that moves across environments | Phase 13 change sets | this guide § below |
| Partner co-selling with derived commission | Phase 13 partner deals | `docs/42-marketplace-publishing-guide.md` |

## Change sets: config that travels

`POST /api/ecosystem/changesets/diff { from, to }` compares two environments
and returns items (`{ entity, op, key, data }`) for anything in `from` that
is missing from `to` (custom fields, agents). Save them as a change set, then
`POST /api/ecosystem/changesets/:id/promote { to }` replays them:

- `create` inserts when the target lacks the row, `update` patches when it
  exists, `delete` removes + emits `schema.field_deleted` (`via: "changeset"`).
- Per-item errors are recorded on the change set (`error`); re-promoting an
  already-promoted set → 400.
- Supported entities: `fieldDef`, `agent`, `featureFlag`.

This is the ADR-008 environment story extended from records to config: your
sandbox can now preview a field + an agent before production gets them.
