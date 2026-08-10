// Audit trail — one row per mutation, with a computed field-level diff.
// Combined with persisted Events this gives full history for the
// Phase-15 "CRM Time Machine".
import { db } from "../db";

type AuditInput = {
  orgId: string;
  environment?: string;
  actorId: string;
  entity: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
};

function changedFields(
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null
): Record<string, { from: unknown; to: unknown }> | null {
  if (!before || !after) return null;
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    const norm = (v: unknown) => JSON.stringify(v ?? null);
    if (norm(a) !== norm(b)) diff[k] = { from: a ?? null, to: b ?? null };
  }
  return Object.keys(diff).length ? diff : null;
}

export async function writeAudit(input: AuditInput) {
  try {
    await db().auditLog.create({
      data: {
        orgId: input.orgId,
        environment: input.environment ?? "production",
        actorId: input.actorId,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        before: (input.before ?? null) as object | null,
        after: (input.after ?? null) as object | null,
        changed: changedFields(input.before, input.after) as object | null,
        ip: input.ip ?? null,
      },
    });
  } catch (e) {
    console.error("[audit write failed]", e);
  }
}
