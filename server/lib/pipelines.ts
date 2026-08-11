// Multi-pipeline engine (Phase 2-lite) — per-org deal pipelines.
//
// The blueprint's Phase 2 "Multi-pipeline engine": a pipeline is a named set of
// stages (key, label, probability, order) owned by an org (× environment,
// ADR-008). The registry's static PIPELINE stays as the *seed source* for the
// org's default pipeline, which is lazily created on first access — so existing
// orgs and brand-new orgs both end up with a working "Sales" pipeline without
// any migration. Deals reference a pipeline via Opportunity.pipelineId (null =
// the org's default pipeline, so pre-existing deals keep working).
//
// Events: pipeline.created / pipeline.updated / pipeline.deleted and
// deal.pipeline_changed (from/to) are emitted by the routes/object service.
import { db } from "../db";
import { badRequest } from "./http";
import { PIPELINE } from "./registry";

export type PipelineStageDef = { key: string; label: string; probability: number; order: number };
export type PipelineShape = {
  id: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStageDef[];
  dealCount?: number;
};

const DEFAULT_NAME = "Sales";

/** Slugify a stage label into a stable key (e.g. "Proposal sent" → "proposal_sent"). */
export function slugifyStageKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Normalize + validate a stages array from an API payload. Keys auto-derived from labels. */
export function normalizeStages(input: unknown): PipelineStageDef[] {
  if (!Array.isArray(input) || input.length === 0) throw badRequest("A pipeline needs at least one stage");
  const seen = new Set<string>();
  return input.map((raw, order) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const label = typeof s.label === "string" && s.label.trim() ? s.label.trim() : undefined;
    if (!label) throw badRequest("Every stage needs a label");
    const key = typeof s.key === "string" && s.key.trim() ? s.key.trim() : slugifyStageKey(label);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw badRequest(`Stage key "${key}" must start with a letter (lowercase letters, digits, underscores)`);
    if (seen.has(key)) throw badRequest(`Duplicate stage key: "${key}"`);
    seen.add(key);
    let probability = 10;
    if (typeof s.probability === "number") probability = s.probability;
    else if (typeof s.probability === "string" && s.probability !== "") probability = Number(s.probability);
    if (!Number.isFinite(probability)) throw badRequest(`Stage "${label}" has an invalid probability`);
    probability = Math.max(0, Math.min(100, Math.round(probability)));
    return { key, label, probability, order };
  });
}

/** Find an org's pipeline by id within its environment. */
export async function findPipeline(orgId: string, environment: string, id: string): Promise<PipelineShape | null> {
  const row = await (db() as any).pipeline.findFirst({ where: { orgId, environment, id } });
  return row ? rowToShape(row) : null;
}

function rowToShape(row: any): PipelineShape {
  return { id: row.id, name: row.name, isDefault: row.isDefault, stages: normalizeStagesFromDb(row.stages) };
}

function normalizeStagesFromDb(raw: unknown): PipelineStageDef[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((s, order) => {
      const r = (s ?? {}) as Record<string, unknown>;
      return {
        key: String(r.key ?? ""),
        label: String(r.label ?? r.key ?? ""),
        probability: Number(r.probability ?? 10) || 0,
        order: Number(r.order ?? order) || order,
      };
    })
    .filter((s) => s.key);
}

/**
 * Ensure the org's default pipeline exists (lazily seeded from the registry
 * PIPELINE). Idempotent — returns the default pipeline's id.
 */
export async function ensureDefaultPipeline(orgId: string, environment: string): Promise<string> {
  const existing = await (db() as any).pipeline.findFirst({ where: { orgId, environment, isDefault: true } });
  if (existing) return existing.id;
  const anyPipeline = await (db() as any).pipeline.findFirst({ where: { orgId, environment } });
  if (anyPipeline) {
    // No default marked yet — promote the first one so reads always resolve.
    await (db() as any).pipeline.update({ where: { id: anyPipeline.id }, data: { isDefault: true, updatedAt: new Date() } });
    return anyPipeline.id;
  }
  const created = await (db() as any).pipeline.create({
    data: {
      orgId,
      environment,
      name: DEFAULT_NAME,
      isDefault: true,
      stages: PIPELINE.map((p, order) => ({ key: p.stage, label: p.stage, probability: p.probability, order })),
    },
  });
  return created.id;
}

/** The org's default pipeline (ensuring one exists). */
export async function getDefaultPipeline(orgId: string, environment: string): Promise<PipelineShape> {
  const id = await ensureDefaultPipeline(orgId, environment);
  const row = await (db() as any).pipeline.findFirst({ where: { orgId, environment, id } });
  return rowToShape(row);
}

/** All of the org's pipelines in this environment, with live deal counts. */
export async function listPipelines(orgId: string, environment: string): Promise<PipelineShape[]> {
  await ensureDefaultPipeline(orgId, environment);
  const [rows, counts] = await Promise.all([
    (db() as any).pipeline.findMany({ where: { orgId, environment }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    (db() as any).opportunity.groupBy({
      by: ["pipelineId"],
      where: { orgId, environment, pipelineId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const byId = new Map<string, number>();
  for (const c of counts) byId.set(c.pipelineId, c._count._all);
  return rows.map((r: any) => ({ ...rowToShape(r), dealCount: byId.get(r.id) ?? 0 }));
}

/**
 * Resolve the effective pipeline context for a deal create/update:
 * - pipelineId: explicit (must exist in org×env) → else the org's default.
 * - stage: explicit (must belong to the pipeline) → else the pipeline's
 *   "qualified" stage if it has one, otherwise its first stage.
 * - probability: derived from the stage definition in the pipeline.
 * Returns the fully-resolved values so the object service can persist them.
 */
export async function resolveDealContext(
  orgId: string,
  environment: string,
  input: { pipelineId?: string; stage?: string; probability?: number },
  before?: { pipelineId?: string | null; stage?: string }
): Promise<{ pipelineId: string; stage: string; probability: number }> {
  const pipeline = input.pipelineId
    ? await findPipeline(orgId, environment, input.pipelineId)
    : await getDefaultPipeline(orgId, environment);
  if (!pipeline) throw badRequest("Pipeline not found in this environment");

  // Explicit stage must belong to the pipeline; otherwise keep the current
  // stage if valid; otherwise default to "qualified" → first stage.
  let stage = input.stage;
  if (stage && !pipeline.stages.some((s) => s.key === stage)) {
    throw badRequest(`Stage "${stage}" does not exist in pipeline "${pipeline.name}"`);
  }
  if (!stage && before?.stage && pipeline.stages.some((s) => s.key === before.stage)) {
    stage = before.stage;
  }
  if (!stage) {
    stage = pipeline.stages.some((s) => s.key === "qualified")
      ? "qualified"
      : pipeline.stages[0]?.key;
  }
  const stageDef = pipeline.stages.find((s) => s.key === stage);
  if (!stageDef) throw badRequest(`Stage "${stage}" does not exist in pipeline "${pipeline.name}"`);

  return {
    pipelineId: pipeline.id,
    stage,
    // Caller-provided probability wins (e.g. explicit field choice); otherwise
    // the stage's configured probability.
    probability: typeof input.probability === "number" ? input.probability : stageDef.probability,
  };
}

/** Public helpers for probability lookups (dashboard etc.). */
export async function pipelineStages(orgId: string, environment: string): Promise<PipelineStageDef[]> {
  return (await getDefaultPipeline(orgId, environment)).stages;
}

export { DEFAULT_NAME };
