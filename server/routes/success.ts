// Customer Success, Retention & Expansion (Phase 11 · ADR-023) — flag cs.*.
//
// Reads open (the Success page is a monitoring + governance surface); plan /
// program / survey / roadmap config writes are admin-only (same pattern as
// automations/campaigns config entities). CSM operational writes (milestones,
// QBRs, responses, referrals, awards) are admin/manager — reps can read and
// respond to surveys. Per-route feature gates (cs.plans / cs.usage / cs.churn
// / cs.surveys / cs.loyalty), exactly like revenue.ts gates metrics vs billing.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import {
  addMilestone, addQbr, addSurveyResponse, awardPoints, churnHistory, churnOverview, createProgram, createReferral,
  createRoadmapItem, createSuccessPlan, createSurvey, deleteSuccessPlan, deleteSurvey, enrollMember, expansionRadar,
  getSuccessPlan, ingestUsage, listMembers, listPrograms, listRoadmap, listSuccessPlans, listSurveys, refreshChurn,
  runSuccessTicker, setMilestone, setReferralStatus, surveyResponses, surveyResults, updateProgram, updateRoadmapItem,
  updateSuccessPlan, updateSurvey, usageOverview, voteRoadmapItem,
} from "../lib/success";

const router = Router();

// ── Success plans (cs.plans) ────────────────────────────────────────────────
router.get(
  "/plans",
  requireFeature("cs.plans"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listSuccessPlans(user.orgId, environment) });
  })
);

router.get(
  "/plans/:id",
  requireFeature("cs.plans"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { plan: await getSuccessPlan(user.orgId, environment, String(req.params.id)) });
  })
);

const planSchema = z.object({
  accountId: z.string().optional().nullable(),
  name: z.string().min(1).max(120),
  kind: z.string().default("onboarding"),
  ownerId: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  targetDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.string().optional(),
});

router.post(
  "/plans",
  requireFeature("cs.plans"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = planSchema.parse(req.body ?? {});
    ok(res, { plan: await createSuccessPlan(user.orgId, environment, input, user) }, 201);
  })
);

router.put(
  "/plans/:id",
  requireFeature("cs.plans"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { plan: await updateSuccessPlan(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.delete(
  "/plans/:id",
  requireFeature("cs.plans"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    await deleteSuccessPlan(user.orgId, environment, String(req.params.id), user);
    ok(res, { ok: true });
  })
);

router.post(
  "/plans/:id/milestones",
  requireFeature("cs.plans"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { title, dueDate } = z.object({ title: z.string().min(1), dueDate: z.string().optional().nullable() }).parse(req.body ?? {});
    ok(res, { plan: await addMilestone(user.orgId, environment, String(req.params.id), { title, dueDate }, user) }, 201);
  })
);

router.post(
  "/plans/:id/milestones/:mid",
  requireFeature("cs.plans"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { done } = z.object({ done: z.boolean().default(true) }).parse(req.body ?? {});
    ok(res, { plan: await setMilestone(user.orgId, environment, String(req.params.id), String(req.params.mid), done, user) });
  })
);

router.post(
  "/plans/:id/qbrs",
  requireFeature("cs.plans"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({ title: z.string().min(1).max(120), date: z.string().optional().nullable(), attendees: z.array(z.string()).optional(), notes: z.string().optional().nullable() }).parse(req.body ?? {});
    ok(res, { plan: await addQbr(user.orgId, environment, String(req.params.id), input, user) }, 201);
  })
);

// ── Usage intelligence (cs.usage) ───────────────────────────────────────────
router.get(
  "/usage",
  requireFeature("cs.usage"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, await usageOverview(user.orgId, environment));
  })
);

const usageSchema = z.object({
  type: z.string().optional(),
  feature: z.string().min(1).max(80),
  value: z.number().optional().nullable(),
  accountId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  profileId: z.string().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().optional().nullable(),
});

router.post(
  "/usage",
  requireFeature("cs.usage"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = usageSchema.parse(req.body ?? {});
    ok(res, { event: await ingestUsage(user.orgId, environment, input, user) }, 201);
  })
);

// ── Churn prediction + expansion radar (cs.churn) ───────────────────────────
router.get(
  "/churn",
  requireFeature("cs.churn"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    ok(res, { overview: await churnOverview(user.orgId, environment), history: await churnHistory(user.orgId, environment, accountId) });
  })
);

router.get(
  "/churn/expansion",
  requireFeature("cs.churn"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await expansionRadar(user.orgId, environment) });
  })
);

router.post(
  "/churn/refresh",
  requireFeature("cs.churn"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { refresh: await refreshChurn(user.orgId, environment, user.id) }, 201);
  })
);

// ── Surveys + roadmap pipeline (cs.surveys) ─────────────────────────────────
router.get(
  "/surveys",
  requireFeature("cs.surveys"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listSurveys(user.orgId, environment) });
  })
);

router.post(
  "/surveys",
  requireFeature("cs.surveys"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({ name: z.string().min(1), kind: z.string().optional(), question: z.string().optional(), targetSegmentId: z.string().optional().nullable() }).parse(req.body ?? {});
    ok(res, { survey: await createSurvey(user.orgId, environment, input, user) }, 201);
  })
);

