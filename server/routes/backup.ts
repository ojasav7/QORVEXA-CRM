import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { orgEnvironments, resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import { createSnapshot, restoreSnapshot, addOrgEnvironment } from "../lib/backup";
import { emitEvent } from "../lib/events";

const router = Router();
router.use(requireRole("admin"));
router.use(requireFeature("backups"));

// GET /api/backups — list snapshot + restore jobs (newest first)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().backupJob.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" }, take: 50 });
    ok(res, { items });
  })
);

// POST /api/backup/create — snapshot the given (or current) environment
const createSchema = z.object({
  environment: z.string().optional(),
  note: z.string().max(200).optional(),
});
router.post(
  "/create",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const current = await resolveEnvironment(req, user.orgId);
    const { environment = current, note } = createSchema.parse(req.body);
    const environments = await orgEnvironments(user.orgId);
    if (!environments.includes(environment)) throw badRequest(`Unknown environment: "${environment}"`);

    const job = await db().backupJob.create({
      data: { orgId: user.orgId, status: "running", archivePath: "", environment, note: note ?? null },
    });
    try {
      const { archivePath, sizeBytes, manifest } = await createSnapshot(user.orgId, environment);
      const done = await db().backupJob.update({
        where: { id: job.id },
        data: { status: "success", archivePath, sizeBytes },
      });
      await emitEvent({
        orgId: user.orgId,
        environment,
        type: "backup.created",
        entity: "backupJob",
        entityId: job.id,
        actorId: user.id,
        payload: { archivePath, sizeBytes, note: note ?? null, manifest },
      });
      ok(res, { job: done }, 201);
    } catch (e: any) {
      await db().backupJob.update({
        where: { id: job.id },
        data: { status: "failed", error: String(e?.message ?? e) },
      });
      throw e;
    }
  })
);

// POST /api/backup/restore — restore ALWAYS lands in a fresh sandbox env
const restoreSchema = z.object({
  backupId: z.string().min(1),
  targetEnvironment: z.string().optional().default("sandbox"),
});
router.post(
  "/restore",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const { backupId, targetEnvironment } = restoreSchema.parse(req.body);
    // ADR-009: production restore is rejected by construction.
    if (targetEnvironment !== "sandbox" && targetEnvironment !== "sandbox-restored") {
      throw badRequest("Restores must target a sandbox environment — production is never overwritten");
    }

    const job = await db().backupJob.findUnique({ where: { id: backupId } });
    if (!job || job.orgId !== user.orgId) throw badRequest("Backup not found");
    if (job.status !== "success") throw badRequest("Only successful snapshots can be restored");

    const freshEnv = `sandbox-restored-${Date.now()}`;
    const { restored } = await restoreSnapshot(user.orgId, job.archivePath, freshEnv);
    await addOrgEnvironment(user.orgId, freshEnv);
    const done = await db().backupJob.update({
      where: { id: job.id },
      data: { restoredToEnv: freshEnv },
    });
    await emitEvent({
      orgId: user.orgId,
      environment: "sandbox",
      type: "backup.restored",
      entity: "backupJob",
      entityId: job.id,
      actorId: user.id,
      payload: { archivePath: job.archivePath, targetEnvironment: freshEnv, restored },
    });
    ok(res, { job: done, restored, targetEnvironment: freshEnv });
  })
);

export default router;
