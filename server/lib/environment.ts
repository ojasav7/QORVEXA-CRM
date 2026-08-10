// Environment resolution (ADR-008 — docs/08-decision-log.md).
// The client persists its environment choice in localStorage and sends it on
// every request as the `X-Environment` header. The server validates it against
// the org's configured environments and threads it through the central access
// layer (lib/access.ts) exactly like orgId. The session cookie is not involved.
import type { Request } from "express";
import { db } from "../db";
import { badRequest } from "./http";

export const PRODUCTION_ENV = "production";
export const SANDBOX_ENV = "sandbox";
export const DEFAULT_ENVIRONMENTS = [PRODUCTION_ENV, SANDBOX_ENV];

/** Raw header value, defaulting to production. */
export function envFromHeader(req: Request): string {
  const v = req.headers["x-environment"];
  if (typeof v === "string" && v.trim()) return v.trim();
  return PRODUCTION_ENV;
}

/** The org's allowed environments (Organization.settings.environments, default [production, sandbox]). */
export async function orgEnvironments(orgId: string): Promise<string[]> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const list = settings.environments;
  if (Array.isArray(list) && list.length) return list.map(String);
  return [...DEFAULT_ENVIRONMENTS];
}

/** Validate the X-Environment header against the org's environments. 400 on unknown values. */
export async function resolveEnvironment(req: Request, orgId: string): Promise<string> {
  const requested = envFromHeader(req);
  const allowed = await orgEnvironments(orgId);
  if (!allowed.includes(requested)) throw badRequest(`Unknown environment: "${requested}"`);
  return requested;
}
