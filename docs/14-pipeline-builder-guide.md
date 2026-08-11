# 14 · Pipeline Builder Guide (Phase 2)

> The blueprint requires a *"pipeline builder guide"* as a Phase 2 deliverable.
> This is the user-facing how-to for building deal pipelines — the equivalent
> of what an admin does in **Settings → Pipelines**. Under the hood it is the
> multi-pipeline engine from `docs/13-phase2-lite-build-report.md` (ADR-013).

## What a pipeline is

A pipeline is a **per-org deal board** with its own ordered stages. Each stage
has a label and a **probability** (0–100%) that becomes the win probability of
any deal sitting on it. Example: a *Sales* pipeline (`Discovery 10% → Qualified
25% → Proposal 50% → Negotiation 75% → Won 100% → Lost 0%`) and a separate
*Renewals* pipeline with different stages.

- The org always has a **default pipeline** (lazily created from the built-in
  Sales template on first use) — the deals board, the dashboard snapshot, and
  the deal form all default to it.
- Deals belong to exactly one pipeline (`pipelineId`); a deal with no pipeline
  is treated as being on the default.
- Probability is **owned by the pipeline stage** — editing a stage's
  probability updates every deal on that stage (re-derived on stage moves).

## Building a pipeline

1. Go to **Settings → Pipelines → New pipeline**.
2. **Name** it (e.g. "Renewals", "Partner deals").
3. **Add stages** — a label plus a probability (0–100). Drag the up/down
   arrows to order them; the first stage is where deals land when created
   without a stage.
   - Stage keys are machine slugs derived from the label **only for new
     stages**. Renaming an existing stage keeps its key, so deals that
     reference it are never orphaned (ADR-013).
4. **Create** — the first pipeline you create becomes the default
   automatically (or use **Set default** later).

## Setting the default pipeline

- **Settings → Pipelines → Set default** on any non-default pipeline. The
  current default is demoted automatically (there is exactly one default).
- What follows the default:
  - the **deals board** chips + columns (selected pipeline = active board),
  - the **dashboard** "Pipeline by stage" snapshot,
  - the **deal form** stage dropdown and new-deal defaults.

## Editing vs deleting

- **Edit:** rename, add/remove/reorder stages, change probabilities — the
  pipeline's deals follow automatically (stage keys are preserved).
- **Delete is guarded** — you cannot delete:
  - the **default** pipeline,
  - the **only** pipeline,
  - a pipeline that **still has deals**.
  Move the deals off first (drag them to another pipeline on the board), then
  delete.

## Working with deals on pipelines

- The **deals board** has a chip switcher (default + each custom pipeline with
  live deal counts); columns are that pipeline's stages.
- **New deal**: pick the pipeline (defaults to the active board) and the stage
  from that pipeline's stages.
- **Moving a deal between pipelines**: select a different pipeline on the
  board or edit the deal — the service keeps a valid stage, re-derives
  probability from the new pipeline's stage definition, and emits
  `deal.pipeline_changed` (`{ from, to }`) which is webhook-deliverable and
  event-sourced for later forecasting (Phase 6).
- **Deal fields** (blueprint Phase 2): value/amount, derived probability,
  close date, competitors, and win/lost reasons are editable on the deal form.

## API + migration notes

- Full endpoint reference: `docs/05-api-reference.md` → **Pipelines**.
- Legacy deals created before pipelines existed carry **no** `pipelineId`
  field; they belong to the default pipeline in list filters. On existing
  databases run `npm run backfill:pipeline` once after `db:push` to stamp them
  at the raw level.
- The static registry (`server/lib/registry.ts`) is only the **seed source**;
  once a pipeline exists it is the runtime authority.

## See also

- `docs/13-phase2-lite-build-report.md` — the engine + ADR-013.
- `docs/14-phase2-build-report.md` — Phase 2 completion report.
