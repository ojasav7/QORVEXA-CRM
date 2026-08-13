// Right-to-portability full-tenant export (Phase 7 · 🆕 blueprint item).
//
// One admin click produces a single downloadable JSON file containing EVERY
// org × environment collection: object rows, comms, tickets, marketing,
// analytics, the Phase 7 CDP rows, plus the audit trail and the event log —
// the GDPR "give me my data" bundle. Like snapshots, exports are written under
// backups/ and tracked by a PortabilityExport row (status/size/date); the
// download endpoint streams the file and DELETE purges it.
import fs from "node:fs";
import path from "node:path";
import { db } from "../db";
import { badRequest, notFound } from "./http";

const BACKUP_ROOT = path.resolve(process.cwd(), "backups");
const PORTABILITY_ROOT = path.join(BACKUP_ROOT, "portability");

/** [bundle key, prisma delegate] — every org-scoped collection. */
const COLLECTIONS: [string, string][] = [
  ["accounts", "account"],
  ["contacts", "contact"],
  ["leads", "lead"],
  ["opportunities", "opportunity"],
  ["tasks", "task"],
  ["notes", "note"],
  ["messages", "message"],
  ["calls", "call"],
  ["meetings", "meeting"],
  ["bookingPages", "bookingPage"],
  ["emailTemplates", "emailTemplate"],
  ["pipelines", "pipeline"],
  ["automations", "automation"],
  ["automationRuns", "automationRun"],
  ["notifications", "notification"],
  ["tickets", "ticket"],
  ["ticketReplies", "ticketReply"],
  ["knowledgeArticles", "knowledgeArticle"],
  ["slaPolicies", "slaPolicy"],
  ["portalPages", "portalPage"],
  ["campaigns", "campaign"],
  ["campaignRecipients", "campaignRecipient"],
  ["landingPages", "landingPage"],
  ["journeys", "journey"],
  ["journeyEnrollments", "journeyEnrollment"],
  ["journeyStepRuns", "journeyStepRun"],
  ["segments", "segment"],
  ["leadForms", "leadForm"],
  ["forecasts", "forecast"],
  ["reports", "report"],
  ["identityProfiles", "identityProfile"],
  ["behaviorEvents", "behaviorEvent"],
  ["healthScores", "healthScore"],
  ["fieldDefs", "fieldDef"],
  ["featureFlags", "featureFlag"],
  ["webhooks", "webhook"],
  ["webhookDeliveries", "webhookDelivery"],
  ["events", "event"],
  ["auditLogs", "auditLog"],
  // Phase 10 · Revenue Cloud
  ["products", "product"],
  ["priceBooks", "priceBook"],
  ["quoteTemplates", "quoteTemplate"],
  ["quotes", "quote"],
  ["orders", "order"],
  ["contracts", "contract"],
  ["subscriptions", "subscription"],
  ["invoices", "invoice"],
  ["payments", "payment"],
];

export type PortabilityResult = { path: string; sizeBytes: number; counts: Record<string, number> };

/** Build + write the full-tenant bundle for one org × environment. */
export async function createPortabilityBundle(orgId: string, environment: string): Promise<PortabilityResult> {
  fs.mkdirSync(PORTABILITY_ROOT, { recursive: true });

  const org = await db().organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound("Organization not found");

  // Users are org-scoped without an environment field — staff accounts belong
  // to the tenant, but password hashes are excluded from the bundle.
  const users = await db().user.findMany({ where: { orgId }, take: 2000 });
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const [key, delegate] of COLLECTIONS) {
    const rows = await (db() as any)[delegate].findMany({ where: { orgId }, take: 20_000 });
    const scoped = rows.filter((r: any) => r.environment === undefined || r.environment === null || r.environment === environment);
    data[key] = scoped;
    counts[key] = scoped.length;
  }
  data.users = users.map(({ passwordHash, ...rest }) => ({ ...rest, passwordHashExcluded: true }));
  counts.users = users.length;

  const bundle = {
    format: "qorvexa-cdp-portability",
    version: 1,
    exportedAt: new Date().toISOString(),
    environment,
    org: { id: org.id, name: org.name, slug: org.slug, plan: org.plan, settings: org.settings },
    counts,
    data,
  };

  const fileName = `portability-${org.slug}-${Date.now()}.json`;
  const absolute = path.join(PORTABILITY_ROOT, fileName);
  fs.writeFileSync(absolute, JSON.stringify(bundle, null, 2));
  const sizeBytes = fs.statSync(absolute).size;
  return { path: `portability/${fileName}`, sizeBytes, counts };
}

/** Resolve a stored export path to a readable absolute path (path-traversal safe). */
export function resolveExportFile(relative: string): string {
  if (!relative.startsWith("portability/") || relative.includes("..")) throw badRequest("Invalid export path");
  const absolute = path.resolve(BACKUP_ROOT, relative);
  if (!absolute.startsWith(BACKUP_ROOT)) throw badRequest("Invalid export path");
  if (!fs.existsSync(absolute)) throw notFound("Export file not found on disk");
  return absolute;
}

/** Remove an export's file from disk (best-effort — the row is the source of truth). */
export function deleteExportFile(relative: string) {
  try {
    const absolute = resolveExportFile(relative);
    fs.rmSync(absolute, { force: true });
  } catch {
    /* row cleanup should not fail on a missing file */
  }
}
