// Phase 12 · Field Operations routes — mounted at /api/field. Reads open
// (the page is a planning + dispatch surface); writes admin/manager via
// requireRole; every area is behind its own feature flag. All logic lives in
// lib/field.ts.
import { Router } from "express";
import { z } from "zod";
import { assertActiveUser, requireRole } from "../lib/auth";
import { resolveEnvironment } from "../lib/environment";
import { requireFeature } from "../lib/features";
import { asyncHandler, ok } from "../lib/http";
import {
  listTerritories, getTerritory, createTerritory, updateTerritory, deleteTerritory,
  listTechnicians, createTechnician, updateTechnician,
  listVisits, createVisit, startVisit, checkInVisit, completeVisit, cancelVisit, planRoute,
  listWorkOrders, createWorkOrder, dispatchWorkOrder, startWorkOrder, completeWorkOrder, cancelWorkOrder,
  listAssets, createAsset, updateAsset, completeMaintenance,
  listInventory, createInventoryItem, receiveStock, consumeStock,
  syncChanges, runFieldTicker, fieldOverview,
} from "../lib/field";

const router = Router();

// ── Overview ───────────────────────────────────────────────────────────────
router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { overview: await fieldOverview(user.orgId, environment) });
  })
);

// ── Territories (field.territories) ────────────────────────────────────────
router.get(
  "/territories",
  requireFeature("field.territories"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listTerritories(user.orgId, environment) });
  })
);

router.get(
  "/territories/:id",
  requireFeature("field.territories"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { territory: await getTerritory(user.orgId, environment, String(req.params.id)) });
  })
);

