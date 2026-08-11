# 13 · Phase 2-lite Build Report — Multi-pipeline engine

> What shipped to bring the first Phase 2 capability (the blueprint's
> "Multi-pipeline engine") live, the decisions behind it, and the verification
> evidence. Companion to `docs/12-phase1-build-report.md`; status overview in
> `PROGRESS.md`. All live checks below ran against the real server
> (`localhost:8787`, Mongo via Docker, seeded demo org).

## What shipped

### 1. Pipeline data model + per-org config
- `Pipeline` model (org × environment scoped, ADR-008) with `name`, `isDefault`,
  and `stages` as a JSON array (`{ key, label, probability, order }`) — the
  MongoDB/no-relations convention (same collapse as `LeadForm.fields`).
- The org's **default** pipeline is lazily seeded from the static registry
  `PIPELINE` on first access (`ensureDefaultPipeline`) — existing orgs and new
  orgs both get a working "Sales" pipeline with zero migrations; the registry
  stays as the seed source, not a runtime authority.
- Seed creates the default "Sales" pipeline + a "Renewals" demo pipeline (with
  its own stages/probabilities) and stamps deals onto them.

### 2. Pipeline CRUD API — `/api/pipelines`
- Reads open to any authenticated user (board + form need them); writes
  admin-only (`requireRole("admin")`).
- POST (create; first pipeline becomes default automatically), PATCH (rename,
  replace stages wholesale, or `{ isDefault: true }` which demotes the current
  default), DELETE with **guards**: cannot delete the default pipeline, the only
  pipeline, or a pipeline that still has deals.
- Stage keys auto-slugified from labels, validated unique + lowercase pattern;
  probability clamped 0–100.
- Emits `pipeline.created` / `pipeline.updated` / `pipeline.deleted` + audit rows.

### 3. Pipeline-aware deals
- `Opportunity.pipelineId` (ObjectId, NULL = the org's default pipeline).
- The generic object service gained a `resolveDeal` config hook (same pattern as
  Phase 1's `assignOwner`): on create/update it resolves pipeline (explicit →
  else default), validates the stage exists in that pipeline (400 otherwise),
  and **derives probability from the pipeline's stage definition** — replacing
  the old registry-global `stageProbability()` for deals.
- Moving a deal between pipelines (`PATCH { pipelineId }`) keeps a valid stage,
  re-derives probability, and emits `deal.pipeline_changed { from, to }`.
- `GET /api/opportunities?pipelineId=<id>` filters the board; filtering by the
  default pipeline also returns legacy `null`-pipeline deals.
- `pipelineId_label` hydrated on deal rows (relations mechanism).

### 4. Deals board — pipeline switcher + per-pipeline columns
- Chip switcher: default pipeline + each custom pipeline (with live deal counts).
- Columns come from the selected pipeline's stages (label + probability +
  color); drag-drop moves emit `deal.stage_changed` as before.
- New-deal modal picks pipeline (defaults to the active board) + stage from that
  pipeline's stages.

