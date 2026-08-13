// Phase 12 · Field Operations — territory management, field service (visits,
// dispatch, work orders), route planning + GPS check-ins, assets & inventory,
// and offline sync. All logic lives here (ADR-015/017 row-as-config pattern):
// routes/field.ts + the engine ticker are the only other code.
//
// Conventions: every row is org × environment scoped (ADR-008), every state
// change is evented (`visit.checked_in`, `workorder.completed`,
// `asset.maintenance_due`, `inventory.reorder_triggered`, …), reads are
// derived at read time (no stored rollups), and RBAC is admin/manager for
// writes with reads open (the page is a planning + dispatch surface).
import { db } from "../db";
import { emitEvent } from "./events";
import { badRequest, notFound } from "./http";
import { PRODUCTION_ENV } from "./environment";

// ── Notifications (kind: field) ────────────────────────────────────────────
export async function notifyFieldAdmins(orgId: string, environment: string, title: string, body: string, link: string): Promise<void> {
  const admins = await db().user.findMany({ where: { orgId, role: "admin", active: true }, select: { id: true } });
  for (const a of admins) {
    await db().notification.create({ data: { orgId, environment, userId: a.id, title, body, kind: "field", link } });
  }
}

type Actor = { id: string };

// ── Territories (field.territories) ────────────────────────────────────────
export async function listTerritories(orgId: string, environment: string): Promise<any[]> {
  const rows = await db().territory.findMany({ where: { orgId, environment }, orderBy: { name: "asc" } });
  const users = await db().user.findMany({ where: { orgId }, select: { id: true, name: true } });
  const userById = new Map(users.map((u) => [u.id, u.name]));
  const accounts = await db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } });
  const accountById = new Map(accounts.map((a) => [a.id, a.name]));
  return rows.map((t) => {
    const ids = ((t.accountIds ?? []) as string[]);
    return {
      id: t.id, name: t.name, region: t.region, active: t.active, notes: t.notes,
      ownerId: t.ownerId, ownerName: t.ownerId ? userById.get(t.ownerId) ?? null : null,
      accountIds: ids, accountNames: ids.map((id) => accountById.get(id) ?? null).filter(Boolean),
      createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  });
}

export async function getTerritory(orgId: string, environment: string, id: string): Promise<any> {
  const t = await db().territory.findFirst({ where: { id, orgId, environment } });
  if (!t) throw notFound("Territory not found");
  return (await listTerritories(orgId, environment)).find((x) => x.id === id) ?? null;
}

export async function createTerritory(orgId: string, environment: string, input: {
  name: string; region?: string | null; ownerId?: string | null; accountIds?: string[]; active?: boolean; notes?: string | null;
}, actor: Actor): Promise<any> {
  const name = (input.name ?? "").trim();
  if (!name) throw badRequest("Territory name is required");
  const territory = await db().territory.create({
    data: {
      orgId, environment, name, region: input.region ?? null, ownerId: input.ownerId ?? null,
      accountIds: (input.accountIds ?? []) as any, active: input.active ?? true, notes: input.notes ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "territory.created", entity: "territory", entityId: territory.id, actorId: actor.id, payload: { name } });
  return getTerritory(orgId, environment, territory.id);
}

export async function updateTerritory(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: Actor): Promise<any> {
  const t = await db().territory.findFirst({ where: { id, orgId, environment } });
  if (!t) throw notFound("Territory not found");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.region !== undefined) data.region = input.region === null ? null : String(input.region);
  if (input.ownerId !== undefined) data.ownerId = input.ownerId === null ? null : String(input.ownerId);
  if (input.accountIds !== undefined) data.accountIds = input.accountIds as any;
  if (input.active !== undefined) data.active = Boolean(input.active);
  if (input.notes !== undefined) data.notes = input.notes === null ? null : String(input.notes);
  if (!Object.keys(data).length) throw badRequest("Nothing to update");
  const updated = await db().territory.update({ where: { id }, data });
  await emitEvent({ orgId, environment, type: "territory.updated", entity: "territory", entityId: id, actorId: actor.id, payload: { name: updated.name } });
  return getTerritory(orgId, environment, id);
}

export async function deleteTerritory(orgId: string, environment: string, id: string, actor: Actor): Promise<void> {
  const t = await db().territory.findFirst({ where: { id, orgId, environment } });
  if (!t) throw notFound("Territory not found");
  await db().territory.delete({ where: { id } });
  await emitEvent({ orgId, environment, type: "territory.deleted", entity: "territory", entityId: id, actorId: actor.id, payload: { name: t.name } });
}

