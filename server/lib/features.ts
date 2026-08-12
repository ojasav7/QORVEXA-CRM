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
  {
    key: "automation.workflows",
    label: "Workflows & automation",
    description: "Phase 3 — visual workflow builder (trigger → condition → action) over the event bus, plus in-app notifications.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "service.tickets",
    label: "Tickets & helpdesk",
    description: "Phase 4 — ticket queues with priorities, SLA deadlines + breach sweep, escalation, replies, legal hold, email intake, convert-to-lead, and public portal pages.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "service.knowledge",
    label: "Knowledge base",
    description: "Phase 4 — self-service knowledge base: articles, categories, search, and published articles shown in the public portal.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "marketing.campaigns",
    label: "Campaigns",
    description: "Phase 5 — email campaigns targeted at dynamic segments, with A/B subject testing, open/click tracking, and attributed ROI.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "marketing.landing",
    label: "Landing pages",
    description: "Phase 5 — public landing pages at /l/:slug that capture routed leads (honeypot + rate limit), optionally attributed to a campaign.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "marketing.journeys",
    label: "Journeys",
    description: "Phase 5 — customer journey orchestration: event/segment triggers with wait + action steps (send email, notify, create task, update record, branch), advanced by a ticker.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "marketing.deliverability",
    label: "Deliverability monitoring",
    description: "Phase 5 — email deliverability health: open/click/bounce rates computed from sent messages, with simulated provider events (mock, ADR-014).",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "analytics.metrics",
    label: "Analytics & dashboards",
    description: "Phase 6 — the metrics library (sales/marketing/service/revenue/executive dashboards) with data lineage, weighted forecasting + predictive v1 scores, and threshold alerts.",
    enabledDefault: true,
    plans: ["free", "pro", "enterprise"],
  },
  {
    key: "analytics.reports",
    label: "Report builder",
    description: "Phase 6 — saved report configs (kind + metric keys) rendered with live data.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "cdp.profiles",
    label: "Customers (CDP / Customer 360)",
    description: "Phase 7 — unified customer identities (identity resolution over contacts + leads), behavioral event tracking, the customer 360 profile view, the relationship graph, and the customer health engine.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "cdp.portability",
    label: "Right-to-portability export",
    description: "Phase 7 — admin self-service full-tenant export bundles (every collection in one downloadable JSON file).",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "ai.assistant",
    label: "AI copilot",
    description: "Phase 8 — the non-agentic AI assistant layer: record/call/meeting summaries, email drafts, transparent AI scoring (lead/deal), sentiment + intent, semantic search, the data firewall, and short-term AI memory.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "ai.modelRouter",
    label: "AI model router",
    description: "Phase 8 — the model catalog + routing policy (cost/latency/quality preference, region residency) that decides which model serves each AI feature. Model rows + policy are admin-editable.",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "ai.agents",
    label: "AI agents",
    description: "Phase 9 — the governed AI agent platform: autonomous agents (Lead / Sales / Service / Renewal) that propose risk-tiered actions (🟢 automatic, 🟡 approval, 🔴 human), with the kill switch, the testing lab, and cost metering.",
    enabledDefault: true,
    plans: ["enterprise"],
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
