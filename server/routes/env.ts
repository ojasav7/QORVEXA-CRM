import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { orgEnvironments, PRODUCTION_ENV, resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import { BUSINESS_MODELS, addOrgEnvironment } from "../lib/backup";
import { emitEvent } from "../lib/events";

const router = Router();

// GET /api/env — current environment (from X-Environment) + the org's environments.
// Returns sensible defaults when unauthenticated (the client calls this on initial
// load before login — the session cookie isn't set yet).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = (req as any).sessionUser as { orgId: string } | null;
    if (!user) return ok(res, { environment: "production", environments: ["production"] });
    const environments = await orgEnvironments(user.orgId);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { environment, environments });
  })
);

// POST /api/env/switch — validate the requested env; the client persists it
const switchSchema = z.object({ environment: z.string().min(1) });
router.post(
  "/switch",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const { environment } = switchSchema.parse(req.body);
    const environments = await orgEnvironments(user.orgId);
    if (!environments.includes(environment)) throw badRequest(`Unknown environment: "${environment}"`);
    ok(res, { environment });
  })
);

// POST /api/env/create — create a sandbox env (admin)
const createSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "Name must be lowercase letters, numbers, dashes").optional() });
router.post(
  "/create",
  requireRole("admin"),
  requireFeature("environments.sandbox"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const { name = "sandbox" } = createSchema.parse(req.body);
    const environments = await orgEnvironments(user.orgId);
    if (environments.includes(name)) throw badRequest(`Environment "${name}" already exists`);
    await addOrgEnvironment(user.orgId, name);
    await emitEvent({
      orgId: user.orgId,
      environment: await resolveEnvironment(req, user.orgId),
      type: "env.created",
      entity: "organization",
      entityId: user.orgId,
      actorId: user.id,
      payload: { environment: name },
    });
    ok(res, { environment: name, environments: await orgEnvironments(user.orgId) }, 201);
  })
);

// POST /api/env/reset — wipe records in an environment (never production without double-confirm + org setting)
const resetSchema = z.object({
  environment: z.string().min(1),
  confirm: z.string().optional(), // required when resetting production
});
router.post(
  "/reset",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const { environment, confirm } = resetSchema.parse(req.body);
    const environments = await orgEnvironments(user.orgId);
    if (!environments.includes(environment)) throw badRequest(`Unknown environment: "${environment}"`);
    if (environment === PRODUCTION_ENV) {
      const org = await db().organization.findUnique({ where: { id: user.orgId } });
      const settings = (org?.settings ?? {}) as Record<string, unknown>;
      if (settings.allowProductionReset !== true || confirm !== "RESET-PRODUCTION") {
        throw badRequest("Resetting production requires the org setting allowProductionReset=true and confirm=RESET-PRODUCTION");
      }
    }

    let deleted = 0;
    for (const model of BUSINESS_MODELS) {
      const res = await (db() as any)[model].deleteMany({ where: { orgId: user.orgId, environment } });
      deleted += res.count;
    }
    const fieldRes = await db().fieldDef.deleteMany({ where: { orgId: user.orgId, environment } });
    deleted += fieldRes.count;

    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "env.reset",
      entity: "organization",
      entityId: user.orgId,
      actorId: user.id,
      payload: { environment, deleted },
    });
    ok(res, { ok: true, environment, deleted });
  })
);

// POST /api/env/promote — copy changed records from one env to another
const promoteSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  objectType: z.string().optional(),
  ids: z.array(z.string()).optional(),
});
router.post(
  "/promote",
  requireRole("admin"),
  requireFeature("promote"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const { from, to, objectType, ids } = promoteSchema.parse(req.body);
    const environments = await orgEnvironments(user.orgId);
    if (!environments.includes(from) || !environments.includes(to)) throw badRequest("Unknown source or target environment");
    if (from === to) throw badRequest("Source and target environments must differ");

    // Reference fields that point at other promoted records — remapped to the target ids.
    const REF_FIELDS: Record<string, string[]> = {
      account: ["parentId"],
      contact: ["accountId"],
      opportunity: ["accountId", "contactId"],
      task: ["contactId", "opportunityId"],
      note: ["contactId", "accountId", "opportunityId"],
      lead: [],
    };
    // Process in dependency order so referenced records are mapped first.
    const types = objectType ? [objectType] : ["account", "contact", "lead", "opportunity", "task", "note"];
    const idMaps: Record<string, Map<string, string>> = {}; // source id → target id
    const counts: Record<string, number> = {};
    let copied = 0;
    let updated = 0;

    for (const type of types) {
      const delegate = (db() as any)[type];
      if (!delegate) throw badRequest(`Unknown object type: ${type}`);
      const rows = await delegate.findMany({
        where: { orgId: user.orgId, environment: from, ...(ids?.length ? { id: { in: ids } } : {}) },
      });
      counts[type] = 0;
      idMaps[type] = new Map();
      const refs = REF_FIELDS[type] ?? [];
      for (const row of rows) {
        // Lineage marker: the target-env copy (if any) records promotedFrom = source id.
        const existing = await delegate.findFirst({ where: { environment: to, promotedFrom: row.id } });
        const remap = (v: unknown) => {
          if (typeof v === "string") {
            for (const map of Object.values(idMaps)) if (map.has(v)) return map.get(v);
          }
          return v;
        };
        if (!existing) {
          const { _id, ...rest } = row;
          const targetId = crypto.randomBytes(12).toString("hex");
          const data: Record<string, any> = { ...rest, id: targetId, environment: to, promotedFrom: row.id, updatedAt: new Date() };
          for (const f of refs) if (data[f] !== undefined && data[f] !== null) data[f] = remap(data[f]);
          await delegate.create({ data });
          idMaps[type].set(row.id, targetId);
          counts[type] += 1;
          copied++;
        } else {
          const fields = Object.fromEntries(
            Object.entries(row).filter(([k]) => k !== "_id" && k !== "id" && k !== "environment" && k !== "createdAt" && k !== "promotedFrom")
          );
          for (const f of refs) if (fields[f] !== undefined && fields[f] !== null) fields[f] = remap(fields[f]);
          await delegate.update({ where: { id: existing.id }, data: { ...fields, updatedAt: new Date() } });
          idMaps[type].set(row.id, existing.id);
          counts[type] += 1;
          updated++;
        }
      }
    }

    await emitEvent({
      orgId: user.orgId,
      environment: from,
      type: "env.promoted",
      entity: "organization",
      entityId: user.orgId,
      actorId: user.id,
      payload: { from, to, objectType: objectType ?? "all", counts, copied, updated },
    });
    ok(res, { ok: true, from, to, copied, updated, counts });
  })
);

export default router;
