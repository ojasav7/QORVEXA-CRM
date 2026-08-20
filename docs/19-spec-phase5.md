# 19 · Technical Spec — Phase 5: Marketing Automation & Journey Orchestration

> Implementation-ready spec for Phase 5 (the blueprint's "Marketing Automation
> & Journey Orchestration"): **campaigns** (email with A/B variants, sent to
> dynamic segments, with open/click tracking and **attributed ROI**),
> **landing pages / forms** (public, no-auth, honeypot + rate limited,
> feeding routed leads), the **customer journey orchestration engine**
> (event → context → decision → action → observe loop over the event bus,
> with wait steps advanced by a ticker), and **deliverability monitoring**
> (computed from the email infra, with a mock provider seam per ADR-014).
> Audience: future-you or an AI agent building this next. Companion reports:
> `docs/20-phase5-build-report.md` (verification evidence).

---

## 1. Goal

Let an org run full-funnel marketing from the same platform as sales:
marketers compose **campaigns** targeted at **dynamic segments** (Phase 1),
send them through the existing email infra (tracking + events for free),
**A/B test** subject lines and declare a winner by open rate, publish
**landing pages** that capture routed leads and attribute them back to a
campaign, and orchestrate **customer journeys** — a sequence of waits and
actions (send email, notify, create task, update record, branch on
conditions) that a contact walks through after a triggering event. A
**deliverability** page turns the org's email data into health metrics.

**Done** = an admin can: build + send a campaign to a segment (with A/B
subjects) and see sent/opened/clicked + attributed revenue; publish a
landing page at `/l/<slug>` that creates routed leads; build a journey
(`lead.created` → wait 24h → welcome email → notify owner) that actually
runs on the event bus with a run log; and read deliverability health with
simulated bounce/complaint data (mock provider, ADR-014).

**Non-goals (deferred):** SMS/WhatsApp/push/popup delivery (channels are
data fields v1 — same mock-provider trade-off as ADR-014; email is the
implemented channel), real-time wait precision (the ticker advances waits at
a fixed interval — see §2), journey visual canvas (v1 is a structured step
list builder), deliverability provider data (bounces/complaints are
simulated; the metrics pipeline is real).

---

## 2. Architecture decision (recorded as ADR-017)

### ADR-017 · Campaigns/Journeys/Landing pages are config entities; journeys are a ticker-driven engine over the event bus

**Decision:**

- **Config entities, not generic objects.** `Campaign`, `LandingPage`, and
  `Journey` follow the `Segment` / `Automation` / `BookingPage` pattern:
  dedicated Prisma models + routers, org × environment scoped, admin writes.
  They are *plans*, not *records* — the records they touch (contacts,
  messages, leads, enrollments) stay generic objects. This matches ADR-003
  (no per-feature tables for record data) while keeping config where it has
  its own semantics.
- **Campaign send = segment membership → messages.** `sendCampaign` resolves
  the audience from a `Segment` (Phase 1 dynamic lists, live member counts),
  splits it by A/B variant, and writes one `Message` row per recipient
  through the existing email send path (tracking token, open/click tracking,
  `email.sent`). A `CampaignRecipient` row links variant + message to the
  campaign so open/click events roll up into campaign stats. **Attribution:
  ROI = sum of `won` deal amounts whose linked contact was a recipient of
  the campaign** (first-touch-ish, v1; documented in the attribution model
  reference).
- **Journeys = declarative rows + a ticker.** A `Journey` holds a trigger
  (an event, or entry when a contact joins a segment) and an ordered
  `steps` array. The engine (`server/lib/journeys.ts`) subscribes to the
  event bus (`onEvent("*")`) like workflows (ADR-015) and enrolls the
  triggering record; a **ticker** (`setInterval`, 60s in v1) advances
  enrollments whose `nextRunAt` is due, executing `wait` → action steps and
  logging each to `JourneyStepRun`. Step actions (`send_email`, `notify`,
  `create_task`, `update_record`) reuse the exact helpers from the workflow
  engine + comm layer, so audit/events/tracking come along. Loop protection:
  one active enrollment per (journey, entity); completing/exiting closes it.
