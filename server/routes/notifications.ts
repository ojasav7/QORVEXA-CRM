// Notifications (Phase 3) — the header bell. Rows are owned by userId; every
// endpoint here scopes by the caller so users can never see/read each other's
// notifications. The automation `notify` action writes rows (lib/automations.ts).
import { Router } from "express";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";

const router = Router();

// GET /api/notifications — the caller's notifications, newest first.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const unreadOnly = String(req.query.unreadOnly ?? "") === "true";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 15));
    const where = { orgId: user.orgId, environment, userId: user.id, ...(unreadOnly ? { read: false } : {}) };
    const [items, total, unread] = await Promise.all([
      db().notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().notification.count({ where }),
      db().notification.count({ where: { orgId: user.orgId, environment, userId: user.id, read: false } }),
    ]);
    ok(res, { items, total, unread });
  })
);

// GET /api/notifications/unread-count — badge for the header bell.
router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const unread = await db().notification.count({ where: { orgId: user.orgId, environment, userId: user.id, read: false } });
    ok(res, { unread });
  })
);

// POST /api/notifications/:id/read — mark one of the caller's rows read.
router.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const notification = await db().notification.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment, userId: user.id } });
    if (!notification) throw notFound("Notification not found");
    if (!notification.read) {
      await db().notification.update({ where: { id: notification.id }, data: { read: true } });
    }
    ok(res, { ok: true });
  })
);

// POST /api/notifications/read-all — mark all of the caller's rows read.
router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const result = await db().notification.updateMany({
      where: { orgId: user.orgId, environment, userId: user.id, read: false },
      data: { read: true },
    });
    ok(res, { ok: true, updated: result.count });
  })
);

export default router;