### 5. Settings → Pipelines tab
- List pipelines with stage chips (label + probability) + deal counts.
- Editor modal: rename, add/remove/reorder stages, edit label + probability.
- Set-default / delete (guards surface the API's 400s).
- Stage options in the generic deal form (`/api/fields/opportunity`) now come
  from the org's default pipeline; the deal form has a Pipeline select.

### 6. Dashboard
- The "Pipeline by stage" snapshot uses the org's **default** pipeline stages
  (falling back to the registry), so renamed/edited stages render correctly.

### 7. Backfill
- `npm run backfill:pipeline` stamps pre-schema deals (which carry **no**
  `pipelineId` field) onto their org's default pipeline at the RAW level —
  required once after `db:push` on existing databases (same pattern as
  `backfill:env`).

## Decisions (ADR-013)
- Stages are JSON on the `Pipeline` row (not a relational `PipelineStage` table)
  — atomic wholesale replacement, consistent with `LeadForm.fields`.
- Default pipeline is **lazily seeded** rather than migrated — no data change for
  existing orgs; the registry PIPELINE remains the seed source.
- Probability is owned by the pipeline stage definition — one source of truth.
- Delete is guarded (default / last / has-deals) rather than cascading.

## Bugs found & fixed during verification
1. **Prisma/Mongo missing ≠ null** — deals created before the `pipelineId`
   column existed have no field at all, and Prisma WHERE filters only match
   explicit null, so pipeline-scoped lists returned 0. Fixed with the RAW-level
   backfill (`$runCommandRaw` + `$or: [{ $exists: false }, { null }]`).
2. **Backfill wrote strings, Prisma stores ObjectIds** — the first backfill
   pass stamped `pipelineId` as a plain string, which Prisma queries (typed as
   `@db.ObjectId`) couldn't match. Fixed by writing `{ $oid: id }` extended JSON.
3. **Pipeline change kept an invalid stage** — moving a deal to a pipeline that
   didn't contain its current stage would 400 (correct) but the board's
   optimistic update could briefly show a ghost column; the service now validates
   against the resolved pipeline and the board reloads from the response.
4. **`PATCH { isDefault: true }` 400'd** (code review catch) — the PATCH route
   reused the POST schema, which required `name`; Settings → Set default sends a
   name-less body. Fixed by splitting `createSchema` / `patchSchema` (the
   repo's Zod-PATCH rule); regression check added to the smoke suite.
5. **Deals board "default" chip fetched every pipeline's deals** (code review
   catch) — the board now always filters by a concrete pipeline id (default chip
   → the org's default id, which the server expands to include legacy null-
   pipelineId deals), so cross-pipeline deals can't bleed into the wrong board.
6. **Stage-key orphaning on label edit** (code review catch) — the Settings
   editor re-slugified a stage's key whenever its label changed, orphaning deals
   that referenced the old key. Keys are now derived only for newly added stages;
   editing an existing stage's label preserves its key (ADR-013).
7. **Spurious `deal.pipeline_changed` on empty pipelineId** (code review catch)
   — an empty-string `pipelineId` is now treated as "keep current" (no event,
   no change), matching the hook's fallback semantics.

## Verification evidence
- `npm run typecheck` (tsc --noEmit) ✅ · `npm run build` ✅ (production bundle).
- **Live smoke suite (`verify-phase2.sh`, 29/29 green):**
  - Pipelines listed with dealCount; default Sales + Renewals seeded.
  - Create without `pipelineId` → routed to default Sales; probability 50 from
    Sales proposal; explicit `pipelineId` honored; Renewals negotiation = 75.
  - No stage on a pipeline without "qualified" → first stage (`renewal_due`).
  - Unknown stage → 400; nonexistent pipelineId → 400.
  - Stage change re-derives probability from the pipeline (55); `deal.stage_changed`.
  - Pipeline change keeps a valid stage + re-derives probability (55) +
    `deal.pipeline_changed` emitted.
  - `?pipelineId=` filter: default includes legacy null-pipeline deals; no double
    counting across pipelines (16 = 6 + 10).
  - CRUD guards: delete default → 400; delete pipeline with deals → 400; delete
    empty non-default → ok; duplicate stage keys → 400; rep write → 403; rep
    read → 200.
  - Dashboard snapshot uses default pipeline stages.
  - Set-default via name-less `PATCH { isDefault: true }` → 200; new default
    demotes the old one; state restored after (regression #4).
- **Phase 1 regression:** `verify-phase1.sh` still 30/30 green.
- **Demo data left pristine:** 7 deals (6 on Sales + 1 on Renewals), 2 pipelines,
  no leftover smoke pipelines/deals.

## Docs updated
`PROGRESS.md` (Phase 2 → 🧱 ~15%, multi-pipeline shipped), `docs/06-roadmap.md`,
`docs/03-event-catalog.md` (pipeline.* + deal.pipeline_changed),
`docs/05-api-reference.md` (pipelines section + deal pipeline semantics),
`docs/08-decision-log.md` (ADR-013), `README.md`.
