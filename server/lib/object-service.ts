// Generic object service — one engine for every object type (contact, account,
// lead, opportunity, task, note). New object types register a def in
// registry.ts and get full CRUD + events + audit + search for free
// (the blueprint's principle #1: never hard-code tables per feature).
import { z } from "zod";
import { db } from "../db";
import { badRequest, forbidden, notFound } from "./http";
import { writeAudit } from "./audit";
import { emitEvent } from "./events";
import { assertCanAccess, listConditions, type AccessUser } from "./access";
import { getObjectDef, stageProbability, type ObjectDef } from "./registry";
import { fieldPermMap, canWrite, maskRow, type FieldPerm } from "./field-permissions";

// ── Type helpers ─────────────────────────────────────────────────────────────
type PrismaModel = any; // a Prisma model delegate (contact, account, ...)
const modelOf = (type: string): PrismaModel => (db() as any)[type];

export type ObjectConfig = {
  type: string;
  uniqueFields?: string[]; // e.g. ["email"] → duplicate detection
  eventPrefix?: string; // e.g. "contact" → contact.created (defaults to type)
  relations?: { field: string; type: string }[]; // display joins
  ownerField?: string; // column holding the creator/owner (default "ownerId"; notes use "authorId")
};

const configs: Record<string, ObjectConfig> = {};
export function registerObject(cfg: ObjectConfig) {
  configs[cfg.type] = cfg;
}

// ── Field handling ───────────────────────────────────────────────────────────

function coreFieldMap(def: ObjectDef) {
  return Object.fromEntries(def.fields.map((f) => [f.key, f]));
}

/** Split input into core fields (validated by def) + custom fields (validated by FieldDef registry). */
async function splitFields(def: ObjectDef, input: Record<string, unknown>, user: AccessUser) {
  const core = coreFieldMap(def);
  const coreData: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const spec = core[key];
    if (spec) coreData[key] = value;
    else if (key !== "tags" && key !== "visibility" && key !== "custom") custom[key] = value;
  }

  // Field-level write permissions (blueprint principle #3): reject writes to
  // fields the role can't set. Applied to core + custom keys present in input.
  if (user.role !== "admin") {
    const perms = await fieldPermMap(user.orgId, user.environment ?? "production", def.type);
    const deny = (key: string, perm: FieldPerm | undefined) => {
      if (perm && !canWrite(perm, user.role)) throw forbidden(`You do not have permission to write the field "${key}"`);
    };
    for (const key of Object.keys(coreData)) deny(key, perms[key]);
    for (const key of Object.keys(custom)) deny(key, perms[key]);
  }

  // validate required core fields
  for (const f of def.fields) {
    if (f.required && (coreData[f.key] === undefined || coreData[f.key] === null || coreData[f.key] === "")) {
      throw badRequest(`Missing required field: ${f.label}`);
    }
  }

  // validate custom fields against the registry (unknown keys are dropped)
  // ADR-008: custom fields are per-environment too.
  const defs = await db().fieldDef.findMany({ where: { orgId: user.orgId, environment: user.environment ?? "production", objectType: def.type, active: true } });
  const validated: Record<string, unknown> = {};
  for (const fd of defs) {
    const raw = custom[fd.key];
    if (raw === undefined) continue;
    const v = validateCustom(fd.type, raw);
    if (fd.required && (v === undefined || v === null || v === "")) throw badRequest(`Missing custom field: ${fd.label}`);
    validated[fd.key] = v;
  }
  return { coreData, custom: validated };
}

function validateCustom(type: string, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (type) {
    case "number":
      return Number(raw);
    case "boolean":
      return raw === true || raw === "true" || raw === "on";
    case "date":
      return new Date(String(raw)).toISOString();
    case "select":
    case "multiselect":
      return Array.isArray(raw) ? raw : String(raw);
    default:
      return String(raw);
  }
}

// ── Duplicate detection ──────────────────────────────────────────────────────
// ADR-008: duplicates are matched within the same environment only — a
// sandbox import must not be flagged against production records.

async function findDuplicate(
  type: string,
  cfg: ObjectConfig,
  orgId: string,
  environment: string,
  data: Record<string, unknown>,
  excludeId?: string
) {
  if (!cfg.uniqueFields) return null;
  for (const field of cfg.uniqueFields) {
    const value = data[field];
    if (!value || typeof value !== "string") continue;
    const existing = await modelOf(type).findFirst({
      where: { orgId, environment, [field]: value.toLowerCase().trim() },
    });
    if (existing && existing.id !== excludeId) return { field, id: existing.id };
  }
  return null;
}

