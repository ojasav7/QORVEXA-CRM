import { Router } from "express";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, ok } from "../lib/http";
import { listWhere } from "../lib/access";
import { PIPELINE } from "../lib/registry";
import { resolveEnvironment } from "../lib/environment";
import { pipelineStages } from "../lib/pipelines";

const router = Router();

// GET /api/dashboard — headline stats for the home screen
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const scoped = { ...user, environment: await resolveEnvironment(req, user.orgId) };
    const scope = listWhere(scoped);

    const [contacts, accounts, leads, openDeals, wonDeals, tasks, pipelineRaw, overdueTasks] =
      await Promise.all([
        db().contact.count({ where: scope }),
        db().account.count({ where: scope }),
        db().lead.count({ where: scope }),
        db().opportunity.count({ where: { ...scope, stage: { notIn: ["won", "lost"] } } }),
        db().opportunity.count({ where: { ...scope, stage: "won" } }),
        db().task.count({ where: { ...scope, status: { not: "done" } } }),
        db().opportunity.findMany({ where: { ...scope, stage: { notIn: ["won", "lost"] } } }),
        db().task.count({ where: { ...scope, status: { not: "done" }, dueAt: { lt: new Date() } } }),
      ]);

    // Phase 2-lite: the snapshot reflects the org's DEFAULT pipeline stages
    // (falling back to the static registry PIPELINE for safety).
    const stages = (await pipelineStages(user.orgId, scoped.environment ?? "production")).map((s) => ({
      stage: s.key,
      probability: s.probability,
    }));
    const snapshot = stages.length ? stages : PIPELINE;
    const pipeline = snapshot.map((p) => {
      const deals = pipelineRaw.filter((d) => d.stage === p.stage);
      return { stage: p.stage, probability: p.probability, count: deals.length, amount: deals.reduce((s, d) => s + d.amount, 0) };
    });

    const pipelineTotal = pipeline.reduce((s, p) => s + p.amount, 0);

    ok(res, {
      stats: { contacts, accounts, leads, openDeals, wonDeals, openTasks: tasks, overdueTasks, pipelineTotal },
      pipeline,
    });
  })
);

export default router;