const territorySchema = z.object({
  name: z.string().min(1),
  region: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  accountIds: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

router.post(
  "/territories",
  requireFeature("field.territories"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { territory: await createTerritory(user.orgId, environment, territorySchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.put(
  "/territories/:id",
  requireFeature("field.territories"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { territory: await updateTerritory(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.delete(
  "/territories/:id",
  requireFeature("field.territories"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    await deleteTerritory(user.orgId, environment, String(req.params.id), user);
    ok(res, { ok: true });
  })
);

// ── Technicians (dispatch surface) ─────────────────────────────────────────
router.get(
  "/technicians",
  requireFeature("field.workorders"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listTechnicians(user.orgId, environment) });
  })
);

const technicianSchema = z.object({
  name: z.string().min(1),
  userId: z.string().optional().nullable(),
  territoryId: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  skills: z.array(z.string()).optional(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});

router.post(
  "/technicians",
  requireFeature("field.workorders"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { technician: await createTechnician(user.orgId, environment, technicianSchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.put(
  "/technicians/:id",
  requireFeature("field.workorders"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { technician: await updateTechnician(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

// ── Visits + GPS check-ins + route planning (field.visits) ────────────────
router.get(
  "/visits",
  requireFeature("field.visits"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { technicianId, status } = req.query as { technicianId?: string; status?: string };
    ok(res, { items: await listVisits(user.orgId, environment, { technicianId, status }) });
  })
);

const visitSchema = z.object({
  title: z.string().min(1),
  scheduledAt: z.string().min(1),
  territoryId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  technicianId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  "/visits",
  requireFeature("field.visits"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { visit: await createVisit(user.orgId, environment, visitSchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.post(
  "/visits/:id/start",
  requireFeature("field.visits"),
  requireRole("admin", "manager", "rep"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { visit: await startVisit(user.orgId, environment, String(req.params.id), user) });
  })
);

router.post(
  "/visits/:id/check-in",
  requireFeature("field.visits"),
  requireRole("admin", "manager", "rep"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { lat, lng } = z.object({ lat: z.number().optional(), lng: z.number().optional() }).parse(req.body ?? {});
    ok(res, { visit: await checkInVisit(user.orgId, environment, String(req.params.id), { lat, lng }, user) });
  })
);

router.post(
  "/visits/:id/complete",
  requireFeature("field.visits"),
  requireRole("admin", "manager", "rep"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { visit: await completeVisit(user.orgId, environment, String(req.params.id), user) });
  })
);

router.post(
  "/visits/:id/cancel",
  requireFeature("field.visits"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { visit: await cancelVisit(user.orgId, environment, String(req.params.id), user) });
  })
);

router.get(
  "/routes/optimize",
  requireFeature("field.visits"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { technicianId } = req.query as { technicianId?: string };
    ok(res, { route: await planRoute(user.orgId, environment, technicianId ?? null) });
  })
);

// ── Work orders + dispatch (field.workorders) ──────────────────────────────
router.get(
  "/workorders",
  requireFeature("field.workorders"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { status } = req.query as { status?: string };
    ok(res, { items: await listWorkOrders(user.orgId, environment, { status }) });
  })
);

const workOrderSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.string().optional(),
  accountId: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  territoryId: z.string().optional().nullable(),
  technicianId: z.string().optional().nullable(),
  slaDueAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  "/workorders",
  requireFeature("field.workorders"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { workOrder: await createWorkOrder(user.orgId, environment, workOrderSchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.post(
  "/workorders/:id/dispatch",
  requireFeature("field.workorders"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { technicianId } = z.object({ technicianId: z.string().min(1) }).parse(req.body ?? {});
    ok(res, { workOrder: await dispatchWorkOrder(user.orgId, environment, String(req.params.id), { technicianId }, user) });
  })
);

router.post(
  "/workorders/:id/start",
  requireFeature("field.workorders"),
  requireRole("admin", "manager", "rep"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { workOrder: await startWorkOrder(user.orgId, environment, String(req.params.id), user) });
  })
);

router.post(
  "/workorders/:id/complete",
  requireFeature("field.workorders"),
  requireRole("admin", "manager", "rep"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { notes, partsUsed } = z.object({
      notes: z.string().optional().nullable(),
      partsUsed: z.array(z.object({ sku: z.string().min(1), qty: z.number().int().positive() })).optional(),
    }).parse(req.body ?? {});
    ok(res, { workOrder: await completeWorkOrder(user.orgId, environment, String(req.params.id), { notes, partsUsed }, user) });
  })
);

router.post(
  "/workorders/:id/cancel",
  requireFeature("field.workorders"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { workOrder: await cancelWorkOrder(user.orgId, environment, String(req.params.id), user) });
  })
);

// ── Assets + maintenance (field.inventory) ─────────────────────────────────
router.get(
  "/assets",
  requireFeature("field.inventory"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listAssets(user.orgId, environment) });
  })
);

const assetSchema = z.object({
  name: z.string().min(1),
  accountId: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  warrantyUntil: z.string().optional().nullable(),
  lastMaintenanceAt: z.string().optional().nullable(),
  maintenanceIntervalDays: z.number().int().positive().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  "/assets",
  requireFeature("field.inventory"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { asset: await createAsset(user.orgId, environment, assetSchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.put(
  "/assets/:id",
  requireFeature("field.inventory"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { asset: await updateAsset(user.orgId, environment, String(req.params.id), req.body ?? {}, user) });
  })
);

router.post(
  "/assets/:id/maintenance",
  requireFeature("field.inventory"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { asset: await completeMaintenance(user.orgId, environment, String(req.params.id), user) });
  })
);

// ── Inventory (field.inventory) ────────────────────────────────────────────
router.get(
  "/inventory",
  requireFeature("field.inventory"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await listInventory(user.orgId, environment) });
  })
);

const inventorySchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  quantityOnHand: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  unitCost: z.number().min(0).optional(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  "/inventory",
  requireFeature("field.inventory"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { item: await createInventoryItem(user.orgId, environment, inventorySchema.parse(req.body ?? {}), user) }, 201);
  })
);

router.post(
  "/inventory/:id/receive",
  requireFeature("field.inventory"),
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { qty } = z.object({ qty: z.number() }).parse(req.body ?? {});
    ok(res, { item: await receiveStock(user.orgId, environment, String(req.params.id), { qty }, user) });
  })
);

router.post(
  "/inventory/:id/consume",
  requireFeature("field.inventory"),
  requireRole("admin", "manager", "rep"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { qty, reason } = z.object({ qty: z.number(), reason: z.string().optional() }).parse(req.body ?? {});
    ok(res, { item: await consumeStock(user.orgId, environment, String(req.params.id), { qty, reason }, user) });
  })
);

// ── Offline sync (docs/38-offline-sync-spec.md) ────────────────────────────
router.post(
  "/sync",
  requireFeature("field.visits"),
  requireRole("admin", "manager", "rep"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({
      since: z.string().optional().nullable(),
      changes: z.array(z.object({
        entity: z.string().min(1),
        op: z.enum(["create", "update"]),
        id: z.string().optional(),
        data: z.record(z.string(), z.unknown()),
        clientTs: z.number(),
      })).optional(),
    }).parse(req.body ?? {});
    ok(res, await syncChanges(user.orgId, environment, input, user));
  })
);

// ── Engine tick ────────────────────────────────────────────────────────────
router.post(
  "/tick",
  requireFeature("field.workorders"),
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { tick: await runFieldTicker(user.orgId, environment, user.id) });
  })
);

export default router;
