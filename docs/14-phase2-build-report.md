# 14 · Phase 2 Build Report — Communication Core

> What shipped to complete Phase 2 (the blueprint's "Communication Core")
> end-to-end, the decisions behind it, and the verification evidence.
> Companion to `docs/13-phase2-lite-build-report.md` (multi-pipeline) and
> `docs/14-communication-guide.md` (how it works). Status overview in
> `PROGRESS.md`. All live checks below ran against the real server
> (`localhost:8787`, Mongo via Docker, seeded demo org).

## What shipped

### 1. Email templates — `/api/email-templates`
- `EmailTemplate` model (org × env, ADR-008): `name`, `category`
  (`general | sales | follow-up | marketing | internal`), `subject`, `body`,
  `active`, `createdBy`.
- Full CRUD — reads open to any authenticated user, writes admin + manager.
- Templates support **`{{variable}}` merge fields**
  (`{{contact.firstName}}`, `{{account.name}}`, `{{deal.amount}}`); the
  Templates UI shows click-to-insert variable chips.
- Events: `template.created / updated / deleted`.

### 2. Email — `/api/emails` (mock provider, ADR-014)
- **Send** (`POST /api/emails`): optional `templateId` merges variables from
  the linked contact/account/deal; every outbound message gets a random
  `trackingToken` and is stored with its record references — so it appears on
  the record timeline (auto-logging) the moment it's sent.
- **Tracking:** public open-pixel (`/api/t/px/:token`) and click-redirect
  (`/api/t/click/:token?u=`, scheme-validated) flip message status
  `sent → opened → clicked → replied` and emit `email.opened` / `email.clicked`
  (first occurrence only; `openedCount` increments every load).
- **Inbox sync** (`POST /api/emails/sync`) drains a per-org mock inbound
  queue; **reply simulation** (`POST /api/emails/:id/reply`) posts a reply on
  the same thread. Delete also supported. Events: `email.sent / received /
  replied / opened / clicked / deleted`.
- **Email UI** (`/emails`): inbox/sent filter + search, tracking-status
  badges, compose modal with template picker + linked record selects, sync
  button, message detail with tracking facts, simulate-reply + delete.

### 3. Calling — `/api/calls`
- Call log with direction, phone, duration, status (`completed |
  no-answer | voicemail`), notes, and record references.
- **Recording + transcription (mock, ADR-014):** when
  `Organization.settings.calling.recording` is enabled (or requested per
  call), a placeholder recording URL + canned transcript are generated and
  the UI renders an audio player + transcript.
- Events: `call.completed` (duration > 0) / `call.logged` / `call.deleted`.
- **Calls UI** (`/calls`): log list with expandable recording/transcript/
  notes, log-a-call modal (direction, status, duration, linked contact).

### 4. Calendar / meetings — `/api/meetings`
- CRUD with date-range **overlap queries** (`?from=&to=`), status lifecycle
  (`scheduled → completed | cancelled | no-show`), location, notes, linked
  records, host (`ownerId`).
- Events: `meeting.scheduled / completed / status_changed / deleted`.
- **Calendar UI** (`/meetings`): day-grouped list, schedule modal, complete/
  cancel/reopen actions.

### 5. Booking pages — `/api/booking-pages` + `/b/:slug`
- Admin CRUD (admin only): name, slug (`/b/<slug>`), description,
  duration/buffer, **round-robin host pool** (persisted cursor, mirrors lead
  routing), availability days + hours, timezone, active toggle. Public URL +
  embed snippet surfaced in the UI.
- **Public flow** (`/api/public/booking/:slug`) — no auth, honeypot
  (`company_name`) + per-IP rate limit (20/min):
  - config endpoint; per-date **slots** (windows minus already-booked
    meetings);
  - **book** re-validates the slot server-side (guards double-booking),
    assigns the next round-robin host, creates the meeting
    (`meeting.scheduled { booking: true }` + `booking.booked`).
- **Public booking UI** (`/b/:slug`): date rail → time picker → confirm form
  → success. Feature-gated nav (admin) at `/booking`.

### 6. Auto-logged record timeline — `/api/timeline`
- Aggregates notes + emails + calls + meetings against a record, newest
  first; the **record detail drawer** now renders it, so every send/call/
  booking is visible on the contact/deal immediately.

### 7. Seed + feature flags
- Seed now creates 3 demo templates, a sent message (with tracking token) +
  an inbound message, a completed call (recording + transcript), an upcoming
  + a completed meeting, and a live `intro-call` booking page — all
  idempotent.
- `comm.email` / `comm.calling` / `comm.calendar` feature flags (all
  default-on) gate the API (`requireFeature`) and the nav.

## Decisions (ADR-014)
- **Providers are mocked behind one swap point** (`lib/comm.ts`): sending,
  inbound sync, replies, and call recording/transcription all simulate real
  providers (`EMAIL_MOCK=1`). Storage, events, webhooks, timeline, and UI use
  the real implementation — swapping in SMTP/telephony later only touches the
  helpers.
- **Tracking endpoints are public by design**, secured by an unguessable
  24-byte per-message token; responses leak no org data (GIF / validated 302).
- **Public booking reuses the lead-form playbook** (ADR-012): honeypot +
  rate limit + no-existence-leak, plus server-side slot re-validation.

## Bugs found & fixed during verification
1. **`no-answer` status key broke the Calls UI** — an unquoted `no-answer`
   object key in the status-tone map failed to parse; quoted and typechecked.
2. **Timeline reference for contacts** — the detail drawer must post the note
   and fetch the timeline against `contactId` for contacts; the generic ref
   mapping (account/opportunity/contact) was verified per object type.
3. **Mock inbound queue drained permanently for an org** — the queue resets
   only when empty; `sync` with `limit` ≤ 3 keeps demo data replenishable
   across the smoke suite (queue re-seeds after drain).
4. **Public booking double-submit** — the book endpoint re-computes open
   slots from the DB at request time, so two rapid bookings for the same slot
   can't both succeed (second gets 400).

## Verification evidence
- `npm run typecheck` (tsc --noEmit) ✅ · `npm run build` ✅ (production bundle).
- **Live smoke suite (`verify-phase2-comm.sh`, 44/44 green):**
  - Templates: list → create → patch → delete; 403 for reps; subject/body
    validation.
  - Send with template: `{{contact.firstName}}` merged from linked contact;
    tracking token returned; `email.sent` event emitted; message auto-logged
    to the contact timeline.
  - Tracking: pixel marks `opened` (+ `email.opened`), click redirect 302s
    to the target and marks `clicked`; invalid scheme rejected 400.
  - Sync drains mock inbound (`email.received`); reply simulation flips the
    thread to `replied`.
  - Calls: log completed call → `call.completed`; recording + transcript
    present when requested; patch/delete.
  - Meetings: schedule → `meeting.scheduled`; complete → `meeting.completed`;
    cancel; date-range filter.
  - Booking: create page (admin) → public config (no auth) → slots per date →
    book → meeting created with round-robin host + `booking.booked`;
    double-booking same slot → 400; honeypot → fake success, no meeting;
    rep create → 403.
  - Timeline: aggregated entries for a contact include the sent email.
- **Regressions:** `verify-phase2.sh` still 29/29 and `verify-phase1.sh`
  still 30/30 green on the same stack.
- **Demo data left pristine:** 3 templates, 2 messages, 1 call, 2 meetings,
  1 booking page — no leftover smoke rows.

## Docs updated
`PROGRESS.md` (Phase 2 → ✅ 100%), `docs/06-roadmap.md`, `docs/03-event-catalog.md`
(Phase 2 events), `docs/05-api-reference.md` (email/templates/calls/meetings/
booking/timeline/tracking sections), `docs/08-decision-log.md` (ADR-014),
new `docs/14-communication-guide.md`, `docs/14-calling-compliance.md`(calling/recording compliance notes — blueprint deliverable),
`docs/14-pipeline-builder-guide.md` (pipeline builder guide — blueprint
deliverable), `README.md`.
