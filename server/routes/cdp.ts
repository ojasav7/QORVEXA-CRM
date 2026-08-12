// CDP / Customer 360 (Phase 7) — flag cdp.profiles.
//
// One router for the whole CDP surface: unified customer profiles + identity
// resolution (list/360/rebuild/merge), behavioral event ingestion + listing,
// the relationship graph (account + deal views), and the customer health
// engine (derived on read + admin snapshot refresh that persists history and
// emits customer.health_changed / customer.churn_risk_changed). Reads open to
// any authenticated user; writes (rebuild / merge / health refresh) admin-only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import {
  BEHAVIOR_TYPES,
  ensureProfileForRecord,
  ingestBehavior,
  listProfiles,
  mergeProfiles,
  profile360,
  rebuildProfiles,
} from "../lib/cdp";
import { healthFor, refreshHealth } from "../lib/health";
import { graphForAccount, graphForDeal, graphForContact } from "../lib/graph";

const router = Router();

// GET /api/cdp/overview — the CDP headline numbers.
router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const [profiles, contacts, leads, behaviors, behaviorRows, lastRefresh, healthRows] = await Promise.all([
      db().identityProfile.findMany({ where: { orgId: user.orgId, environment }, select: { id: true, memberIds: true } }),
      db().contact.count({ where: { orgId: user.orgId, environment } }),
      db().lead.count({ where: { orgId: user.orgId, environment } }),
      db().behaviorEvent.count({ where: { orgId: user.orgId, environment } }),
      db().behaviorEvent.findMany({ where: { orgId: user.orgId, environment }, select: { type: true } }),
      db().healthScore.findFirst({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db().healthScore.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 200, select: { profileId: true, score: true, createdAt: true } }),
    ]);
    const byType = new Map<string, number>();
    for (const b of behaviorRows) byType.set(b.type, (byType.get(b.type) ?? 0) + 1);
    const latest = new Map<string, number>();
    for (const h of healthRows) if (!latest.has(h.profileId)) latest.set(h.profileId, h.score);
    const scores = [...latest.values()];
    ok(res, {
      profiles: profiles.length,
      contacts,
      leads,
      records: contacts + leads,
      merged: profiles.filter((p) => ((p.memberIds as string[]) ?? []).length > 1).length,
      behaviors,
      behaviorByType: Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
      avgHealth: scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0,
      atRisk: scores.filter((s) => 100 - s >= 70).length,
      lastHealthRefresh: lastRefresh?.createdAt ?? null,
      behaviorCatalog: BEHAVIOR_TYPES,
    });
  })
);

// GET /api/cdp/profiles?q=&limit=&offset= — unified customer list.
router.get(
  "/profiles",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const q = String(req.query.q ?? "");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const { items, total } = await listProfiles(user.orgId, environment, { q, limit, offset });
    // Attach the derived health + churn to each row (explained, live).
    const enriched = await Promise.all(
      items.map(async (p) => {
        const health = await healthFor(user.orgId, environment, p);
        return { ...p, health };
      })
    );
    ok(res, { items: enriched, total });
  })
);

// GET /api/cdp/profiles/:id — the full 360 view.
router.get(
  "/profiles/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const view = await profile360(user.orgId, environment, id);
    const health = await healthFor(user.orgId, environment, view.profile);
    const history = await db().healthScore.findMany({ where: { orgId: user.orgId, environment, profileId: id }, orderBy: { createdAt: "desc" }, take: 20 });
    // The person's slice of the relationship graph.
    const contactMembers = (view.profile.memberIds as string[]).filter((m) => m.startsWith("contact:"));
    const graphs = [];
    for (const ref of contactMembers.slice(0, 5)) {
      const g = await graphForContact(user.orgId, environment, ref.split(":")[1]);
      if (g) graphs.push(g);
    }
    ok(res, { ...view, health, history, graphs });
  })
);

// POST /api/cdp/profiles/rebuild (admin) — reconcile contacts + leads into profiles.
router.post(
  "/profiles/rebuild",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const result = await rebuildProfiles(user.orgId, environment, user.id);
    await emitEvent({ orgId: user.orgId, environment, type: "customer.profiles_rebuilt", entity: "identityProfile", entityId: "000000000000000000000000", actorId: user.id, payload: result });
    ok(res, result);
  })
);