/** Public duplicate check — used by the import route for dry-runs and merge targets. */
export async function detectDuplicate(
  type: string,
  orgId: string,
  environment: string,
  data: Record<string, unknown>,
  excludeId?: string
) {
  return findDuplicate(type, configs[type] ?? { type }, orgId, environment, data, excludeId);
}

/** The registered event prefix for a type (contact → contact.created, opportunity → deal.*). */
export function eventPrefixFor(type: string): string {
  return configs[type]?.eventPrefix ?? type;
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ObjectService = {
  type: string;
  list: (user: AccessUser, query: ListQuery) => Promise<{ items: any[]; total: number }>;
  get: (user: AccessUser, id: string) => Promise<any>;
  create: (user: AccessUser, input: Record<string, unknown>, ip?: string | null) => Promise<any>;
  update: (user: AccessUser, id: string, input: Record<string, unknown>, ip?: string | null) => Promise<any>;
  remove: (user: AccessUser, id: string, ip?: string | null) => Promise<void>;
};

export type ListQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  stage?: string;
  status?: string;
  ownerId?: string;
  sort?: string;
};

export function createObjectService(cfg: ObjectConfig): ObjectService {
  // Merge registered defaults (uniqueFields, eventPrefix, relations) so a
  // bare `{ type }` call inherits them — registration is the single source.
  cfg = { ...(configs[cfg.type] ?? {}), ...cfg };
  const def = getObjectDef(cfg.type);
  const core = coreFieldMap(def);

  async function list(user: AccessUser, query: ListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    // Scope conditions (tenant + visibility) must AND with all filters, so
    // they are merged through `AND` and never overwritten by a filter OR.
    const and: Record<string, unknown>[] = listConditions(user, cfg.ownerField);
    const ors: Record<string, unknown>[] = [];

    if (query.q) {
      for (const f of def.fields.filter((f) => f.searchable)) {
        if (f.type === "number" || f.type === "currency" || f.type === "boolean") continue;
        ors.push({ [f.key]: { contains: query.q, mode: "insensitive" } });
      }
      if (ors.length) and.push({ OR: ors });
    }
    const where: Record<string, unknown> = { AND: and };
    if (query.stage) where.stage = query.stage;
    if (query.status) where.status = query.status;
    if (query.ownerId) where.ownerId = query.ownerId;

    const [items, total] = await Promise.all([
      modelOf(cfg.type).findMany({
        where,
        orderBy: { [query.sort ?? "createdAt"]: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      modelOf(cfg.type).count({ where }),
    ]);

    return { items: await hydrateThenMask(items, user), total };
  }

  async function get(user: AccessUser, id: string) {
    const row = await modelOf(cfg.type).findUnique({ where: { id } });
    if (!row) throw notFound(`${def.label} not found`);
    assertCanAccess(user, row);
    return (await hydrateThenMask([row], user))[0];
  }

  async function create(user: AccessUser, input: Record<string, unknown>, ip?: string | null) {
    const environment = user.environment ?? "production";
    const { coreData, custom } = await splitFields(def, { ...input, orgId: user.orgId }, user);
    const dup = await findDuplicate(cfg.type, cfg, user.orgId, environment, coreData);
    if (dup) {
      const existing = await modelOf(cfg.type).findUnique({ where: { id: dup.id } });
      throw badRequest(`A ${def.label.toLowerCase()} with this ${dup.field} already exists`);
    }

    const stage = coreData.stage ?? (def.type === "opportunity" ? "qualified" : undefined);
    const ownerField = cfg.ownerField ?? "ownerId";
    const data: Record<string, unknown> = {
      ...coreData,
      orgId: user.orgId,
      environment,
      [ownerField]: (coreData.ownerId as string) ?? user.id,
      visibility: (input.visibility as string) ?? "org",
      tags: Array.isArray(input.tags) ? input.tags : [],
      custom,
    };
    // ownerId is the generic alias; when the real column differs (Note → authorId)
    // remove the alias so Prisma doesn't see an unknown field.
    if (ownerField !== "ownerId") delete data.ownerId;
    if (def.type === "opportunity" && typeof data.probability !== "number") {
      data.probability = stageProbability(String(stage));
    }
    if (def.type === "lead" && typeof data.score !== "number") data.score = 0;

    const row = await modelOf(cfg.type).create({ data });
    await writeAudit({
      orgId: user.orgId,
      environment,
      actorId: user.id,
      entity: cfg.type,
      entityId: row.id,
      action: "create",
      after: row as Record<string, unknown>,
      ip,
    });
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: `${cfg.eventPrefix}.created`,
      entity: cfg.type,
      entityId: row.id,
      actorId: user.id,
      payload: { [cfg.type]: row },
    });
    return (await hydrateThenMask([row], user))[0];
  }

  async function update(user: AccessUser, id: string, input: Record<string, unknown>, ip?: string | null) {
    const before = await modelOf(cfg.type).findUnique({ where: { id } });
    if (!before) throw notFound(`${def.label} not found`);
    assertCanAccess(user, before);

    // PATCH semantics: validate required fields against the merged state
    // (existing values + patch), not the patch alone.
    const environment = user.environment ?? "production";
    const { coreData, custom } = await splitFields(def, {
      ...input,
      ...Object.fromEntries(def.fields.filter((f) => f.required).map((f) => [f.key, before[f.key]])),
      orgId: user.orgId,
    }, user);
    const merged = {
      ...Object.fromEntries(Object.entries(before).filter(([k]) => !(k in coreData))),
      ...coreData,
    };
    const dup = await findDuplicate(cfg.type, cfg, user.orgId, environment, merged, id);
    if (dup) throw badRequest(`A ${def.label.toLowerCase()} with this ${dup.field} already exists`);

    const patch: Record<string, unknown> = { ...coreData };
    if (input.tags !== undefined) patch.tags = Array.isArray(input.tags) ? input.tags : [];
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    if (Object.keys(custom).length) patch.custom = { ...((before.custom as object) ?? {}), ...custom };

    const isStageChange = cfg.type === "opportunity" && before.stage !== patch.stage;
    if (isStageChange) {
      patch.probability = stageProbability(String(patch.stage));
      patch.updatedAt = new Date();
    }

    const after = await modelOf(cfg.type).update({ where: { id }, data: patch });
    await writeAudit({
      orgId: user.orgId,
      environment,
      actorId: user.id,
      entity: cfg.type,
      entityId: id,
      action: isStageChange ? "stage_changed" : "update",
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
      ip,
    });

    if (isStageChange) {
      await emitEvent({
        orgId: user.orgId,
        environment,
        type: `${cfg.eventPrefix}.stage_changed`,
        entity: cfg.type,
        entityId: id,
        actorId: user.id,
        payload: { from: before.stage, to: patch.stage },
      });
    } else {
      await emitEvent({
        orgId: user.orgId,
        environment,
        type: `${cfg.eventPrefix}.updated`,
        entity: cfg.type,
        entityId: id,
        actorId: user.id,
      });
    }
    return (await hydrateThenMask([after], user))[0];
  }

  async function remove(user: AccessUser, id: string, ip?: string | null) {
    const before = await modelOf(cfg.type).findUnique({ where: { id } });
    if (!before) throw notFound(`${def.label} not found`);
    assertCanAccess(user, before);
    await modelOf(cfg.type).delete({ where: { id } });
    await writeAudit({
      orgId: user.orgId,
      environment: user.environment ?? "production",
      actorId: user.id,
      entity: cfg.type,
      entityId: id,
      action: "delete",
      before: before as Record<string, unknown>,
      ip,
    });
    await emitEvent({
      orgId: user.orgId,
      environment: user.environment ?? "production",
      type: `${cfg.eventPrefix}.deleted`,
      entity: cfg.type,
      entityId: id,
      actorId: user.id,
    });
  }

  // Attach display names, then apply field-level read masking (principle #3).
  // Masking runs AFTER hydration so protected relation labels are hidden too.
  async function hydrateThenMask(rows: any[], user: AccessUser): Promise<any[]> {
    const out = await hydrate(rows, user);
    if (user.role === "admin") return out;
    const perms = await fieldPermMap(user.orgId, user.environment ?? "production", cfg.type);
    for (const r of out) maskRow(r, perms, user.role);
    return out;
  }

  // Attach display names for relation fields (accountId → account.name etc.).
  // Scoped to the caller's org + environment so labels can never surface
  // another org's or another environment's record names.
  async function hydrate(rows: any[], user?: AccessUser): Promise<any[]> {
    if (!cfg.relations || !rows.length) return rows;
    const whereBase: Record<string, unknown> = {};
    if (user) {
      whereBase.orgId = user.orgId;
      if (user.environment) whereBase.environment = user.environment;
    }
    for (const rel of cfg.relations) {
      const ids = rows.map((r) => r[rel.field]).filter(Boolean);
      if (!ids.length) continue;
      const related = await modelOf(rel.type).findMany({ where: { ...whereBase, id: { in: ids } } });
      const byId = new Map<string, any>(related.map((r: any) => [r.id, r]));
      for (const row of rows) {
        const ref: any = row[rel.field];
        const linked = ref ? byId.get(ref) : null;
        const label = (linked?.name ?? `${linked?.firstName ?? ""} ${linked?.lastName ?? ""}`.trim()) || null;
        row[`${rel.field}_label`] = label;
      }
    }
    return rows;
  }

  return { type: cfg.type, list, get, create, update, remove };
}
