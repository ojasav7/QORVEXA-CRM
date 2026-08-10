// CSV export — the missing half of Phase 0 "basic import/export".
// Exports the CURRENT environment's records through the same central scoping
// as list views (tenant + visibility + environment), so reps only ever export
// what they can see. Columns = core field keys + the org's active custom fields.
import { Router } from "express";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, badRequest } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { OBJECTS } from "../lib/registry";
import { listConditions } from "../lib/access";
import { fieldPermMap, canRead } from "../lib/field-permissions";

const router = Router();

const OWNER_FIELD: Record<string, string> = { note: "authorId" };

function csvEscape(v: unknown): string {
  if (v === undefined || v === null) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else s = String(v);
  // CSV formula-injection guard: neutralize spreadsheet-prefix values (= + - @).
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/export/:objectType?q=&status=&stage=&ownerId=&sort=&pageSize=
router.get(
  "/:objectType",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const type = String(req.params.objectType);
    const def = OBJECTS.find((o) => o.type === type);
    if (!def) throw badRequest("Unknown object type");
    const scoped = { ...user, environment };

    const and = listConditions(scoped, OWNER_FIELD[type] ?? "ownerId");
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q) {
      const ors = def.fields
        .filter((f) => f.searchable && f.type !== "number" && f.type !== "currency" && f.type !== "boolean")
        .map((f) => ({ [f.key]: { contains: q, mode: "insensitive" } }));
      if (ors.length) and.push({ OR: ors });
    }
    const where: Record<string, unknown> = { AND: and };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.stage) where.stage = String(req.query.stage);
    if (req.query.ownerId) where.ownerId = String(req.query.ownerId);

    const rows = await (db() as any)[type].findMany({
      where,
      orderBy: { [String(req.query.sort ?? "createdAt")]: "desc" },
      take: Math.min(10_000, Math.max(1, Number(req.query.pageSize) || 5_000)),
    });

    const fieldDefs = await db().fieldDef.findMany({
      where: { orgId: user.orgId, environment, objectType: type, active: true },
      orderBy: { order: "asc" },
    });
    // Field-level permissions (principle #3): exports only include columns the
    // acting role can read — same masking as list/detail views.
    const permMap = await fieldPermMap(user.orgId, environment, type);
    const headers = [...def.fields.map((f) => f.key), ...fieldDefs.map((f) => f.key)].filter((k) => canRead(permMap[k], user.role));

    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((h) => csvEscape(row[h] ?? (row.custom as Record<string, unknown>)?.[h])).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${environment}-${Date.now()}.csv"`);
    res.send(lines.join("\n") + "\n"); // trailing newline = well-formed CSV (RFC 4180)
  })
);

export default router;