router.put(
  "/surveys/:id",
  requireFeature("cs.surveys"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { survey: await updateSurvey(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.delete(
  "/surveys/:id",
  requireFeature("cs.surveys"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    await deleteSurvey(user.orgId, environment, String(req.params.id), user);
    ok(res, { ok: true });
  })
);

router.get(
  "/surveys/:id/responses",
  requireFeature("cs.surveys"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await surveyResponses(user.orgId, environment, String(req.params.id)) });
  })
);

router.get(
  "/surveys/:id/results",
  requireFeature("cs.surveys"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, await surveyResults(user.orgId, environment, String(req.params.id)));
  })
);

router.post(
  "/surveys/:id/responses",
  requireFeature("cs.surveys"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({
      score: z.number().int(),
      comment: z.string().optional().nullable(),
      contactId: z.string().optional().nullable(),
      profileId: z.string().optional().nullable(),
      accountId: z.string().optional().nullable(),
    }).parse(req.body ?? {});
    ok(res, await addSurveyResponse(user.orgId, environment, { surveyId: String(req.params.id), ...input }, user), 201);
  })
);

// Roadmap pipeline
router.get(
  "/roadmap",
  requireFeature("cs.surveys"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const status = req.query.status ? String(req.query.status) : undefined;
    ok(res, { items: await listRoadmap(user.orgId, environment, status) });
  })
);

router.post(
  "/roadmap",
  requireFeature("cs.surveys"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({
      title: z.string().min(1), description: z.string().optional().nullable(), source: z.string().optional(),
      category: z.string().optional(), surveyResponseId: z.string().optional().nullable(), status: z.string().optional(),
    }).parse(req.body ?? {});
    ok(res, { item: await createRoadmapItem(user.orgId, environment, input, user) }, 201);
  })
);

router.put(
  "/roadmap/:id",
  requireFeature("cs.surveys"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { item: await updateRoadmapItem(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.post(
  "/roadmap/:id/vote",
  requireFeature("cs.surveys"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { item: await voteRoadmapItem(user.orgId, environment, String(req.params.id)) });
  })
);

// ── Loyalty & advocacy (cs.loyalty) ─────────────────────────────────────────
router.get(
  "/loyalty",
  requireFeature("cs.loyalty"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { programs: await listPrograms(user.orgId, environment), members: await listMembers(user.orgId, environment) });
  })
);

router.post(
  "/loyalty/programs",
  requireFeature("cs.loyalty"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({ name: z.string().min(1), tiers: z.array(z.unknown()).optional(), rewards: z.array(z.unknown()).optional(), pointsRules: z.record(z.string(), z.number()).optional() }).parse(req.body ?? {});
    ok(res, { program: await createProgram(user.orgId, environment, input, user) }, 201);
  })
);

router.put(
  "/loyalty/programs/:id",
  requireFeature("cs.loyalty"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { program: await updateProgram(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.post(
  "/loyalty/programs/:id/members",
  requireFeature("cs.loyalty"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({ contactId: z.string().optional().nullable(), profileId: z.string().optional().nullable() }).parse(req.body ?? {});
    ok(res, { member: await enrollMember(user.orgId, environment, String(req.params.id), input, user) }, 201);
  })
);

router.post(
  "/loyalty/members/:id/award",
  requireFeature("cs.loyalty"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { points, reason } = z.object({ points: z.number().int().positive(), reason: z.string().min(1) }).parse(req.body ?? {});
    ok(res, { member: await awardPoints(user.orgId, environment, String(req.params.id), points, reason, user) }, 201);
  })
);

router.get(
  "/loyalty/referrals",
  requireFeature("cs.loyalty"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().referralRecord.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 100 });
    const referrerIds = [...new Set(items.map((r) => r.referrerContactId).filter(Boolean) as string[])];
    const referrers = referrerIds.length ? await db().contact.findMany({ where: { id: { in: referrerIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const nameById = new Map(referrers.map((c) => [c.id, `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email]));
    ok(res, { items: items.map((r) => ({ ...r, referrerName: r.referrerContactId ? (nameById.get(r.referrerContactId) ?? null) : null })) });
  })
);

router.post(
  "/loyalty/referrals",
  requireFeature("cs.loyalty"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({
      programId: z.string().min(1), referredEmail: z.string().min(3), referredName: z.string().optional().nullable(),
      referrerContactId: z.string().optional().nullable(), referrerProfileId: z.string().optional().nullable(),
    }).parse(req.body ?? {});
    ok(res, { referral: await createReferral(user.orgId, environment, input, user) }, 201);
  })
);

router.post(
  "/loyalty/referrals/:id/status",
  requireFeature("cs.loyalty"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { status } = z.object({ status: z.enum(["contacted", "converted", "expired"]) }).parse(req.body ?? {});
    ok(res, { referral: await setReferralStatus(user.orgId, environment, String(req.params.id), status, user) }, 201);
  })
);

// ── Engine tick (admin) — deterministic twin of the 60s ticker. Gated by the
// customer-success flags being enabled at all (usage/churn drive the work).
router.post(
  "/tick",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { featureState } = await import("../lib/features");
    const [usageOn, churnOn] = await Promise.all([featureState(user.orgId, environment, "cs.usage"), featureState(user.orgId, environment, "cs.churn")]);
    if (!usageOn?.enabled && !churnOn?.enabled) throw badRequest("Customer success is disabled for this workspace");
    ok(res, { tick: await runSuccessTicker(user.orgId, environment, user.id) }, 201);
  })
);

export default router;
