// Deliverability monitoring (Phase 5 · Marketing Automation) — derived from
// the org's outbound Message rows (computed on read, never stale). Bounce /
// unsubscribe / complaint events are simulated through the mock provider seam
// (ADR-014) and write real state; the metrics pipeline itself is real.
// Flag: marketing.deliverability.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { deliverabilityMetrics, simulateDeliverabilityEvent } from "../lib/campaigns";

const router = Router();

// GET /api/deliverability
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const metrics = await deliverabilityMetrics(user.orgId, environment);
    const recent = await db().message.findMany({
      where: { orgId: user.orgId, environment, direction: "out" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, toEmail: true, subject: true, status: true, openedAt: true, clickedAt: true, bouncedAt: true, unsubscribedAt: true, createdAt: true },
    });
    ok(res, { metrics, recent });
  })
);

// POST /api/deliverability/simulate (admin) — mock provider event (ADR-014).
router.post(
  "/simulate",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { messageId, kind } = z.object({ messageId: z.string().min(1), kind: z.enum(["bounce", "unsubscribe", "complaint"]) }).parse(req.body ?? {});
    const message = await simulateDeliverabilityEvent(user.orgId, environment, messageId, kind, user.id);
    ok(res, { message });
  })
);

// GET /api/deliverability/messages — paginated outbound messages for the page.
router.get(
  "/messages",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const where: Record<string, unknown> = { orgId: user.orgId, environment, direction: "out" };
    if (req.query.status) where.status = req.query.status;
    const [items, total] = await Promise.all([
      db().message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().message.count({ where }),
    ]);
    ok(res, { items, total });
  })
);

export default router;
