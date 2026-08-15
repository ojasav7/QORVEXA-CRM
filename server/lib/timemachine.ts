// CRM Time Machine (Phase 15) — reconstruct the full historical state of any
// record as of any date.
//
// Two complementary mechanisms:
//   1. RECONSTRUCTION (derived on read) — the audit trail stores a field-level
//      diff per mutation ({ field: { from, to } }) plus before/after snapshots;
//      replaying it in order reconstructs any record's state as of any date.
//      Approximation (documented): state is read at the last audit write ≤ the
//      target date, which equals the true state because every mutation is
//      audited.
//   2. SNAPSHOTS (durable, blueprint entity TimeMachineSnapshot) — full-org or
//      per-record point-in-time captures with a retention window
//      (Organization.settings.brain.timeMachineRetentionDays, default 90).
//      Pruned by the engine ticker; snapshot.created is emitted per capture.
//
// Events: snapshot.created. (insight.generated lives in lib/brain.ts.)
import { db } from "../db";
import { emitEvent } from "./events";
import { notFound, badRequest } from "./http";

const DAY = 86_400_000;

const RECORD_TYPES = ["contact", "account", "lead", "opportunity", "task", "note", "ticket"];

/** The full-org snapshot scope: every object/comm/revenue collection. */
const FULL_COLLECTIONS: [string, string][] = [
  ["accounts", "account"],
  ["contacts", "contact"],
  ["leads", "lead"],
  ["opportunities", "opportunity"],
  ["tasks", "task"],
  ["notes", "note"],
  ["messages", "message"],
  ["calls", "call"],
  ["meetings", "meeting"],
  ["tickets", "ticket"],
  ["ticketReplies", "ticketReply"],
  ["campaigns", "campaign"],
  ["campaignRecipients", "campaignRecipient"],
  ["landingPages", "landingPage"],
  ["journeys", "journey"],
  ["segments", "segment"],
  ["identityProfiles", "identityProfile"],
  ["behaviorEvents", "behaviorEvent"],
  ["products", "product"],
  ["priceBooks", "priceBook"],
  ["quotes", "quote"],
  ["orders", "order"],
  ["contracts", "contract"],
  ["subscriptions", "subscription"],
  ["invoices", "invoice"],
  ["payments", "payment"],
];

export async function retentionDays(orgId: string): Promise<number> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const brain = ((org?.settings ?? {}) as Record<string, unknown>).brain as Record<string, unknown> | undefined;
  const v = Number(brain?.timeMachineRetentionDays);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 90;
}

/**
 * Reconstruct a record's state as of a date from the audit trail.
 * Returns null when the record had no audited state by that date.
 */
export async function reconstruct(orgId: string, environment: string, entity: string, entityId: string, asOf: Date) {
  if (!RECORD_TYPES.includes(entity)) throw badRequest(`entity must be one of ${RECORD_TYPES.join(", ")}`);
  const audits = await db().auditLog.findMany({ where: { orgId, environment, entity, entityId }, orderBy: { createdAt: "asc" }, select: { id: true, action: true, before: true, after: true, createdAt: true } });
  const row = [...audits].reverse().find((a) => new Date(a.createdAt).getTime() <= asOf.getTime());
  if (!row) return null;
  if (row.action === "delete") {
    return { entity, entityId, asOf: asOf.toISOString(), deleted: true, deletedAt: row.createdAt, sourceAuditId: row.id };
  }
  return {
    entity,
    entityId,
    asOf: asOf.toISOString(),
    state: row.after ?? {},
    at: row.createdAt,
    sourceAuditId: row.id,
    sourceAction: row.action,
    deleted: false,
  };
}

/** Diff two reconstructed states — the "what changed between two dates" view. */
export function compareStates(from: Record<string, unknown>, to: Record<string, unknown>) {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const removed: string[] = [];
  const added: string[] = [];
  const norm = (v: unknown) => JSON.stringify(v ?? null);
  for (const k of keys) {
    if (!(k in from)) added.push(k);
    else if (!(k in to)) removed.push(k);
    else if (norm(from[k]) !== norm(to[k])) changed[k] = { from: from[k], to: to[k] };
  }
  return { changed, removed, added };
}

