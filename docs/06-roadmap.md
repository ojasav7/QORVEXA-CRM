# 06 · Roadmap — Blueprint → Build Status

Maps the 16-phase blueprint (`QORVEXAThe intelligent operating system for business.md`) to what exists in this repo. **Shipped** = working code; **Scaffolded** = schema/design ready, feature to build; **Planned** = future phase.

Legend: ✅ Shipped · 🧱 Scaffolded (foundation exists) · ⬜ Planned

## Phase 0 — Platform Foundations ✅ (core shipped)

| Blueprint item | Status | Where |
|---|---|---|
| Object/Relationship/Event architecture | ✅ | `lib/registry.ts`, `lib/object-service.ts`, Prisma schema |
| Event bus | ✅ | `lib/events.ts` + `Event` collection + UI feed |
| RBAC + record-level permissions | ✅ | `lib/access.ts`, roles admin/manager/rep |
| Multi-tenant org model | ✅ | `orgId` scoping everywhere |
| Custom fields (no-code, v1) | ✅ | `FieldDef` registry + Settings UI |
| API (REST) + Webhooks | ✅ | `docs/05-api-reference.md`, Settings UI |
| Audit trail (field-level diff) | ✅ | `lib/audit.ts` + `AuditLog` collection |
| OAuth / SSO | ⬜ | Phase 14 (signed cookies now) |
| Sandbox/staging, feature flags, data residency, backups, point-in-time restore | ⬜ | Schema-ready (`Organization.settings`), UI later |

## Phase 1 — Core CRM ✅

Contacts, accounts, leads, deals (6-stage pipeline board with drag-drop), activities (tasks + notes), tags, ownership, duplicate detection & merge (detection ✅, merge UI ⬜), universal keyword search ✅ (semantic → Phase 8).

## Phase 2 — Communication Core 🧱

- Email sync, templates, tracking — ⬜
- Calendar / booking pages — ⬜
- Calling — ⬜
- **Multi-pipeline engine** — 🧱 `registry.ts` already parameterizes the pipeline; add pipeline CRUD + per-org config
- Auto-logging, deal fields (win/lost reasons exist ✅)

## Phase 3 — Automation & Workflow Engine 🧱

- Visual workflow builder (trigger → condition → action) — the event bus is the trigger substrate; `onEvent()` is the hook point
- Sequences, notifications, escalations — ⬜
- Conflict resolution UI + duplicate-agent detection — ⬜

## Phase 4 — Customer Service ⬜

Tickets, omnichannel intake, knowledge base, portal, SLAs, legal hold. (Adding `Ticket` via the object model is the intended path — see `docs/01-architecture.md` "Adding a new object type".)

## Phase 5 — Marketing Automation ⬜

Campaigns, journeys, segmentation (Tag-based segments already work), landing pages, deliverability monitoring.

## Phase 6 — Analytics & BI 🧱

- Dashboards — 🧱 dashboard stats endpoint exists; add report builder + metrics library
- Forecasting — 🧱 pipeline data is event-sourced, ready for weighted forecasts
- Predictive analytics — ⬜

## Phase 7 — CDP / Customer 360 ⬜

Identity resolution, relationship graph, health engine, right-to-portability export. (Audit + events are the raw material.)

## Phase 8 — AI Assistant Layer 🧱

- AI summaries / scoring / semantic search — the `Event` + `AuditLog` history and searchable fields are the context substrate; `ModelRoute`/`AIInsight` models to add
- Confidence scoring, data firewall, model router — ⬜

## Phase 9 — AI Agent Platform ⬜

Agent builder, risk-tiered actions, kill switch, testing lab, cost metering. Governance model already defined (`docs/04-permissions.md`).

## Phase 10 — Revenue Cloud ⬜

CPQ, contracts, billing, subscriptions, MRR. Opportunity amount/stage history already event-sourced.

## Phase 11 — Customer Success ⬜ / Phase 12 — Field Ops ⬜ / Phase 13 — Ecosystem ⬜

Success plans, usage intelligence, loyalty · territory/field service/inventory · no-code platform, marketplace, change-impact analysis.

## Phase 14 — Enterprise Security ⬜

SSO/MFA/SCIM, encryption/masking, GDPR/consent, vendor transparency, WCAG 2.2 AA, status page, i18n. Auth/permissions foundation shipped.

## Phase 15 — Differentiators ⬜

Business Brain, relationship graph v2, multi-agent orchestration, Deal X-Ray, Time Machine (**audit + events already provide the history substrate**), simulators, voice/computer-use agent, universal business query.

---

## Suggested next milestones

1. **Phase 2-lite:** multi-pipeline admin + email templates (natural extension of the object model).
2. **Phase 3-lite:** a visual workflow builder over the event bus (trigger → condition → action), which also delivers `task.completed` and notifications.
3. **Phase 0 hardening:** sandbox environments, feature flags, CSV merge UI, and backup/restore — the remaining enterprise backbone items.
