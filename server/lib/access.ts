// Record-level access control (Phase 0 backbone, principle #3 + ADR-008).
// Every object row carries `visibility`: "org" | "owner" and an `environment`
// scoping field. Access is enforced centrally so no route can forget it:
//   admin   → everything in the org + environment
//   manager → everything in the org + environment
//   rep     → records they own, plus records with visibility "org"
// Environment is scoped exactly like orgId — a sandbox query can never see
// production rows (verified by the cross-env leak smoke test).
import { forbidden, notFound } from "./http";

export type AccessUser = { id: string; orgId: string; role: string; environment?: string };
export type ScopedRecord = { orgId: string; ownerId: string; visibility?: string; environment?: string };

export const VISIBILITY_OWNER = "owner";
export const VISIBILITY_ORG = "org";

/**
 * Can this user read/write this record?
 * 404 across orgs AND across environments (no existence leak, no env leak).
 * 403 on visibility denial.
 */
export function assertCanAccess(user: AccessUser, record: ScopedRecord) {
  if (record.orgId !== user.orgId) throw notFound();
  // ADR-008: when the request carries an environment, the record must be in it.
  // A record missing the field is treated as not matching (forces backfill).
  if (user.environment && record.environment !== user.environment) throw notFound();
  if (user.role === "admin" || user.role === "manager") return;
  const vis = record.visibility ?? VISIBILITY_ORG;
  if (vis === VISIBILITY_ORG) return;
  if (record.ownerId === user.id) return;
  throw forbidden("You do not have access to this record");
}

/**
 * Scope clause for list queries.
 * admin/manager → whole org; rep → org-visible records OR records they own.
 * The resolved environment is ANDed in when present.
 * Returns `AND`-style conditions when combined with other filters:
 * callers should merge as `where.AND = [...scopeConditions, ...searchConditions]`.
 */
export function listConditions(user: AccessUser, ownerField = "ownerId"): Record<string, unknown>[] {
  const env = user.environment ? { environment: user.environment } : {};
  if (user.role === "admin" || user.role === "manager") {
    return [{ orgId: user.orgId, ...env }];
  }
  return [{ orgId: user.orgId, ...env, OR: [{ visibility: VISIBILITY_ORG }, { [ownerField]: user.id }] }];
}

/** Backwards-compatible shorthand returning a single where object. */
export function listWhere(user: AccessUser): Record<string, unknown> {
  return { AND: listConditions(user) };
}
