// Reports (Phase 6 · Analytics, Forecasting & BI) — flag analytics.reports.
//
// Saved dashboard configs (ADR-018): a Report row holds `kind` + `keys`
// (metric keys) and GET /:id/data renders the LIVE metrics for those keys
// with full data lineage. Reads open; writes admin-only (org config like
// segments/automations).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { computeAllMetrics, DASHBOARD_KINDS } from "../lib/metrics";

const router = Router();

/** Mongo ObjectId shape — rejects malformed ids before Prisma 500s on them. */
const validId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

const reportSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  kind: z.enum(DASHBOARD_KINDS).optional(),
  keys: z.array(z.string()).max(40).optional(),
  active: z.boolean().optional(),
});

// GET /api/reports
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().report.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    ok(res, { items });
  })
);

// POST /api/reports (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = reportSchema.parse(req.body);
    const report = await db().report.create({
      data: {
        orgId: user.orgId,
        environment,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind ?? "sales",
        keys: input.keys ?? [],
        active: input.active ?? true,
        createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "report.created", entity: "report", entityId: report.id, actorId: user.id, payload: { name: report.name, kind: report.kind } });
    ok(res, { report }, 201);
  })
);

// GET /api/reports/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    if (!validId(String(req.params.id))) throw notFound("Report not found");
    const report = await db().report.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!report) throw notFound("Report not found");
    ok(res, { report });
  })
);

// GET /api/reports/:id/data — live metrics for the report's kind + keys.
router.get(
  "/:id/data",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    if (!validId(String(req.params.id))) throw notFound("Report not found");
    const report = await db().report.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!report) throw notFound("Report not found");
    const groups = await computeAllMetrics(user.orgId, environment);
    const kindGroup = groups.find((g) => g.kind === report.kind);
    const keys = (report.keys as string[]) ?? [];
    const metrics = (kindGroup?.metrics ?? []).filter((m) => keys.length === 0 || keys.includes(m.key));
    ok(res, { report, metrics, kindLabel: kindGroup?.label ?? report.kind });
  })
);

// PATCH /api/reports/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    if (!validId(String(req.params.id))) throw notFound("Report not found");
    const report = await db().report.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!report) throw notFound("Report not found");
    const input = reportSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.keys !== undefined) data.keys = input.keys;
    if (input.active !== undefined) data.active = input.active;
    const updated = await db().report.update({ where: { id: report.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "report.updated", entity: "report", entityId: updated.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { report: updated });
  })
);

// DELETE /api/reports/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    if (!validId(String(req.params.id))) throw notFound("Report not found");
    const report = await db().report.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!report) throw notFound("Report not found");
    await db().report.delete({ where: { id: report.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "report.deleted", entity: "report", entityId: report.id, actorId: user.id, payload: { name: report.name } });
    ok(res, { ok: true });
  })
);

export default router;
