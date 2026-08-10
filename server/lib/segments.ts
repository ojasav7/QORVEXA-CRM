// Segments (Phase 1) — first-class dynamic lists. A segment holds a name,
// object type, and `criteria` (a list of field filters); membership is computed
// on read against the object collection, scoped like every query (org +
// environment + visibility). v1 filters operate on core registry fields.
import { getObjectDef } from "./registry";
import { badRequest } from "./http";

export type SegmentFilter = { field: string; op: string; value: unknown };
export type SegmentCriteria = { filters: SegmentFilter[] };

const OPS = ["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "in", "not_in"];

export const SEGMENT_OBJECT_TYPES = ["contact", "account", "lead", "opportunity", "task"];

/** Validate + normalize criteria against the object's registry definition. */
export function parseCriteria(objectType: string, raw: unknown): SegmentCriteria {
  const c = (raw ?? {}) as Record<string, unknown>;
  const filters = Array.isArray(c.filters) ? (c.filters as SegmentFilter[]) : [];
  const def = getObjectDef(objectType);
  for (const f of filters) {
    if (!f || typeof f.field !== "string" || !def.fields.some((x) => x.key === f.field)) {
      throw badRequest(`Unknown field "${f?.field ?? "?"}" on ${objectType}`);
    }
    if (!OPS.includes(f.op)) throw badRequest(`Unknown operator "${f.op}"`);
  }
  return { filters };
}

function normalizeValue(type: string | undefined, v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return v;
  if (type === "number" || type === "currency") return Number(v);
  if (type === "date") return new Date(String(v)).toISOString();
  if (type === "boolean") return v === true || v === "true";
  return String(v);
}

/**
 * Build the `where` for a segment's members: `{ AND: [...scopeClauses, ...filters] }`.
 * `scope` comes from listConditions (org + environment + role visibility).
 */
export function criteriaWhere(objectType: string, criteria: SegmentCriteria, scope: Record<string, unknown>[]): Record<string, unknown> {
  const def = getObjectDef(objectType);
  const and: Record<string, unknown>[] = [];
  for (const f of criteria.filters ?? []) {
    const spec = def.fields.find((x) => x.key === f.field);
    const value = normalizeValue(spec?.type, f.value);
    switch (f.op) {
      case "eq": and.push({ [f.field]: value }); break;
      case "neq": and.push({ [f.field]: { not: value } }); break;
      case "contains": and.push({ [f.field]: { contains: String(value), mode: "insensitive" } }); break;
      case "not_contains": and.push({ [f.field]: { not: { contains: String(value), mode: "insensitive" } } }); break;
      case "gt": and.push({ [f.field]: { gt: value } }); break;
      case "gte": and.push({ [f.field]: { gte: value } }); break;
      case "lt": and.push({ [f.field]: { lt: value } }); break;
      case "lte": and.push({ [f.field]: { lte: value } }); break;
      case "in": and.push({ [f.field]: { in: Array.isArray(value) ? value : [value] } }); break;
      case "not_in": and.push({ [f.field]: { notIn: Array.isArray(value) ? value : [value] } }); break;
      default: break;
    }
  }
  return { AND: [...scope, ...and] };
}
