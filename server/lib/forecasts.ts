// Forecasts + predictive v1 (Phase 6 · Analytics, Forecasting & BI) — ADR-018.
//
// Forecasting is the WEIGHTED PIPELINE: per-stage amount × probability, rolled
// into buckets. `pipeline` = raw open amounts, `weighted` = Σ amount × prob,
// `commit` = amounts of stages at ≥75% probability (negotiation/won),
// `bestCase` = amounts of stages at ≥50% (proposal+). Live reads recompute
// from current rows; POST refresh snapshots a Forecast row (the durable
// record + history) and emits forecast.updated.
//
// Predictive v1 is transparent arithmetic (documented inputs, no black box):
// conversion likelihood from stage probability + amount + age, churn risk
// from inactivity + open tickets + no open deals, LTV from won amounts × an
// expected-lifetime multiplier (org setting settings.analytics.ltvMultiplier).
import { db } from "../db";

export type ForecastBuckets = { pipeline: number; weighted: number; commit: number; bestCase: number };
export type ForecastStageRow = { stage: string; probability: number; count: number; amount: number; weighted: number };
export type ForecastOwnerRow = { ownerId: string; ownerName: string; pipeline: number; weighted: number; commit: number; bestCase: number };

/** Bucket the open pipeline rows into the four forecast totals. */
export function bucketPipeline(open: { stage: string; amount: number; probability: number }[]): ForecastBuckets {
  const buckets: ForecastBuckets = { pipeline: 0, weighted: 0, commit: 0, bestCase: 0 };
  for (const d of open) {
    const amount = Number(d.amount) || 0;
    const prob = Number(d.probability) || 0;
    buckets.pipeline += amount;
    buckets.weighted += amount * (prob / 100);
    if (prob >= 75) buckets.commit += amount;
    if (prob >= 50) buckets.bestCase += amount;
  }
  return { pipeline: r2(buckets.pipeline), weighted: r2(buckets.weighted), commit: r2(buckets.commit), bestCase: r2(buckets.bestCase) };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Build the live forecast: buckets + per-stage rows + per-owner rows.
 * `owners` maps ownerId → display name (users + workflow/journey actors).
 */
export async function liveForecast(orgId: string, environment: string): Promise<{
  buckets: ForecastBuckets;
  stages: ForecastStageRow[];
  byOwner: ForecastOwnerRow[];
  dealCount: number;
}> {
  const deals = await db().opportunity.findMany({
    where: { orgId, environment, stage: { notIn: ["won", "lost"] } },
    select: { id: true, stage: true, amount: true, probability: true, ownerId: true },
  });
  const open = deals.map((d) => ({ stage: d.stage, amount: Number(d.amount) || 0, probability: Number(d.probability) || 0 }));
  const buckets = bucketPipeline(open);

  // Per-stage rows.
  const stageMap = new Map<string, { probability: number; count: number; amount: number; weighted: number }>();
  for (const d of open) {
    const row = stageMap.get(d.stage) ?? { probability: d.probability, count: 0, amount: 0, weighted: 0 };
    row.count++;
    row.amount += d.amount;
    row.weighted += d.amount * (d.probability / 100);
    row.probability = Math.max(row.probability, d.probability);
    stageMap.set(d.stage, row);
  }
  const stages: ForecastStageRow[] = [...stageMap.entries()].map(([stage, v]) => ({
    stage,
    probability: v.probability,
    count: v.count,
    amount: r2(v.amount),
    weighted: r2(v.weighted),
  }));

  // Per-owner rows (admins + system actors resolved against the user table).
  const ownerIds = [...new Set(deals.map((d) => d.ownerId).filter(Boolean))] as string[];
  const users = ownerIds.length ? await db().user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const ownerMap = new Map<string, { pipeline: number; weighted: number; commit: number; bestCase: number }>();
  for (const d of deals) {
    const ownerId = d.ownerId;
    const amount = Number(d.amount) || 0;
    const prob = Number(d.probability) || 0;
    const row = ownerMap.get(ownerId) ?? { pipeline: 0, weighted: 0, commit: 0, bestCase: 0 };
    row.pipeline += amount;
    row.weighted += amount * (prob / 100);
    if (prob >= 75) row.commit += amount;
    if (prob >= 50) row.bestCase += amount;
    ownerMap.set(ownerId, row);
  }
  const byOwner: ForecastOwnerRow[] = [...ownerMap.entries()].map(([ownerId, v]) => ({
    ownerId,
    ownerName: nameById.get(ownerId) ?? "System",
    pipeline: r2(v.pipeline),
    weighted: r2(v.weighted),
    commit: r2(v.commit),
    bestCase: r2(v.bestCase),
  })).sort((a, b) => b.weighted - a.weighted);

  return { buckets, stages, byOwner, dealCount: open.length };
}

/** Persist a forecast snapshot (admin refresh) and return the saved row. */
export async function snapshotForecast(orgId: string, environment: string, actorId: string): Promise<any> {
  const live = await liveForecast(orgId, environment);
  const created = await db().forecast.create({
    data: {
      orgId,
      environment,
      buckets: live.buckets as object,
      stages: live.stages as object,
      byOwner: live.byOwner as object,
      metricKeys: ["pipelineValue", "weightedPipeline", "winRate", "salesVelocity"],
      createdBy: actorId,
    },
  });
  return created;
}

// ── Predictive v1 ─────────────────────────────────────────────────────────────
/** Sigmoid helper (maps a raw score to 0..1). */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Clamp + round a score to a 0–100 integer. */
function score(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Conversion likelihood for a deal, 0–100. Inputs (all documented):
 * stage probability (weight .5), amount vs the org average (weight .25 via
 * sigmoid), deal age in days (weight .25 — older without a decision decays).
 * 0.5 baseline + contributions, clamped.
 */
export async function conversionLikelihood(orgId: string, environment: string, deal: { id: string; stage: string; probability: number; amount: number; createdAt: Date }): Promise<{ score: number; inputs: Record<string, string> }> {
  const avgRow = await db().opportunity.aggregate({ where: { orgId, environment, stage: { notIn: ["won", "lost"] } }, _avg: { amount: true } });
  const avgAmount = avgRow._avg.amount ?? 0;
  const prob = Math.max(0, Math.min(100, Number(deal.probability) || 0)) / 100;
  const amountNorm = avgAmount > 0 ? sigmoid((Number(deal.amount) - avgAmount) / Math.max(1, avgAmount)) : 0.5;
  const ageDays = Math.max(0, (Date.now() - new Date(deal.createdAt).getTime()) / 86_400_000);
  const ageFactor = Math.max(0, 1 - ageDays / 365);
  const raw = 0.5 + 0.5 * prob + 0.25 * (amountNorm - 0.5) + 0.25 * (ageFactor - 0.5);
  return {
    score: score(raw * 100),
    inputs: {
      "Stage probability": `${Math.round(prob * 100)}%`,
      "Amount vs org avg": avgAmount > 0 ? `${Math.round((Number(deal.amount) / avgAmount) * 100)}% of average` : "no baseline",
      "Deal age": `${Math.round(ageDays)}d`,
    },
  };
}

/**
 * Churn risk for a contact/account, 0–100. Inputs: days since the entity's
 * last event (weight .5 — inactivity decays from a 60-day grace), open ticket
 * count (weight .3), and having no open deal (weight .2).
 */
export async function churnRisk(
  orgId: string,
  environment: string,
  entity: "contact" | "account",
  entityId: string,
  contactIds: string[]
): Promise<{ score: number; inputs: Record<string, string> }> {
  const event = await db().event.findFirst({
    where: { orgId, environment, entity: { in: entity === "contact" ? ["contact", "message", "ticket"] : ["account", "opportunity"] }, entityId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const daysInactive = event ? Math.max(0, (Date.now() - new Date(event.createdAt).getTime()) / 86_400_000) : 999;
  const inactivity = Math.max(0, Math.min(1, (daysInactive - 60) / 120)); // 0 at ≤60d, 1 at ≥180d
  const tickets = await db().ticket.count({ where: { orgId, environment, status: { notIn: ["resolved", "closed"] }, ...(entity === "contact" ? { contactId: entityId } : { accountId: entityId }) } });
  const ticketFactor = Math.min(1, tickets / 3);
  const openDeals = await db().opportunity.count({ where: { orgId, environment, stage: { notIn: ["won", "lost"] }, ...(entity === "contact" ? { contactId: entityId } : { accountId: entityId }) } });
  const noDealFactor = openDeals === 0 ? 1 : 0;
  const raw = 0.5 * inactivity + 0.3 * ticketFactor + 0.2 * noDealFactor;
  return {
    score: score(raw * 100),
    inputs: {
      "Inactive since": event ? `${Math.round(daysInactive)}d (grace 60d)` : "no events yet",
      "Open tickets": String(tickets),
      "Open deals": String(openDeals),
      "Related contacts": String(contactIds.length),
    },
  };
}

/**
 * LTV estimate for a contact: Σ won deal amounts on the contact ÷ contacts on
 * its account × lifetime multiplier (settings.analytics.ltvMultiplier, default
 * 1.5). Falls back to the contact's own won deals when unlinked.
 */
export async function ltvEstimate(orgId: string, environment: string, settings: Record<string, any> | null | undefined, contact: { id: string; accountId?: string | null }): Promise<{ value: number; inputs: Record<string, string> }> {
  const multiplier = typeof settings?.analytics?.ltvMultiplier === "number" ? settings.analytics.ltvMultiplier : 1.5;
  const accountId = contact.accountId ?? null;
  const [wonOnContact, wonOnAccount, accountContacts] = await Promise.all([
    db().opportunity.findMany({ where: { orgId, environment, stage: "won", contactId: contact.id }, select: { amount: true } }),
    accountId
      ? db().opportunity.findMany({ where: { orgId, environment, stage: "won", accountId }, select: { amount: true } })
      : Promise.resolve([] as { amount: number }[]),
    accountId ? db().contact.count({ where: { orgId, environment, accountId } }) : Promise.resolve(0),
  ]);
  const contactWon = wonOnContact.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const accountWon = wonOnAccount.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const base = accountId && accountContacts > 0 ? accountWon / accountContacts : contactWon;
  return {
    value: Math.round(base * multiplier),
    inputs: {
      "Won on contact": `$${contactWon.toLocaleString()}`,
      "Won on account": accountId ? `$${accountWon.toLocaleString()}` : "unlinked",
      "Contacts on account": String(accountContacts || 0),
      "Lifetime multiplier": String(multiplier),
    },
  };
}
