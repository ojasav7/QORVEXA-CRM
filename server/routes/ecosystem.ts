// Phase 13 · Ecosystem routes — mounted at /api/ecosystem. Reads open (the
// page is a monitoring + management surface); writes admin/manager; install/
// uninstall + listing config are admin. Per-route feature gates
// (ecosystem.marketplace / ecosystem.partners / ecosystem.changesets /
// ecosystem.schema). All logic lives in lib/ecosystem.ts.
import { Router } from "express";
import { z } from "zod";
import { assertActiveUser, requireRole } from "../lib/auth";
import { resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import { asyncHandler, badRequest, ok } from "../lib/http";
import {
  listListings, createListing, updateListing, deleteListing,
  listApps, installApp, uninstallApp,
  listPartners, createPartner, updatePartner, registerPartnerDeal, setPartnerDealStatus,
  diffEnvironments, createChangeSet, listChangeSets, promoteChangeSet,
  fieldImpact, safeDeleteField, ecosystemOverview,
} from "../lib/ecosystem";

const router = Router();

// ── Overview ───────────────────────────────────────────────────────────────
router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { overview: await ecosystemOverview(user.orgId, environment) });
  })
);

// ── Marketplace (ecosystem.marketplace) ────────────────────────────────────
router.get(
  "/marketplace",
  requireFeature("ecosystem.marketplace"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listListings(user.orgId, environment) });
  })
);

const listingSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().optional(),
  description: z.string().optional().nullable(),
  publisher: z.string().optional(),
  version: z.string().optional(),
  icon: z.string().optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional(),
});

router.post(
  "/marketplace",
  requireFeature("ecosystem.marketplace"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { listing: await createListing(user.orgId, environment, listingSchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.put(
  "/marketplace/:id",
  requireFeature("ecosystem.marketplace"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { listing: await updateListing(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.delete(
  "/marketplace/:id",
  requireFeature("ecosystem.marketplace"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    await deleteListing(user.orgId, environment, String(req.params.id), user);
    ok(res, { ok: true });
  })
);

// ── Apps (install / uninstall) ─────────────────────────────────────────────
router.get(
  "/apps",
  requireFeature("ecosystem.marketplace"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listApps(user.orgId, environment) });
  })
);

router.post(
  "/apps/install",
  requireFeature("ecosystem.marketplace"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { listingId } = z.object({ listingId: z.string().min(1) }).parse(req.body ?? {});
    ok(res, { app: await installApp(user.orgId, environment, { listingId }, user) }, 201);
  })
);

router.post(
  "/apps/:id/uninstall",
  requireFeature("ecosystem.marketplace"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { app: await uninstallApp(user.orgId, environment, String(req.params.id), user) });
  })
);

// ── Partners (ecosystem.partners) ──────────────────────────────────────────
router.get(
  "/partners",
  requireFeature("ecosystem.partners"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listPartners(user.orgId, environment) });
  })
);

const partnerSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  contactName: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  commissionRate: z.number().min(0).max(1).optional(),
  notes: z.string().optional().nullable(),
});

router.post(
  "/partners",
  requireFeature("ecosystem.partners"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { partner: await createPartner(user.orgId, environment, partnerSchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.put(
  "/partners/:id",
  requireFeature("ecosystem.partners"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { partner: await updatePartner(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.post(
  "/partners/:id/deals",
  requireFeature("ecosystem.partners"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { name, amount, opportunityId } = z.object({ name: z.string().min(1), amount: z.number().optional(), opportunityId: z.string().optional().nullable() }).parse(req.body ?? {});
    ok(res, { partner: await registerPartnerDeal(user.orgId, environment, { partnerId: String(req.params.id), name, amount, opportunityId }, user) }, 201);
  })
);

router.post(
  "/partners/deals/:id/status",
  requireFeature("ecosystem.partners"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { status } = z.object({ status: z.string().min(1) }).parse(req.body ?? {});
    ok(res, { deal: await setPartnerDealStatus(user.orgId, environment, String(req.params.id), status, user) });
  })
);

// ── Change sets + env promotion (ecosystem.changesets) ─────────────────────
router.post(
  "/changesets/diff",
  requireFeature("ecosystem.changesets"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { from, to } = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(req.body ?? {});
    ok(res, { items: await diffEnvironments(user.orgId, from, to) });
  })
);

router.get(
  "/changesets",
  requireFeature("ecosystem.changesets"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listChangeSets(user.orgId, environment) });
  })
);

const changeSetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  items: z.array(z.object({ entity: z.string().min(1), op: z.string().min(1), key: z.string().min(1), data: z.record(z.string(), z.unknown()).optional() })).min(1),
  fromEnv: z.string().optional().nullable(),
  toEnv: z.string().optional().nullable(),
});

router.post(
  "/changesets",
  requireFeature("ecosystem.changesets"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { changeSet: await createChangeSet(user.orgId, environment, changeSetSchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.post(
  "/changesets/:id/promote",
  requireFeature("ecosystem.changesets"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { to } = z.object({ to: z.string().min(1) }).parse(req.body ?? {});
    ok(res, { changeSet: await promoteChangeSet(user.orgId, environment, String(req.params.id), to, user) });
  })
);

// ── Schema change safety (ecosystem.schema) ────────────────────────────────
router.get(
  "/schema/impact",
  requireFeature("ecosystem.schema"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { objectType, key } = req.query as { objectType: string; key: string };
    if (!objectType || !key) throw badRequest("objectType and key are required");
    ok(res, await fieldImpact(user.orgId, environment, objectType, key));
  })
);

router.post(
  "/schema/safe-delete",
  requireFeature("ecosystem.schema"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.body ?? {});
    ok(res, await safeDeleteField(user.orgId, environment, id, user));
  })
);

export default router;
