// Backup engine (ADR-009 — docs/08-decision-log.md).
// Snapshots are per-collection JSON archives under `backups/` (a portable
// alternative to mongodump that works with the same single-node replica set).
// Restore ALWAYS lands in a fresh sandbox environment name
// (`sandbox-restored-<ts>`) — production is rejected by construction.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db";
import { badRequest } from "./http";
import { DEFAULT_ENVIRONMENTS } from "./environment";
import { featureState } from "./features";

export const BACKUP_ROOT = path.resolve(process.cwd(), "backups");

/** Business data models included in a snapshot (users/auth excluded — restores land in sandbox, not prod). */
export const BUSINESS_MODELS = ["contact", "account", "lead", "opportunity", "task", "note"] as const;
export const SNAPSHOT_MODELS = [...BUSINESS_MODELS, "fieldDef"] as const;

/** Archive names are server-generated and validated against path traversal. */
export function validArchiveName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

export type SnapshotResult = { archivePath: string; sizeBytes: number; manifest: { model: string; count: number }[] };

export async function createSnapshot(orgId: string, environment: string): Promise<SnapshotResult> {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  const dirName = `${orgId}-${Date.now()}`;
  const dir = path.join(BACKUP_ROOT, dirName);
  fs.mkdirSync(dir, { recursive: true });

  let sizeBytes = 0;
  const manifest: { model: string; count: number }[] = [];
  for (const model of SNAPSHOT_MODELS) {
    const delegate = (db() as any)[model];
    const rows = await delegate.findMany({ where: { orgId, environment } });
    const file = path.join(dir, `${model}.json`);
    fs.writeFileSync(file, JSON.stringify(rows));
    sizeBytes += fs.statSync(file).size;
    manifest.push({ model, count: rows.length });
  }
  const meta = {
    orgId,
    environment,
    createdAt: new Date().toISOString(),
    models: SNAPSHOT_MODELS,
    manifest,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  sizeBytes += fs.statSync(path.join(dir, "meta.json")).size;

  return { archivePath: dirName, sizeBytes, manifest };
}

export type RestoreResult = { targetEnvironment: string; restored: number };

/** Reference fields per model that point at other restored records — remapped to the fresh ids. */
const REF_FIELDS: Record<string, string[]> = {
  contact: ["accountId", "promotedFrom"],
  account: ["parentId", "promotedFrom"],
  lead: ["promotedFrom"],
  opportunity: ["accountId", "contactId", "promotedFrom"],
  task: ["contactId", "opportunityId", "promotedFrom"],
  note: ["contactId", "accountId", "opportunityId", "promotedFrom"],
  fieldDef: [],
};

/**
 * Restore an archive into a FRESH sandbox env name. Never production — callers must enforce.
 * ADR-008 keeps one collection per model for all environments, so _id is globally
 * unique: restored records get NEW ids and cross-record references are remapped.
 */
export async function restoreSnapshot(orgId: string, archivePath: string, targetEnvironment: string): Promise<RestoreResult> {
  if (!validArchiveName(archivePath)) throw badRequest("Invalid archive path");
  const dir = path.join(BACKUP_ROOT, archivePath);
  const metaFile = path.join(dir, "meta.json");
  if (!fs.existsSync(metaFile)) throw badRequest("Backup archive not found");

  // Pass 1: read all rows and assign fresh ids (id maps per model, for ref remapping).
  const plans: { model: string; rows: Record<string, any>[]; idMap: Map<string, string> }[] = [];
  for (const model of SNAPSHOT_MODELS) {
    const file = path.join(dir, `${model}.json`);
    if (!fs.existsSync(file)) continue;
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>[];
    const idMap = new Map<string, string>();
    for (const row of rows) {
      if (!row?.id) continue;
      idMap.set(row.id, crypto.randomBytes(12).toString("hex"));
    }
    plans.push({ model, rows, idMap });
  }

  // Pass 2 + 3: remap references (against ALL model maps — a contact's accountId
  // lives in the account map, not the contact map), then insert.
  const allMaps = new Map<string, string>();
  for (const { idMap } of plans) for (const [k, v] of idMap) allMaps.set(k, v);

  let restored = 0;
  for (const { model, rows, idMap } of plans) {
    const delegate = (db() as any)[model];
    const refs = REF_FIELDS[model] ?? [];
    const hasUpdatedAt = BUSINESS_MODELS.includes(model as (typeof BUSINESS_MODELS)[number]);
    for (const row of rows) {
      if (!row?.id) continue;
      const { id, _id, ...rest } = row;
      const data: Record<string, any> = { ...rest, id: idMap.get(id) ?? crypto.randomBytes(12).toString("hex"), orgId, environment: targetEnvironment };
      if (hasUpdatedAt) data.updatedAt = new Date();
      for (const f of refs) {
        if (typeof data[f] === "string" && allMaps.has(data[f])) data[f] = allMaps.get(data[f]);
      }
      await delegate.create({ data });
      restored++;
    }
  }
  return { targetEnvironment, restored };
}

/**
 * Delete snapshots older than `retentionDays` (org.settings.backupRetentionDays,
 * default 30): removes the archive directory and its BackupJob row.
 */
export async function pruneSnapshots(orgId: string, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const old = await db().backupJob.findMany({ where: { orgId, createdAt: { lt: cutoff } } });
  for (const job of old) {
    if (job.archivePath && validArchiveName(job.archivePath)) {
      try {
        fs.rmSync(path.join(BACKUP_ROOT, job.archivePath), { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
    await db().backupJob.delete({ where: { id: job.id } });
  }
  return old.length;
}

/**
 * Scheduled snapshots (ADR-009: scheduled + manual). Snapshots each org's
 * production env when the `backups` feature is enabled for it, then prunes
 * per org.settings.backupRetentionDays (default 30). Never throws to the caller.
 */
export async function runScheduledSnapshots(): Promise<void> {
  const orgs = await db().organization.findMany({ select: { id: true, settings: true } });
  for (const org of orgs) {
    try {
      const state = await featureState(org.id, "production", "backups");
      if (!state?.enabled) continue;
      const settings = (org.settings ?? {}) as Record<string, unknown>;
      const retention = Number(settings.backupRetentionDays ?? 30);
      const job = await db().backupJob.create({
        data: { orgId: org.id, status: "running", archivePath: "", environment: "production" },
      });
      try {
        const { archivePath, sizeBytes } = await createSnapshot(org.id, "production");
        await db().backupJob.update({ where: { id: job.id }, data: { status: "success", archivePath, sizeBytes } });
      } catch (e: any) {
        await db().backupJob.update({ where: { id: job.id }, data: { status: "failed", error: String(e?.message ?? e) } });
      }
      const pruned = await pruneSnapshots(org.id, retention);
      console.log(`[backups] scheduled snapshot for ${org.id}: done (pruned ${pruned} old)`);
    } catch (e) {
      console.error("[backups] scheduled snapshot failed for org", org.id, e);
    }
  }
}

/**
 * Record a restore target env on the org so the UI switcher can select it.
 * Note: read-modify-write on settings — concurrent restores are last-write-wins
 * (acceptable v1; only ever appends env names).
 */
export async function addOrgEnvironment(orgId: string, name: string): Promise<void> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  if (!org) return;
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const stored = Array.isArray(settings.environments) ? (settings.environments as string[]).map(String) : [];
  // An empty stored list means the org relies on the virtual defaults — persist them
  // so adding an env never hides production/sandbox from the switcher.
  const list = stored.length ? stored : [...DEFAULT_ENVIRONMENTS];
  if (list.includes(name)) return;
  list.push(name);
  await db().organization.update({
    where: { id: orgId },
    data: { settings: { ...settings, environments: list } as object },
  });
}
