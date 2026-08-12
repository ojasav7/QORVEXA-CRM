// Analytics (Phase 6 · Analytics, Forecasting & BI) — flag analytics.metrics.
//
// One router for the whole BI surface: dashboard metric groups (with data
// lineage), the live weighted forecast + snapshot refresh (forecast.updated),
// predictive v1 scores (conversion / churn / LTV), and threshold evaluation
// (metric.threshold_breached + admin notifications). Reads open to any
// authenticated user; writes (forecast refresh) admin-only. Reports live in
// server/routes/reports.ts (flag analytics.reports).
import { Router } from "express";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { computeMetricsFor, computeAllMetrics, evaluateThresholds, DASHBOARD_KINDS, type DashboardKind } from "../lib/metrics";
import { liveForecast, snapshotForecast, conversionLikelihood, churnRisk, ltvEstimate } from "../lib/forecasts";

const router = Router();

// GET /api/analytics/dashboard?kind=sales|marketing|service|revenue|executive
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const kind = String(req.query.kind ?? "sales");
    if (!(DASHBOARD_KINDS as string[]).includes(kind)) throw badRequest(`Unknown dashboard kind \"${kind}\"`);
    const [group, forecast] = await Promise.all([computeMetricsFor(kind as DashboardKind, user.orgId, environment), liveForecast(user.orgId, environment)]);
    ok(res, { kind, group, forecast });
  })
);

// GET /api/analytics/metrics — every metric across all groups (report data).
router.get(
  "/metrics",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const groups = await computeAllMetrics(user.orgId, environment);
    ok(res, { groups, kinds: DASHBOARD_KINDS });
  })
);

// GET /api/analytics/forecast — live forecast + latest snapshots (history).
router.get(
  "/forecast",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const [live, snapshots] = await Promise.all([
      liveForecast(user.orgId, environment),
      db().forecast.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);
    ok(res, { live, snapshots });
  })
);

// POST /api/analytics/forecast/refresh (admin) — snapshot + thresholds.
router.post(
  "/forecast/refresh",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const saved = await snapshotForecast(user.orgId, environment, user.id);
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "forecast.updated",
      entity: "forecast",
      entityId: saved.id,
      actorId: user.id,
      payload: { buckets: saved.buckets, byOwnerCount: (saved.byOwner as unknown[]).length },
    });
    // Thresholds: breaches → admin notifications + metric.threshold_breached.
    const org = await db().organization.findUnique({ where: { id: user.orgId } });
    const settings = (org?.settings ?? {}) as Record<string, any>;
    const breaches = await evaluateThresholds(user.orgId, environment, settings);
    const admins = await db().user.findMany({ where: { orgId: user.orgId, role: "admin", active: true }, select: { id: true } });
    for (const b of breaches) {
      for (const admin of admins) {
        await db().notification.create({
          data: {
            orgId: user.orgId,
            environment,
            userId: admin.id,
            title: `Metric alert: ${b.label} is ${b.value} (threshold ${b.threshold})`,
            body: `${b.label} fell below its threshold — check the Analytics dashboard.`,
            kind: "metric",
            link: "/analytics",
          },
        });
      }
      await emitEvent({
        orgId: user.orgId,
        environment,
        type: "metric.threshold_breached",
        entity: "metric",
        entityId: "000000000000000000000000", // no backing record — all-zero ObjectId sentinel, key lives in payload
        actorId: user.id,
        payload: { key: b.key, label: b.label, value: b.value, threshold: b.threshold, direction: b.direction },
      });
    }
    ok(res, { saved, breaches }, 201);
  })
);

// GET /api/analytics/predictions — top conversion deals, churn risks, LTVs.
router.get(
  "/predictions",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const org = await db().organization.findUnique({ where: { id: user.orgId } });
    const settings = (org?.settings ?? {}) as Record<string, any>;
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));

    const deals = await db().opportunity.findMany({
      where: { orgId: user.orgId, environment, stage: { notIn: ["won", "lost"] } },
      orderBy: { amount: "desc" },
      take: 30,
      select: { id: true, name: true, stage: true, probability: true, amount: true, createdAt: true },
    });
    const conversions = await Promise.all(
      deals.slice(0, limit).map(async (d) => ({ dealId: d.id, name: d.name, stage: d.stage, ...(await conversionLikelihood(user.orgId, environment, d)) }))
    );
    conversions.sort((a: any, b: any) => b.score - a.score);

    const [contacts, accounts] = await Promise.all([
      db().contact.findMany({ where: { orgId: user.orgId, environment }, select: { id: true, firstName: true, lastName: true, email: true, accountId: true } }),
      db().account.findMany({ where: { orgId: user.orgId, environment }, select: { id: true, name: true } }),
    ]);
    // Related contacts = the contact's account peers (the churn input that says
    // "how many contacts hang off this account").
    const accountPeers = new Map<string, string[]>();
    for (const c of contacts) {
      if (c.accountId) {
        const peers = accountPeers.get(c.accountId) ?? [];
        peers.push(c.id);
        accountPeers.set(c.accountId, peers);
      }
    }
    const churn = [];
    for (const c of contacts.slice(0, limit * 2)) {
      churn.push({ contactId: c.id, name: `${c.firstName} ${c.lastName}`.trim(), ...(await churnRisk(user.orgId, environment, "contact", c.id, accountPeers.get(c.accountId ?? "") ?? [c.id])) });
    }
    churn.sort((a: any, b: any) => b.score - a.score);

    const ltvs = [];
    for (const c of contacts.slice(0, limit)) {
      ltvs.push({ contactId: c.id, name: `${c.firstName} ${c.lastName}`.trim(), ...(await ltvEstimate(user.orgId, environment, settings, c)) });
    }
    ltvs.sort((a: any, b: any) => b.value - a.value);

    ok(res, { conversions: conversions.slice(0, limit), churn: churn.slice(0, limit), ltvs: ltvs.slice(0, limit), accounts: accounts.length });
  })
);

// GET /api/analytics/sources — the lineage dictionary (entity → what it is).
router.get(
  "/sources",
  asyncHandler(async (req, res) => {
    ok(res, {
      entities: [
        { entity: "Opportunity", note: "Deal rows — stage, amount, probability (pipeline-derived), owner" },
        { entity: "Event", note: "The persisted event log (ADR-004) — deal.stage_changed, form.submitted, …" },
        { entity: "CampaignRecipient", note: "Per-recipient campaign state — variant, openedAt, clickedAt" },
        { entity: "Lead", note: "Lead rows — source (Landing page / Website / …)" },
        { entity: "Ticket", note: "Ticket rows — status, priority, firstResponseAt, breachedAt, slaDueAt" },
        { entity: "Contact", note: "Contact rows — the audience + attribution base" },
      ],
    });
  })
);

export default router;
