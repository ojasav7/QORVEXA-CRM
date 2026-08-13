# 40 · Phase 13 Build Report — Ecosystem

**Status:** ✅ COMPLETE (100%) · **Verified live:** `verify-phase13.sh` **53/53** + regressions (Phase 12 69/69, Phase 11 71/71, Phase 10 109/109) · **Date:** 2026-08-13

Spec `docs/39-spec-phase13.md` · guides `docs/41-developer-platform.md` + `docs/42-marketplace-publishing-guide.md` + `docs/43-schema-change-safety.md` · ADR-025.

## What shipped

### Server

**`server/lib/ecosystem.ts`** (all logic, ADR-025 row-as-config) +
**`server/routes/ecosystem.ts`** (thin REST, mounted at `/api/ecosystem` in `server/index.ts`):

- **Marketplace** — `listListings` (hydrated with `installed` from App rows), `createListing` (slug-slugified, kind-validated, duplicate → 400), `updateListing`, `deleteListing`, `listApps`, **`installApp`** (applies `config.agentTemplate` → Phase 9 `Agent` via `templateFor`, `config.webhookEvents` → `Webhook`; double-install → 400; increments `installCount`; emits `app.installed`), `uninstallApp` (stamps `uninstalledAt`; not-installed → 400).
- **Partners** — `listPartners` (hydrated deals + **derived** `commissionEarned` = Σ won × rate, `pipelineValue` = Σ registered/approved), `createPartner` (type + rate 0–1 validated), `updatePartner`, `registerPartnerDeal` (optional `opportunityId`), `setPartnerDealStatus` (`won` stamps `wonAt` + emits `partner.commission_earned`; invalid status → 400).
- **Change sets** — `diffEnvironments` (fieldDefs absent in target / newer; agents absent in target), `createChangeSet` (entity/op whitelisted, zero items → 400), `listChangeSets`, **`promoteChangeSet`** (replays items: fieldDef create/update/delete, agent create/update/delete, featureFlag upsert; per-item errors recorded; re-promote → 400; emits `changeset.promoted`).
- **Schema safety** — `fieldImpact` (scans segments, automations, agents, lead forms, reports, field permissions + stored record values), `safeDeleteField` (refuses `Field is in use: N config reference(s), M record value(s)`; emits `schema.field_deleted` via `safe-delete`), `ecosystemOverview` (dashboard numbers).

### Data + UI

- **Prisma** — 5 new models: `MarketplaceListing`, `App`, `PartnerAccount`, `PartnerDeal`, `ChangeSet` (all org × env scoped, ADR-008).
- **Feature flags** — `ecosystem.marketplace` (pro/enterprise), `ecosystem.partners` (enterprise), `ecosystem.changesets` (enterprise), `ecosystem.schema` (pro/enterprise).
- **Seed** — 3 listings (Lead Qualifier Agent — agent kind, installed; Webhook Studio — integration; NPS Survey Template), 1 installed App row, 2 partners (Northwind Channel reseller 12% with a won $96k deal → $11,520 commission; Globex Referrals referral 8% with an approved $24k deal → pipeline), 1 draft change set ("Q3 field rollout" — a fieldDef + the Lead agent).
- **UI** — `EcosystemPage.tsx` at `/ecosystem` ("Ecosystem" nav section, gated by the four flags): Overview / Marketplace / Apps / Partners / Change sets / Schema tabs.

## Verification

`npm run typecheck` + `npm run build` green. **`verify-phase13.sh` — 53/53** on a fresh seeded stack:

- **Seeds** — overview numbers (3 listings, 1 installed, 2 partners, commission 11520 derived), listing/app/partner/change-set rows present.
- **RBAC** — rep reads 200 everywhere; rep publish/install/partner-create/env-diff/safe-delete all 403.
- **Marketplace** — publish → duplicate slug 400 → bad kind 400 → delete 200.
- **Install/uninstall** — webhook-studio install applies the webhook payload (webhook row created), double-install 400, uninstall works; **agent-template install creates a Phase 9 agent** (`agentId` in the applied config, `sales` agent exists afterwards).
- **Partners** — deal registration → won → 8% commission derived (400 on $5000); bad status 400; rate > 1 → 400.
- **Change sets** — env diff surfaces fieldDef creates; seeded change set promotes to sandbox (`promoted`), re-promote 400, promoted fieldDef + agent present in the sandbox; zero-items → 400.
- **Schema safety** — impact on `contact.linkedin` reports 5 record values; safe delete blocked in use; unused field deletes cleanly; `schema.field_deleted` + `changeset.promoted` + `app.installed` + `partner.commission_earned` all in the event log.
- **Feature gates + isolation** — `ecosystem.partners` off → partners API 403 while marketplace stays 200; sandbox has no listings/partners (ADR-008).

**Regressions** — `verify-phase12.sh` 69/69, `verify-phase11.sh` 71/71, `verify-phase10.sh` 109/109 (each on its own fresh seeded stack — the suites create subscriptions/partner deals that would otherwise pollute each other's baselines).

## Engineering notes

- **Install = payload applier, not a feature** — the marketplace creates no new runtime machinery: an agent-kind listing installs by calling the existing Phase 9 template registry (the agent then runs on the Phase 9 engine), an integration listing installs by creating a Phase 0 `Webhook`. The `App.config` records what was applied for audit + the Apps tab.
- **Commissions derived at read** — a won partner deal never stores its commission; `commissionEarned` is recomputed from `amount × rate` (ADR-018 discipline — no drift). The `partner.commission_earned` event carries the number for the audit trail/notifications only.
- **FieldDef has no `updatedAt`** — the env diff treats fieldDefs as create-only (absence in target), while agents diff by `kind` presence; both promote idempotently.
- **One script fix** — the Phase 13 suite originally compared the derived commission as a string (`400.0` vs `400`); now compares numerically.
