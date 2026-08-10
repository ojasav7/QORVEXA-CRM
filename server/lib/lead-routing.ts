// Lead routing (Phase 1) — the admin configures a pool of assignees; new leads
// without an explicit owner are handed out round-robin.
//
// Config lives in `Organization.settings.leadRouting`:
//   { mode: "manual" | "round-robin", pool: string[] (user ids), cursor: number }
// - mode "manual" (or unset) → no auto-assignment; the creator keeps the lead.
// - mode "round-robin" → cycle through ACTIVE pool users, skipping disabled
//   accounts; the cursor is persisted so a restart doesn't reset the rotation.
// Admins always keep full authority: PATCH /api/leads/:id { ownerId } overrides
// any routing (explicit ownerId on create also wins).
import { db } from "../db";

export type LeadRoutingConfig = {
  mode: "manual" | "round-robin";
  pool: string[];
  cursor: number;
};

export function normalizeRouting(raw: unknown): LeadRoutingConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    mode: r.mode === "round-robin" ? "round-robin" : "manual",
    pool: Array.isArray(r.pool) ? r.pool.map(String).filter(Boolean) : [],
    cursor: Number.isFinite(Number(r.cursor)) ? Number(r.cursor) : 0,
  };
}

/**
 * Pick the next round-robin owner for a new lead, or null when routing is
 * manual/disabled (caller keeps its default owner). Never throws.
 */
export async function nextRoundRobinOwner(orgId: string): Promise<string | null> {
  try {
    const org = await db().organization.findUnique({ where: { id: orgId } });
    if (!org) return null;
    const settings = (org.settings ?? {}) as Record<string, unknown>;
    const rr = normalizeRouting(settings.leadRouting);
    if (rr.mode !== "round-robin" || rr.pool.length === 0) return null;

    // Only active, same-org users are eligible — inactive ones are skipped.
    const users = await db().user.findMany({ where: { id: { in: rr.pool }, orgId, active: true }, select: { id: true } });
    const pool = users.map((u) => u.id);
    if (!pool.length) return null;

    const owner = pool[rr.cursor % pool.length];
    // Persist the cursor so rotation survives restarts (read-modify-write;
    // concurrent creates may share an index — acceptable v1, documented).
    await db().organization.update({
      where: { id: orgId },
      data: { settings: { ...settings, leadRouting: { ...rr, cursor: (rr.cursor + 1) % pool.length } } as object },
    });
    return owner;
  } catch {
    return null; // routing must never break lead capture
  }
}
