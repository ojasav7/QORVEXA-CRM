# 18 · Phase 4 Build Report — Customer Service

> What shipped to complete Phase 4 (the blueprint's "Customer Service" phase)
> end-to-end, the decisions behind it, and the verification evidence.
> Spec: `docs/17-spec-phase4.md` · Decision: ADR-016 in `docs/08-decision-log.md`.
> Status overview in `PROGRESS.md`. All live checks below ran against the real
> server (`localhost:8787`, Mongo via Docker, freshly seeded demo org).

## What shipped

### 1. Tickets as a first-class object type (ADR-016)
- `Ticket` added through the **documented object-model path** (`docs/01-architecture.md`
  "Adding a new object type"): Prisma model + `registry.ts` def + one
  `registerObject()` line. The generic object service powers CRUD, audit,
  events, search, and custom fields for free; it emits `ticket.created` /
  `ticket.updated` / `ticket.deleted` / `ticket.status_changed`
  (the last via a `cfg.type === "ticket"` branch mirroring `task.completed`).
- A **thin wrapper** (`server/routes/tickets.ts`) layers the helpdesk surface
  on top of the generic service:
  - **Per-org reference numbers** — `TKT-####` from the max existing suffix + 1,
    with a 5-attempt retry loop on reference collisions after deletes.
  - **Queues** — `GET /api/tickets/queues` returns live counts for
    All / My tickets / New / Open / Pending / Resolved / Closed / SLA breached /
    Escalated (the page tabs).
  - **Reply threads** — `TicketReply` rows (staff + `internal` flag); a staff
    reply sets `firstResponseAt`, flips `new → open`, and emits `ticket.replied`.
  - **Assignment** — admin/manager reassign, validates the assignee is an
    active org member, notifies the new owner, emits `ticket.assigned`.
  - **Escalation** — flags `escalated: true`, bumps priority, notifies the
    assignee + managers, emits `ticket.escalated`.
  - **Email intake** — `POST /api/tickets/intake/email` turns `{ from, subject,
    body }` into a `channel: email` ticket, linking the contact by address and
    auto-creating it when unknown (race-safe catch on duplicate), emits
    `ticket.captured`. The Phase-2 mock inbox can POST here when a real sync lands.
  - **Convert-to-lead** — `POST :id/convert-to-lead` creates a lead from the
    ticket's contact (auto-named "Support Lead" when unlinked), emits
    `ticket.converted`.

### 2. SLAs — policy rows, deadlines, read-time status, breach sweep
- `SlaPolicy` (org × environment, `targets` JSON) **lazily seeded** with
  defaults `urgent 1h / high 4h / medium 8h / low 24h`
  (`server/lib/slas.ts`), overridable per priority.
- Create sets `slaDueAt` = now + `responseHoursFor(priority)`. A priority
  change restarts the clock (documented v1 semantics); resolution sets
  `resolvedAt`.
- **Read-time `slaStatus`** is always computed from the clock
  (`ok / warning / breached`) — never stored, so it can't go stale.
- **Breach sweep** (`POST /api/tickets/sla/check`, admin): finds open tickets
  past their deadline that aren't yet flagged, persists `breachedAt`, emits
  `ticket.sla_breached`, and **auto-escalates high/urgent breaches**
  (notify assignee + managers, `ticket.escalated`).
- Two Mongo quirks hit and fixed during verification (see "Bugs found").

### 3. Knowledge base — `server/routes/knowledge.ts` (flag `service.knowledge`)
- `KnowledgeArticle` CRUD — admin writes, reads open to any authenticated user.
- Categories (with counts), title/body search (`?q=`), tags, slugs unique per
  org × env, published/draft. Reading a **published** article bumps `viewCount`.

### 4. Public self-service portal (flag `service.tickets`)
- Admin `PortalPage` CRUD (`/api/portals`): name, slug, description,
  `autoCreateContact`, active.
- **Public endpoints** (`/api/public/portal/:slug` + `/p/:slug` SPA route),
  no auth — the ADR-012 playbook applied:
  - `POST :slug/tickets` — submit a ticket. Honeypot field (`favorite_color`)
    silently swallows bots (fake success, no write); per-IP rate limit
    (20/min shared across submit + lookup). Creates the ticket as the **portal
    page's actor** (a system identity) in the org's production env, so org
    field permissions never block capture. Contacts are auto-created/linked by
    email when `autoCreateContact`. Returns `{ ok, reference }` + emits
    `ticket.captured`.
  - `POST :slug/lookup` — **no-leak status check**: `{ email, reference }` must
    both match the ticket's linked contact, else a generic `found: false`.
    Only **non-internal** replies are ever exposed.
  - `GET :slug` — portal config + the org's **published** KB articles.

### 5. Legal hold (🆕 blueprint item)
- Admin-only toggle (`POST :id/legal-hold`). While held: the generic PATCH is
  blocked for non-admins (403; only an admin can lift the hold), and
  delete/reply/assign/escalate are blocked for **everyone** — the compliance
  lock.

### 6. Workflow integration
- The Phase 3 engine's trigger catalog gained `ticket.created`,
  `ticket.status_changed` (optional `to` status filter — joins
  `deal.stage_changed` in `TRIGGERS_WITH_TO`), and `ticket.escalated`.
  The Workflows page builder lists them. Tickets are automatable like any
  object (e.g. "ticket.status_changed → resolved → notify owner").

### 7. UI — three admin pages + one public page
- **Tickets** (`/tickets`, nav under a new "Support" section): queue tabs with
  live counts, search + status filter, ticket rows with SLA badges
  (`ok / warning / breached`), a detail drawer with the reply thread, status
  control, and actions — Assign, Escalate, Legal hold, Convert to lead, Reply
  (public/internal toggle).
- **Knowledge** (`/knowledge`): article cards with category chips + published
  toggle, search, categories list, create/edit modal.
- **Portals** (`/portals`): portal cards with the public `/p/<slug>` link,
  create/edit modal, active toggle.
- **Public portal** (`/p/<slug>`, no auth): submit form + reference lookup +
  published articles.
- All admin pages + nav links are feature-gated (`service.tickets`,
  `service.knowledge` — default-on, so they appear in Settings → Feature flags).

### 8. Seed
- 3 tickets ("Cannot log into the dashboard", priority high / SLA on-track,
  an escalated one, a resolved one), a couple of replies, the default
  `SlaPolicy`, 3 KB articles (one draft), and the "Qorvexa Support" portal —
  so every page has content on first login.

## Decisions (ADR-016)

Tickets are a **generic object** (ADR-003) with a thin helpdesk wrapper — CRUD,
audit, events, search, custom fields, and workflow automation for free. SLAs
are **policy rows** lazily seeded, with read-time status derived from the clock
(never stale) and an admin-triggered sweep as the durable breach record.
Public intake follows the **ADR-012 playbook** (honeypot + rate limit +
no-leak). **Legal hold is a hard lock** enforced in the wrapper, so held
tickets cannot be edited, replied to, or deleted. See
`docs/17-spec-phase4.md` §2 for the full rationale.

## Bugs found & fixed during verification

1. **`slaDueAt` stored as a string** — the generic service stores raw values,
   so a string `slaDueAt` was stored as a string and Mongo `$lt` (Date)
   comparisons in the sweep never matched it. Fixed: the PATCH wrapper
   normalizes to a `Date` before the service writes (same discipline as
   `merge.ts`'s `validateFieldValue`).
2. **Prisma `breachedAt: null` misses missing fields** — tickets created via
   the API lacked the `breachedAt` key entirely (the generic service only
   stores registry fields), and Prisma's `null` filter doesn't match missing
   keys. Fixed: fetch candidate past-due rows and filter `breachedAt` in JS
   (seeded rows had explicit nulls, which is why the sweep found those).
3. **Verify-script JSON greps** — `"key": "value"` (with space) never matched
   the JSON output; corrected to `"key":"value"`.
4. **Portal rate limiter too tight for the suite** — repeated suite runs tripped
   the 10/min limiter; raised to 20/min and made the burst test deterministic.
5. **Portal slugs were only unique per org** (post-review) — the public router
   looks a portal up by slug with no org context, so a per-org uniqueness check
   let two orgs share "support" and route submissions to an arbitrary one.
   Slug uniqueness is now **global** (ADR-016 amendment; same fix applied to
   the PATCH slug check).
6. **Manual escalation didn't restart the SLA clock** (post-review) —
   `escalateTicket` now accepts `bumpPriority` (manual escalations raise to ≥
   `high` and recompute `slaDueAt` from the escalation moment, matching the
   PATCH priority-change semantics). The SLA sweep deliberately passes nothing:
   a breached ticket stays breached, never gets a fresh deadline.
7. **KB view bump reordered the list** (post-review) — reading a published
   article bumped `updatedAt`, which re-sorted the "newest updated first" list
   and looked like an edit. The `viewCount` increment no longer touches
   `updatedAt`.

## Verification evidence

- `npm run typecheck` ✅ · `npm run build` ✅ (production bundle, `dist/`).
- **Live smoke suite (`verify-phase4.sh`, 61/61 green):**
  - Tickets: create (reference + SLA deadline), list with `slaStatus`, queues
    counts, get, patch (status/priority/assignee), legal-hold lockout
    (rep PATCH → 403, admin lift → 200), delete (blocked on hold).
  - Replies: staff reply sets `firstResponseAt` + `new → open`; internal reply
    hidden from the public lookup.
  - Assignment → `ticket.assigned` + a notification to the new owner.
  - Escalation → `escalated: true` + `ticket.escalated` emitted.
  - Convert-to-lead → lead created with the contact's email.
  - Email intake → ticket with `channel: email`, contact auto-created,
    `ticket.captured`.
  - **SLA sweep**: backdated `slaDueAt` → sweep marks `breachedAt` + emits
    `ticket.sla_breached` + auto-escalates a high-priority breach (notify +
    `ticket.escalated`); warning status computed on the 20% edge.
  - Knowledge: CRUD, search, categories with counts, viewCount bump on
    published read, admin-only writes (rep 403).
  - Portals: CRUD + slug-uniqueness 400; public submit (honeypot swallowed,
    rate limit 429-equivalent 400, auto-created contact, `{ reference }`
    returned); public lookup found + no-leak (`found: false` on email mismatch
    and on unknown reference).
  - **Workflow triggers**: a `ticket.status_changed → resolved` workflow fired
    end-to-end (runCount++, notification).
  - Feature gates: disabling `service.tickets` / `service.knowledge` 403s the
    APIs; re-enable restores 200.
  - Cleanup: smoke tickets/workflows deleted; demo data left pristine.
- **Regressions on the same stack:** `verify-phase3.sh` 34/34,
  `verify-phase2-comm.sh` 45/45, `verify-phase2.sh` 29/29,
  `verify-phase1.sh` 30/30 — all green.
- **Browser check** (login → Support nav → Tickets detail drawer with Escalate /
  Legal hold / Convert buttons → Knowledge articles → Portals → public
  `/p/support` submit form): all rendered, zero console errors.

## Docs updated

`docs/17-spec-phase4.md` (spec, new), `docs/18-phase4-build-report.md` (this
report), `docs/03-event-catalog.md` (Phase 4 events), `docs/05-api-reference.md`
(Tickets / Knowledge base / Portals sections + Phase 3 trigger-catalog update),
`docs/08-decision-log.md` (ADR-016), `PROGRESS.md` (Phase 4 → ✅ 100%),
`docs/06-roadmap.md` (Phase 4 → ✅ shipped), `README.md` (Phase 4 feature list).
