import { Router } from "express";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";

const router = Router();

// GET /api/events?page=&pageSize=&type= — recent events for the activity feed
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
    const where: Record<string, unknown> = { orgId: user.orgId, environment };
    if (req.query.type) where.type = String(req.query.type);

    const [items, total] = await Promise.all([
      db().event.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().event.count({ where }),
    ]);
    ok(res, { items, total });
  })
);

// GET /api/events/feed — compact feed for the dashboard side panel
router.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().event.findMany({
      where: { orgId: user.orgId, environment },
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    ok(res, { items });
  })
);

export default router;
