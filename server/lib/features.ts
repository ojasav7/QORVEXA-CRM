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
  {
    key: "revenue.products",
    label: "Products & price books",
    description: "Phase 10 — the product catalog (with bundles) and named price books with per-product prices + discounts; quotes resolve line prices from a book.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "revenue.cpq",
    label: "Quotes & orders (CPQ)",
    description: "Phase 10 — configure-price-quote: quotes built from the price book with the approval → e-signature lifecycle (mock signature), quote templates, and orders created from signed quotes.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "revenue.billing",
    label: "Contracts, subscriptions & billing",
    description: "Phase 10 — contracts with AI clause extraction, subscriptions with a renewal ticker, invoices + payments (mock), refunds, and dunning on failed/overdue collections.",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "revenue.metrics",
    label: "MRR / ARR analytics",
    description: "Phase 10 — recurring-revenue metrics (MRR, ARR, churned MRR, expansion, outstanding) derived on read with data lineage, in the Revenue overview.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "cs.plans",
    label: "Success plans & QBRs",
    description: "Phase 11 — onboarding/success plans per account with a milestones checklist and a QBR log, health-score-to-playbook mapping (at-risk auto-flagging), and the plan board.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "cs.usage",
    label: "Usage intelligence",
    description: "Phase 11 — product usage telemetry (feature adoption, seat usage, inactivity) ingested via API + event-bus mirror, with adoption-drop detection.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "cs.churn",
    label: "Churn prediction & expansion radar",
    description: "Phase 11 — churn prediction v2 (explained, deterministic over health/usage/support/billing/surveys) with persisted snapshots, plus the upsell/cross-sell expansion radar.",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "cs.surveys",
    label: "Surveys & feedback roadmap",
    description: "Phase 11 — NPS / CSAT / CES surveys with response intake, derived sentiment, computed scores, and the feedback → roadmap pipeline.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "cs.loyalty",
    label: "Loyalty & advocacy",
    description: "Phase 11 — loyalty programs (tiers + rewards + points rules), member enrollment with a points ledger, and referral tracking with automatic point awards.",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "field.territories",
    label: "Territories",
    description: "Phase 12 — sales/service territories that own accounts + technicians, with assignment and management.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "field.visits",
    label: "Visits & route planning",
    description: "Phase 12 — scheduled field visits with GPS check-ins (visit.checked_in) and route optimization by technician position.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "field.workorders",
    label: "Field service (work orders)",
    description: "Phase 12 — technician dispatch, work-order lifecycle with SLA deadlines (workorder.sla_breached), and parts consumption from inventory.",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "field.inventory",
    label: "Assets & inventory",
    description: "Phase 12 — serialized assets with warranty + maintenance schedules (asset.maintenance_due) and inventory stock with reorder levels.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "ecosystem.marketplace",
    label: "App & agent marketplace",
    description: "Phase 13 — a catalog of pre-built apps / agents / integrations / templates (MarketplaceListing) that install into the org (App, app.installed).",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "ecosystem.partners",
    label: "Partner & channel management",
    description: "Phase 13 — partner accounts with deal registration / co-selling and derived commissions (PartnerAccount + PartnerDeal).",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "ecosystem.changesets",
    label: "Change sets & env promotion",
    description: "Phase 13 — bundle config/schema changes (fields, agents, flags) into a ChangeSet and promote them across environments (changeset.promoted).",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "ecosystem.schema",
    label: "Schema change safety",
    description: "Phase 13 — change-impact analysis before deleting a custom field (who references it), with schema.field_deleted on deletion.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "sec.mfa",
    label: "MFA (TOTP)",
    description: "Phase 14 — per-user time-based one-time passwords + recovery codes; MFA-challenged logins.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "sec.sessions",
    label: "Sessions & device management",
    description: "Phase 14 — DB-backed sessions with per-device listing, revocation, and IP restriction (allowlist).",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "sec.scim",
    label: "SCIM provisioning",
    description: "Phase 14 — SCIM 2.0 /Users + /Groups endpoints for automated identity provisioning.",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "sec.consent",
    label: "Consent & privacy",
    description: "Phase 14 — consent records (consent.updated), the privacy center, and data-subject requests.",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "sec.retention",
    label: "Retention & deletion",
    description: "Phase 14 — retention policies that delete or anonymize stale records (retention.policy_applied).",
    enabledDefault: true,
    plans: ["enterprise"],
  },
  {
    key: "sec.status",
    label: "Status page & uptime",
    description: "Phase 14 — the uptime SLA dashboard (UptimeEvent ticks + incidents) with a public status endpoint.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
  },
  {
    key: "i18n.localization",
    label: "Localization",
    description: "Phase 14 — org locale/currency/timezone config + the translation catalog with completeness QA.",
    enabledDefault: true,
    plans: ["pro", "enterprise"],
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
