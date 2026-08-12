// Metrics library (Phase 6 · Analytics, Forecasting & BI) — ADR-018.
//
// Every metric is COMPUTED ON READ from live rows + the event log (same
// discipline as campaignStats/deliverabilityMetrics), so a number on screen
// can never go stale. Each metric carries DATA LINEAGE — { key, label, value,
// format, sources: [{ entity, query, note }] } — describing exactly which
// rows/events produced it. No metrics are stored; the only persisted Phase-6
// artifacts are Forecast snapshots (lib/forecasts.ts) and Report configs.
//
// Thresholds (winRate / pipelineCoverage / campaignsOpenRate / slaHealth) are
// evaluated by the forecast refresh; breaches write admin notifications +
// emit metric.threshold_breached. Defaults live here, overridable per org via
// Organization.settings.analytics.thresholds.
import { db } from "../db";
import { pipelineStages } from "./pipelines";

export type MetricSource = { entity: string; query: string; note: string };
export type Metric = { key: string; label: string; value: number | string | null; format: "number" | "currency" | "percent" | "hours" | "days" | "text"; sources: MetricSource[] };
export type MetricGroup = { kind: string; label: string; metrics: Metric[] };

export type DashboardKind = "sales" | "marketing" | "service" | "revenue" | "executive";
export const DASHBOARD_KINDS: DashboardKind[] = ["sales", "marketing", "service", "revenue", "executive"];

export const DEFAULT_THRESHOLDS = {
  winRate: 30, // % — below this = breached
  pipelineCoverage: 1.0, // weighted pipeline ÷ target — below this = breached
  campaignsOpenRate: 20, // %
  slaHealth: 70, // 0–100
};

export type Thresholds = typeof DEFAULT_THRESHOLDS;
export type ThresholdBreach = { key: string; label: string; value: number; threshold: number; direction: "below" };

/** Effective thresholds for an org (settings override → defaults). */
export function thresholdsFor(settings: Record<string, any> | null | undefined): Thresholds {
  const t = settings?.analytics?.thresholds as Partial<Thresholds> | undefined;
  return {
    winRate: typeof t?.winRate === "number" ? t.winRate : DEFAULT_THRESHOLDS.winRate,
    pipelineCoverage: typeof t?.pipelineCoverage === "number" ? t.pipelineCoverage : DEFAULT_THRESHOLDS.pipelineCoverage,
    campaignsOpenRate: typeof t?.campaignsOpenRate === "number" ? t.campaignsOpenRate : DEFAULT_THRESHOLDS.campaignsOpenRate,
    slaHealth: typeof t?.slaHealth === "number" ? t.slaHealth : DEFAULT_THRESHOLDS.slaHealth,
  };
}

/** Round to 1 decimal for readability. */
const r1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (n: number): number => Math.round(n * 1000) / 10; // 0.371 → 37.1