// POST /api/cdp/profiles/merge (admin) — unify two profiles (identity merge).
const mergeSchema = z.object({
  fromId: z.string().min(1),
  intoId: z.string().min(1),
});
router.post(
  "/profiles/merge",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { fromId, intoId } = mergeSchema.parse(req.body);
    const profile = await mergeProfiles(user.orgId, environment, fromId, intoId, user.id);
    ok(res, { profile }, 201);
  })
);

// POST /api/cdp/behaviors — ingest one customer behavior (websites/products call this).
const behaviorSchema = z.object({
  type: z.string().min(1).max(60),
  email: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  profileId: z.string().optional(),
  entity: z.string().max(60).optional(),
  entityId: z.string().optional(),
  value: z.number().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().optional(),
});
router.post(
  "/behaviors",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = behaviorSchema.parse(req.body);
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;
    const created = await ingestBehavior(user.orgId, environment, input, { source: "api", actorId: user.id, ip });
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "customer.behavior_tracked",
      entity: "behaviorEvent",
      entityId: created.id,
      actorId: user.id,
      payload: { type: created.type, profileId: created.profileId },
    });
    ok(res, { behavior: created }, 201);
  })
);

// DELETE /api/cdp/behaviors/:id (admin) — purge one touchpoint (governance).
router.delete(
  "/behaviors/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const behavior = await db().behaviorEvent.findUnique({ where: { id } });
    if (!behavior || behavior.orgId !== user.orgId || behavior.environment !== environment) throw notFound("Behavior not found");
    await db().behaviorEvent.delete({ where: { id } });
    ok(res, { ok: true });
  })
);

// GET /api/cdp/behaviors?profileId=&type=&limit= — the touchpoint stream.
router.get(
  "/behaviors",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const profileId = req.query.profileId ? String(req.query.profileId) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const where: Record<string, unknown> = { orgId: user.orgId, environment };
    if (profileId) where.profileId = profileId;
    if (type) where.type = type;
    const [items, total] = await Promise.all([
      db().behaviorEvent.findMany({ where, orderBy: { occurredAt: "desc" }, take: limit }),
      db().behaviorEvent.count({ where }),
    ]);
    ok(res, { items, total });
  })
);

// GET /api/cdp/graph?accountId= | ?dealId= — the relationship graph.
router.get(
  "/graph",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    if (req.query.accountId) {
      const graph = await graphForAccount(user.orgId, environment, String(req.query.accountId));
      ok(res, graph);
      return;
    }
    if (req.query.dealId) {
      const graph = await graphForDeal(user.orgId, environment, String(req.query.dealId));
      ok(res, graph);
      return;
    }
    throw badRequest("Pass accountId or dealId to query the relationship graph");
  })
);

// GET /api/cdp/health?profileId= — the explained health score, computed live.
router.get(
  "/health",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const profileId = String(req.query.profileId ?? "");
    if (!profileId) throw badRequest("profileId is required");
    const profile = await db().identityProfile.findUnique({ where: { id: profileId } });
    if (!profile || profile.orgId !== user.orgId || profile.environment !== environment) throw notFound("Profile not found");
    const health = await healthFor(user.orgId, environment, profile);
    ok(res, { health });
  })
);

// GET /api/cdp/health/history?profileId= — persisted snapshots (deltas).
router.get(
  "/health/history",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const profileId = String(req.query.profileId ?? "");
    if (!profileId) throw badRequest("profileId is required");
    const items = await db().healthScore.findMany({ where: { orgId: user.orgId, environment, profileId }, orderBy: { createdAt: "desc" }, take: 30 });
    ok(res, { items });
  })
);

// POST /api/cdp/health/refresh (admin) — persist a snapshot per profile + emit events.
router.post(
  "/health/refresh",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const summary = await refreshHealth(user.orgId, environment, user.id);
    ok(res, summary, 201);
  })
);

export default router;
