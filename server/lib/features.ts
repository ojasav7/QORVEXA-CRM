// Feature flags — the server-owned registry is the authoritative source of
// known keys (docs/09-spec-phase0-hardening.md §3). Effective state for an
// org × environment = Organization.settings.featureFlags[key] override
// (highest) → FeatureFlag row → known-key default. The API is the real gate
// (requireFeature); the UI toggles are advisory conveniences.
import type { NextFunction, Request, Response } from "express";
import { db } from "../db";
import { forbidden, unauthorized } from "./http";
import { resolveEnvironment } from "./environment";

export type FeatureDef = {
  key: string;
  label: string;
  description: string;
  enabledDefault: boolean;
  plans: string[];
};

export const KNOWN_FEATURES: FeatureDef[] = [
  {
    key: "import.merge",
    label: "CSV import with merge",
    description: "Enables the Import page, dry-run previews, and per-row merge resolution into existing records.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "environments.sandbox",
    label: "Sandbox environments",
    description: "Allows admins to create and reset sandbox environments from Settings.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "backups",
    label: "Snapshots & restore",
    description: "Enables creating snapshots and restoring them into fresh sandboxes (never production).",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "promote",
    label: "Environment promotion",
    description: "Copies changed records between environments (sandbox → production).",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "comm.email",
    label: "Email & templates",
    description: "Phase 2 email — compose with templates, mock inbox sync, and open/click/reply tracking.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "comm.calendar",
    label: "Calendar & booking",
    description: "Phase 2 meetings — calendar view, scheduling, and public booking pages with round-robin hosts.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "comm.calling",
    label: "Calling",
    description: "Phase 2 calls — click-to-call and call logging with optional recording + transcription (mock provider).",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
];

export type FeatureState = FeatureDef & { enabled: boolean; source: "settings" | "featureFlag" | "default" };

function knownDef(key: string): FeatureDef | undefined {
  return KNOWN_FEATURES.find((f) => f.key === key);
}

/** Effective state for one known flag in an org × environment. */
export async function featureState(orgId: string, environment: string, key: string): Promise<FeatureState | null> {
  const def = knownDef(key);
  if (!def) return null;
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const overrides = (settings.featureFlags ?? {}) as Record<string, { enabled?: boolean; plans?: string[] }>;
  const override = overrides[key];
  if (override && typeof override === "object" && typeof override.enabled === "boolean") {
    return { ...def, enabled: override.enabled, plans: override.plans ?? def.plans, source: "settings" };
  }
  const row = await db().featureFlag.findUnique({
    where: { orgId_environment_key: { orgId, environment, key } },
  });
  if (row) {
    return { ...def, enabled: row.enabled, plans: (row.plans as string[]) ?? def.plans, source: "featureFlag" };
  }
  return { ...def, enabled: def.enabledDefault, source: "default" };
}

/** All known flags with their effective state — GET /api/features payload. */
export async function allFeatureStates(orgId: string, environment: string): Promise<Record<string, FeatureState>> {
  const out: Record<string, FeatureState> = {};
  for (const def of KNOWN_FEATURES) {
    out[def.key] = (await featureState(orgId, environment, def.key))!;
  }
  return out;
}

/**
 * Route gate — the real enforcement point. Reads the current environment from
 * the X-Environment header, resolves the flag's effective state, and 403s
 * when disabled. Admin always passes when the flag row doesn't exist (defaults
 * are enabled), so gating never blocks demo/admin flows by accident.
 */
export function requireFeature(key: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = (req as any).sessionUser as { id: string; orgId: string } | null;
      if (!user) return next(unauthorized());
      const environment = await resolveEnvironment(req, user.orgId);
      const state = await featureState(user.orgId, environment, key);
      if (!state?.enabled) return next(forbidden(`Feature "${key}" is disabled for this workspace`));
      next();
    } catch (e) {
      next(e);
    }
  };
}