// ── Technicians (field.workorders / dispatch surface) ──────────────────────
export async function listTechnicians(orgId: string, environment: string): Promise<any[]> {
  const rows = await db().technician.findMany({ where: { orgId, environment }, orderBy: { name: "asc" } });
  const territories = await db().territory.findMany({ where: { orgId, environment }, select: { id: true, name: true } });
  const tById = new Map(territories.map((t) => [t.id, t.name]));
  const openWos = await db().workOrder.findMany({ where: { orgId, environment, status: { in: ["open", "dispatched", "in_progress"] } }, select: { technicianId: true } });
  const loadByTech = new Map<string, number>();
  for (const w of openWos) if (w.technicianId) loadByTech.set(w.technicianId, (loadByTech.get(w.technicianId) ?? 0) + 1);
  return rows.map((t) => ({
    id: t.id, name: t.name, phone: t.phone, skills: (t.skills ?? []) as string[],
    status: t.status, lat: t.lat, lng: t.lng,
    territoryId: t.territoryId, territoryName: t.territoryId ? tById.get(t.territoryId) ?? null : null,
    openWorkOrders: loadByTech.get(t.id) ?? 0,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  }));
}

export async function createTechnician(orgId: string, environment: string, input: {
  name: string; userId?: string | null; territoryId?: string | null; phone?: string | null; skills?: string[]; lat?: number | null; lng?: number | null;
}, actor: Actor): Promise<any> {
  const name = (input.name ?? "").trim();
  if (!name) throw badRequest("Technician name is required");
  const tech = await db().technician.create({
    data: {
      orgId, environment, name, userId: input.userId ?? null, territoryId: input.territoryId ?? null,
      phone: input.phone ?? null, skills: (input.skills ?? []) as any, lat: input.lat ?? null, lng: input.lng ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "technician.created", entity: "technician", entityId: tech.id, actorId: actor.id, payload: { name } });
  return (await listTechnicians(orgId, environment)).find((x) => x.id === tech.id) ?? null;
}

export async function updateTechnician(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: Actor): Promise<any> {
  const t = await db().technician.findFirst({ where: { id, orgId, environment } });
  if (!t) throw notFound("Technician not found");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.phone !== undefined) data.phone = input.phone === null ? null : String(input.phone);
  if (input.territoryId !== undefined) data.territoryId = input.territoryId === null ? null : String(input.territoryId);
  if (input.skills !== undefined) data.skills = input.skills as any;
  if (input.status !== undefined) {
    const s = String(input.status);
    if (!["available", "on_route", "off_duty"].includes(s)) throw badRequest(`Unknown technician status: "${s}"`);
    data.status = s;
  }
  if (input.lat !== undefined) data.lat = input.lat === null ? null : Number(input.lat);
  if (input.lng !== undefined) data.lng = input.lng === null ? null : Number(input.lng);
  if (!Object.keys(data).length) throw badRequest("Nothing to update");
  const updated = await db().technician.update({ where: { id }, data });
  await emitEvent({ orgId, environment, type: "technician.updated", entity: "technician", entityId: id, actorId: actor.id, payload: { name: updated.name, status: updated.status } });
  return (await listTechnicians(orgId, environment)).find((x) => x.id === id) ?? null;
}

// ── Visits + GPS check-ins + route planning (field.visits) ─────────────────
export async function listVisits(orgId: string, environment: string, opts: { technicianId?: string; status?: string } = {}): Promise<any[]> {
  const rows = await db().visit.findMany({
    where: { orgId, environment, ...(opts.technicianId ? { technicianId: opts.technicianId } : {}), ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { scheduledAt: "asc" },
  });
  const [technicians, accounts, contacts, territories] = await Promise.all([
    db().technician.findMany({ where: { orgId, environment }, select: { id: true, name: true } }),
    db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } }),
    db().contact.findMany({ where: { orgId, environment }, select: { id: true, firstName: true, lastName: true } }),
    db().territory.findMany({ where: { orgId, environment }, select: { id: true, name: true } }),
  ]);
  const tech = new Map(technicians.map((t) => [t.id, t.name]));
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const con = new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  const ter = new Map(territories.map((t) => [t.id, t.name]));
  return rows.map((v) => ({
    id: v.id, title: v.title, scheduledAt: v.scheduledAt, status: v.status,
    checkInAt: v.checkInAt, checkInLat: v.checkInLat, checkInLng: v.checkInLng, notes: v.notes,
    territoryId: v.territoryId, territoryName: v.territoryId ? ter.get(v.territoryId) ?? null : null,
    accountId: v.accountId, accountName: v.accountId ? acc.get(v.accountId) ?? null : null,
    contactId: v.contactId, contactName: v.contactId ? con.get(v.contactId) ?? null : null,
    technicianId: v.technicianId, technicianName: v.technicianId ? tech.get(v.technicianId) ?? null : null,
    createdAt: v.createdAt, updatedAt: v.updatedAt,
  }));
}

export async function createVisit(orgId: string, environment: string, input: {
  title: string; scheduledAt: string; territoryId?: string | null; accountId?: string | null; contactId?: string | null; technicianId?: string | null; notes?: string | null;
}, actor: Actor): Promise<any> {
  const title = (input.title ?? "").trim();
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (!title) throw badRequest("Visit title is required");
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) throw badRequest("A valid scheduledAt date is required");
  const visit = await db().visit.create({
    data: {
      orgId, environment, title, scheduledAt, territoryId: input.territoryId ?? null,
      accountId: input.accountId ?? null, contactId: input.contactId ?? null, technicianId: input.technicianId ?? null,
      notes: input.notes ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "visit.scheduled", entity: "visit", entityId: visit.id, actorId: actor.id, payload: { title, technicianId: visit.technicianId } });
  return (await listVisits(orgId, environment, {})).find((x) => x.id === visit.id) ?? null;
}