/** Capture a point-in-time snapshot (full org or one record). Returns the row. */
export async function createSnapshot(orgId: string, environment: string, actorId: string, scope: string, entity?: string | null, entityId?: string | null) {
  if (!["full", "record"].includes(scope)) throw badRequest("scope must be full | record");
  const retention = await retentionDays(orgId);
  const retentionUntil = new Date(Date.now() + retention * DAY);

  let data: Record<string, unknown> = {};
  if (scope === "record") {
    if (!entity || !entityId) throw badRequest("record snapshots need entity + entityId");
    if (!RECORD_TYPES.includes(entity)) throw badRequest(`entity must be one of ${RECORD_TYPES.join(", ")}`);
    const delegate = (db() as any)[entity];
    const row = await delegate.findUnique({ where: { id: entityId } });
    if (!row || row.orgId !== orgId || (row.environment !== undefined && row.environment !== environment)) throw notFound(`${entity} not found`);
    data = { entity, entityId, row };
  } else {
    const collections: Record<string, unknown[]> = {};
    for (const [key, delegateName] of FULL_COLLECTIONS) {
      const rows = await (db() as any)[delegateName].findMany({ where: { orgId }, take: 20_000 });
      collections[key] = rows.filter((r: any) => r.environment === undefined || r.environment === null || r.environment === environment);
    }
    data = { collections, capturedAt: new Date().toISOString() };
  }

  const snapshot = await db().timeMachineSnapshot.create({
    data: { orgId, environment, scope, entity: scope === "record" ? entity : null, entityId: scope === "record" ? entityId : null, data: data as object, retentionUntil, createdBy: actorId },
  });

  await emitEvent({
    orgId,
    environment,
    type: "snapshot.created",
    entity: scope === "record" ? (entity as string) : "brain",
    entityId: snapshot.id,
    actorId,
    payload: { scope, entity: entity ?? null, entityId: entityId ?? null, retentionDays: retention, snapshotId: snapshot.id },
  });

  // Prune expired snapshots.
  const pruned = await db().timeMachineSnapshot.deleteMany({ where: { orgId, environment, retentionUntil: { lt: new Date() } } });
  return { snapshot, retentionUntil, pruned: pruned.count };
}

export async function listSnapshots(orgId: string, environment: string, scope?: string) {
  return db().timeMachineSnapshot.findMany({ where: { orgId, environment, ...(scope ? { scope } : {}) }, orderBy: { snapshotAt: "desc" }, take: 100 });
}

export async function getSnapshot(orgId: string, environment: string, id: string) {
  const row = await db().timeMachineSnapshot.findUnique({ where: { id } });
  if (!row || row.orgId !== orgId || row.environment !== environment) throw notFound("Snapshot not found");
  return row;
}

/** The Time Machine engine — a daily full snapshot per org × env + retention
 * pruning. Does NOT capture at boot: snapshots are admin-triggered (POST
 * /api/brain/timemachine/snapshot) so the seeded state on a fresh stack is
 * exact; the ticker keeps the daily cadence on long-running instances. */
export function startTimeMachineEngine() {
  const tick = async () => {
    try {
      const orgs = await db().organization.findMany({ select: { id: true } });
      for (const o of orgs) {
        const actor = await db().user.findFirst({ where: { orgId: o.id, role: "admin" }, select: { id: true } });
        if (!actor) continue;
        for (const environment of ["production", "sandbox"]) {
          try {
            const since = new Date(Date.now() - 24 * 3600 * 1000);
            const recent = await db().timeMachineSnapshot.count({ where: { orgId: o.id, environment, scope: "full", snapshotAt: { gte: since } } });
            if (recent === 0) await createSnapshot(o.id, environment, actor.id, "full");
            await db().timeMachineSnapshot.deleteMany({ where: { orgId: o.id, environment, retentionUntil: { lt: new Date() } } });
          } catch (e) {
            console.error("[time machine tick]", o.id, environment, e);
          }
        }
      }
    } catch (e) {
      console.error("[time machine engine]", e);
    }
  };
  setInterval(tick, 24 * 3600 * 1000);
}