// ── Sales metrics ─────────────────────────────────────────────────────────────
async function salesMetrics(orgId: string, environment: string): Promise<MetricGroup> {
  const scope = { orgId, environment };
  const [deals, wonEvents] = await Promise.all([
    db().opportunity.findMany({ where: scope, select: { id: true, stage: true, amount: true, probability: true, ownerId: true, createdAt: true, updatedAt: true } }),
    db().event.findMany({ where: { orgId, environment, type: "deal.stage_changed" }, select: { entityId: true, createdAt: true, payload: true } }),
  ]);
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const wonIds = new Set(won.map((d) => d.id));
  const lostIds = new Set(lost.map((d) => d.id));
  const decided = won.length + lost.length;

  // Weighted pipeline: Σ amount × probability (probability is pipeline-derived).
  const weightedPipeline = open.reduce((s, d) => s + (Number(d.amount) || 0) * (d.probability / 100), 0);
  const pipelineValue = open.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const wonAmount = won.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const avgDealSize = won.length ? wonAmount / won.length : 0;

  // Sales velocity = avgDealSize × winRate ÷ avg cycle days (won only).
  const cycleDays = won
    .map((d) => {
      const wonAt = wonEvents.find((e) => e.entityId === d.id && (e.payload as any)?.to === "won")?.createdAt ?? d.updatedAt ?? d.createdAt;
      return Math.max(0, (new Date(wonAt).getTime() - new Date(d.createdAt).getTime()) / 86_400_000);
    })
    .filter((n) => Number.isFinite(n));
  const avgCycleDays = cycleDays.length ? cycleDays.reduce((s, n) => s + n, 0) / cycleDays.length : 0;
  const winRate = decided ? won.length / decided : 0;
  const velocity = avgDealSize * winRate * (avgCycleDays > 0 ? 30 / Math.max(1, avgCycleDays) : 0); // monthlyized

  // Pipeline coverage = weighted pipeline ÷ a 90-day target proxy (4× the
  // current weighted pipeline is a documented stand-in for a sales target).
  const target = weightedPipeline * 4;
  const coverage = target > 0 ? weightedPipeline / target : 0;

  return {
    kind: "sales",
    label: "Sales",
    metrics: [
      { key: "openDeals", label: "Open deals", value: open.length, format: "number", sources: [{ entity: "Opportunity", query: `stage ∉ {won, lost} in ${environment}`, note: `${open.length} open deal rows` }] },
      { key: "pipelineValue", label: "Pipeline value", value: pipelineValue, format: "currency", sources: [{ entity: "Opportunity", query: `stage ∉ {won, lost}, sum(amount)`, note: `${open.length} open deals summed` }] },
      { key: "weightedPipeline", label: "Weighted pipeline", value: r1(weightedPipeline), format: "currency", sources: [{ entity: "Opportunity", query: `Σ amount × probability (pipeline-derived)`, note: "probability comes from the deal's pipeline stage def" }] },
      { key: "wonDeals", label: "Won deals", value: won.length, format: "number", sources: [{ entity: "Opportunity", query: `stage = won`, note: `${won.length} won rows` }] },
      { key: "wonAmount", label: "Won amount", value: wonAmount, format: "currency", sources: [{ entity: "Opportunity", query: `stage = won, sum(amount)`, note: `${won.length} won deals` }] },
      { key: "winRate", label: "Win rate", value: pct(winRate), format: "percent", sources: [{ entity: "Opportunity", query: `won ÷ (won + lost)`, note: `${won.length} won, ${lost.length} lost` }, ...(lostIds.size ? [{ entity: "Event", query: "deal.stage_changed → to: lost", note: `${lostIds.size} loss transitions` }] : [])] },
      { key: "avgDealSize", label: "Avg deal size", value: r1(avgDealSize), format: "currency", sources: [{ entity: "Opportunity", query: `mean(amount) over stage = won`, note: `${won.length} won deals` }] },
      { key: "salesVelocity", label: "Sales velocity (mo)", value: r1(velocity), format: "currency", sources: [{ entity: "Opportunity", query: "avgDealSize × winRate ÷ cycle", note: `avg cycle ${r1(avgCycleDays)}d across ${cycleDays.length} won deals` }] },
      { key: "pipelineCoverage", label: "Pipeline coverage", value: r1(coverage), format: "number", sources: [{ entity: "Opportunity", query: "weightedPipeline ÷ 4× target", note: "90-day target proxied at 4× current weighted pipeline" }] },
    ],
  };
}

// ── Marketing metrics ─────────────────────────────────────────────────────────
async function marketingMetrics(orgId: string, environment: string): Promise<MetricGroup> {
  const scope = { orgId, environment };
  const [recipients, leads, formEvents, wonDeals, contacts] = await Promise.all([
    db().campaignRecipient.findMany({ where: scope, select: { openedAt: true, clickedAt: true, contactId: true } }),
    db().lead.findMany({ where: scope, select: { source: true } }),
    db().event.count({ where: { orgId, environment, type: "form.submitted" } }),
    db().opportunity.findMany({ where: { orgId, environment, stage: "won" }, select: { amount: true, contactId: true } }),
    db().contact.findMany({ where: scope, select: { id: true } }),
  ]);
  const sent = recipients.length;
  const opened = recipients.filter((r) => r.openedAt).length;
  const clicked = recipients.filter((r) => r.clickedAt).length;
  const contactIds = [...new Set(recipients.map((r) => r.contactId).filter(Boolean))];
  const roiDeals = wonDeals.filter((d) => d.contactId && contactIds.includes(d.contactId));
  const roi = roiDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const bySource = new Map<string, number>();
  for (const l of leads) bySource.set(l.source ?? "Other", (bySource.get(l.source ?? "Other") ?? 0) + 1);
  const landingLeads = leads.filter((l) => l.source === "Landing page").length;

  return {
    kind: "marketing",
    label: "Marketing",
    metrics: [
      { key: "campaignsSent", label: "Campaign recipients", value: sent, format: "number", sources: [{ entity: "CampaignRecipient", query: `count in ${environment}`, note: `${sent} recipients across all campaigns` }] },
      { key: "campaignsOpenRate", label: "Campaign open rate", value: sent ? pct(opened / sent) : 0, format: "percent", sources: [{ entity: "CampaignRecipient", query: `openedAt ≠ null ÷ sent`, note: `${opened}/${sent} opened` }] },
      { key: "campaignsClickRate", label: "Campaign click rate", value: sent ? pct(clicked / sent) : 0, format: "percent", sources: [{ entity: "CampaignRecipient", query: `clickedAt ≠ null ÷ sent`, note: `${clicked}/${sent} clicked` }] },
      { key: "campaignRoi", label: "Campaign ROI", value: roi, format: "currency", sources: [{ entity: "Opportunity", query: "won deals whose contact was a recipient", note: `${roiDeals.length} attributed won deals (ADR-017)` }] },
      { key: "landingLeads", label: "Landing-page leads", value: landingLeads, format: "number", sources: [{ entity: "Lead", query: `source = "Landing page"`, note: `${landingLeads} leads from /l/ pages` }] },
      { key: "formSubmissions", label: "Form submissions", value: formEvents, format: "number", sources: [{ entity: "Event", query: `type = form.submitted`, note: `${formEvents} captured submissions` }] },
      { key: "leadsBySource", label: "Leads by source", value: JSON.stringify(Object.fromEntries(bySource)), format: "text", sources: [{ entity: "Lead", query: "group by source", note: `${leads.length} leads total` }] },
      { key: "contacts", label: "Contacts", value: contacts.length, format: "number", sources: [{ entity: "Contact", query: `count in ${environment}`, note: "audience base" }] },
    ],
  };
}

