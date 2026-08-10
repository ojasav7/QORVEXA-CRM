import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { allFeatureStates, featureState } from "../lib/features";
import { emitEvent } from "../lib/events";

const router = Router();

// GET /api/features — merged registry + org overrides for the current environment.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { environment, features: await allFeatureStates(user.orgId, environment) });
  })
);

// PUT /api/features/:key — admin toggle (writes a FeatureFlag row for this env).
const putSchema = z.object({
  enabled: z.boolean(),
  plans: z.array(z.string()).optional(),
});
router.put(
  "/:key",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const key = String(req.params.key);
    const current = await featureState(user.orgId, environment, key);
    if (!current) throw badRequest(`Unknown feature: ${key}`);
    const { enabled, plans } = putSchema.parse(req.body);

    const row = await db().featureFlag.findUnique({
      where: { orgId_environment_key: { orgId: user.orgId, environment, key } },
    });
    const after = row
      ? await db().featureFlag.update({
          where: { id: row.id },
          data: { enabled, plans: (plans ?? (row.plans as string[])) as string[], updatedAt: new Date() },
        })
      : await db().featureFlag.create({
          data: { orgId: user.orgId, environment, key, label: current.label, description: current.description, enabled, plans: (plans ?? current.plans) as string[] },
        });

    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "feature.updated",
      entity: "featureFlag",
      entityId: after.id,
      actorId: user.id,
      payload: { key, from: current.enabled, to: enabled, environment },
    });
    ok(res, { feature: { key, enabled, plans: after.plans, environment } });
  })
);

export default router;