- **Deliverability = derived metrics + mock provider events.** The
  deliverability endpoint computes sent/opened/clicked/bounce/complaint
  rates from `Message` rows (new `bouncedAt` / `unsubscribedAt` fields) —
  the metrics pipeline is real; the *events* (a message bouncing, a spam
  complaint, an unsubscribe) are simulated endpoints, exactly the ADR-014
  shape (mock provider behind a documented seam).
- **Feature-gated** — `marketing.campaigns`, `marketing.landing`,
  `marketing.journeys`, `marketing.deliverability` (all default-on) gate
  the APIs and nav like every prior phase.

**Why:** the event bus + generic object service + segment engine + email
infra are the stated substrate; this composes them rather than duplicating.
Journeys specifically need a time dimension the pure event-driven workflow
engine lacks, hence the ticker — which is also the documented upgrade path
to a queue worker.

**Cost/risk:** the ticker is in-process (resets on restart, 60s granularity)
— accepted v1, same spirit as ADR-009-A/015; campaign sends loop over the
segment synchronously (fine at Phase-0–5 scale); attribution is
campaign-to-deal-through-contact only in v1.

---

## 3. Data model changes (`prisma/schema.prisma`)

| Model | Shape | Notes |
|---|---|---|
| 🆕 `Campaign` | `orgId`, `environment`, `name`, `description?`, `status` (`draft \| active \| paused \| sent`), `channel` (`email` v1), `subject`, `body`, `templateId?`, `audienceSegmentId?`, `ab` Json (`{ enabled, splitA, subjectB }`), `winner` (`A \| B \| null`), `sendAt?`, `sentCount`, `openedCount`, `clickedCount`, `createdBy`, timestamps | A/B subjects live in `ab.subjectB`; `subject` is variant A. Counts are rollups from `CampaignRecipient` (+ kept on the row for cheap list display). |
| 🆕 `CampaignRecipient` | `orgId`, `environment`, `campaignId`, `contactId`, `messageId?`, `variant` (`A \| B`), `status` (`sent \| opened \| clicked`), `openedAt?`, `clickedAt?` | One row per sent message — the per-recipient attribution + A/B comparison surface. |
| 🆕 `LandingPage` | `orgId`, `environment`, `name`, `slug` (public handle), `headline`, `subtext?`, `ctaLabel`, `successMessage`, `theme` (`indigo \| emerald \| rose \| amber \| slate`), `campaignId?`, `fields` Json (lead core-field subset), `active`, timestamps | Same shape philosophy as `LeadForm`; the public page at `/app/l/:slug` (root `/l/:slug` redirects) posts to the no-auth intake. |
| 🆕 `Journey` | `orgId`, `environment`, `name`, `description?`, `trigger` Json (`{ kind: "event", event: "lead.created" }` or `{ kind: "segment", segmentId }`), `steps` Json (`[{ type, ... }]`), `active`, `enrolledCount`, `createdBy`, timestamps | Steps: `wait` (hours/days), `send_email`, `notify`, `create_task`, `update_record`, `condition` (branch), `end`. |
| 🆕 `JourneyEnrollment` | `orgId`, `environment`, `journeyId`, `entity`, `entityId`, `currentStep` (index), `status` (`active \| waiting \| completed \| exited`), `enteredAt`, `nextRunAt?`, `completedAt?` | One active row per (journey, entity). `waiting` means the ticker will advance it. |
| 🆕 `JourneyStepRun` | `orgId`, `environment`, `journeyId`, `enrollmentId`, `stepIndex`, `stepType`, `status` (`ok \| skipped \| failed`), `detail?`, `createdAt` | The journey run log (conflict-resolution surface, like `AutomationRun`). |
| ✏️ `Message` | + `bouncedAt?`, `unsubscribedAt?` | Deliverability state — additive, nullable; no backfill needed. |

**Migration warning (Mongo):** `prisma db push` adds new collections + two
nullable Message fields — existing data untouched.

### Journey step catalog (v1)

