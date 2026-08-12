# 17 · Technical Spec — Phase 4: Customer Service / Helpdesk

> Implementation-ready spec for Phase 4 (the blueprint's "Customer Service /
> Helpdesk"): a full support desk inside the same platform — **ticket/case
> management, SLAs, priorities, escalation, queues**, an **omnichannel intake**
> surface (email + web in v1; chat/WhatsApp/SMS/phone/social are data channels
> awaiting real providers, mirroring ADR-014), a **knowledge base** (articles,
> categories, search), a **customer self-service portal** (submit + track
> tickets), **ticket-to-lead / email-to-ticket conversion**, and **legal hold**.
> Audience: future-you or an AI agent building this next. Companion reports:
> `docs/18-phase4-build-report.md` (verification evidence).

---

## 1. Goal

Let an org run support from the same platform as sales: customers submit
tickets via a public portal or email, reps work them from **queues** with
priorities and **SLA deadlines**, high-value issues **escalate** (with
in-app notifications), answers are written up in a **knowledge base**, and
compliance-sensitive tickets can be put on **legal hold** so nothing on them
can be edited. Because tickets are an **object type** (the documented path in
`docs/01-architecture.md`), they inherit CRUD + events + audit + search +
custom fields + the Phase 3 workflow engine (`ticket.created`,
`ticket.status_changed` are new triggers).

**Done** = an admin can: open/close/assign/escalate tickets from a queue UI
with live SLA status; sweep for SLA breaches (which escalate + notify); convert
an inbound email into a ticket; convert a ticket into a lead; write + publish
KB articles; and publish a public portal page where a customer submits a ticket
and looks it up by reference. A rep sees only their queues and works replies.

**Non-goals (deferred):** knowledge-article version history (v1 keeps
`updatedAt` + body; a full diff/restore UI is future scope), real provider
integrations for chat/WhatsApp/SMS/phone/social (channels are data fields v1,
intake is email + web — same mock-provider trade-off as ADR-014), portal
orders/invoices/profile (v1 portal is tickets only), round-robin ticket
assignment (v1 is manual assignment + self-service), SLA calendar-hour
precision (v1 counts wall-clock hours from creation/priority change).

---

## 2. Architecture decision (recorded as ADR-016)

### ADR-016 · Tickets are an object type; SLAs are policy rows + a sweep

**Decision:**
- **Tickets are a first-class object type** via the object model
  (`registry.ts` def + `registerObject` + object router). They get CRUD,
  audit, events, search, field permissions, custom fields, and the Phase 3
  workflow engine for free. Service-specific behavior (reference numbers,
  SLA due dates, status transitions, replies, escalation, legal hold) lives
  in a thin **ticket router** (`server/routes/tickets.ts`) that mounts the
  generic object router last, so the generic surface stays untouched and
  custom routes win for the same paths.
- **SLA = declarative policy rows + a computed deadline.** A `SlaPolicy`
  holds per-priority response hours (low 24 / medium 8 / high 4 / urgent 1,
  resolvable targets). The engine (`server/lib/slas.ts`) computes
  `slaDueAt` on create/priority-change, computes a *read-time* `slaStatus`
  (`on_track / due_soon / breached / n/a`), and a **sweep** (`POST
  /api/tickets/sla/check`) marks breached tickets, emits
  `ticket.sla_breached`, and auto-escalates high/urgent breaches (notify the
  assignee + managers). Same philosophy as segments/workflows: policy is
  data, not code.
- **Legal hold is a ticket flag with teeth.** `legalHold: true` blocks
  PATCH/DELETE from every role except an admin explicitly lifting the hold —
  enforced in the ticket router, audited, and surfaced in the UI.
- **Omnichannel intake is a channel field + two intake paths.** Every ticket
  carries a `channel` (email | web | chat | whatsapp | sms | phone | social).
  v1 intake: `POST /api/tickets/intake/email` (email → ticket, contact linked
  by address) and the public portal (web). The other channels are valid data
  and workflow-triggerable; their provider integrations are deferred exactly
  like telephony was in ADR-014.

**Why:** the object model + event bus are the stated substrate; this keeps one
write path for tickets and makes the workflow engine (Phase 3) and the future
AI layer (Phase 8) consumable for support data with zero new plumbing.

**Cost/risk:** the ticket router duplicates a little of the generic router's
surface (create/update wrappers); SLA sweep is admin-triggered in v1 (a
scheduled worker is the documented upgrade path); in-memory breach state is
derived from timestamps so restarts can't lose it.

---

## 3. Data model changes (`prisma/schema.prisma`)

| Model | Shape | Notes |
|---|---|---|
| 🆕 `Ticket` | `orgId`, `environment`, `reference` (per-org `TKT-####`), `subject`, `description?`, `status` (`new \| open \| pending \| resolved \| closed`), `priority` (`low \| medium \| high \| urgent`), `channel` (`email \| web \| chat \| whatsapp \| sms \| phone \| social`), `source` (`portal \| email \| manual`), `assigneeId` (via generic `ownerId`), `contactId?`, `accountId?`, `slaDueAt?`, `breachedAt?`, `escalated Bool`, `escalatedAt?`, `firstResponseAt?`, `resolvedAt?`, `legalHold Bool`, `tags`, `custom`, `visibility` | Indexed `[orgId, environment, status]`, `[orgId, environment, priority]`, `[orgId, environment, assigneeId]`. `reference` unique per org+env. |
| 🆕 `TicketReply` | `orgId`, `environment`, `ticketId`, `authorId`, `body`, `internal Bool` (true = visible to staff only), `createdAt` | The reply thread; public replies are what the portal lookup shows. Indexed `[orgId, ticketId, createdAt]`. |
| 🆕 `KnowledgeArticle` | `orgId`, `environment`, `title`, `slug`, `body`, `category`, `tags`, `published Bool`, `authorId`, `viewCount Int`, `createdAt`, `updatedAt` | KB articles; slug unique per org+env. Published articles appear in the portal. |
| 🆕 `SlaPolicy` | `orgId`, `environment`, `name`, `targets Json` (`{ low: {responseHours}, medium: …, high: …, urgent: … }`), `active Bool`, `createdAt` | One default policy seeded per org; targets are data-editable later. |
| 🆕 `PortalPage` | `orgId`, `environment`, `name`, `slug` (public URL handle), `description?`, `autoCreateContact Bool`, `active Bool`, `createdAt`, `updatedAt` | The public self-service portal config — same shape philosophy as `LeadForm` / `BookingPage`. |

**Migration warning (Mongo):** `prisma db push` adds new collections only —
no backfill needed. Existing data untouched.

### Ticket lifecycle (v1)

```
new ──(assign/reply)──▶ open ──(waiting on customer)──▶ pending ──▶ resolved ──▶ closed
   └──▶ resolved / closed at any point (with reason)
```
- `reference` = `TKT-{seq}` per org (sequence derived from count+1; unique per
  org × environment).
- `slaDueAt` = created/priority-changed time + policy responseHours.
- `firstResponseAt` = first staff reply (internal or public) — set once.
- `resolvedAt` = set when status moves to `resolved`/`closed`.
- **SLA status (read-time):** `n/a` when resolved/closed or no `slaDueAt`;
  `breached` when now > `slaDueAt` (and `breachedAt` set); `due_soon` when
  inside the last 25% of the window; else `on_track`.

---

## 4. API changes

All routes behind `requireFeature("service.tickets")` (default on). KB behind
`service.knowledge`; portal admin behind `service.tickets`.

### Tickets (`/api/tickets`) — custom router first, generic object router last

| Method | Path | Notes |
|---|---|---|
| GET | `/api/tickets` | Generic list (+ `?status=&priority=&channel=&assigneeId=&q=`) — every row carries read-time `slaStatus`, `assigneeId_label`. |
| POST | `/api/tickets` | Generic create **wrapped**: auto `reference` + `slaDueAt` computed from the org's policy; emits `ticket.created`. Admin/manager may set `assigneeId`; reps get themselves. |
| GET/PATCH/DELETE | `/api/tickets/:id` | Generic, with a PATCH wrapper: legal-hold enforcement, `resolvedAt` on resolution, SLA recompute on priority change, `ticket.status_changed` emitted by the generic service (new branch, mirroring `task.completed`). |
| GET | `/api/tickets/queues` | `{ items: [{ key, label, count }] }` — new, open, pending, resolved, closed, breached, escalated, my, unassigned. |
| GET | `/api/tickets/:id/replies` | The reply thread (newest first). |
| POST | `/api/tickets/:id/reply` | `{ body, internal? }` — staff reply; sets `firstResponseAt` + status `new → open`; emits `ticket.replied`. |
| POST | `/api/tickets/:id/assign` | `{ assigneeId }` — admin/manager; emits `ticket.assigned` (+ notification to the assignee). |
| POST | `/api/tickets/:id/escalate` | Sets `escalated` + `escalatedAt`; emits `ticket.escalated` + notifies assignee + managers. |
| POST | `/api/tickets/:id/legal-hold` | `{ legalHold: boolean }` — **admin only**; toggles the lock. |
| POST | `/api/tickets/:id/convert-to-lead` | Creates a `Lead` from the ticket's contact (falls back to subject-derived name); emits `ticket.converted` + `lead.created`. |
| POST | `/api/tickets/intake/email` | `{ from, subject, body, contactId? }` — email → ticket (channel `email`, source `email`, contact linked by address, auto-created if missing); emits `ticket.captured`. |
| POST | `/api/tickets/sla/check` | **Admin** sweep: marks breaches (`ticket.sla_breached`), auto-escalates high/urgent, returns `{ checked, breached, escalated }`. |

### Knowledge base (`/api/knowledge`, flag `service.knowledge`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/knowledge` | `?q=&category=&published=` — `{ items }` with `viewCount`, `authorName`. |
| GET | `/api/knowledge/categories` | Distinct categories with counts. |
| GET | `/api/knowledge/:id` | Single article; increments `viewCount` when `published`. |
| POST | `/api/knowledge` | Admin — `{ title, body, category, tags?, published?, slug? }` (slug auto-derived). Emits `knowledge.created`. |
| PATCH | `/api/knowledge/:id` | Admin partial update (no `.default()`s — ADR engineering note). Emits `knowledge.updated`. |
| DELETE | `/api/knowledge/:id` | Admin. Emits `knowledge.deleted`. |

### Portals (`/api/portals`, flag `service.tickets`; public intake at `/api/public/portal`)

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/portals` | Admin CRUD for `PortalPage`. Emits `portal.created/updated/deleted`. |
| PATCH/DELETE | `/api/portals/:id` | Admin. |
| GET | `/api/public/portal/:slug` | **No auth.** `{ name, description, active, articles: published KB }`. |
| POST | `/api/public/portal/:slug/tickets` | **No auth.** Honeypot + per-IP rate limit (same guards as public leads/booking). `{ name, email, subject, body }` → finds-or-creates the contact (`autoCreateContact`), creates ticket (channel `web`, source `portal`, priority low), returns `{ reference, ok: true }`. Emits `ticket.captured`. |
| POST | `/api/public/portal/:slug/lookup` | **No auth.** `{ email, reference }` → `{ found, ticket: { subject, status, priority, updatedAt, publicReplies } }` — no-leak semantics (mismatched email = `found: false`). |

### Events emitted (v1)

`ticket.created / updated / deleted / status_changed / assigned / replied /
escalated / sla_breached / converted / captured`, `knowledge.created /
updated / deleted`, `portal.created / updated / deleted`.

### Workflow engine integration (Phase 3)

New triggers: **`ticket.created`**, **`ticket.status_changed`** (with optional
`to` status filter, same shape as `deal.stage_changed`), **`ticket.escalated`**.
This makes the flagship new object immediately automatable — e.g. "new
urgent ticket → notify the support manager" or "ticket resolved → create a
follow-up task".

---

## 5. UI changes (`src/`)

| Surface | What |
|---|---|
| New page **Tickets** (`/tickets`, flag `service.tickets`) | **Queue tabs** (All / My / Unassigned / Breached / Escalated / by status), stat chips, and a ticket table (reference, subject, priority, channel, assignee, SLA chip with `on_track/due_soon/breached/n/a` colors, status). **Create modal** (subject, description, priority, channel, contact link). **Detail drawer**: full fields, SLA deadline, reply composer (with "internal" toggle), assign select, escalate button, legal-hold toggle (admin), convert-to-lead button, delete; the reply thread renders public/internal chips. |
| New page **Knowledge** (`/knowledge`, flag `service.knowledge`) | Article grid with search + category filter; published/unpublished badges; **editor modal** (title, category, tags, body, published toggle); view counts. |
| New page **Portals** (`/portals`, flag `service.tickets`) | Manage public portal pages: name, slug, description, auto-create-contact toggle, active; shows the public `/p/:slug` URL. |
| New public page **Portal** (`/p/:slug`, no auth) | Mirrors the public booking page: submit a ticket (name/email/subject/body + honeypot) → success screen with the ticket **reference**; a lookup tab (email + reference) → status + public replies. |
| Nav | New "Support" section: **Tickets**, **Knowledge**, **Portals** (feature-gated). |
| Settings → Feature flags | `service.tickets`, `service.knowledge` appear automatically via the known-flags registry. |

---

## 6. Edge cases & risks

1. **Legal hold** — enforced in the ticket router (PATCH/DELETE wrapper) for
   every role; only an admin toggling it off unlocks. Audited via the generic
   audit trail; the UI shows a lock banner.
2. **SLA drift** — status is *computed at read* from `slaDueAt`, so a missed
   sweep can never show a stale "on track"; the sweep just persists
   `breachedAt` + events. Wall-clock hours are a documented v1 simplification.
3. **Reference collisions** — `TKT-{count+1}` can collide after deletes;
   uniqueness is enforced per org × env and the create loop retries on
   conflict (max 5).
4. **Portal abuse** — honeypot + per-IP rate limit + no-leak lookup (email +
   reference required, generic "not found" otherwise), same discipline as
   public leads/booking (ADR-012).
5. **Email intake contact leak** — the intake finds contacts by email within
   the org only; an unknown address auto-creates a contact (opt-out via
   `autoCreateContact: false` on intake is future scope).
6. **Tenant isolation** — every new query is org × environment scoped like all
   existing rows; sandbox tickets never appear in production queues and never
   fire production workflows.
7. **`status_changed` contract** — like `task.completed`, this is a new event;
   the generic service's existing `ticket.updated` still fires for non-status
   edits.

---

## 7. Acceptance criteria

- [ ] Creating a ticket auto-assigns a `reference` + `slaDueAt` (per priority
      policy); priority change recomputes `slaDueAt`.
- [ ] Moving a ticket to `resolved`/`closed` sets `resolvedAt` and emits
      `ticket.status_changed` (with `from`/`to`); other edits emit
      `ticket.updated`.
- [ ] A staff reply sets `firstResponseAt` (+ `new → open`) and emits
      `ticket.replied`; `GET :id/replies` returns the thread.
- [ ] Assign emits `ticket.assigned` and notifies the assignee; escalate emits
      `ticket.escalated` and notifies assignee + managers.
- [ ] `POST /api/tickets/sla/check` marks breached tickets (`ticket.sla_breached`),
      auto-escalates high/urgent breaches, and returns counts.
- [ ] Legal hold blocks PATCH/DELETE for reps and managers; admin can lift it.
- [ ] `convert-to-lead` creates a lead linked to the ticket's contact.
- [ ] Email intake creates a ticket (channel email) linked to the org's contact
      by address.
- [ ] Reps get 403 on portal/KB writes and `sla/check`; reads open.
- [ ] Public portal: honeypot submissions get a fake success + no write; rate
      limit 429/400; real submission returns a reference; lookup requires
      matching email (no-leak); disabled/unknown portal → 400.
- [ ] Workflows can trigger on `ticket.created` / `ticket.status_changed`
      (`to` filter) / `ticket.escalated`.
- [ ] Disabling `service.tickets` 403s tickets/portals; disabling
      `service.knowledge` 403s the KB. Sandbox tickets never leak into
      production.
- [ ] `npm run typecheck` + `npm run build` pass; new smoke suite
      `verify-phase4.sh` green; `verify-phase1.sh` (30), `verify-phase2.sh`
      (29), `verify-phase2-comm.sh` (45), `verify-phase3.sh` (34) still green.
- [ ] Docs updated: event catalog, API reference, ADR-016, PROGRESS, roadmap,
      README.

---

## Suggested implementation order (one developer)

1. **Models:** `Ticket`, `TicketReply`, `KnowledgeArticle`, `SlaPolicy`,
   `PortalPage` in schema → `db push` (~0.5 day).
2. **Engine:** `server/lib/slas.ts` — policy defaults, due-date math, read-time
   status, breach sweep (~0.75 day).
3. **Ticket object + router:** registry def + `registerObject` + ticket router
   (queues, replies, assign, escalate, legal hold, convert, intake, sla check,
   create/update wrappers) + generic-service `status_changed` branch (~1.5 days).
4. **KB + portals:** knowledge routes (CRUD + categories + view counts) and
   portal admin + public routes (honeypot/rate limit/lookup) (~1 day).
5. **Workflow triggers:** add `ticket.created / status_changed / escalated` to
   the engine catalog + UI trigger list (~0.25 day).
6. **UI:** Tickets page (queues + drawer + replies), Knowledge page, Portals
   page, public portal page, nav, `objects.ts` (~2 days).
7. **Seed:** SLA policy, tickets across statuses/priorities (incl. one breached
   + one escalated + one legal hold), replies, KB articles, a portal page
   (~0.5 day).
8. **Docs & verification:** event catalog, API reference, ADR-016, PROGRESS,
   roadmap, README; `verify-phase4.sh` + full regression pass (~1 day).
