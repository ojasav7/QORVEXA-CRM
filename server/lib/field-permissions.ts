// Field-level permissions (blueprint principle #3 — "field- and record-level
// from day 1"). One FieldPermission row per org × env × object type × field key:
//   readRoles  — roles allowed to see the field ([] = everyone)
//   writeRoles — roles allowed to set the field ([] = everyone)
// Admin always passes. Enforcement happens in object-service (read masking on
// list/get, write rejection in create/update); the UI hides masked fields.
import { db } from "../db";

export type FieldPerm = { readRoles: string[]; writeRoles: string[] };

export async function fieldPermMap(orgId: string, environment: string, objectType: string): Promise<Record<string, FieldPerm>> {
  const rows = await db().fieldPermission.findMany({ where: { orgId, environment, objectType } });
  const map: Record<string, FieldPerm> = {};
  for (const r of rows) {
    map[r.fieldKey] = { readRoles: (r.readRoles as string[]) ?? [], writeRoles: (r.writeRoles as string[]) ?? [] };
  }
  return map;
}

// Admin always passes — enforced identically here (UI/export consumers), in
// object-service masking, and in splitFields write rejection.
export const canRead = (perm: FieldPerm | undefined, role: string): boolean =>
  role === "admin" || !perm || perm.readRoles.length === 0 || perm.readRoles.includes(role);
export const canWrite = (perm: FieldPerm | undefined, role: string): boolean =>
  role === "admin" || !perm || perm.writeRoles.length === 0 || perm.writeRoles.includes(role);

/** Mutates a row in place: nulls out fields the role can't read (custom values live in row.custom). */
export function maskRow(row: Record<string, any>, permMap: Record<string, FieldPerm>, role: string): void {
  if (role === "admin") return;
  for (const [key, perm] of Object.entries(permMap)) {
    if (canRead(perm, role)) continue;
    if (key in row) row[key] = undefined;
    delete row[`${key}_label`]; // hydrated relation labels must hide with the field
    if (row.custom && key in (row.custom as Record<string, unknown>)) delete (row.custom as Record<string, unknown>)[key];
  }
}