// ── Service metrics ───────────────────────────────────────────────────────────
async function serviceMetrics(orgId: string, environment: string): Promise<MetricGroup> {
  const scope = { orgId, environment };
  const tickets = await db().ticket.findMany({
    where: scope,
    select: { id: true, status: true, priority: true, escalated: true, breachedAt: true, slaDueAt: true, firstResponseAt: true, createdAt: true },
  });
  const open = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const breached = open.filter((t) => t.breachedAt || (t.slaDueAt && new Date(t.slaDueAt) < new Date()));
  const replied = tickets.filter((t) => t.firstResponseAt);
  const responseHours = replied
    .map((t) => Math.max(0, (new Date(t.firstResponseAt!).getTime() - new Date(t.createdAt).getTime()) / 3_600_000))
    .filter((n) => Number.isFinite(n));
  const avgResponse = responseHours.length ? responseHours.reduce((s, n) => s + n, 0) / responseHours.length : 0;
  const breachedRate = open.length ? breached.length / open.length : 0;
  const slaHealth = Math.max(0, Math.min(100, 100 - breachedRate * 200)); // 100 − 2×breach rate(%)

  return {
    kind: "service",
    label: "Service",
    metrics: [
      { key: "openTickets", label: "Open tickets", value: open.length, format: "number", sources: [{ entity: "Ticket", query: `status ∉ {resolved, closed}`, note: `${open.length} open rows` }] },
      { key: "breachedTickets", label: "SLA breached", value: breached.length, format: "number", sources: [{ entity: "Ticket", query: `breachedAt ≠ null OR slaDueAt < now`, note: `${breached.length} past their response deadline` }] },
      { key: "avgFirstResponseHours", label: "Avg first response", value: r1(avgResponse), format: "hours", sources: [{ entity: "Ticket", query: `mean(firstResponseAt − createdAt)`, note: `${responseHours.length} replied tickets` }] },
      { key: "escalatedTickets", label: "Escalated", value: tickets.filter((t) => t.escalated).length, format: "number", sources: [{ entity: "Ticket", query: `escalated = true`, note: "manual + SLA-sweep escalations" }] },
      { key: "slaHealth", label: "SLA health", value: Math.round(slaHealth), format: "number", sources: [{ entity: "Ticket", query: "100 − 2×breach rate", note: `${pct(breachedRate)}% of open tickets breached` }] },
    ],
  };
}