| Step | Shape | Behavior |
|---|---|---|
| `wait` | `{ type: "wait", hours?: number, days?: number }` | Sets `nextRunAt`; enrollment → `waiting` until the ticker advances it. |
| `send_email` | `{ type: "send_email", templateId, subject?, body? }` | Sends to the contact via the email path (tracking + `email.sent`); template merged against the contact/lead. |
| `notify` | `{ type: "notify", title, body?, target: "owner" }` | In-app notification to the record owner. |
| `create_task` | `{ type: "create_task", title, description?, dueInDays?, priority? }` | Task owned by the record owner, linked to the record. |
| `update_record` | `{ type: "update_record", field, value }` | Sets a core field via the generic service (events + audit free). |
| `condition` | `{ type: "condition", field, op, value, thenIndex, elseIndex? }` | Branch to `thenIndex` (or `elseIndex`); non-matching without else → exits. |
| `end` | `{ type: "end" }` | Completes the enrollment. |

---

## 4. API changes

Flags: `marketing.campaigns`, `marketing.landing`, `marketing.journeys`,
`marketing.deliverability` (all default-on).

### Campaigns (`/api/campaigns`, flag `marketing.campaigns`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/campaigns` | Any | `{ items: [{ id, name, status, subject, ab, winner, audienceName, sentCount, openedCount, clickedCount, openRate, createdAt }] }` — audience name + rates computed. |
| POST | `/api/campaigns` | Admin | `{ name, description?, subject, body, templateId?, audienceSegmentId?, ab?, sendAt?, status? }`. Emits `campaign.created`. |
| GET | `/api/campaigns/:id` | Any | Single campaign + `stats` (`{ sent, opened, clicked, openRate, clickRate, roi, wonDealIds }`). |
| PATCH | `/api/campaigns/:id` | Admin | Partial update (PATCH semantics — no `.default()`s). Emits `campaign.updated`. |
| DELETE | `/api/campaigns/:id` | Admin | Emits `campaign.deleted`. |
| POST | `/api/campaigns/:id/send` | Admin | Sends now: resolves the segment audience, writes per-recipient `Message` + `CampaignRecipient` rows (A/B split by `ab.splitA`), bumps counts, status → `sent`. Emits `campaign.sent` + `email.sent` per recipient. Returns `{ sent, recipients }`. |
| POST | `/api/campaigns/:id/declare-winner` | Admin | `{ variant: "A" \| "B" }` — sets `winner` by open rate (or force). Emits `campaign.winner_declared`. |
| GET | `/api/campaigns/:id/recipients` | Any | Paginated recipient rows with contact name + status. |

### Landing pages (`/api/landing-pages`, flag `marketing.landing`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/landing-pages` | Any | List. |
| POST | `/api/landing-pages` | Admin | `{ name, slug, headline, subtext?, ctaLabel, successMessage?, theme?, campaignId?, fields?, active? }`. Slug unique per org × env. Emits `landing.created`. |
| PATCH | `/api/landing-pages/:id` | Admin | Partial update. Emits `landing.updated`. |
| DELETE | `/api/landing-pages/:id` | Admin | Emits `landing.deleted`. |
| GET | `/api/public/pages/:slug` | **none** | Public config `{ name, headline, subtext, ctaLabel, theme, fields }` — 400 when inactive/unknown. |
| POST | `/api/public/pages/:slug/submit` | **none** | Honeypot + per-IP rate limit (ADR-012). `{ firstName, lastName, email, phone?, company?, website? (honeypot) }` → creates a **routed lead** (`source: "Landing page"`, `campaignId` tagged via `custom` when the page is linked) → `{ ok, duplicate, leadId?, reference? }`. Emits `form.submitted` + `lead.captured` + `intent.detected`. |

### Journeys (`/api/journeys`, flag `marketing.journeys`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/journeys` | Any | `{ items: [{ id, name, trigger, steps, active, enrolledCount }] }`. |
| POST | `/api/journeys` | Admin | `{ name, description?, trigger, steps?, active? }`. Validates trigger + step types/fields (400 on unknown). Emits `journey.created`. |
| GET | `/api/journeys/:id` | Any | Single journey. |
| PATCH | `/api/journeys/:id` | Admin | Partial update (same validation). Emits `journey.updated`. |
| DELETE | `/api/journeys/:id` | Admin | Emits `journey.deleted`. |
| GET | `/api/journeys/:id/enrollments` | Any | Enrollment list (status, currentStep, nextRunAt). |
| GET | `/api/journeys/:id/runs` | Any | `JourneyStepRun` log, newest first. |
| POST | `/api/journeys/:id/test` | Admin | `{ entityId }` — enrolls + runs the journey synchronously against a real record (no waits honored; `triggeredBy: "test"`). Returns the step outcomes. |
| POST | `/api/journeys/advance` | Admin | Runs one ticker pass manually (advances due `waiting` enrollments). Returns `{ advanced }`. |