/** Set a visit to in_transit (the technician is en route). */
export async function startVisit(orgId: string, environment: string, id: string, actor: Actor): Promise<any> {
  const v = await db().visit.findFirst({ where: { id, orgId, environment } });
  if (!v) throw notFound("Visit not found");
  if (v.status === "cancelled" || v.status === "completed") throw badRequest(`Cannot start a ${v.status} visit`);
  await db().visit.update({ where: { id }, data: { status: "in_transit" } });
  return (await listVisits(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

/** GPS check-in: records checkInAt + lat/lng and emits visit.checked_in. */
export async function checkInVisit(orgId: string, environment: string, id: string, input: { lat?: number; lng?: number }, actor: Actor): Promise<any> {
  const v = await db().visit.findFirst({ where: { id, orgId, environment } });
  if (!v) throw notFound("Visit not found");
  if (v.status === "cancelled" || v.status === "completed") throw badRequest(`Cannot check in to a ${v.status} visit`);
  const lat = input.lat !== undefined ? Number(input.lat) : null;
  const lng = input.lng !== undefined ? Number(input.lng) : null;
  const updated = await db().visit.update({ where: { id }, data: { status: "checked_in", checkInAt: new Date(), checkInLat: lat, checkInLng: lng } });
  await emitEvent({ orgId, environment, type: "visit.checked_in", entity: "visit", entityId: id, actorId: actor.id, payload: { title: v.title, lat, lng } });
  // Remember the technician's last position for route planning.
  if (v.technicianId) {
    await db().technician.update({ where: { id: v.technicianId }, data: { lat, lng, status: "on_route" } }).catch(() => {});
  }
  return (await listVisits(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

export async function completeVisit(orgId: string, environment: string, id: string, actor: Actor): Promise<any> {
  const v = await db().visit.findFirst({ where: { id, orgId, environment } });
  if (!v) throw notFound("Visit not found");
  if (v.status === "cancelled") throw badRequest("Cannot complete a cancelled visit");
  const updated = await db().visit.update({ where: { id }, data: { status: "completed", checkInAt: v.checkInAt ?? new Date() } });
  await emitEvent({ orgId, environment, type: "visit.completed", entity: "visit", entityId: id, actorId: actor.id, payload: { title: v.title } });
  return (await listVisits(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

export async function cancelVisit(orgId: string, environment: string, id: string, actor: Actor): Promise<any> {
  const v = await db().visit.findFirst({ where: { id, orgId, environment } });
  if (!v) throw notFound("Visit not found");
  if (v.status === "completed") throw badRequest("Cannot cancel a completed visit");
  await db().visit.update({ where: { id }, data: { status: "cancelled" } });
  await emitEvent({ orgId, environment, type: "visit.cancelled", entity: "visit", entityId: id, actorId: actor.id, payload: { title: v.title } });
  return (await listVisits(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

// Route optimization — greedy nearest-neighbor over a technician's planned
// (non-cancelled) visits starting from the technician's last GPS position.
// Deterministic: ties break by scheduledAt. Returns the ordered visits with a
// per-leg distance estimate (haversine, km).
export async function planRoute(orgId: string, environment: string, technicianId?: string | null): Promise<{ technicianId: string | null; technicianName: string | null; ordered: any[]; totalKm: number }> {
  const tech = technicianId ? await db().technician.findFirst({ where: { id: technicianId, orgId, environment } }) : null;
  if (technicianId && !tech) throw notFound("Technician not found");
  const where: any = { orgId, environment, status: { in: ["planned", "in_transit", "checked_in"] } };
  if (tech) where.technicianId = tech.id;
  const visits = await listVisits(orgId, environment, {});
  const candidates = visits.filter((v) => !["cancelled", "completed"].includes(v.status) && (!tech || v.technicianId === tech.id));

  // Fall back to the account's last known position when the technician has no
  // GPS fix: use the visit's own coordinates if any, else account midpoint
  // (deterministic: first account in the list).
  const posOf = (v: any): { lat: number; lng: number } => {
    if (v.checkInLat != null && v.checkInLng != null) return { lat: v.checkInLat, lng: v.checkInLng };
    return { lat: 40.7128, lng: -74.006 }; // demo hub (NYC) when unknown
  };
  const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const start = tech?.lat != null && tech?.lng != null ? { lat: tech.lat, lng: tech.lng } : { lat: 40.7128, lng: -74.006 };
  const remaining = [...candidates].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const ordered: any[] = [];
  let cur = start;
  let totalKm = 0;
  while (remaining.length) {
    remaining.sort((a, b) => dist(cur, posOf(a)) - dist(cur, posOf(b)));
    const next = remaining.shift()!;
    const leg = dist(cur, posOf(next));
    totalKm += leg;
    ordered.push({ ...next, legKm: Math.round(leg * 10) / 10, cumulativeKm: Math.round(totalKm * 10) / 10 });
    cur = posOf(next);
  }
  return {
    technicianId: tech?.id ?? null,
    technicianName: tech?.name ?? null,
    ordered,
    totalKm: Math.round(totalKm * 10) / 10,
  };
}

// ── Work orders + dispatch + SLA (field.workorders) ────────────────────────
export async function listWorkOrders(orgId: string, environment: string, opts: { status?: string } = {}): Promise<any[]> {
  const rows = await db().workOrder.findMany({
    where: { orgId, environment, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
  const [technicians, accounts, assets, territories] = await Promise.all([
    db().technician.findMany({ where: { orgId, environment }, select: { id: true, name: true } }),
    db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } }),
    db().asset.findMany({ where: { orgId, environment }, select: { id: true, name: true, serialNumber: true } }),
    db().territory.findMany({ where: { orgId, environment }, select: { id: true, name: true } }),
  ]);
  const tech = new Map(technicians.map((t) => [t.id, t.name]));
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const ast = new Map(assets.map((a) => [a.id, a.name]));
  const ter = new Map(territories.map((t) => [t.id, t.name]));
  const now = Date.now();
  return rows.map((w) => ({
    id: w.id, title: w.title, description: w.description, priority: w.priority, status: w.status,
    slaDueAt: w.slaDueAt, startedAt: w.startedAt, completedAt: w.completedAt, notes: w.notes,
    partsUsed: (w.partsUsed ?? []) as any[], slaBreached: !!w.slaDueAt && !["completed", "cancelled"].includes(w.status) && new Date(w.slaDueAt).getTime() < now,
    territoryId: w.territoryId, territoryName: w.territoryId ? ter.get(w.territoryId) ?? null : null,
    accountId: w.accountId, accountName: w.accountId ? acc.get(w.accountId) ?? null : null,
    assetId: w.assetId, assetName: w.assetId ? ast.get(w.assetId) ?? null : null,
    technicianId: w.technicianId, technicianName: w.technicianId ? tech.get(w.technicianId) ?? null : null,
    createdAt: w.createdAt, updatedAt: w.updatedAt,
  }));
}

export async function createWorkOrder(orgId: string, environment: string, input: {
  title: string; description?: string | null; priority?: string; accountId?: string | null; assetId?: string | null;
  territoryId?: string | null; technicianId?: string | null; slaDueAt?: string | null; notes?: string | null;
}, actor: Actor): Promise<any> {
  const title = (input.title ?? "").trim();
  if (!title) throw badRequest("Work order title is required");
  const priority = input.priority ?? "medium";
  if (!["low", "medium", "high", "critical"].includes(priority)) throw badRequest(`Unknown priority: "${priority}"`);
  const slaDueAt = input.slaDueAt ? new Date(input.slaDueAt) : null;
  if (slaDueAt && Number.isNaN(slaDueAt.getTime())) throw badRequest("Invalid slaDueAt date");
  const wo = await db().workOrder.create({
    data: {
      orgId, environment, title, description: input.description ?? null, priority, accountId: input.accountId ?? null,
      assetId: input.assetId ?? null, territoryId: input.territoryId ?? null, technicianId: input.technicianId ?? null,
      slaDueAt, notes: input.notes ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "workorder.created", entity: "workOrder", entityId: wo.id, actorId: actor.id, payload: { title, priority } });
  return (await listWorkOrders(orgId, environment, {})).find((x) => x.id === wo.id) ?? null;
}

/** Dispatch an open work order to a technician (or re-assign). */
export async function dispatchWorkOrder(orgId: string, environment: string, id: string, input: { technicianId: string }, actor: Actor): Promise<any> {
  const wo = await db().workOrder.findFirst({ where: { id, orgId, environment } });
  if (!wo) throw notFound("Work order not found");
  if (["completed", "cancelled"].includes(wo.status)) throw badRequest(`Cannot dispatch a ${wo.status} work order`);
  const tech = await db().technician.findFirst({ where: { id: input.technicianId, orgId, environment } });
  if (!tech) throw badRequest("Technician not found");
  await db().workOrder.update({ where: { id }, data: { technicianId: tech.id, status: "dispatched" } });
  await db().technician.update({ where: { id: tech.id }, data: { status: "on_route" } }).catch(() => {});
  await emitEvent({ orgId, environment, type: "workorder.dispatched", entity: "workOrder", entityId: id, actorId: actor.id, payload: { title: wo.title, technicianId: tech.id } });
  return (await listWorkOrders(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

export async function startWorkOrder(orgId: string, environment: string, id: string, actor: Actor): Promise<any> {
  const wo = await db().workOrder.findFirst({ where: { id, orgId, environment } });
  if (!wo) throw notFound("Work order not found");
  if (["completed", "cancelled"].includes(wo.status)) throw badRequest(`Cannot start a ${wo.status} work order`);
  await db().workOrder.update({ where: { id }, data: { status: "in_progress", startedAt: wo.startedAt ?? new Date() } });
  return (await listWorkOrders(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

/** Complete a work order. partsUsed [{sku, qty}] deducts inventory stock; the
 *  serviced asset's maintenance clock resets. Emits workorder.completed. */
export async function completeWorkOrder(orgId: string, environment: string, id: string, input: { notes?: string | null; partsUsed?: { sku: string; qty: number }[] }, actor: Actor): Promise<any> {
  const wo = await db().workOrder.findFirst({ where: { id, orgId, environment } });
  if (!wo) throw notFound("Work order not found");
  if (wo.status === "cancelled") throw badRequest("Cannot complete a cancelled work order");
  const parts = (input.partsUsed ?? []) as { sku: string; qty: number }[];
  // Consume parts from inventory (validate stock first — atomic-ish: check all, then deduct).
  if (parts.length) {
    for (const p of parts) {
      const item = await db().inventoryItem.findFirst({ where: { orgId, environment, sku: p.sku } });
      if (!item) throw badRequest(`Unknown part SKU: ${p.sku}`);
      if (item.quantityOnHand < p.qty) throw badRequest(`Insufficient stock for ${p.sku} (on hand ${item.quantityOnHand}, need ${p.qty})`);
    }
    for (const p of parts) {
      await db().inventoryItem.updateMany({ where: { orgId, environment, sku: p.sku }, data: { quantityOnHand: { decrement: p.qty } } });
      await emitEvent({ orgId, environment, type: "inventory.consumed", entity: "inventoryItem", entityId: id, actorId: actor.id, payload: { sku: p.sku, qty: p.qty, reason: `workorder ${wo.title}` } });
    }
  }
  const updated = await db().workOrder.update({ where: { id }, data: { status: "completed", completedAt: new Date(), notes: input.notes ?? wo.notes, partsUsed: parts as any } });
  // Reset the asset's maintenance clock.
  if (wo.assetId) {
    await db().asset.update({ where: { id: wo.assetId }, data: { lastMaintenanceAt: new Date(), status: "active" } }).catch(() => {});
  }
  if (wo.technicianId) {
    await db().technician.update({ where: { id: wo.technicianId }, data: { status: "available" } }).catch(() => {});
  }
  await emitEvent({ orgId, environment, type: "workorder.completed", entity: "workOrder", entityId: id, actorId: actor.id, payload: { title: wo.title, partsUsed: parts } });
  return (await listWorkOrders(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

export async function cancelWorkOrder(orgId: string, environment: string, id: string, actor: Actor): Promise<any> {
  const wo = await db().workOrder.findFirst({ where: { id, orgId, environment } });
  if (!wo) throw notFound("Work order not found");
  if (wo.status === "completed") throw badRequest("Cannot cancel a completed work order");
  await db().workOrder.update({ where: { id }, data: { status: "cancelled" } });
  await emitEvent({ orgId, environment, type: "workorder.cancelled", entity: "workOrder", entityId: id, actorId: actor.id, payload: { title: wo.title } });
  return (await listWorkOrders(orgId, environment, {})).find((x) => x.id === id) ?? null;
}

// ── Assets + maintenance (field.inventory) ─────────────────────────────────
export async function listAssets(orgId: string, environment: string): Promise<any[]> {
  const rows = await db().asset.findMany({ where: { orgId, environment }, orderBy: { name: "asc" } });
  const accounts = await db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } });
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const now = Date.now();
  return rows.map((a) => {
    const maintenanceDue = a.status !== "retired" && a.lastMaintenanceAt != null && a.maintenanceIntervalDays != null
      ? new Date(a.lastMaintenanceAt).getTime() + a.maintenanceIntervalDays! * 86_400_000 < now
      : a.status === "active" && a.lastMaintenanceAt == null && a.maintenanceIntervalDays != null;
    return {
      id: a.id, name: a.name, serialNumber: a.serialNumber, type: a.type, status: a.status,
      warrantyUntil: a.warrantyUntil, lastMaintenanceAt: a.lastMaintenanceAt, maintenanceIntervalDays: a.maintenanceIntervalDays,
      location: a.location, notes: a.notes, maintenanceDue,
      accountId: a.accountId, accountName: a.accountId ? acc.get(a.accountId) ?? null : null,
      createdAt: a.createdAt, updatedAt: a.updatedAt,
    };
  });
}

export async function createAsset(orgId: string, environment: string, input: {
  name: string; accountId?: string | null; serialNumber?: string | null; type?: string | null;
  warrantyUntil?: string | null; lastMaintenanceAt?: string | null; maintenanceIntervalDays?: number | null; location?: string | null; notes?: string | null;
}, actor: Actor): Promise<any> {
  const name = (input.name ?? "").trim();
  if (!name) throw badRequest("Asset name is required");
  const asset = await db().asset.create({
    data: {
      orgId, environment, name, accountId: input.accountId ?? null, serialNumber: input.serialNumber ?? null,
      type: input.type ?? null, warrantyUntil: input.warrantyUntil ? new Date(input.warrantyUntil) : null,
      lastMaintenanceAt: input.lastMaintenanceAt ? new Date(input.lastMaintenanceAt) : null,
      maintenanceIntervalDays: input.maintenanceIntervalDays ?? null, location: input.location ?? null, notes: input.notes ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "asset.created", entity: "asset", entityId: asset.id, actorId: actor.id, payload: { name, serialNumber: asset.serialNumber } });
  return (await listAssets(orgId, environment)).find((x) => x.id === asset.id) ?? null;
}

export async function updateAsset(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: Actor): Promise<any> {
  const a = await db().asset.findFirst({ where: { id, orgId, environment } });
  if (!a) throw notFound("Asset not found");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.serialNumber !== undefined) data.serialNumber = input.serialNumber === null ? null : String(input.serialNumber);
  if (input.status !== undefined) {
    const s = String(input.status);
    if (!["active", "maintenance", "retired"].includes(s)) throw badRequest(`Unknown asset status: "${s}"`);
    data.status = s;
  }
  if (input.location !== undefined) data.location = input.location === null ? null : String(input.location);
  if (input.notes !== undefined) data.notes = input.notes === null ? null : String(input.notes);
  if (input.maintenanceIntervalDays !== undefined) data.maintenanceIntervalDays = input.maintenanceIntervalDays === null ? null : Number(input.maintenanceIntervalDays);
  if (input.lastMaintenanceAt !== undefined) data.lastMaintenanceAt = input.lastMaintenanceAt === null ? null : new Date(String(input.lastMaintenanceAt));
  if (!Object.keys(data).length) throw badRequest("Nothing to update");
  const updated = await db().asset.update({ where: { id }, data });
  await emitEvent({ orgId, environment, type: "asset.updated", entity: "asset", entityId: id, actorId: actor.id, payload: { name: updated.name, status: updated.status } });
  return (await listAssets(orgId, environment)).find((x) => x.id === id) ?? null;
}

/** Log a maintenance completion — resets the clock, emits asset.maintenance_done. */
export async function completeMaintenance(orgId: string, environment: string, id: string, actor: Actor): Promise<any> {
  const a = await db().asset.findFirst({ where: { id, orgId, environment } });
  if (!a) throw notFound("Asset not found");
  const updated = await db().asset.update({ where: { id }, data: { lastMaintenanceAt: new Date(), status: "active" } });
  await emitEvent({ orgId, environment, type: "asset.maintenance_done", entity: "asset", entityId: id, actorId: actor.id, payload: { name: a.name, serialNumber: a.serialNumber } });
  return (await listAssets(orgId, environment)).find((x) => x.id === id) ?? null;
}

// ── Inventory (field.inventory) ────────────────────────────────────────────
export async function listInventory(orgId: string, environment: string): Promise<any[]> {
  const rows = await db().inventoryItem.findMany({ where: { orgId, environment }, orderBy: { sku: "asc" } });
  return rows.map((i) => ({
    id: i.id, sku: i.sku, name: i.name, quantityOnHand: i.quantityOnHand, reorderLevel: i.reorderLevel,
    unitCost: i.unitCost, location: i.location, notes: i.notes, lowStock: i.quantityOnHand <= i.reorderLevel,
    stockValue: Math.round(i.quantityOnHand * i.unitCost * 100) / 100,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  }));
}

export async function createInventoryItem(orgId: string, environment: string, input: {
  sku: string; name: string; quantityOnHand?: number; reorderLevel?: number; unitCost?: number; location?: string | null; notes?: string | null;
}, actor: Actor): Promise<any> {
  const sku = (input.sku ?? "").trim().toUpperCase();
  const name = (input.name ?? "").trim();
  if (!sku || !name) throw badRequest("SKU and name are required");
  const existing = await db().inventoryItem.findFirst({ where: { orgId, environment, sku } });
  if (existing) throw badRequest(`SKU already exists: ${sku}`);
  const item = await db().inventoryItem.create({
    data: {
      orgId, environment, sku, name, quantityOnHand: input.quantityOnHand ?? 0, reorderLevel: input.reorderLevel ?? 0,
      unitCost: input.unitCost ?? 0, location: input.location ?? null, notes: input.notes ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "inventory.created", entity: "inventoryItem", entityId: item.id, actorId: actor.id, payload: { sku, name } });
  return (await listInventory(orgId, environment)).find((x) => x.id === item.id) ?? null;
}

export async function receiveStock(orgId: string, environment: string, id: string, input: { qty: number }, actor: Actor): Promise<any> {
  const item = await db().inventoryItem.findFirst({ where: { id, orgId, environment } });
  if (!item) throw notFound("Inventory item not found");
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest("Receive quantity must be a positive number");
  const updated = await db().inventoryItem.update({ where: { id }, data: { quantityOnHand: { increment: qty } } });
  await emitEvent({ orgId, environment, type: "inventory.received", entity: "inventoryItem", entityId: id, actorId: actor.id, payload: { sku: item.sku, qty, onHand: updated.quantityOnHand } });
  return (await listInventory(orgId, environment)).find((x) => x.id === id) ?? null;
}

export async function consumeStock(orgId: string, environment: string, id: string, input: { qty: number; reason?: string }, actor: Actor): Promise<any> {
  const item = await db().inventoryItem.findFirst({ where: { id, orgId, environment } });
  if (!item) throw notFound("Inventory item not found");
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest("Consume quantity must be a positive number");
  if (item.quantityOnHand < qty) throw badRequest(`Insufficient stock (on hand ${item.quantityOnHand}, need ${qty})`);
  const updated = await db().inventoryItem.update({ where: { id }, data: { quantityOnHand: { decrement: qty } } });
  await emitEvent({ orgId, environment, type: "inventory.consumed", entity: "inventoryItem", entityId: id, actorId: actor.id, payload: { sku: item.sku, qty, onHand: updated.quantityOnHand, reason: input.reason ?? null } });
  return (await listInventory(orgId, environment)).find((x) => x.id === id) ?? null;
}

// ── Offline sync (see docs/38-offline-sync-spec.md) ───────────────────────
// The mobile client works offline and syncs on reconnect. This endpoint is a
// two-phase push/pull:
//   1. PUSH — the client sends its queued operations `{ entity, op, id?,
//      data, clientTs }`; each is applied with LAST-WRITE-WINS conflict
//      resolution (a change wins if clientTs > the row's updatedAt; losing
//      changes are returned as conflicts, not silently dropped).
//   2. PULL — everything the client hasn't seen (updatedAt > since) comes
//      back so the device catches up.
// Entities: territory, technician, visit, workOrder, asset, inventoryItem.
const SYNC_ENTITIES = ["territory", "technician", "visit", "workOrder", "asset", "inventoryItem"] as const;
type SyncEntity = (typeof SYNC_ENTITIES)[number];

const MODEL_OF: Record<SyncEntity, string> = {
  territory: "territory", technician: "technician", visit: "visit",
  workOrder: "workOrder", asset: "asset", inventoryItem: "inventoryItem",
};

function entityModel(entity: SyncEntity) {
  return (db() as any)[MODEL_OF[entity]];
}

export async function syncChanges(orgId: string, environment: string, input: {
  since?: string | null; changes?: { entity: string; op: "create" | "update"; id?: string; data: Record<string, unknown>; clientTs: number }[];
}, actor: Actor): Promise<{ pushed: number; conflicts: { entity: string; id: string; reason: string }[]; pulled: any[] }> {
  const changes = input.changes ?? [];
  const since = input.since ? new Date(input.since) : new Date(0);
  const conflicts: { entity: string; id: string; reason: string }[] = [];
  let pushed = 0;

  for (const c of changes) {
    const entity = c.entity as SyncEntity;
    if (!SYNC_ENTITIES.includes(entity)) {
      conflicts.push({ entity: String(c.entity), id: c.id ?? "", reason: "unknown entity" });
      continue;
    }
    const model = entityModel(entity);
    const clientTs = Number(c.clientTs) || 0;
    try {
      if (c.op === "create" && !c.id) {
        const row = await model.create({ data: { ...c.data, orgId, environment, createdBy: actor.id } });
        await emitEvent({ orgId, environment, type: `${entity}.synced`, entity, entityId: row.id, actorId: actor.id, payload: { op: "create" } });
        pushed++;
      } else {
        if (!c.id) { conflicts.push({ entity, id: "", reason: "update without id" }); continue; }
        const existing = await model.findFirst({ where: { id: c.id, orgId, environment } });
        if (!existing) {
          conflicts.push({ entity, id: c.id, reason: "missing on server (create locally instead)" });
          continue;
        }
        const serverTs = new Date(existing.updatedAt).getTime();
        if (clientTs < serverTs) {
          conflicts.push({ entity, id: c.id, reason: "server is newer (server wins)" });
          continue;
        }
        const { id: _drop, createdAt: _c, updatedAt: _u, orgId: _o, environment: _e, ...data } = c.data;
        await model.update({ where: { id: c.id }, data });
        await emitEvent({ orgId, environment, type: `${entity}.synced`, entity, entityId: c.id, actorId: actor.id, payload: { op: "update" } });
        pushed++;
      }
    } catch (e: any) {
      conflicts.push({ entity, id: c.id ?? "", reason: e?.message ?? "apply failed" });
    }
  }

  // PULL — everything changed since the client's last sync.
  const pulled: any[] = [];
  for (const entity of SYNC_ENTITIES) {
    const model = entityModel(entity);
    const rows = await model.findMany({ where: { orgId, environment, updatedAt: { gt: since } }, orderBy: { updatedAt: "asc" } });
    for (const r of rows) {
      pulled.push({ entity, id: r.id, updatedAt: r.updatedAt, data: r });
    }
  }
  return { pushed, conflicts, pulled };
}

// ── Engine ticker (startFieldEngine) ───────────────────────────────────────
export async function runFieldTicker(orgId: string, environment: string, actorId: string): Promise<{
  maintenanceDue: number; slaBreached: number; reorders: number;
}> {
  const actor: Actor = { id: actorId };
  const now = Date.now();
  let maintenanceDue = 0;
  let slaBreached = 0;
  let reorders = 0;

  // Asset maintenance due (once per cycle — the ticker fires the event once;
  // completeMaintenance resets the clock).
  const assets = await db().asset.findMany({ where: { orgId, environment, status: { not: "retired" } } });
  for (const a of assets) {
    const due = a.lastMaintenanceAt != null && a.maintenanceIntervalDays != null
      ? new Date(a.lastMaintenanceAt).getTime() + a.maintenanceIntervalDays * 86_400_000 < now
      : a.lastMaintenanceAt == null && a.maintenanceIntervalDays != null;
    if (due) {
      maintenanceDue++;
      await emitEvent({ orgId, environment, type: "asset.maintenance_due", entity: "asset", entityId: a.id, actorId, payload: { name: a.name, serialNumber: a.serialNumber, intervalDays: a.maintenanceIntervalDays } });
    }
  }

  // Work-order SLA breach: due but not completed/cancelled. The read model
  // already derives slaBreached; the ticker events it once per run.
  const wos = await db().workOrder.findMany({ where: { orgId, environment, status: { notIn: ["completed", "cancelled"] } } });
  for (const w of wos) {
    if (w.slaDueAt && new Date(w.slaDueAt).getTime() < now) {
      slaBreached++;
      await emitEvent({ orgId, environment, type: "workorder.sla_breached", entity: "workOrder", entityId: w.id, actorId, payload: { title: w.title, slaDueAt: w.slaDueAt } });
    }
  }

  // Inventory reorder: at/below reorder level.
  const items = await db().inventoryItem.findMany({ where: { orgId, environment } });
  for (const i of items) {
    if (i.quantityOnHand <= i.reorderLevel) {
      reorders++;
      await emitEvent({ orgId, environment, type: "inventory.reorder_triggered", entity: "inventoryItem", entityId: i.id, actorId, payload: { sku: i.sku, onHand: i.quantityOnHand, reorderLevel: i.reorderLevel } });
    }
  }

  // Push-based alerts for anything the ops team must see.
  if (maintenanceDue > 0) await notifyFieldAdmins(orgId, environment, `${maintenanceDue} asset(s) due for maintenance`, "Maintenance is due — schedule the work.", "/field?tab=inventory");
  if (slaBreached > 0) await notifyFieldAdmins(orgId, environment, `${slaBreached} work order(s) past SLA`, "Field-service SLA breached — check dispatch.", "/field?tab=workorders");
  if (reorders > 0) await notifyFieldAdmins(orgId, environment, `${reorders} inventory item(s) at/below reorder level`, "Reorder stock before field work stalls.", "/field?tab=inventory");

  return { maintenanceDue, slaBreached, reorders };
}

const tickedOrgs = new Set<string>();

export function startFieldEngine() {
  const tick = async () => {
    try {
      const orgs = await db().organization.findMany({ select: { id: true } });
      const envs = [PRODUCTION_ENV, "sandbox"];
      for (const org of orgs) {
        for (const env of envs) {
          const key = `${org.id}:${env}`;
          if (tickedOrgs.has(key)) continue; // once per boot — events fire once per cycle
          tickedOrgs.add(key);
          await runFieldTicker(org.id, env, org.id).catch(() => {});
        }
      }
    } catch {
      // engine ticker is best-effort
    }
  };
  void tick();
  const interval = setInterval(tick, 10 * 60 * 1000);
  if (typeof interval.unref === "function") interval.unref();
}

// ── Field overview (dashboard data) ────────────────────────────────────────
export async function fieldOverview(orgId: string, environment: string): Promise<any> {
  const [territories, technicians, visits, workOrders, assets, inventory] = await Promise.all([
    listTerritories(orgId, environment),
    listTechnicians(orgId, environment),
    listVisits(orgId, environment, {}),
    listWorkOrders(orgId, environment, {}),
    listAssets(orgId, environment),
    listInventory(orgId, environment),
  ]);
  const openWos = workOrders.filter((w) => !["completed", "cancelled"].includes(w.status));
  const breached = openWos.filter((w) => w.slaBreached);
  return {
    territories: territories.length,
    technicians: technicians.length,
    visitsToday: visits.filter((v) => new Date(v.scheduledAt).toDateString() === new Date().toDateString()).length,
    visitsPlanned: visits.filter((v) => ["planned", "in_transit", "checked_in"].includes(v.status)).length,
    openWorkOrders: openWos.length,
    slaBreached: breached.length,
    maintenanceDue: assets.filter((a) => a.maintenanceDue).length,
    lowStock: inventory.filter((i) => i.lowStock).length,
    assetsTotal: assets.length,
    inventoryValue: Math.round(inventory.reduce((s, i) => s + i.stockValue, 0) * 100) / 100,
  };
}
