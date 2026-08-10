// Duplicate merge (Phase 1) — merge two records of the same type into one.
// The caller picks the master + loser; per-field `fieldChoices` decide whether
// the merged value comes from the master (default) or the loser. Custom fields
// merge key-by-key, tags union. The master keeps its id; the loser is deleted.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { getObjectDef, validateFieldValue } from "../lib/registry";
import { writeAudit } from "../lib/audit";
import { emitEvent } from "../lib/events";

const router = Router();
router.use(requireRole("admin"));

const mergeSchema = z.object({
  objectType: z.string().min(1),
  masterId: z.string().min(1),
  mergeId: z.string().min(1),
  fieldChoices: z.record(z.string(), z.enum(["master", "merge"])).optional().default({}),
});

// POST /api/merge
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { objectType, masterId, mergeId, fieldChoices } = mergeSchema.parse(req.body);
    if (masterId === mergeId) throw badRequest("Master and merge record must be different");
    const def = getObjectDef(objectType); // throws for unknown types

    const delegate = (db() as any)[objectType];
    const [master, merge] = await Promise.all([
      delegate.findFirst({ where: { id: masterId, orgId: user.orgId, environment } }),
      delegate.findFirst({ where: { id: mergeId, orgId: user.orgId, environment } }),
    ]);
    if (!master || !merge) throw notFound("One of the records was not found in this environment");

    // Build the merged row — master wins per field unless the caller chose the merge row.
    const pick = (key: string) => {
      if (fieldChoices[key] === "merge") return merge[key];
      return master[key] !== undefined && master[key] !== null && master[key] !== "" ? master[key] : merge[key];
    };
    const merged: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const f of def.fields) {
      const v = pick(f.key);
      merged[f.key] = validateFieldValue(f, v);
      if (String(master[f.key] ?? "") !== String(merged[f.key] ?? "") && merged[f.key] !== undefined) changed.push(f.key);
    }
    // Custom fields merge key-by-key (per-key choice).
    const masterCustom = (master.custom ?? {}) as Record<string, unknown>;
    const mergeCustom = (merge.custom ?? {}) as Record<string, unknown>;
    const mergedCustom: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(masterCustom), ...Object.keys(mergeCustom)])) {
      mergedCustom[k] = fieldChoices[k] === "merge" ? mergeCustom[k] : masterCustom[k] ?? mergeCustom[k];
    }
    const tags = [...new Set([...(master.tags ?? []), ...(merge.tags ?? [])])];

    // Duplicate safety: the merged email/name must not collide with a THIRD record.
    const uniqueFields: string[] = ["contact", "account", "lead"].includes(objectType) ? ["email", "name"] : [];
    for (const key of uniqueFields) {
      const value = merged[key];
      if (typeof value === "string" && value.trim()) {
        const dup = await delegate.findFirst({ where: { orgId: user.orgId, environment, [key]: value.toLowerCase().trim(), id: { not: masterId } } });
        if (dup) throw badRequest(`Merging would collide with another ${objectType}: same ${key}`);
      }
    }

    const data: Record<string, unknown> = { ...merged, custom: mergedCustom, tags, updatedAt: new Date() };
    const after = await delegate.update({ where: { id: masterId }, data });
    await delegate.delete({ where: { id: mergeId } });

    await writeAudit({
      orgId: user.orgId,
      environment,
      actorId: user.id,
      entity: objectType,
      entityId: masterId,
      action: "merged",
      before: { master: master as Record<string, unknown>, merge: merge as Record<string, unknown> },
      after: after as Record<string, unknown>,
      ip: req.ip,
    });
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: `${objectType}.merged`,
      entity: objectType,
      entityId: masterId,
      actorId: user.id,
      payload: { via: "records", masterId, mergeId, fields: changed },
    });
    ok(res, { merged: after, fieldsChanged: changed });
  })
);

export default router;