### Deliverability (`/api/deliverability`, flag `marketing.deliverability`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/deliverability` | Any | Org-level metrics from `Message` rows: `{ sent, opened, openedRate, clicked, clickedRate, bounced, bounceRate, unsubscribed, complaints, health: 0–100, grades: { per-status counts } }` (current environment). |
| POST | `/api/deliverability/simulate` | Admin | `{ messageId, kind: "bounce" \| "unsubscribe" \| "complaint" }` — mock provider event (ADR-014). Marks the message + emits `email.bounced` / `email.unsubscribed` / `email.complained`. |

### Events emitted (v1)

`campaign.created / updated / deleted / sent / winner_declared`,
`landing.created / updated / deleted`, `form.submitted`, `intent.detected`,
`journey.created / updated / deleted / enrolled / step_entered /
completed`, `email.bounced / unsubscribed / complained`.

### Workflow engine integration (Phase 3)

New trigger: **`form.submitted`** (entity `lead`) — a landing-page
submission is automatable like any object ("landing page form submitted →
notify the sales owner"). Journey triggers are *separate* from workflow
triggers (they can fire on any event the bus carries).

---

## 5. UI changes (`src/`)

| Surface | What |
|---|---|
| New page **Campaigns** (`/campaigns`, flag `marketing.campaigns`) | Card grid: name, status chip, audience, A/B badge, stats (sent/opened/clicked + open rate), ROI. **Builder modal** (name, audience segment select, subject + optional B subject + split slider, body, template). **Send button**, **declare winner** (by computed open rate). Recipients drawer. |
| New page **Landing pages** (`/landing`, flag `marketing.landing`) | Cards with theme color + slug + `/l/:slug` link. **Builder modal** (name, slug, headline, subtext, CTA, success message, theme picker, campaign link, field toggles). |
| New public page **Landing** (`/l/:slug`, no auth) | Renders the headline/subtext + themed form (honeypot hidden) → success screen; mirrors public booking/portal page discipline. |
| New page **Journeys** (`/journeys`, flag `marketing.journeys`) | Card grid with trigger badge + enrolled count. **Builder modal**: trigger select (event list / segment), **step list editor** (add wait/send_email/notify/create_task/update_record/condition/end with per-type fields), reorder/remove. Enrollments + run-log drawer, test modal, "Advance" button. |
| New page **Deliverability** (`/deliverability`, flag `marketing.deliverability`) | Health score ring, metric cards (sent/opened/clicked/bounce/unsubscribed/complaints + rates), recent messages, simulate buttons (bounce/unsubscribe/complaint). |
| Nav | New "Marketing" section: **Campaigns**, **Landing**, **Journeys**, **Deliverability** (feature-gated). |
| Settings → Feature flags | The four `marketing.*` flags appear automatically. |

---

## 6. Edge cases & risks

1. **Audience = segment member snapshot.** `send` resolves members once at
   send time; later segment changes don't retro-apply. Reps see stats only
   for the environment they're in (ADR-008).
2. **A/B split stability.** Recipients are assigned variant by alternating
   index (`i % 100 < splitA`), so the split is deterministic for the same
   audience order — rerunning a send isn't possible (idempotency guard:
   sending a `sent` campaign → 400 unless `force: true`).
3. **Journey loops.** One active enrollment per (journey, entity); a journey
   that re-triggers on the same record skips (already enrolled). `condition`
   branches are index-checked at save; a bad branch → step run `failed` +
   enrollment `exited` (never an infinite loop).
4. **Wait precision.** The ticker advances waits at a fixed interval (60s
   v1); a `wait` is a `nextRunAt` deadline, not a realtime timer — a smoke
   test can backdate `nextRunAt` and call `POST /advance` for determinism.