// ── Revenue metrics ───────────────────────────────────────────────────────────
async function revenueMetrics(orgId: string, environment: string): Promise<MetricGroup> {
  const scope = { orgId, environment };
  // Campaign ROI is computed here (not borrowed from another group): won deal
  // amounts on recipient contacts — same attribution model as marketingMetrics.
  const [deals, contacts, recipients] = await Promise.all([
    db().opportunity.findMany({ where: scope, select: { id: true, stage: true, amount: true, probability: true, createdAt: true, contactId: true } }),
    db().contact.count({ where: scope }),
    db().campaignRecipient.findMany({ where: scope, select: { contactId: true } }),
  ]);
  const now = Date.now();
  const won30 = deals.filter((d) => d.stage === "won" && now - new Date(d.createdAt).getTime() <= 30 * 86_400_000);
  const won90 = deals.filter((d) => d.stage === "won" && now - new Date(d.createdAt).getTime() <= 90 * 86_400_000);
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const wonAmount30 = won30.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const wonAmount90 = won90.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const weighted = open.reduce((s, d) => s + (Number(d.amount) || 0) * (d.probability / 100), 0);
  const wonAmount = deals.filter((d) => d.stage === "won").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const recipientContactIds = [...new Set(recipients.map((r) => r.contactId).filter(Boolean))];
  const roiDeals = deals.filter((d) => d.stage === "won" && d.contactId && recipientContactIds.includes(d.contactId));
  const roi = roiDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  return {
    kind: "revenue",
    label: "Revenue",
    metrics: [
      { key: "wonAmount30d", label: "Won (30d)", value: wonAmount30, format: "currency", sources: [{ entity: "Opportunity", query: `stage = won, created ≤ 30d`, note: `${won30.length} deals` }] },
      { key: "wonAmount90d", label: "Won (90d)", value: wonAmount90, format: "currency", sources: [{ entity: "Opportunity", query: `stage = won, created ≤ 90d`, note: `${won90.length} deals` }] },
      { key: "openPipelineWeighted", label: "Weighted pipeline", value: r1(weighted), format: "currency", sources: [{ entity: "Opportunity", query: `open, Σ amount × probability`, note: `${open.length} open deals` }] },
      { key: "campaignRoi", label: "Campaign ROI", value: roi, format: "currency", sources: [{ entity: "Opportunity", query: "won deals on recipient contacts", note: `${roiDeals.length} attributed won deals (ADR-017)` }] },
      { key: "wonAmountTotal", label: "Won (all time)", value: wonAmount, format: "currency", sources: [{ entity: "Opportunity", query: `stage = won, sum(amount)`, note: `${deals.filter((d) => d.stage === "won").length} deals` }] },
      { key: "revenuePerContact", label: "Revenue / contact", value: contacts ? r1(wonAmount / contacts) : 0, format: "currency", sources: [{ entity: "Contact", query: "wonAmount ÷ contacts", note: `${contacts} contacts` }] },
    ],
  };
}

/** All metric groups in one call (executive dashboard + report data). */
export async function computeAllMetrics(orgId: string, environment: string): Promise<MetricGroup[]> {
  const [sales, marketing, service, revenue] = await Promise.all([
    salesMetrics(orgId, environment),
    marketingMetrics(orgId, environment),
    serviceMetrics(orgId, environment),
    revenueMetrics(orgId, environment),
  ]);
  return [sales, marketing, service, revenue];
}

/** Metrics for one dashboard kind (executive = headline cards from all four). */
export async function computeMetricsFor(kind: DashboardKind, orgId: string, environment: string): Promise<MetricGroup> {
  if (kind === "executive") {
    const all = await computeAllMetrics(orgId, environment);
    const headlineKeys = new Set(["pipelineValue", "weightedPipeline", "winRate", "wonAmount30d", "openTickets", "campaignsOpenRate", "leadsBySource"]);
    const picks: Metric[] = [];
    for (const g of all) for (const m of g.metrics) if (headlineKeys.has(m.key)) picks.push(m);
    return { kind: "executive", label: "Executive", metrics: picks };
  }
  const groups = await computeAllMetrics(orgId, environment);
  const group = groups.find((g) => g.kind === kind);
  if (!group) throw new Error(`Unknown dashboard kind: ${kind}`);
  return group;
}

/**
 * Evaluate the org's configured thresholds against the current metrics.
 * Returns the breaches (each also becomes a notification + event in the route).
 */
export async function evaluateThresholds(
  orgId: string,
  environment: string,
  settings: Record<string, any> | null | undefined
): Promise<ThresholdBreach[]> {
  const t = thresholdsFor(settings);
  const all = await computeAllMetrics(orgId, environment);
  const byKey = new Map(all.flatMap((g) => g.metrics).map((m) => [m.key, m]));

  const breaches: ThresholdBreach[] = [];
  const check = (key: string, label: string, threshold: number) => {
    const metric = byKey.get(key);
    if (!metric || typeof metric.value !== "number") return;
    if (metric.value < threshold) breaches.push({ key, label, value: metric.value, threshold, direction: "below" });
  };
  check("winRate", "Win rate", t.winRate);
  check("campaignsOpenRate", "Campaign open rate", t.campaignsOpenRate);
  check("slaHealth", "SLA health", t.slaHealth);
  const coverage = byKey.get("pipelineCoverage");
  if (coverage && typeof coverage.value === "number" && coverage.value < t.pipelineCoverage) {
    breaches.push({ key: "pipelineCoverage", label: "Pipeline coverage", value: coverage.value, threshold: t.pipelineCoverage, direction: "below" });
  }
  return breaches;
}

export { pipelineStages };
