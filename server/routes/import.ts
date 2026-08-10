import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { parseCsv } from "../lib/csv";
import { createObjectService, detectDuplicate, eventPrefixFor } from "../lib/object-service";
import { OBJECTS } from "../lib/registry";
import { resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import { emitEvent } from "../lib/events";

const router = Router();

const bodySchema = z.object({
  objectType: z.enum(OBJECTS.map((o) => o.type) as [string, ...string[]]),
  csv: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  // Per-row resolution keyed by the 1-based row number shown in the preview
  // (row 1 = header, row 2 = first data row — matches the dry-run output).
  merge: z
    .record(
      z.string(),
      z.object({
        mode: z.enum(["create", "merge"]),
        targetId: z.string().optional(),
        fields: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

type DryRunRow = {
  row: number;
  status: "new" | "duplicate" | "failed";
  existingId?: string;
  matchedOn?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  error?: string;
};

/** Diff CSV row values against an existing record for the fields the CSV contains. */
function diffRow(record: Record<string, unknown>, existing: Record<string, unknown>, headers: string[]): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const h of headers) {
    if (!h || h === "id") continue;
    const to = record[h];
    const from = existing[h];
    if (to === undefined || to === "" ) continue;
    if (String(from ?? "") !== String(to)) changes[h] = { from: from ?? "", to };
  }
  return changes;
}

// POST /api/import — CSV import with dry-run preview and per-row merge resolution.
//   dryRun: true  → analyze every row (new / duplicate + diff), write nothing.
//   merge: { [row]: { mode: "merge", targetId?, fields? } } → apply the resolution.
router.post(
  "/",
  requireFeature("import.merge"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const scoped = { ...user, environment };
    const body = bodySchema.parse(req.body);
    const { objectType, csv, dryRun } = body;
    const merge = (body.merge ?? {}) as Record<string, { mode: "create" | "merge"; targetId?: string; fields?: string[] }>;
    const service = createObjectService({ type: objectType });
    const def = OBJECTS.find((o) => o.type === objectType)!;
    const prefix = eventPrefixFor(objectType);
    const model = (db() as any)[objectType];

    const rows = parseCsv(csv);
    if (rows.length < 2) throw badRequest("CSV needs a header row and at least one data row");
    const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
    const dataRows = rows.slice(1);

    const result: DryRunRow[] = [];
    let imported = 0;
    let merged = 0;
    let duplicates = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2; // 1-based including the header row
      const record: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        if (h) record[h] = (dataRows[i][idx] ?? "").trim();
      });

      // ── Dry run: classify without writing ───────────────────────────────
      if (dryRun) {
        const dup = await detectDuplicate(objectType, user.orgId, environment, record);
        if (dup) {
          const existing = await model.findUnique({ where: { id: dup.id } });
          result.push({
            row: rowNumber,
            status: "duplicate",
            existingId: dup.id,
            matchedOn: dup.field,
            changes: existing ? diffRow(record, existing, headers) : undefined,
          });
          duplicates++;
        } else {
          result.push({ row: rowNumber, status: "new" });
          imported++;
        }
        continue;
      }

      // ── Execute: per-row resolution ─────────────────────────────────────
      const decision = merge[String(rowNumber)] ?? merge[String(i)];
      if (decision?.mode === "merge") {
        let targetId = decision.targetId;
        if (!targetId) {
          const dup = await detectDuplicate(objectType, user.orgId, environment, record);
          targetId = dup?.id;
        }
        if (!targetId) {
          // Nothing to merge into — falls back to a plain create.
          await service.create(scoped, record, req.ip);
          imported++;
          result.push({ row: rowNumber, status: "new" });
          continue;
        }
        const fields = decision.fields?.length ? decision.fields : Object.keys(record).filter((k) => k !== "id");
        const patch: Record<string, unknown> = {};
        for (const f of fields) if (f in record) patch[f] = record[f];
        const before = await model.findUnique({ where: { id: targetId } });
        if (!before) {
          failed++;
          errors.push(`Row ${rowNumber}: merge target ${targetId} not found`);
          result.push({ row: rowNumber, status: "failed", error: "merge target not found" });
          continue;
        }
        await service.update(scoped, targetId, patch, req.ip);
        const after = await model.findUnique({ where: { id: targetId } });
        await emitEvent({
          orgId: user.orgId,
          environment,
          type: `${prefix}.merged`,
          entity: objectType,
          entityId: targetId,
          actorId: user.id,
          payload: { row: rowNumber, fields, changes: after ? diffRow(patch, before, Object.keys(patch)) : undefined },
        });
        merged++;
        result.push({ row: rowNumber, status: "duplicate", existingId: targetId, matchedOn: "row", changes: after ? diffRow(patch, before, Object.keys(patch)) : undefined });
        continue;
      }

      // Default: create (duplicate → counted, no write)
      try {
        const created = await service.create(scoped, record, req.ip);
        await emitEvent({
          orgId: user.orgId,
          environment,
          type: `${prefix}.imported`,
          entity: objectType,
          entityId: created.id,
          actorId: user.id,
          payload: { row: rowNumber },
        });
        imported++;
        result.push({ row: rowNumber, status: "new" });
      } catch (e: any) {
        if (e?.status === 400 && /already exists/.test(e?.message ?? "")) {
          const dup = await detectDuplicate(objectType, user.orgId, environment, record);
          duplicates++;
          result.push({
            row: rowNumber,
            status: "duplicate",
            existingId: dup?.id,
            matchedOn: dup?.field,
            error: e?.message,
          });
        } else {
          failed++;
          errors.push(e?.message ?? "unknown error");
          result.push({ row: rowNumber, status: "failed", error: e?.message ?? "unknown error" });
        }
      }
    }

    if (dryRun) {
      ok(res, { dryRun: true, objectType, result: { rows: result, counts: { new: imported, duplicate: duplicates } } });
    } else {
      ok(res, {
        imported,
        merged,
        duplicates,
        failed,
        errors: errors.slice(0, 10),
        result: { rows: result, counts: { new: imported, merged, duplicate: duplicates, failed } },
      });
    }
  })
);

export default router;
