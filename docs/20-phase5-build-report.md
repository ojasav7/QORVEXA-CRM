# 20 · Phase 5 Build Report — Marketing Automation & Journey Orchestration

> What shipped to complete Phase 5 (the blueprint's "Marketing Automation &
> Journey Orchestration" phase) end-to-end, the decisions behind it, and the
> verification evidence. Spec: `docs/19-spec-phase5.md` · Decision: ADR-017 in
> `docs/08-decision-log.md`. Status overview in `PROGRESS.md`. All live checks
> below ran against the real server (`localhost:8787`, Mongo via Docker,
> freshly seeded demo org).

## What shipped

### 1. Campaigns — send-to-segment with A/B subjects + attribution (ADR-017)
- `Campaign` (org × environment, `ab` JSON config) + `CampaignRecipient` rows
  linking a contact + message to a campaign with its A/B `variant` and
  open/click state. Admin CRUD (`/api/campaigns`), reads open to any user.
- **Send** (`POST :id/send`, admin): resolves the audience from a **Phase-1
  dynamic Segment** (snapshot at send time, org + environment scoped), splits
  recipients A/B by `splitA` %, and writes one `Message` row per recipient
  through the Phase-2 email path — tracking token, `email.sent`, template
  `{{contact.*}}` merge — plus the `CampaignRecipient` link. Idempotency
  guard: a `sent` campaign refuses a second send without `force: true`.
- **Stats + ROI** computed on read from recipient/message rows (never stale):
  sent / opened / clicked, open & click rates, per-variant breakdown, and
  **ROI = sum of `won` deal amounts whose contact was a recipient** (v1
  first-touch-ish attribution model, documented in the spec §2).
- **A/B winner** — `POST :id/declare-winner` persists the winning variant and
  emits `campaign.winner_declared`. The open pixel (`/api/t/px/:token`) rolls
  opens/clicks up into the recipient + campaign counts as they happen.

### 2. Landing pages + public form capture
- `LandingPage` admin CRUD (`/api/landing-pages`, flag `marketing.landing`):
  headline/subtext/CTA/theme/fields config, optionally linked to a **Campaign**
  for attribution, **globally unique slug** (the public router is org-blind —
  same fix as Phase 4 portals, applied up front).
- **Public endpoints** (`/api/public/pages/:slug` + `/l/:slug` SPA route), no
  auth — the ADR-012 playbook applied:
  - `GET :slug` — public page config only (name, headline, CTA, theme, fields).
  - `POST :slug/submit` — creates a **routed lead** through the generic lead
    service (round-robin owner assignment) with `source: "Landing page"` and
    `campaignId` (attribution). Honeypot field (`website`) silently swallows
    bots; per-IP rate limit (20/min) guards abuse; **no-leak duplicates**
    report a fake success without revealing the lead exists.
  - Emits `form.submitted` + `intent.detected` **only when a lead is actually
    created** — a duplicate has no entityId, so the workflow/journey engines
    never fire against an empty record (post-review fix).

### 3. Journey orchestration engine (`server/lib/journeys.ts`)
- `Journey` (declarative row: trigger + ordered steps) + `JourneyEnrollment`
  (one per journey × entity, loop guard) + `JourneyStepRun` (per-step log).
- **Triggers**: event (`lead.created`, `contact.created`, `deal.created`,
  `deal.stage_changed`, `task.completed`, `ticket.created`,
  `ticket.status_changed`, `form.submitted`) or **segment membership**.
- **Steps**: `wait` (hours/days), `send_email` (template + `{{merge}}`),
  `notify` (in-app notification to the record's owner), `create_task`,
  `update_record`, `condition` (field filter → branch to a later step, else
  optional branch or exit), `end`. Steps run through the same helpers as
  workflows (generic object service, email path, Notification rows) so audit +
  events + tracking come along. Every step logs a `JourneyStepRun` and emits
  `journey.step_entered`.
- **Ticker**: a 60s `setInterval` advances enrollments whose `nextRunAt` is
  due (that's what gives `wait` its time dimension); `POST /api/journeys/advance`
  (admin) runs a manual pass for deterministic tests. **Claim guard**: each due
  enrollment is claimed with a conditional update before advancing, so two
  concurrent passes can't double-run a step (post-review fix).
- **Test endpoint** `POST :id/test` (admin) — synchronous run against a real
  contact, waits treated as zero-delay; returns per-step outcomes.
- Completes emit `journey.completed`; re-enrollment after completion reopens a
  fresh run (fresh leads re-enroll, loop guard only blocks active runs).

### 4. Deliverability monitoring (flag `marketing.deliverability`)
- `/api/deliverability` — metrics computed from `Message` rows (sent / opened /
  click / bounce rates, unsubscribes, complaints, a 0–100 health score, status
  grades) plus a recent-messages feed.
- `POST /api/deliverability/simulate` (admin) — simulated mock-provider events
  (bounce / unsubscribe / complaint, ADR-014) that mark the message and emit
  `email.bounced` / `email.unsubscribed` / `email.complained`.

### 5. Workflow integration + event catalog
- The Phase 3 engine's trigger catalog gained **`form.submitted`**
  (`EVENT_OBJECT_TYPES` + `TRIGGER_EVENTS` + Workflows-page builder list) so
  admins can automate landing submissions (e.g. notify the owner).
- Event catalog additions: `campaign.created/updated/deleted/sent/winner_declared`,
  `landing.created/updated/deleted`, `form.submitted`, `intent.detected`,
  `journey.created/updated/deleted/enrolled/step_entered/completed`,
  `notification.created` (journey kind), `email.bounced/unsubscribed/complained`.

### 6. UI — five pages (four admin + one public)
- **Campaigns** (`/campaigns`): cards with status, audience segment, sent/open/
  ROI stats, A/B config + winner badge; create/send/declare-winner modals,
  recipients drawer.
- **Landing Pages** (`/landing-pages`): page cards with the public `/l/<slug>`
  link, create/edit modal (theme picker, CTA, campaign link), active toggle.
- **Journeys** (`/journeys`): journey cards with trigger label + step count +
  enrolled count; a step-list builder modal (add/reorder the seven step
  types), run history, test-run, manual advance.
- **Deliverability** (`/deliverability`): health score ring, rate tiles, status
  grades, recent messages, simulate buttons.
- **Public landing** (`/l/<slug>`, no auth): themed headline/subtext + dynamic
  field form rendering the page's field config.
- All admin pages + nav links are feature-gated (`marketing.campaigns`,
  `marketing.journeys`, `marketing.landing`, `marketing.deliverability` —
  default-on, so they appear in Settings → Feature flags). A new **Marketing**
  nav section groups them.

### 7. Seed
- A contact segment ("All prospects" — `status in [new, contacted, qualified]`),
  the "Q3 Product Update" campaign (sent, A/B subjects, winner A, 3 recipients
  with open/click state), the "Book a demo" landing page (`/l/demo`, linked to
  the campaign), the "New lead welcome" journey (wait → send_email → notify →
  end, event-triggered on `lead.created`), and deliverability state (a bounced
  message) — so every Marketing page has data on first login.

## Decisions (ADR-017)

Campaigns and journeys are **declarative rows consumed by engine subscribers**
(same philosophy as ADR-015 workflows): data, not code — no deploy per
campaign/journey. Campaign sends **reuse the Phase-2 email path** (tracking +
events for free) and write per-recipient links for attribution; ROI is a v1
first-touch model (sum of won deals on recipient contacts). Journeys extend
workflows with **time**: the 60s ticker advances `wait` steps, and every step
logs a `JourneyStepRun` (the journey's run log). Public capture follows the
**ADR-012 playbook** (honeypot + rate limit + no-leak duplicates). See
`docs/19-spec-phase5.md` §2 for the full rationale.

## Bugs found & fixed during verification

1. **Segment array filters matched nothing** — `normalizeValue` in
   `segments.ts` called `String()` on array values, collapsing
   `["new","contacted","qualified"]` into `"new,contacted,qualified"`, so any
   `in`-op criteria (like the seeded "All prospects" audience) returned zero
   members and campaign sends failed with "no members". Fixed: arrays are
   normalized element-wise and stay arrays.
2. **`campaignId` attribution was dropped** — the landing route put it in
   `custom.campaignId`, but the object service treats `custom` as a reserved
   key and drops unknown custom fields. Fixed: `campaignId` is now a **core
   Lead field** (registry + schema column + index); the route sets it directly.
3. **Verify-script backdate probe couldn't resolve `@prisma/client`** — the
   probe file was written to `/tmp`, where node/tsx can't find the project's
   module graph, so the journey-advance test silently never backdated. Fixed:
   the probe now lives in `server/scripts/` (deleted after the run).
4. **Verify-script open-count check re-parsed a Python dict repr as JSON** —
   `jget "['stats']"` prints Python `{'key': ...}` (single quotes), and the
   follow-up `json.load` on it always threw. Fixed: the check reads
   `['stats']['opened']` straight from the API response.
5. **Em-dash subjects mangled by curl on Windows** — the A/B `subjectB`
   containing `—` (em dash) was corrupted in transit through Git-Bash/curl, so
   the variant-B grep failed. The smoke suite now uses an ASCII-safe subject.
6. **Landing slugs were only unique per org** (post-review) — the public
   loader looks a page up by slug with no org context, so a per-org check let
   a second tenant shadow a page. Slug uniqueness is now **global**, exactly
   like the Phase 4 portal fix.
7. **`form.submitted` fired on no-leak duplicates** (post-review) — the event
   was emitted with `entityId: ""`, so a `form.submitted` workflow could fire
   against an empty record. The route now emits it only when a lead is created.
8. **Journey ticker had a double-run race** (post-review) — two concurrent
   advance passes could both read an enrollment as due and run its next step.
   Each enrollment is now **claimed** (conditional `nextRunAt` sentinel update)
   before advancing; the step execution overwrites the sentinel.
9. **`audience-preview` leaked member PII to reps** (post-review) — the
   endpoint resolved the full org audience; it is now admin-only (matching the
   admin-gated send) and passes the real actor id.

## Verification evidence

- `npm run typecheck` ✅ · `npm run build` ✅ (production bundle, `dist/`).
- **Live smoke suite (`verify-phase5.sh`, 65/65 green):**
  - Campaigns: create (draft), validation 400, rep write 403 / read 200,
    **send to 58 recipients** with A/B split (variant B recipients + subject),
    status → sent, resend blocked, `campaign.sent` emitted, recipients listed.
  - Tracking: open pixel rolled up into campaign stats (opened=1); A/B winner
    declared (B) + `campaign.winner_declared`; **attributed ROI counts a won
    deal** ($42k) on a recipient contact.
  - Landing pages: CRUD + global-slug 400, rep 403, public config, honeypot
    fake success, **public submit → routed lead with source "Landing page" +
    campaignId**, `form.submitted` + `intent.detected`, no-leak duplicate,
    unknown slug 400.
  - Journeys: CRUD + validation (unknown step 400, condition-to-self 400,
    rep 403), **event-trigger enrollment on `lead.created`** → wait → backdated
    advance → send_email/notify/end steps logged → **completed** +
    `journey.completed`; loop guard allows fresh re-enrolls; test endpoint
    runs synchronously.
  - Deliverability: metrics endpoint, simulated bounce marks the message +
    `email.bounced` + reflected in metrics, rep simulate 403 / read 200.
  - **Workflow on `form.submitted` fired end-to-end** (runCount=1).
  - Feature gates: disabling `marketing.campaigns` / `marketing.journeys` /
    `marketing.landing` 403s the APIs; re-enable restores 200; **public
    landing unaffected** by the admin flag.
  - Sandbox isolation: a sandbox campaign is invisible in production and
    visible in sandbox.
  - Cleanup: smoke campaigns/landings/journeys/workflows/leads/deals deleted;
    demo data left pristine.
- **Regressions on the same stack:** `verify-phase4.sh` 61/61,
  `verify-phase3.sh` 34/34, `verify-phase2-comm.sh` 45/45,
  `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 — all green (the segment
  fix touches Phase-1 code, so Phase 1 re-verified).
- **Browser check** (login → Marketing nav → Campaigns card with stats →
  Landing Pages → Journeys with step counts → Deliverability health →
  public `/l/demo` headline + form): all rendered, zero console errors.

## Docs updated

`docs/19-spec-phase5.md` (spec, new), `docs/20-phase5-build-report.md` (this
report), `docs/03-event-catalog.md` (Phase 5 events), `docs/05-api-reference.md`
(Campaigns / Landing pages / Journeys / Deliverability sections + Phase 3
trigger-catalog update), `docs/08-decision-log.md` (ADR-017), `PROGRESS.md`
(Phase 5 → ✅ 100%), `docs/06-roadmap.md` (Phase 5 → ✅ shipped), `README.md`
(Phase 5 feature list).
