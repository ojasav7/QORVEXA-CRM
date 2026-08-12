// Right-to-portability export (Phase 7 · 🆕 blueprint item) — flag cdp.portability.
//
// The GDPR "give me my data" surface: an admin clicks Export and gets a
// single downloadable JSON file containing EVERY org × environment collection
// (see server/lib/portability.ts). Exports are tracked by PortabilityExport
// rows with size/status/history; downloads stream the file; DELETE purges the
// row + file. Reads open, writes admin-only.
import fs from "node:fs";
import { Router } from "express";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { createPortabilityBundle, resolveExportFile, deleteExportFile } from "../lib/portability";

const router = Router();

// GET /api/portability — list bundles (newest first).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().portabilityExport.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 50 });
    ok(res, { items });
  })
);

// POST /api/portability/export (admin) — build the full-tenant bundle.
router.post(
  "/export",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const row = await db().portabilityExport.create({ data: { orgId: user.orgId, environment, status: "running", requestedBy: user.id } });
    try {
      const { path, sizeBytes, counts } = await createPortabilityBundle(user.orgId, environment);
      const done = await db().portabilityExport.update({
        where: { id: row.id },
        data: { status: "success", path, sizeBytes, completedAt: new Date() },
      });
      await emitEvent({
        orgId: user.orgId,
        environment,
        type: "portability.exported",
        entity: "portabilityExport",
        entityId: row.id,
        actorId: user.id,
        payload: { path, sizeBytes, collections: Object.keys(counts).length, totalRows: Object.values(counts).reduce((s, n) => s + n, 0) },
      });
      ok(res, { export: done, counts }, 201);
    } catch (e: any) {
      await db().portabilityExport.update({ where: { id: row.id }, data: { status: "failed", error: String(e?.message ?? e) } });
      throw e;
    }
  })
);

// GET /api/portability/:id/download — stream the bundle.
router.get(
  "/:id/download",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const row = await db().portabilityExport.findUnique({ where: { id } });
    if (!row || row.orgId !== user.orgId || row.environment !== environment) throw notFound("Export not found");
    if (row.status !== "success" || !row.path) throw badRequest("Export is not ready");
    const absolute = resolveExportFile(row.path);
    res.setHeader("content-type", "application/json");
    res.setHeader("content-disposition", `attachment; filename="${row.path.split("/").pop()}"`);
    res.send(fs.readFileSync(absolute));
  })
);

// DELETE /api/portability/:id (admin) — purge the row + file.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const row = await db().portabilityExport.findUnique({ where: { id } });
    if (!row || row.orgId !== user.orgId || row.environment !== environment) throw notFound("Export not found");
    if (row.path) deleteExportFile(row.path);
    await db().portabilityExport.delete({ where: { id: row.id } });
    ok(res, { ok: true });
  })
);

export default router;
