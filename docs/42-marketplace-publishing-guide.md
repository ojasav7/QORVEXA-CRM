# 42 · Marketplace & Channel Guide — Publishing, Installing, Co-Selling

> The operator's guide to the Phase 13 ecosystem: how to publish and install
> marketplace listings, and how to run partner & channel management (deal
> registration, co-selling, derived commissions). The developer-facing
> mechanics live in `docs/41-developer-platform.md`; this guide is the
> business playbook.

## Marketplace in practice

### Publish (admin)

Ecosystem → Marketplace → **Publish listing**:

| Field | Meaning |
|---|---|
| `slug` | Stable id, e.g. `lead-qualifier` — shown in URLs, unique per org × env |
| `name` | Display name |
| `kind` | `app` (a product), `agent` (an AI agent — installs via the Phase 9 engine), `integration` (connects external systems — installs webhooks), `template` (a reusable starting point) |
| `description` | What it does, shown on the card |
| `publisher` | Who built it (your team, a partner, a vendor) |
| `version` / `icon` | Semver + a small emoji/icon |
| `config` | The install payload — `{ "agentTemplate": "lead" }` and/or `{ "webhookEvents": [...] }` |

> **Kind vs. behavior:** the kind is a badge; the behavior comes from
> `config`. An `agent` listing without `config.agentTemplate` installs as a
> plain app row; an `app` listing with `config.agentTemplate` creates an
> agent. Document your payload in the description so installers know what
> they're getting.

### Install (admin)

- One click on the listing card. Double-install → 400 (already installed).
- The **Apps** tab shows every install with exactly what was applied
  (`agentId`, `webhookId`…), who installed it, and when.
- Uninstall keeps the row (status `uninstalled`, `uninstalledAt` stamped) —
  install history is never destroyed.

### The golden rule

**Installs are audit-trail visible end-to-end.** `app.installed` lands in the
event log, and whatever the payload created (`agent.created` with
`source: "marketplace"`, `webhook.created`) lands next to it. If you ever ask
"who turned on this agent / webhook and why", the answer is two event-log
rows away.

## Partners & channels in practice

### Adding a partner (admin/manager)

Ecosystem → Partners → **Add partner**: name, type
(`reseller | referral | technology | consultant`), contacts, and the
**commission rate** (0–1, e.g. `0.12` = 12% of the deal amount).

### Deal registration / co-selling

When a partner helps source an opportunity:

1. **Register the deal** (`+ Deal` on the partner card): name + amount, and
   optionally link the CRM deal (`opportunityId`). Registered deals can
   precede the CRM deal — a partner can register before your pipeline row
   exists.
2. **Lifecycle** — `registered → approved → won | lost`.
3. **On won**, the partner's commission is **derived** (amount × rate), the
   `partner.commission_earned` event fires, and the earned total updates on
   the card.

### Reading the numbers

| Number | Meaning | Where it comes from |
|---|---|---|
| `commissionEarned` | Total commission owed | **Derived at read**: Σ won deal amount × rate — never stored |
| `pipelineValue` | Partner-sourced pipeline | Σ registered/approved deal amounts |
| `wonCount` / `dealCount` | Health of the channel | Live counts of the partner's deals |

Because commission is derived, a rate change retroactively recalculates
earned commission — and there is never a reconciliation step between "what
we display" and "what we owe."

## Change sets in practice (the promotion workflow)

The safe path for config changes:

1. Work in the **sandbox** (create a custom field, an agent, toggle a flag).
2. Ecosystem → Change sets → pick `production → sandbox` direction as
   needed, or diff **from** the environment that has the new config:
   `POST /api/ecosystem/changesets/diff` proposes items automatically.
3. **Save as change set** — name it (e.g. "Q3 field rollout").
4. **Promote** it into the target environment when approved. The target now
   has the field/agent/flag; `changeset.promoted` lands in the event log
   with `applied` + `errors`.

> **Pitfall to avoid:** promoting the same change set twice → 400 (already
> promoted). Promotions are one-shot; create a new change set for the next
> iteration.

## Schema change safety (the deletion playbook)

Before deleting a custom field (Ecosystem → Schema):

1. Pick the object type → find the field → **Impact**.
2. Read the analysis: **config references** by surface (segment, workflow,
   agent, lead form, report, field permission — each with the referencing
   row's name) and **record values** (how many records actually store data
   in this field).
3. **If anything references it, deletion is refused** (`Field is in use: N
   config reference(s), M record value(s)`). Remove the references first —
   or keep the field; it is carrying real configuration/data.
4. Only a field with **zero** references and **zero** record values deletes
   cleanly (`schema.field_deleted`, `via: "safe-delete"`).

This is the guardrail that makes the no-code field builder safe to *undo* —
the same discipline as the agent kill switch and the change-set promotion
guard: destructive operations are refused by construction, not by discipline.

## Runbook cheat sheet

```bash
# Publish + install an agent listing (admin)
curl -b cookies.txt -X POST /api/ecosystem/marketplace -H 'content-type: application/json' \
  -d '{"slug":"lead-qualifier","name":"Lead Qualifier Agent","kind":"agent","config":{"agentTemplate":"lead"}}'
curl -b cookies.txt -X POST /api/ecosystem/apps/install -H 'content-type: application/json' \
  -d '{"listingId":"<id>"}'

# Register a partner deal and mark it won
curl -b cookies.txt -X POST /api/ecosystem/partners/<partnerId>/deals -H 'content-type: application/json' \
  -d '{"name":"Northwind — 400-seat rollout","amount":96000}'
curl -b cookies.txt -X POST /api/ecosystem/partners/deals/<dealId>/status -H 'content-type: application/json' \
  -d '{"status":"won"}'

# Diff environments, then promote
curl -b cookies.txt -X POST /api/ecosystem/changesets/diff -H 'content-type: application/json' \
  -d '{"from":"production","to":"sandbox"}'
curl -b cookies.txt -X POST /api/ecosystem/changesets/<id>/promote -H 'content-type: application/json' \
  -d '{"to":"sandbox"}'

# Analyze a field before deleting it
curl -b cookies.txt "/api/ecosystem/schema/impact?objectType=contact&key=linkedin"
```