5. **Public landing abuse.** Honeypot + per-IP rate limit (20/min) +
   no-leak duplicate handling — same discipline as public leads/booking
   (ADR-012). Campaign attribution is tagged on the lead's `custom` field,
   never exposed publicly.
6. **Deliverability is derived.** Rates are computed from `Message` rows on
   read (never stale); bounce/unsubscribe/complaint are simulated provider
   events (ADR-014) that write the real state.
7. **Tenant isolation.** Every new query is org × environment scoped;
   sandbox campaigns/journeys never fire on production events (same
   `onEvent("*")` filtering as workflows).

---

## 7. Acceptance criteria

- [ ] Campaign CRUD + validation; send resolves the segment audience, writes
      per-recipient Message + CampaignRecipient rows with A/B split, emits
      `campaign.sent`, bumps counts; re-sending a sent campaign → 400.
- [ ] A/B: `ab.subjectB` renders in recipients; `declare-winner` by open
      rate (and force); `winner` persisted + `campaign.winner_declared`.
- [ ] Stats + ROI: opened/clicked rates computed; `roi` = sum of `won` deal
      amounts whose contact is a campaign recipient; recipients list works.
- [ ] Landing page CRUD (slug unique per org × env); public GET 400 when
      inactive; public submit → routed lead (`source: "Landing page"`,
      campaign tagged) + `form.submitted` + `lead.captured` + `intent.detected`;
      honeypot swallowed; rate limit 400; duplicate → no-leak `{ ok, duplicate }`.
- [ ] Journey CRUD + step validation (400 on unknown step type / bad branch);
      `lead.created` trigger enrolls a real lead; `wait` → `waiting` +
      `nextRunAt`; `POST /advance` advances due enrollments and executes
      subsequent steps (`send_email` creates a Message, `notify` a
      Notification, `create_task` a task, `update_record` patches the
      record, `condition` branches); steps log to `JourneyStepRun` +
      `journey.step_entered`; completion closes the enrollment; re-trigger
      while active is skipped.
- [ ] `POST /journeys/:id/test` runs synchronously against a real record.
- [ ] Deliverability: metrics computed; simulate bounce/unsubscribe/complaint
      marks the message + emits the event; rates update.
- [ ] Workflows can trigger on `form.submitted`.
- [ ] Reps get 403 on campaign/landing/journey/deliverability-simulate
      writes; reads open.
- [ ] Feature gates: disabling `marketing.campaigns` / `landing` /
      `journeys` / `deliverability` 403s the respective APIs; sandbox rows
      never leak into production.
- [ ] `npm run typecheck` + `npm run build` pass; `verify-phase5.sh` green;
      regressions `verify-phase4.sh` (61), `verify-phase3.sh` (34),
      `verify-phase2-comm.sh` (45), `verify-phase2.sh` (29),
      `verify-phase1.sh` (30) stay green.
- [ ] Docs updated: event catalog, API reference, ADR-017, PROGRESS,
      roadmap, README, runbook.

---

## Suggested implementation order (one developer)

1. **Models:** Campaign, CampaignRecipient, LandingPage, Journey,
   JourneyEnrollment, JourneyStepRun + Message `bouncedAt`/`unsubscribedAt`
   → `db push` (~0.5 day).
2. **Engine:** `server/lib/campaigns.ts` (send/AB/stats/ROI) +
   `server/lib/journeys.ts` (enroll/advance/step execution/ticker)
   (~1.5 days).
3. **Routes:** campaigns, landing-pages + public intake, journeys,
   deliverability (~1.5 days).
4. **Wiring:** index.ts mounts + feature flags + workflow `form.submitted`
   trigger + event catalog (~0.25 day).
5. **UI:** Campaigns, Landing pages, public Landing page, Journeys,
   Deliverability + nav + App routes (~2 days).
6. **Seed:** campaign with A/B + recipients, landing page, a journey,
   deliverability message state (~0.5 day).
7. **Docs & verification:** event catalog, API reference, ADR-017, PROGRESS,
   roadmap, README; `verify-phase5.sh` + full regression pass (~1 day).
