import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { resolveEnvironment } from "../lib/environment";

const router = Router();

// GET /api/webhooks — webhooks are per-environment (ADR-008): list the current env's hooks
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().webhook.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" } });
    ok(res, { items, environment });
  })
);

// POST /api/webhooks
const hookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
});
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { url, events } = hookSchema.parse(req.body);
    const secret = crypto.randomBytes(24).toString("hex");
    const hook = await db().webhook.create({
      data: { orgId: user.orgId, environment, url, events, secret, active: true },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "webhook.created", entity: "webhook", entityId: hook.id, actorId: user.id });
    ok(res, { webhook: { ...hook, secret } }, 201);
  })
);

// PATCH /api/webhooks/:id
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const hook = await db().webhook.findUnique({ where: { id: String(req.params.id) } });
    if (!hook || hook.orgId !== user.orgId || hook.environment !== environment) throw badRequest("Webhook not found");
    const patch = hookSchema.partial().parse(req.body);
    const updated = await db().webhook.update({ where: { id: hook.id }, data: patch });
    ok(res, { webhook: updated });
  })
);

// DELETE /api/webhooks/:id
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const hook = await db().webhook.findUnique({ where: { id: String(req.params.id) } });
    if (!hook || hook.orgId !== user.orgId || hook.environment !== environment) throw badRequest("Webhook not found");
    await db().webhook.delete({ where: { id: hook.id } });
    ok(res, { ok: true });
  })
);

// POST /api/webhooks/:id/test — fire a synthetic test event through the pipeline
router.post(
  "/:id/test",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const hook = await db().webhook.findUnique({ where: { id: String(req.params.id) } });
    if (!hook || hook.orgId !== user.orgId) throw badRequest("Webhook not found");
    const event = await emitEvent({
      orgId: user.orgId,
      environment: await resolveEnvironment(req, user.orgId),
      type: "webhook.test",
      entity: "webhook",
      entityId: hook.id,
      actorId: user.id,
      payload: { message: "Test delivery" },
    });
    ok(res, { queued: !!event });
  })
);

export default router;
