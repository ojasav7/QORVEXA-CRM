import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, ok } from "../lib/http";
import { emitEvent } from "../lib/events";

const router = Router();

// GET /api/org
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const org = await db().organization.findUnique({ where: { id: user.orgId } });
    ok(res, { org });
  })
);

// PATCH /api/org — org settings (locale, timezone, feature flags)
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
router.patch(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const patch = patchSchema.parse(req.body);
    const org = await db().organization.update({ where: { id: user.orgId }, data: { ...patch, settings: patch.settings as object } });
    await emitEvent({ orgId: user.orgId, type: "org.updated", entity: "organization", entityId: org.id, actorId: user.id });
    ok(res, { org });
  })
);

export default router;
