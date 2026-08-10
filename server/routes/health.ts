import { Router } from "express";
import { dbHealthy } from "../db";
import { asyncHandler, ok } from "../lib/http";

const router = Router();

// GET /api/health — used by deploy platforms and the frontend banner
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const dbOk = await dbHealthy();
    ok(res, {
      status: dbOk ? "ok" : "degraded",
      db: dbOk ? "connected" : "disconnected",
      time: new Date().toISOString(),
    });
  })
);

export default router;
