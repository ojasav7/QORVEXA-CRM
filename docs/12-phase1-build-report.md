# 12 · Phase 1 Build Report — Core CRM completion

> What shipped to take Phase 1 from ~85% to **100%**, the decisions behind it, and the
> verification evidence. Companion to `docs/11-phase0-build-report.md` (Phase 0) and
> `PROGRESS.md` (the 16-phase overview). All live checks below ran against the real
> server (`localhost:8787`, Mongo via Docker, seeded demo org).

## What shipped (5 workstreams + wiring)

### 1. Lead routing — admin round-robin pool, manual override at any time
- Config `Organization.settings.leadRouting` (`{ mode: "manual" | "round-robin", pool, cursor }`) via Settings → Lead routing.
- New leads **without an explicit owner** cycle through the pool's **active** users (inactive skipped); the cursor is persisted so rotation survives restarts.
- **Explicit `ownerId` always wins** on create (and does *not* consume a round-robin slot); PATCH `ownerId` reassigns at any time. Both restricted to `admin`/`manager` — reps get a 403 (routing or themselves).
- Owner changes emit `lead.routed` with `mode: "round-robin"` or `"manual"` (event-catalog §Phase 1).
- Implemented as a config hook on the generic object service (`registerObject({ type: "lead", assignOwner, routedEvent })`) — new algorithms plug in behind the same hook.

### 2. Account hierarchy UI
- `parentId` on accounts (field existed) + **cycle guard** (setting a parent to your own descendant → 400; self-parent → 400) enforced in the service layer on create and update.
- `parentId_label` hydration on list/detail; **Accounts → Hierarchy** tree page (expand/collapse, count + pipeline sum per node); parent picker in the account form.

### 3. Segments — dynamic lists as a first-class entity
- `Segment` model (org × environment, criteria JSON, active) + `server/lib/segments.ts` criteria parser/compiler.
- CRUD (`/api/segments`) with **live member counts** computed on read (criteria → scoped query, org + environment + visibility); `GET /api/segments/:id/members` paginated with `ownerName`.
- **Segments page** with a filter builder (field/op/value rows, add/remove) and live count preview; nav item + Settings not needed (reads open to all roles, writes admin-only).

### 4. Public lead-capture forms
- `LeadForm` model (admin-managed: name, slug, fields — must be real lead core fields, submitLabel, active) + Settings → Lead capture tab with **embed snippet**.
- Public `GET /api/public/forms/:slug` (config) and `POST /api/public/forms/:slug/submit` — **no auth by design**, protected by:
  - a hidden honeypot field (`company_website`) that silently swallows bots,
  - a per-IP rate limit (10/min),
  - duplicate emails → `{ ok: true, duplicate: true }` **without leaking existence**,
  - inactive forms → 400.
- Submissions act as a system actor (the form id) in the org's production env → created leads flow through normal duplicate detection **and round-robin routing**, with `source: "Website"` + a `lead.captured` event. Standalone page at `/forms/:slug` renders the form from the public config.

### 5. Duplicate merge UI
- `POST /api/merge` — `{ objectType, masterId, mergeId, fieldChoices? }`; per-field choice of which record wins (default master); merge record deleted; `<type>.merged` (`via: "records"`) + audit rows.
- UI on list pages: select two records → merge dialog with per-field picker and live preview of the result.

### Wiring
- Routes mounted (`/api/segments`, `/api/lead-forms`, `/api/public`, `/api/merge`), client routes (`/segments`, `/accounts/hierarchy`, `/forms/:slug`), nav items, Settings tabs, and `parentId` in the account registry.

## Decisions (user-confirmed)
- **Routing:** "full authority to admin whom he can assign, and also give all the algorithms required like round robin" → admin/manager-only assignment + round-robin pool (ADR-010).
- **Merge UI:** included (ADR-011).

## Bugs found & fixed during verification
The live smoke suite caught **three real bugs** — all fixed and re-verified:

1. **Explicit `ownerId` was silently dropped** — `splitFields()` routes unknown keys (ownerId isn't a core/custom field) to the custom-field registry, so explicit owners never won and PATCH reassignment was broken. Fixed by special-casing the owner field in `create`/`update` (explicit owner wins, `lead.routed { mode: "manual" }` on reassign, rep → 403).
2. **Public forms missed dedupe + routing** — `public-leads.ts` built its object service at module load, *before* `index.ts` ran `registerObject(...)`, so the lead config (uniqueFields/assignOwner) was absent: duplicate submissions created a second lead and routed owners were ignored (lead owner defaulted to the form id). Fixed by creating the service lazily per request.
3. **Zod `.default()` leaked through `.partial()` on PATCH** — a `PATCH {"active": false}` silently reset `submitLabel` to the default; the same hazard existed on segment `criteria`/`active` and custom-field `required`/`options`. Fixed across `lead-forms.ts`, `segments.ts`, `fields.ts` (no defaults in PATCH-facing schemas; defaults applied explicitly at create). Documented as an engineering rule in `docs/08-decision-log.md`.

## Verification evidence
- `npm run typecheck` (tsc --noEmit) ✅ · `npm run build` ✅ (production bundle).
- **Live smoke suite (curl, real server):**
  - Round-robin: leads 1→priya, 2→leo (full-id assertions); explicit owner wins and doesn't consume a slot; PATCH reassign works; `lead.routed` emits `mode: "manual"`; rep `ownerId` write → 403.
  - Public form: create → public config (no auth); submit → lead created with `source: "Website"` + **routed owner** (not the form id); duplicate email → `duplicate: true` and only **one** lead in the DB; honeypot swallowed; inactive form → 400.
  - Segments: `score >= 50` on seeded leads → live `memberCount: 3`; members endpoint returns them with `ownerName`; unknown field → 400.
  - Hierarchy: parent/grandchild set; cycle → 400; self-parent → 400; `parentId_label` hydrated.
  - Merge: master wins title, merge wins phone per `fieldChoices`; merge record deleted (404); `contact.merged` `via: "records"` event emitted.
  - PATCH-default regression checks (post-fix): form label/segment criteria/custom-field `required` all survive partial PATCHes.
- **Demo data left pristine:** 5 contacts / 4 leads / 4 accounts, sandbox empty, 0 segments / 0 forms / 0 leftover tokens.

## Docs updated
`PROGRESS.md` (Phase 1 → 100%), `docs/06-roadmap.md`, `docs/03-event-catalog.md` (lead.routed/captured, leadform.*, segment.*, merge via records), `docs/05-api-reference.md` (routing, segments, lead forms, public forms, merge), `docs/08-decision-log.md` (ADR-010/011/012 + the Zod-default engineering rule), `README.md`.
