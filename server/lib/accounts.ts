// Account hierarchy (Phase 1) — parentId forms a tree. Cycles would break the
// hierarchy view, so create/update validate the parent exists in scope and that
// setting it cannot introduce a cycle (an account can't be its own ancestor).
import { db } from "../db";
import { badRequest } from "./http";

async function findAccount(orgId: string, environment: string, id: string) {
  return (db() as any).account.findFirst({ where: { orgId, environment, id } });
}

/** Validate a parent assignment for create (existence only — no cycle possible). */
export async function assertAccountParentExists(orgId: string, environment: string, parentId: string | undefined): Promise<void> {
  if (!parentId) return;
  const parent = await findAccount(orgId, environment, parentId);
  if (!parent) throw badRequest("Parent account not found in this environment");
}

/** Validate a parent assignment for update (existence + cycle safety). */
export async function assertSafeAccountParent(orgId: string, environment: string, accountId: string, parentId: string | undefined): Promise<void> {
  if (!parentId) return;
  if (parentId === accountId) throw badRequest("An account cannot be its own parent");
  // Walk up from the proposed parent; if we ever reach the account itself, it's a cycle.
  const seen = new Set<string>([accountId]);
  let cursor = parentId;
  for (let depth = 0; depth < 50; depth++) {
    if (seen.has(cursor)) throw badRequest("Setting this parent would create a cycle in the hierarchy");
    seen.add(cursor);
    const parent = await findAccount(orgId, environment, cursor);
    if (!parent) throw badRequest("Parent account not found in this environment");
    if (!parent.parentId) return; // reached the root — safe
    cursor = parent.parentId;
  }
  throw badRequest("Account hierarchy exceeds 50 levels");
}
