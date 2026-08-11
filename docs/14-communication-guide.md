# 14 · Communication Guide (Phase 2)

How the Phase 2 communication core works end-to-end: email (templates, mock
provider, open/click tracking), calling, calendar/meetings, public booking
pages, and the auto-logged record timeline. Companion to
`docs/13-phase2-lite-build-report.md` (multi-pipeline) and `docs/14-phase2-build-report.md`.

## Feature flags (all on by default)

| Flag | Gates | UI |
|---|---|---|
| `comm.email` | `/api/emails` | Email + Templates nav |
| `comm.calling` | `/api/calls` | Calls nav |
| `comm.calendar` | `/api/meetings` | Calendar + Booking nav |

The API gate is real (`requireFeature` middleware → 403 when disabled);
the nav items are advisory. Toggle in Settings → Feature flags.

## Email

### Templates (`/api/email-templates`)
Reusable `{ subject, body }` pairs with **`{{variable}}` merge fields** —
e.g. `{{contact.firstName}}`, `{{account.name}}`, `{{deal.amount}}`. Managed
by admins + managers (reps read-only). Fields: `name`, `category`
(`general | sales | follow-up | marketing | internal`), `subject`, `body`,
`active`. Reads are open; writes emit `template.created / updated / deleted`.

### Sending (`/api/emails`)
`POST /api/emails` with `{ toEmail, subject, body, templateId?, contactId?, accountId?, opportunityId?, threadId? }`:

1. If `templateId` is set, the body is **merged** from the linked record
   (`{{contact.firstName}}` → Elena, `{{deal.amount}}` → 180000, …). Unknown
   variables render as empty — a send never crashes on a missing field.
2. Every outbound message gets an unguessable `trackingToken` (24 random bytes).
3. The message is stored with `direction: "out"`, `status: "sent"`, and the
   record references (`contactId` / `accountId` / `opportunityId`) that make it
   appear on the record timeline automatically (auto-logging).
4. `email.sent` fires with the token + tracking URLs in the payload.

**Mock provider:** with `EMAIL_MOCK=1` (default in dev) nothing leaves the
server — this is the only piece that changes when a real SMTP/provider lands.

### Inbound + sync + replies
- `POST /api/emails/sync` drains a per-org **mock inbound queue** (3 canned
  messages) into the inbox as `direction: "in"` rows (`email.received`).
- `POST /api/emails/:id/reply` simulates the recipient replying: a new `in`
  message shares the `threadId`, the original flips to `replied`
  (`email.replied`).

### Tracking (public, token-scoped)
Recipients are not logged in, so the endpoints are deliberately public —
security relies on the unguessable token; responses expose no org data.

- `GET /api/t/px/<token>` → 1×1 transparent GIF, marks `opened` (first open
  emits `email.opened`; `openedCount` increments every load).
- `GET /api/t/click/<token>?u=<url>` → 302 to `<url>` (scheme-validated —
  never `javascript:`/`data:`), marks `clicked` (first click emits
  `email.clicked`).

Status is the best state reached: `sent → opened → clicked → replied`.

## Calling (`/api/calls`)

Click-to-call is a `tel:` link in the UI; the log entry is created here.
`POST /api/calls` with `{ direction, phone, durationSec?, status?, notes?, contactId?, recording? }`:

- `status`: `completed | no-answer | voicemail`. A completed call fires
  `call.completed`; anything else fires `call.logged`.
- **Recording/transcript:** when the org setting `settings.calling.recording`
  is true (or `recording: true` is requested), a placeholder `recordingUrl`
  and a canned `transcript` are generated — real telephony is deferred
  (ADR-014). The mock file serves from `/api/mock/media/calls/*`.

## Calendar / meetings (`/api/meetings`)

`POST /api/meetings` with `{ title, startsAt, endsAt, status?, location?, notes?, contactId?, ownerId? }`
creates a scheduled meeting (`meeting.scheduled`). `PATCH` moves status —
`completed` fires `meeting.completed`, other changes fire
`meeting.status_changed`. `GET /api/meetings?from=&to=&ownerId=` supports the
date-range calendar view (overlap semantics).

Booking-page bookings **create meetings** owned by the round-robin-assigned
host — they show up here with `attendeeName` / `attendeeEmail` set.

## Booking pages (`/api/booking-pages`, admin)

Shareable scheduling links (mirror of public lead-capture forms, ADR-012).

**Admin side** (`/api/booking-pages`, admin only): `{ name, slug, description?, durationMins, bufferMins?, hostPool?, availableDays?, startHour?, endHour?, timezone?, active? }`.
Slug is the public handle (`/b/<slug>`); the **host pool is a round-robin
list of user ids** (same pattern as lead routing) and persists a cursor.

**Public side** (`/api/public/booking/:slug` — no auth, honeypot +
per-IP rate limit):
- `GET /:slug` → page config (no slots).
- `GET /:slug/slots?date=YYYY-MM-DD` → slot starts for the day
  (`durationMins` + `bufferMins` windows within `startHour`–`endHour` on
  `availableDays`), each flagged `available` (already-booked windows are
  busy — computed from the page's meetings).
- `POST /:slug/book` `{ name, email, startsAt, notes?, company_name? (honeypot) }`
  → re-validates the slot server-side (guards double-booking), assigns the
  next round-robin host, creates the meeting (`meeting.scheduled` with
  `booking: true` + `booking.booked`). Returns `{ ok, booked, meetingId, hostId }`.

## Record timeline (auto-logging)

`GET /api/timeline?contactId=|accountId=|opportunityId=&limit=50` aggregates
**notes + emails + calls + meetings** against a record, newest first — the
record detail drawer renders it, so every send/call/booking is auto-logged
the moment it happens. (`deal fields` — win/lost reasons — shipped with
Phase 1/2-lite and show on the deal form.)

## Event catalog additions

See `docs/03-event-catalog.md` for the full table: `email.sent/received/replied/opened/clicked/deleted`,
`template.created/updated/deleted`, `call.completed/logged/deleted`,
`meeting.scheduled/completed/status_changed/deleted`, `booking.page_created/updated/deleted`,
`booking.booked`.

## Mock providers recap (ADR-014)

| Surface | Mock | Real swap point |
|---|---|---|
| Email send/sync/reply | `EMAIL_MOCK=1` queue | `comm.ts` provider helpers |
| Call recording/transcript | generated placeholders | telephony provider SDK |
| SSO providers | `OAUTH_MOCK=1` | real Google/GitHub (Phase 0) |

Everything else (storage, events, webhooks, timeline, UI) is already the real
implementation and is untouched by the provider swap.
