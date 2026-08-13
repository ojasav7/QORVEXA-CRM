// Revenue analytics + engine tick (Phase 10 · Revenue Cloud).
// GET /api/revenue/metrics — MRR/ARR + receivables derived on read with data
// lineage (the Phase 6 / ADR-018 discipline). POST /api/revenue/tick (admin)
// runs the billing engine synchronously (renewals + dunning + contract
// warnings) — the deterministic twin of the background ticker, exactly like
// the Phase 4 SLA sweep. Per-route feature gates (metrics vs billing).
import { Router } from "express";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import { revenueMetrics, runRevenueTicker } from "../lib/revenue";

const router = Router();

// GET /api/revenue/metrics (flag revenue.metrics)
router.get(
  "/metrics",
  requireFeature("revenue.metrics"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, await revenueMetrics(user.orgId, environment));
  })
);

// POST /api/revenue/tick (admin, flag revenue.billing) — run the engine now.
router.post(
  "/tick",
  requireRole("admin"),
  requireFeature("revenue.billing"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { tick: await runRevenueTicker(user.orgId, environment) }, 201);
  })
);

export default router;
