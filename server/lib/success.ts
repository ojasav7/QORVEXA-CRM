// Customer Success, Retention & Expansion (Phase 11 · ADR-023) — the
// "protect and grow existing revenue" half of the platform, on top of the
// Phase 7 CDP + Phase 10 Revenue Cloud substrate.
//
// Five areas, one lib (like agents.ts / revenue.ts):
//   1. Success plans  — onboarding/success plans per account with a milestones
//      checklist + QBR log, and health-score-to-playbook mapping (low health
//      auto-flags the plan at_risk).
//   2. Usage intelligence — UsageEvent telemetry (feature adoption, seat
//      usage, inactivity), ingested via API + an event-bus mirror (like the
//      Phase 7 behavior mirror); adoption-drop detection emits
//      usage.adoption_dropped.
//   3. Churn prediction v2 — an EXPLAINED deterministic model over Phase 7
//      health + usage trend + support + billing + survey sentiment; admin
//      refresh persists ChurnScore snapshots and emits churn.risk_scored on
//      tier escalation. The expansion radar derives upsell/cross-sell/
//      expansion opportunities (expansion.opportunity_detected).
//   4. Surveys — NPS / CSAT / CES surveys + responses (sentiment derived),
//      computed scores with lineage, and the feedback → roadmap pipeline
//      (negative comments auto-promote to RoadmapItem rows).
//   5. Loyalty — programs (tiers + rewards + points rules), members with a
//      points ledger + derived tier, and referrals that auto-award points on
//      conversion.
//
// All numbers are COMPUTED at read (ADR-018 discipline); snapshots (ChurnScore)
// exist only for history + deltas. The engine (startSuccessEngine) mirrors
// events into usage + runs a 60s ticker (adoption analysis, churn refresh,
// expansion radar, referral conversion) — with a synchronous admin "tick"
// endpoint for deterministic verification (revenue.ts pattern).
import { db } from "../db";
import { badRequest, notFound } from "./http";
import { emitEvent, onEvent } from "./events";
import { healthFor } from "./health";
import { mrrOf } from "./revenue";

const DAY = 86_400_000;

// ── Feature catalog (org-configurable; lazy default) ───────────────────────
// The catalog is the denominator for feature adoption. Defaults cover the
// product areas that actually emit usage; an admin can override via
// Organization.settings.cs.features.
export const DEFAULT_FEATURES = ["pipelines", "email", "calls", "meetings", "workflows", "tickets", "journeys", "analytics", "cdp", "ai"];

export async function featureCatalog(orgId: string): Promise<string[]> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = ((org?.settings ?? {}) as Record<string, unknown>).cs as Record<string, unknown> | undefined;
  const list = settings?.features;
  if (Array.isArray(list) && list.length) return list.map(String);
  return [...DEFAULT_FEATURES];
}

// ── Notifications (kind: cs) ────────────────────────────────────────────────
export async function notifyCsAdmins(orgId: string, environment: string, title: string, body: string, link: string): Promise<void> {
  const admins = await db().user.findMany({ where: { orgId, role: "admin", active: true }, select: { id: true } });
  for (const a of admins) {
    await db().notification.create({ data: { orgId, environment, userId: a.id, title, body, kind: "cs", link } });
  }
}

// ── Account-level health (Phase 7 engine, worst profile) ───────────────────
// Health is computed per identity profile; an account's health = the WORST of
// its profiles' current scores (a sick champion can sink the account).
export async function accountHealth(orgId: string, environment: string, accountId: string): Promise<{ score: number; churnRisk: number; profiles: number } | null> {
  const profiles = await db().identityProfile.findMany({ where: { orgId, environment, accountId }, select: { id: true, memberIds: true, accountId: true } });
  if (!profiles.length) return null;
  let worst: { score: number; churnRisk: number } | null = null;
  for (const p of profiles) {
    try {
      const h = await healthFor(orgId, environment, p);
      if (!worst || h.score < worst.score) worst = { score: h.score, churnRisk: h.churnRisk };
    } catch {
      /* skip profiles that fail to resolve */
    }
  }
  return worst ? { ...worst, profiles: profiles.length } : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · SUCCESS PLANS (onboarding/success plans, milestones, QBRs)
// ═══════════════════════════════════════════════════════════════════════════

export async function listSuccessPlans(orgId: string, environment: string): Promise<any[]> {
  const plans = await db().successPlan.findMany({ where: { orgId, environment }, orderBy: { updatedAt: "desc" } });
  return Promise.all(plans.map((p) => hydratePlan(orgId, environment, p)));
}

export async function getSuccessPlan(orgId: string, environment: string, id: string): Promise<any> {
  const plan = await db().successPlan.findFirst({ where: { id, orgId, environment } });
  if (!plan) throw notFound("Success plan not found");
  return hydratePlan(orgId, environment, plan);
}

/** Join account name + live health; auto-flag at_risk from low health. */
async function hydratePlan(orgId: string, environment: string, plan: any): Promise<any> {
  const [account, health, owner] = await Promise.all([
    plan.accountId ? db().account.findUnique({ where: { id: plan.accountId }, select: { id: true, name: true, tier: true } }) : Promise.resolve(null),
    plan.accountId ? accountHealth(orgId, environment, plan.accountId) : Promise.resolve(null),
    plan.ownerId ? db().user.findUnique({ where: { id: plan.ownerId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  // Health-score-to-playbook mapping (docs/34): score < 55 ⇒ at risk.
  const atRisk = health != null && health.score < 55;
  return {
    ...plan,
    accountName: account?.name ?? null,
    accountTier: account?.tier ?? null,
    ownerName: owner?.name ?? null,
    healthScore: health?.score ?? null,
    churnRisk: health?.churnRisk ?? null,
    atRisk,
    milestones: (plan.milestones ?? []) as any[],
    qbrs: (plan.qbrs ?? []) as any[],
  };
}

export async function createSuccessPlan(orgId: string, environment: string, input: {
  accountId?: string | null; name: string; kind?: string; ownerId?: string | null;
  startDate?: string | null; targetDate?: string | null; notes?: string | null; status?: string;
}, actor: { id: string }): Promise<any> {
  if (!input.name?.trim()) throw badRequest("Plan name is required");
  if (input.accountId) {
    const account = await db().account.findFirst({ where: { id: input.accountId, orgId, environment } });
    if (!account) throw badRequest("Account not found");
  }
  const plan = await db().successPlan.create({
    data: {
      orgId, environment, accountId: input.accountId ?? null, name: input.name.trim(), kind: input.kind ?? "onboarding",
      ownerId: input.ownerId ?? null, status: input.status ?? "draft",
      startDate: input.startDate ? new Date(input.startDate) : null, targetDate: input.targetDate ? new Date(input.targetDate) : null,
      notes: input.notes ?? null, milestones: [], qbrs: [], createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "success_plan.created", entity: "successPlan", entityId: plan.id, actorId: actor.id, payload: { name: plan.name, kind: plan.kind } });
  return getSuccessPlan(orgId, environment, plan.id);
}

export async function updateSuccessPlan(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: { id: string }): Promise<any> {
  const plan = await db().successPlan.findFirst({ where: { id, orgId, environment } });
  if (!plan) throw notFound("Success plan not found");
  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) data.name = String(input.name).trim() || badRequest("Plan name is required");
  if (input.kind !== undefined) data.kind = String(input.kind);
  if (input.ownerId !== undefined) data.ownerId = input.ownerId as string | null;
  if (input.accountId !== undefined) {
    if (input.accountId) {
      const account = await db().account.findFirst({ where: { id: String(input.accountId), orgId, environment } });
      if (!account) throw badRequest("Account not found");
    }
    data.accountId = input.accountId as string | null;
  }
  if (input.startDate !== undefined) data.startDate = input.startDate ? new Date(String(input.startDate)) : null;
  if (input.targetDate !== undefined) data.targetDate = input.targetDate ? new Date(String(input.targetDate)) : null;
  if (input.notes !== undefined) data.notes = input.notes as string | null;
  if (input.status !== undefined) {
    const allowed = ["draft", "active", "at_risk", "completed", "archived"];
    if (!allowed.includes(String(input.status))) throw badRequest(`status must be one of: ${allowed.join(", ")}`);
    data.status = String(input.status);
  }
  const updated = await db().successPlan.update({ where: { id: plan.id }, data });
  await emitEvent({ orgId, environment, type: "success_plan.updated", entity: "successPlan", entityId: plan.id, actorId: actor.id, payload: { name: updated.name, status: updated.status } });
  return getSuccessPlan(orgId, environment, plan.id);
}

export async function deleteSuccessPlan(orgId: string, environment: string, id: string, actor: { id: string }): Promise<void> {
  const plan = await db().successPlan.findFirst({ where: { id, orgId, environment } });
  if (!plan) throw notFound("Success plan not found");
  await db().successPlan.delete({ where: { id: plan.id } });
  await emitEvent({ orgId, environment, type: "success_plan.deleted", entity: "successPlan", entityId: plan.id, actorId: actor.id, payload: { name: plan.name } });
}

/** Add a milestone to a plan (CSM operational write). */
export async function addMilestone(orgId: string, environment: string, planId: string, input: { title: string; dueDate?: string | null }, actor: { id: string }): Promise<any> {
  const plan = await db().successPlan.findFirst({ where: { id: planId, orgId, environment } });
  if (!plan) throw notFound("Success plan not found");
  if (!input.title?.trim()) throw badRequest("Milestone title is required");
  const milestones = [...((plan.milestones ?? []) as any[]), { id: `${Date.now()}`, title: input.title.trim(), dueDate: input.dueDate ? new Date(String(input.dueDate)).toISOString() : null, status: "open", completedAt: null }];
  const updated = await db().successPlan.update({ where: { id: plan.id }, data: { milestones: milestones as object, updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "milestone.added", entity: "successPlan", entityId: plan.id, actorId: actor.id, payload: { plan: plan.name, title: input.title.trim() } });
  return getSuccessPlan(orgId, environment, plan.id);
}

/** Complete (or reopen) a milestone — emits milestone.completed. */
export async function setMilestone(orgId: string, environment: string, planId: string, milestoneId: string, done: boolean, actor: { id: string }): Promise<any> {
  const plan = await db().successPlan.findFirst({ where: { id: planId, orgId, environment } });
  if (!plan) throw notFound("Success plan not found");
  const milestones = ((plan.milestones ?? []) as any[]).map((m) =>
    m.id === milestoneId ? { ...m, status: done ? "done" : "open", completedAt: done ? new Date().toISOString() : null } : m
  );
  if (!milestones.some((m) => m.id === milestoneId)) throw badRequest("Milestone not found");
  const updated = await db().successPlan.update({ where: { id: plan.id }, data: { milestones: milestones as object, updatedAt: new Date() } });
  if (done) {
    const title = milestones.find((m) => m.id === milestoneId)?.title ?? "milestone";
    await emitEvent({ orgId, environment, type: "milestone.completed", entity: "successPlan", entityId: plan.id, actorId: actor.id, payload: { plan: plan.name, milestone: title } });
  }
  return getSuccessPlan(orgId, environment, plan.id);
}

/** Log a QBR (quarterly business review) on a plan. */
export async function addQbr(orgId: string, environment: string, planId: string, input: { title: string; date?: string | null; attendees?: string[]; notes?: string | null }, actor: { id: string }): Promise<any> {
  const plan = await db().successPlan.findFirst({ where: { id: planId, orgId, environment } });
  if (!plan) throw notFound("Success plan not found");
  const qbrs = [...((plan.qbrs ?? []) as any[]), {
    id: `${Date.now()}`, title: input.title?.trim() || "QBR", date: input.date ? new Date(String(input.date)).toISOString() : new Date().toISOString(),
    attendees: input.attendees ?? [], notes: input.notes ?? null,
  }];
  const updated = await db().successPlan.update({ where: { id: plan.id }, data: { qbrs: qbrs as object, updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "qbr.logged", entity: "successPlan", entityId: plan.id, actorId: actor.id, payload: { plan: plan.name, title: input.title?.trim() ?? "QBR" } });
  return getSuccessPlan(orgId, environment, plan.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · USAGE INTELLIGENCE (UsageEvent: feature adoption, seats, inactivity)
// ═══════════════════════════════════════════════════════════════════════════

/** Resolve an account for a usage event: explicit → contact → profile. */
async function resolveUsageAccount(orgId: string, environment: string, input: { accountId?: string | null; contactId?: string | null; profileId?: string | null }): Promise<string | null> {
  if (input.accountId) return input.accountId;
  if (input.contactId) {
    const contact = await db().contact.findFirst({ where: { id: input.contactId, orgId, environment }, select: { accountId: true } });
    return contact?.accountId ?? null;
  }
  if (input.profileId) {
    const profile = await db().identityProfile.findFirst({ where: { id: input.profileId, orgId, environment }, select: { accountId: true } });
    return profile?.accountId ?? null;
  }
  return null;
}

/** Ingest one product usage event (API telemetry path). */
export async function ingestUsage(orgId: string, environment: string, input: {
  type?: string; feature?: string; value?: number | null; accountId?: string | null;
  contactId?: string | null; profileId?: string | null; meta?: Record<string, unknown>; occurredAt?: string | null;
}, actor: { id: string }): Promise<any> {
  const feature = input.feature?.trim() || "general";
  const accountId = await resolveUsageAccount(orgId, environment, input);
  const created = await db().usageEvent.create({
    data: {
      orgId, environment, accountId,
      profileId: input.profileId ?? null, contactId: input.contactId ?? null,
      type: input.type?.trim() || "feature_used", feature,
      value: typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null,
      meta: (input.meta ?? {}) as object, source: "api",
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    },
  });
  await emitEvent({ orgId, environment, type: "usage.tracked", entity: "usageEvent", entityId: created.id, actorId: actor.id, payload: { feature, accountId, type: created.type } });
  return created;
}

/** Usage overview per account: feature adoption, seat usage, inactivity. */
export async function usageOverview(orgId: string, environment: string): Promise<any> {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const since60 = new Date(now - 60 * DAY);
  const catalog = await featureCatalog(orgId);

  const [events30, events60, accounts, subs, bySource] = await Promise.all([
    db().usageEvent.findMany({ where: { orgId, environment, occurredAt: { gte: since30 } }, select: { accountId: true, contactId: true, feature: true } }),
    db().usageEvent.findMany({ where: { orgId, environment, occurredAt: { gte: since60, lt: since30 } }, select: { accountId: true, feature: true } }),
    db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true, tier: true } }),
    db().subscription.findMany({ where: { orgId, environment, status: { in: ["active", "past_due"] } }, select: { accountId: true, quantity: true } }),
    db().usageEvent.groupBy({ by: ["source"], where: { orgId, environment }, _count: true }),
  ]);

  const perAccount = new Map<string, { features30: Set<string>; features60: Set<string>; users30: Set<string>; lastSeen: number }>();
  const key = (a: string | null) => a ?? "unassigned";
  for (const e of events30) {
    const p = perAccount.get(key(e.accountId)) ?? { features30: new Set(), features60: new Set(), users30: new Set(), lastSeen: 0 };
    if (e.feature) p.features30.add(e.feature);
    if (e.contactId) p.users30.add(e.contactId);
    perAccount.set(key(e.accountId), p);
  }
  for (const e of events60) {
    const p = perAccount.get(key(e.accountId)) ?? { features30: new Set(), features60: new Set(), users30: new Set(), lastSeen: 0 };
    if (e.feature) p.features60.add(e.feature);
    perAccount.set(key(e.accountId), p);
  }
  // lastSeen: newest event per account (any window).
  const lastSeenRows = await db().usageEvent.groupBy({ by: ["accountId"], where: { orgId, environment }, _max: { occurredAt: true } });
  for (const r of lastSeenRows) {
    const p = perAccount.get(key(r.accountId)) ?? { features30: new Set(), features60: new Set(), users30: new Set(), lastSeen: 0 };
    if (r._max.occurredAt) p.lastSeen = Math.max(p.lastSeen, new Date(r._max.occurredAt).getTime());
    perAccount.set(key(r.accountId), p);
  }

  const seatCount = new Map<string, number>();
  for (const s of subs) seatCount.set(key(s.accountId), (seatCount.get(key(s.accountId)) ?? 0) + s.quantity);

  const accountNames = new Map(accounts.map((a) => [a.id, a]));
  const rows = [...perAccount.entries()].map(([accountId, p]) => {
    const features30 = p.features30.size;
    const features60 = p.features60.size;
    const adoption = catalog.length ? Math.round((features30 / catalog.length) * 100) : 0;
    const daysInactive = p.lastSeen ? Math.round((now - p.lastSeen) / DAY) : null;
    const seats = seatCount.get(accountId) ?? 0;
    const seatUtilization = seats > 0 ? Math.round((p.users30.size / seats) * 100) : null;
    return {
      accountId: accountId === "unassigned" ? null : accountId,
      accountName: accountId === "unassigned" ? "Unassigned" : (accountNames.get(accountId)?.name ?? null),
      tier: accountId === "unassigned" ? null : accountNames.get(accountId)?.tier ?? null,
      features30, features60,
      featureDrop: features60 > 0 ? Math.round(((features60 - features30) / features60) * 100) : null,
      adoptionPct: adoption,
      activeUsers30: p.users30.size,
      seats,
      seatUtilization,
      daysInactive,
      inactive: p.lastSeen > 0 && now - p.lastSeen > 30 * DAY,
    };
  }).sort((a, b) => (b.features30 ?? 0) - (a.features30 ?? 0));

  const totalUsers = events30.reduce((s, e) => s + (e.contactId ? 1 : 0), 0);
  const totalFeatures30 = new Set(events30.map((e) => e.feature)).size;
  const bySourceCounts: Record<string, number> = {};
  for (const g of bySource) bySourceCounts[g.source] = g._count;
  return {
    catalog,
    totals: {
      accountsTracked: rows.length,
      featuresUsed30: totalFeatures30,
      adoptionPct: catalog.length ? Math.round((totalFeatures30 / catalog.length) * 100) : 0,
      activeUsers30: new Set(events30.filter((e) => e.contactId).map((e) => e.contactId)).size,
      inactiveAccounts: rows.filter((r) => r.inactive).length,
      mirroredEvents: bySourceCounts["event-bus"] ?? 0,
      apiEvents: bySourceCounts["api"] ?? 0,
    },
    accounts: rows,
  };
}

/**
 * Adoption-drop analysis — the engine's usage check. For every tracked
 * account, compare distinct features used in the last 30d vs the prior 30d;
 * a drop below 50% (or total inactivity after prior usage) emits
 * usage.adoption_dropped + an admin notification. Re-emission is gated by an
 * org-settings flag per account so a drop is announced ONCE until recovery.
 */
export async function runAdoptionAnalysis(orgId: string, environment: string): Promise<{ dropped: { accountId: string | null; accountName: string | null; featuresBefore: number; featuresAfter: number }[]; recovered: number }> {
  const overview = await usageOverview(orgId, environment);
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = ((org?.settings ?? {}) as Record<string, unknown>);
  const cs = (settings.cs ?? {}) as Record<string, unknown>;
  const flagged = new Map(Object.entries((cs.adoptionDropped ?? {}) as Record<string, boolean>));

  const dropped: { accountId: string | null; accountName: string | null; featuresBefore: number; featuresAfter: number }[] = [];
  let recovered = 0;
  for (const row of overview.accounts) {
    const id = row.accountId ?? "unassigned";
    const wasFlagged = flagged.get(id) === true;
    const isDropped = row.features60 >= 2 && (row.features30 < row.features60 * 0.5 || row.inactive);
    if (isDropped && !wasFlagged) {
      flagged.set(id, true);
      dropped.push({ accountId: row.accountId, accountName: row.accountName, featuresBefore: row.features60, featuresAfter: row.features30 });
      await emitEvent({
        orgId, environment, type: "usage.adoption_dropped", entity: "account", entityId: row.accountId ?? id,
        actorId: org?.id ?? id,
        payload: { accountId: row.accountId, accountName: row.accountName, featuresBefore: row.features60, featuresAfter: row.features30, dropPct: row.featureDrop, inactive: row.inactive },
      });
      await notifyCsAdmins(orgId, environment, `Usage drop: ${row.accountName ?? "Unassigned"}`,
        `Feature adoption fell from ${row.features60} → ${row.features30} feature(s) in 30d${row.inactive ? " — account inactive" : ""}. Review the account.`, "/success?tab=usage");
    } else if (!isDropped && wasFlagged) {
      flagged.set(id, false);
      recovered++;
    }
  }
  await db().organization.update({ where: { id: orgId }, data: { settings: { ...settings, cs: { ...cs, adoptionDropped: Object.fromEntries(flagged) } } } });
  return { dropped, recovered };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · CHURN PREDICTION v2 (explained) + EXPANSION RADAR
// ═══════════════════════════════════════════════════════════════════════════

export type ChurnFactor = { key: string; label: string; impact: number; detail: string };

/**
 * The churn model (documented in docs/34-customer-success-guide.md). Score is
 * a weighted sum of five explained components, each returning its raw inputs:
 *   health   (35) — (100 − Phase 7 account health); no health data → 40
 *   usage    (25) — inactivity ≥30d +20 / ≥14d +10; feature drop ≥50% +10
 *   support  (20) — 5/breached 8/escalated 5 per OPEN ticket (cap 20)
 *   billing  (25) — 12/past-due sub, 6/overdue invoice, 15/cancelled-90d (cap 25)
 *   surveys  (15) — 6 per negative response in 90d (cap 15)
 * score = clamp(round(health + usage + support + billing + survey), 0, 100)
 * tier: <30 low · <50 medium · <70 high · ≥70 critical
 */
export async function churnForAccount(orgId: string, environment: string, accountId: string): Promise<{
  accountId: string; score: number; riskTier: "low" | "medium" | "high" | "critical";
  factors: ChurnFactor[]; inputs: Record<string, unknown>; recommendation: string;
}> {
  const now = Date.now();
  const since14 = new Date(now - 14 * DAY);
  const since30 = new Date(now - 30 * DAY);
  const since60 = new Date(now - 60 * DAY);
  const since90 = new Date(now - 90 * DAY);

  const [health, usage30, usage60, lastSeenRow, tickets, subs, invoices, surveys] = await Promise.all([
    accountHealth(orgId, environment, accountId),
    db().usageEvent.count({ where: { orgId, environment, accountId, occurredAt: { gte: since30 } } }),
    db().usageEvent.count({ where: { orgId, environment, accountId, occurredAt: { gte: since60, lt: since30 } } }),
    db().usageEvent.findFirst({ where: { orgId, environment, accountId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    db().ticket.findMany({ where: { orgId, environment, accountId, status: { notIn: ["resolved", "closed"] } }, select: { breachedAt: true, escalated: true } }),
    db().subscription.findMany({ where: { orgId, environment, accountId }, select: { status: true, cancelledAt: true } }),
    db().invoice.findMany({ where: { orgId, environment, accountId, status: { in: ["issued", "overdue"] } }, select: { status: true } }),
    db().surveyResponse.findMany({ where: { orgId, environment, accountId, respondedAt: { gte: since90 } }, select: { sentiment: true, score: true } }),
  ]);

  const factors: ChurnFactor[] = [];
  const inputs: Record<string, unknown> = {};

  // health (35)
  const healthScore = health?.score ?? null;
  inputs.healthScore = healthScore;
  let healthContrib = 40;
  if (healthScore != null) {
    healthContrib = 100 - healthScore;
    factors.push({ key: "health", label: "Customer health", impact: healthContrib, detail: `Phase 7 health score ${healthScore}/100 → (100 − health) = ${healthContrib}` });
  } else {
    factors.push({ key: "health", label: "Customer health", impact: 40, detail: "No health data — neutral 40 baseline" });
  }

  // usage (25)
  let usageContrib = 0;
  const lastSeen = lastSeenRow?.occurredAt ? new Date(lastSeenRow.occurredAt).getTime() : 0;
  const daysInactive = lastSeen ? Math.round((now - lastSeen) / DAY) : 9999;
  inputs.daysInactive = daysInactive === 9999 ? null : daysInactive;
  inputs.usageEvents30 = usage30;
  inputs.usageEvents60 = usage60;
  if (usage30 === 0 && usage60 > 0) { usageContrib += 10; factors.push({ key: "usage", label: "Usage trend", impact: 10, detail: `Feature activity dropped to zero in the last 30d (was ${usage60} events the prior 30d)` }); }
  if (daysInactive >= 30) { usageContrib += 20; factors.push({ key: "usage", label: "Usage trend", impact: 20, detail: `No usage in ${daysInactive} days (≥30)` }); }
  else if (daysInactive >= 14) { usageContrib += 10; factors.push({ key: "usage", label: "Usage trend", impact: 10, detail: `No usage in ${daysInactive} days (≥14)` }); }
  if (usageContrib === 0 && usage30 > 0) factors.push({ key: "usage", label: "Usage trend", impact: 0, detail: `${usage30} usage events in the last 30d — healthy activity` });

  // support (20)
  let supportContrib = Math.min(20, tickets.length * 5 + tickets.filter((t) => t.breachedAt).length * 8 + tickets.filter((t) => t.escalated).length * 5);
  inputs.openTickets = tickets.length;
  inputs.breachedTickets = tickets.filter((t) => t.breachedAt).length;
  inputs.escalatedTickets = tickets.filter((t) => t.escalated).length;
  if (tickets.length) factors.push({ key: "support", label: "Support health", impact: supportContrib, detail: `${tickets.length} open ticket(s)${inputs.breachedTickets ? `, ${inputs.breachedTickets} breached` : ""}${inputs.escalatedTickets ? `, ${inputs.escalatedTickets} escalated` : ""}` });

  // billing (25)
  const pastDue = subs.filter((s) => s.status === "past_due").length;
  const cancelled90 = subs.filter((s) => s.status === "cancelled" && s.cancelledAt && new Date(s.cancelledAt) >= since90).length;
  const overdue = invoices.filter((i) => i.status === "overdue").length;
  let billingContrib = Math.min(25, pastDue * 12 + overdue * 6 + cancelled90 * 15);
  inputs.pastDueSubs = pastDue;
  inputs.overdueInvoices = overdue;
  inputs.cancelled90d = cancelled90;
  if (billingContrib > 0) factors.push({ key: "billing", label: "Billing health", impact: billingContrib, detail: `${pastDue} past-due sub(s), ${overdue} overdue invoice(s), ${cancelled90} cancellation(s) in 90d` });

  // surveys (15)
  const negative = surveys.filter((s) => s.sentiment === "negative").length;
  let surveyContrib = Math.min(15, negative * 6);
  inputs.negativeSurveys90d = negative;
  if (negative) factors.push({ key: "surveys", label: "Survey sentiment", impact: surveyContrib, detail: `${negative} negative response(s) in 90d` });

  const score = Math.max(0, Math.min(100, Math.round(healthContrib + usageContrib + supportContrib + billingContrib + surveyContrib)));
  const riskTier = (score < 30 ? "low" : score < 50 ? "medium" : score < 70 ? "high" : "critical") as "low" | "medium" | "high" | "critical";
  // Health-score-to-playbook mapping (docs/34 §playbook).
  const recommendation =
    riskTier === "critical" ? "Executive save call + win-back offer (risk review within 48h)"
    : riskTier === "high" ? "QBR this quarter + targeted usage nudge + CSM touch"
    : riskTier === "medium" ? "Proactive check-in + adoption campaign for underused features"
    : "Maintain cadence — QBR, health tracking, expansion conversation";

  return { accountId, score, riskTier, factors, inputs, recommendation };
}

/** Which accounts get a churn score: any with subs, usage, tickets or health. */
async function churnAccounts(orgId: string, environment: string): Promise<string[]> {
  const [subAccounts, usageAccounts, ticketAccounts, healthAccounts] = await Promise.all([
    db().subscription.findMany({ where: { orgId, environment }, select: { accountId: true }, distinct: ["accountId"] }),
    db().usageEvent.findMany({ where: { orgId, environment }, select: { accountId: true }, distinct: ["accountId"] }),
    db().ticket.findMany({ where: { orgId, environment }, select: { accountId: true }, distinct: ["accountId"] }),
    db().identityProfile.findMany({ where: { orgId, environment }, select: { accountId: true }, distinct: ["accountId"] }),
  ]);
  const ids = new Set<string>();
  for (const g of [subAccounts, usageAccounts, ticketAccounts, healthAccounts]) for (const r of g) if (r.accountId) ids.add(r.accountId);
  return [...ids];
}

/** Current churn predictions (computed on read) for every scorable account. */
export async function churnOverview(orgId: string, environment: string): Promise<any> {
  const accountIds = await churnAccounts(orgId, environment);
  const [accounts, latest] = await Promise.all([
    db().account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, tier: true } }),
    db().churnScore.findMany({ where: { orgId, environment, accountId: { in: accountIds } }, orderBy: { createdAt: "desc" }, take: accountIds.length * 2, select: { accountId: true, score: true, riskTier: true, createdAt: true } }),
  ]);
  const latestByAccount = new Map<string, typeof latest[number]>();
  for (const s of latest) if (s.accountId && !latestByAccount.has(s.accountId)) latestByAccount.set(s.accountId, s);
  const names = new Map(accounts.map((a) => [a.id, a]));
  const items = [];
  for (const accountId of accountIds) {
    const prediction = await churnForAccount(orgId, environment, accountId);
    const snapshot = latestByAccount.get(accountId);
    items.push({
      ...prediction,
      accountName: names.get(accountId)?.name ?? null,
      accountTier: names.get(accountId)?.tier ?? null,
      lastScoredAt: snapshot?.createdAt ?? null,
      lastScore: snapshot?.score ?? null,
      delta: snapshot ? prediction.score - snapshot.score : null,
    });
  }
  items.sort((a, b) => b.score - a.score);
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const i of items) counts[i.riskTier] = (counts[i.riskTier] ?? 0) + 1;
  return { counts, items };
}

/**
 * Admin refresh — persists one ChurnScore snapshot per account, emits
 * churn.risk_scored when the tier ESCALATES vs the previous snapshot, and
 * returns a summary (health.ts refresh pattern).
 */
export async function refreshChurn(orgId: string, environment: string, actorId: string): Promise<{ refreshed: number; refreshId: string; escalated: string[]; counts: Record<string, number> }> {
  const accountIds = await churnAccounts(orgId, environment);
  const refreshId = `${Date.now()}`;
  const latest = await db().churnScore.findMany({ where: { orgId, environment, accountId: { in: accountIds } }, orderBy: { createdAt: "desc" }, take: accountIds.length * 2, select: { accountId: true, riskTier: true, score: true } });
  const previous = new Map<string, { riskTier: string; score: number }>();
  for (const s of latest) if (s.accountId && !previous.has(s.accountId)) previous.set(s.accountId, s);

  const escalated: string[] = [];
  const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const names = new Map((await db().account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  for (const accountId of accountIds) {
    const prediction = await churnForAccount(orgId, environment, accountId);
    counts[prediction.riskTier] = (counts[prediction.riskTier] ?? 0) + 1;
    const prev = previous.get(accountId) ?? null;
    const tierOrder = ["low", "medium", "high", "critical"] as const;
    const escalatedNow = prev != null && tierOrder.indexOf(prediction.riskTier) > tierOrder.indexOf(prev.riskTier as (typeof tierOrder)[number]);
    await db().churnScore.create({
      data: {
        orgId, environment, accountId, score: prediction.score, riskTier: prediction.riskTier,
        factors: prediction.factors as object, inputs: prediction.inputs as object,
        refreshId, previousScore: prev?.score ?? null,
      },
    });
    if (escalatedNow) {
      escalated.push(accountId);
      await emitEvent({
        orgId, environment, type: "churn.risk_scored", entity: "account", entityId: accountId, actorId,
        payload: { accountId, accountName: names.get(accountId) ?? null, score: prediction.score, riskTier: prediction.riskTier, previousTier: prev.riskTier, recommendation: prediction.recommendation, factors: prediction.factors },
      });
      await notifyCsAdmins(orgId, environment, `Churn risk escalated: ${names.get(accountId) ?? "Account"}`,
        `${prediction.riskTier.toUpperCase()} risk (${prediction.score}/100, was ${prev.riskTier}). ${prediction.recommendation}.`, "/success?tab=churn");
    }
  }
  return { refreshed: accountIds.length, refreshId, escalated, counts };
}

/** Latest persisted snapshots (history for the Churn tab). */
export async function churnHistory(orgId: string, environment: string, accountId?: string): Promise<any[]> {
  const where = { orgId, environment, ...(accountId ? { accountId } : {}) };
  return db().churnScore.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
}

/**
 * EXPANSION RADAR — derived upsell / cross-sell / expansion opportunities.
 *   upsell     — active subscription seats ≥80% utilized, or very high usage
 *   cross_sell — high feature usage while catalog features stay unadopted
 *   expansion  — won revenue in 90d + healthy account → next add-on
 * Emits expansion.opportunity_detected for NEW opportunities on tick (gated by
 * an org-settings fingerprint per account × type).
 */
export async function expansionRadar(orgId: string, environment: string): Promise<any[]> {
  const now = Date.now();
  const since90 = new Date(now - 90 * DAY);
  const catalog = await featureCatalog(orgId);
  const overview = await usageOverview(orgId, environment);
  const [subs, wonDeals, accounts] = await Promise.all([
    db().subscription.findMany({ where: { orgId, environment, status: { in: ["active", "past_due"] } } }),
    db().opportunity.findMany({ where: { orgId, environment, stage: "won", updatedAt: { gte: since90 } }, select: { accountId: true, amount: true } }),
    db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } }),
  ]);
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  const opportunities: { type: string; accountId: string; accountName: string | null; title: string; reason: string; estimatedValue: number; confidence: number }[] = [];
  const used = new Set<string>();

  // upsell from seat utilization
  for (const s of subs) {
    if (!s.accountId) continue;
    const row = (overview.accounts as any[]).find((r: any) => r.accountId === s.accountId);
    const utilization = row?.seatUtilization ?? null;
    if (utilization != null && utilization >= 80) {
      const key = `${s.accountId}:upsell:seats`;
      if (!used.has(key)) {
        used.add(key);
        opportunities.push({
          type: "upsell", accountId: s.accountId, accountName: names.get(s.accountId) ?? null,
          title: `Seat expansion — ${s.name}`, reason: `${utilization}% of ${row?.seats} purchased seat(s) active — add capacity`,
          estimatedValue: Math.round(mrrOf(s) * 12 * 0.25), confidence: 0.7,
        });
      }
    }
  }
  // cross-sell from unadopted catalog features
  for (const row of overview.accounts) {
    if (!row.accountId || !row.features30 || row.features30 < 3) continue;
    const featureSet = new Set(await usageFeaturesForAccount(orgId, environment, row.accountId));
    const miss = catalog.find((f) => !featureSet.has(f));
    if (miss) {
      const key = `${row.accountId}:cross_sell:${miss}`;
      if (!used.has(key)) {
        used.add(key);
        opportunities.push({
          type: "cross_sell", accountId: row.accountId, accountName: row.accountName,
          title: `Cross-sell: ${miss}`, reason: `High usage (${row.features30} features) but ${miss} is unadopted`,
          estimatedValue: 5000, confidence: 0.55,
        });
      }
    }
  }
  // expansion from won revenue + health
  for (const d of wonDeals) {
    if (!d.accountId) continue;
    const health = await accountHealth(orgId, environment, d.accountId);
    if (health && health.score >= 60) {
      const key = `${d.accountId}:expansion:won`;
      if (!used.has(key)) {
        used.add(key);
        opportunities.push({
          type: "expansion", accountId: d.accountId, accountName: names.get(d.accountId) ?? null,
          title: "Expansion — next add-on", reason: `Won ${d.amount ? `$${d.amount.toLocaleString()}` : "revenue"} in 90d with healthy account (${health.score}/100) — pitch the next product`,
          estimatedValue: Math.round((Number(d.amount) || 0) * 0.1), confidence: 0.6,
        });
      }
    }
  }
  return opportunities.sort((a, b) => b.estimatedValue - a.estimatedValue);
}

async function usageFeaturesForAccount(orgId: string, environment: string, accountId: string): Promise<string[]> {
  const rows = await db().usageEvent.findMany({ where: { orgId, environment, accountId }, select: { feature: true }, distinct: ["feature"] });
  return rows.map((r) => r.feature);
}

/** Emit expansion.opportunity_detected for opportunities not seen before. */
async function emitNewExpansionOpportunities(orgId: string, environment: string): Promise<{ emitted: number; opportunities: any[] }> {
  const opportunities = await expansionRadar(orgId, environment);
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const cs = (settings.cs ?? {}) as Record<string, unknown>;
  const seen = new Set(Object.keys((cs.expansionSeen ?? {}) as Record<string, boolean>));
  let emitted = 0;
  for (const o of opportunities) {
    const key = `${o.accountId}:${o.type}:${o.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    emitted++;
    await emitEvent({
      orgId, environment, type: "expansion.opportunity_detected", entity: "account", entityId: o.accountId,
      actorId: org?.id ?? o.accountId,
      payload: { accountId: o.accountId, accountName: o.accountName, type: o.type, title: o.title, reason: o.reason, estimatedValue: o.estimatedValue },
    });
  }
  if (emitted > 0) {
    const expansionSeen: Record<string, boolean> = {};
    for (const k of seen) expansionSeen[k] = true;
    await db().organization.update({ where: { id: orgId }, data: { settings: { ...settings, cs: { ...cs, expansionSeen } } } });
  }
  return { emitted, opportunities };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · SURVEYS (NPS / CSAT / CES) + FEEDBACK → ROADMAP PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

const SURVEY_RANGES: Record<string, [number, number]> = { nps: [0, 10], csat: [1, 5], ces: [1, 7] };

export async function listSurveys(orgId: string, environment: string): Promise<any[]> {
  return db().survey.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" } });
}

export async function createSurvey(orgId: string, environment: string, input: { name: string; kind?: string; question?: string; targetSegmentId?: string | null }, actor: { id: string }): Promise<any> {
  const kind = input.kind ?? "nps";
  if (!["nps", "csat", "ces"].includes(kind)) throw badRequest("kind must be nps | csat | ces");
  if (!input.name?.trim()) throw badRequest("Survey name is required");
  const survey = await db().survey.create({
    data: {
      orgId, environment, name: input.name.trim(), kind, question: input.question?.trim() || (kind === "nps" ? "How likely are you to recommend us?" : kind === "csat" ? "How satisfied are you?" : "How easy was it?"),
      targetSegmentId: input.targetSegmentId ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "survey.created", entity: "survey", entityId: survey.id, actorId: actor.id, payload: { name: survey.name, kind: survey.kind } });
  return survey;
}

export async function updateSurvey(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: { id: string }): Promise<any> {
  const survey = await db().survey.findFirst({ where: { id, orgId, environment } });
  if (!survey) throw notFound("Survey not found");
  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.question !== undefined) data.question = String(input.question).trim();
  if (input.active !== undefined) data.active = Boolean(input.active);
  if (input.kind !== undefined) {
    if (!["nps", "csat", "ces"].includes(String(input.kind))) throw badRequest("kind must be nps | csat | ces");
    data.kind = String(input.kind);
  }
  const updated = await db().survey.update({ where: { id: survey.id }, data });
  await emitEvent({ orgId, environment, type: "survey.updated", entity: "survey", entityId: survey.id, actorId: actor.id, payload: { name: updated.name } });
  return updated;
}

export async function deleteSurvey(orgId: string, environment: string, id: string, actor: { id: string }): Promise<void> {
  const survey = await db().survey.findFirst({ where: { id, orgId, environment } });
  if (!survey) throw notFound("Survey not found");
  await db().surveyResponse.deleteMany({ where: { orgId, environment, surveyId: survey.id } });
  await db().survey.delete({ where: { id: survey.id } });
  await emitEvent({ orgId, environment, type: "survey.deleted", entity: "survey", entityId: survey.id, actorId: actor.id, payload: { name: survey.name } });
}

/** Transparent sentiment from free-text (ADR-020 discipline, no black box). */
export function deriveSentiment(comment: string): "positive" | "negative" | "neutral" {
  const text = comment.toLowerCase();
  const positive = ["great", "love", "excellent", "amazing", "easy", "fast", "helpful", "good", "happy", "recommend"];
  const negative = ["bad", "slow", "bug", "broken", "frustrat", "difficult", "confus", "terrible", "awful", "error", "crash", "hate", "unusable", "worst"];
  const pos = positive.filter((w) => text.includes(w)).length;
  const neg = negative.filter((w) => text.includes(w)).length;
  if (neg > pos) return "negative";
  if (pos > neg) return "positive";
  return "neutral";
}

/** Record a survey response. Negative comments auto-promote to the roadmap. */
export async function addSurveyResponse(orgId: string, environment: string, input: {
  surveyId: string; score: number; comment?: string | null; contactId?: string | null; profileId?: string | null; accountId?: string | null;
}, actor: { id: string }): Promise<any> {
  const survey = await db().survey.findFirst({ where: { id: input.surveyId, orgId, environment } });
  if (!survey) throw notFound("Survey not found");
  const [min, max] = SURVEY_RANGES[survey.kind] ?? SURVEY_RANGES.nps;
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < min || score > max) throw badRequest(`${survey.kind} score must be an integer ${min}–${max}`);
  const accountId = input.accountId ?? (input.contactId ? (await db().contact.findFirst({ where: { id: input.contactId, orgId, environment }, select: { accountId: true } }))?.accountId ?? null : null);
  const sentiment = input.comment?.trim() ? deriveSentiment(input.comment) : null;
  const created = await db().surveyResponse.create({
    data: {
      orgId, environment, surveyId: survey.id, profileId: input.profileId ?? null, contactId: input.contactId ?? null,
      accountId, score, comment: input.comment?.trim() || null, sentiment, respondedAt: new Date(),
    },
  });
  await emitEvent({
    orgId, environment, type: "survey.response_submitted", entity: "surveyResponse", entityId: created.id, actorId: actor.id,
    payload: { survey: survey.name, kind: survey.kind, score, sentiment, accountId },
  });
  // Feedback → roadmap pipeline: negative comments become roadmap items.
  let roadmapItem: any = null;
  if (sentiment === "negative" && created.comment) {
    roadmapItem = await createRoadmapItem(orgId, environment, {
      title: `${survey.name}: ${created.comment.slice(0, 60)}${created.comment.length > 60 ? "…" : ""}`,
      description: `Auto-promoted from a ${survey.kind} response. Original: "${created.comment}"`,
      source: "survey", category: "improvement", surveyResponseId: created.id,
    }, actor);
  }
  return { response: created, roadmapItem };
}

export async function surveyResponses(orgId: string, environment: string, surveyId: string): Promise<any[]> {
  const survey = await db().survey.findFirst({ where: { id: surveyId, orgId, environment } });
  if (!survey) throw notFound("Survey not found");
  const responses = await db().surveyResponse.findMany({ where: { orgId, environment, surveyId }, orderBy: { respondedAt: "desc" }, take: 100 });
  const contactIds = [...new Set(responses.map((r) => r.contactId).filter(Boolean) as string[])];
  const contacts = contactIds.length ? await db().contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
  const nameById = new Map(contacts.map((c) => [c.id, `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email]));
  return responses.map((r) => ({ ...r, contactName: r.contactId ? (nameById.get(r.contactId) ?? null) : null }));
}

/** Computed survey score with lineage (NPS −100..100, CSAT %, CES avg). */
export async function surveyResults(orgId: string, environment: string, surveyId: string): Promise<any> {
  const survey = await db().survey.findFirst({ where: { id: surveyId, orgId, environment } });
  if (!survey) throw notFound("Survey not found");
  const responses = await db().surveyResponse.findMany({ where: { orgId, environment, surveyId }, select: { score: true, sentiment: true, comment: true } });
  const total = responses.length;
  const avg = total ? Math.round((responses.reduce((s, r) => s + r.score, 0) / total) * 10) / 10 : null;
  const sentiment: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
  for (const r of responses) if (r.sentiment && r.sentiment in sentiment) sentiment[r.sentiment]++;
  let score: number | null = null;
  const formula: string[] = [];
  if (survey.kind === "nps") {
    const promoters = responses.filter((r) => r.score >= 9).length;
    const detractors = responses.filter((r) => r.score <= 6).length;
    score = total ? Math.round(((promoters - detractors) / total) * 100) : null;
    formula.push(`NPS = %promoters(9-10) − %detractors(0-6) = ${promoters}/${total} − ${detractors}/${total}`);
  } else if (survey.kind === "csat") {
    const satisfied = responses.filter((r) => r.score >= 4).length;
    score = total ? Math.round((satisfied / total) * 100) : null;
    formula.push(`CSAT = % of 4-5 scores = ${satisfied}/${total}`);
  } else {
    score = avg;
    formula.push(`CES = mean effort score (1 = very easy … 7 = very hard) = ${avg}`);
  }
  return { survey, total, score, avg, sentiment, formula, responses: responses.length, distribution: responses.reduce<Record<number, number>>((acc, r) => { acc[r.score] = (acc[r.score] ?? 0) + 1; return acc; }, {}) };
}

// ── Roadmap pipeline ────────────────────────────────────────────────────────
export async function listRoadmap(orgId: string, environment: string, status?: string): Promise<any[]> {
  const where: Record<string, unknown> = { orgId, environment };
  if (status) where.status = status;
  return db().roadmapItem.findMany({ where, orderBy: [{ votes: "desc" }, { createdAt: "desc" }], take: 100 });
}

export async function createRoadmapItem(orgId: string, environment: string, input: {
  title: string; description?: string | null; source?: string; category?: string; surveyResponseId?: string | null; status?: string;
}, actor: { id: string }): Promise<any> {
  if (!input.title?.trim()) throw badRequest("Title is required");
  const item = await db().roadmapItem.create({
    data: {
      orgId, environment, title: input.title.trim(), description: input.description ?? null,
      source: input.source ?? "internal", category: input.category ?? "improvement",
      surveyResponseId: input.surveyResponseId ?? null, status: input.status ?? "new", createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "roadmap.created", entity: "roadmapItem", entityId: item.id, actorId: actor.id, payload: { title: item.title, source: item.source } });
  return item;
}

export async function updateRoadmapItem(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: { id: string }): Promise<any> {
  const item = await db().roadmapItem.findFirst({ where: { id, orgId, environment } });
  if (!item) throw notFound("Roadmap item not found");
  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) data.title = String(input.title).trim();
  if (input.description !== undefined) data.description = input.description as string | null;
  if (input.category !== undefined) data.category = String(input.category);
  if (input.status !== undefined) {
    const allowed = ["new", "triaged", "planned", "in_progress", "shipped", "declined"];
    if (!allowed.includes(String(input.status))) throw badRequest(`status must be one of: ${allowed.join(", ")}`);
    data.status = String(input.status);
  }
  if (input.votes !== undefined) data.votes = Number(input.votes) || 0;
  const updated = await db().roadmapItem.update({ where: { id: item.id }, data });
  await emitEvent({ orgId, environment, type: "roadmap.updated", entity: "roadmapItem", entityId: item.id, actorId: actor.id, payload: { title: updated.title, status: updated.status } });
  return updated;
}

export async function voteRoadmapItem(orgId: string, environment: string, id: string): Promise<any> {
  const item = await db().roadmapItem.findFirst({ where: { id, orgId, environment } });
  if (!item) throw notFound("Roadmap item not found");
  return db().roadmapItem.update({ where: { id: item.id }, data: { votes: { increment: 1 }, updatedAt: new Date() } });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · LOYALTY & ADVOCACY (programs, members, referrals, rewards)
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_TIERS = [
  { key: "bronze", name: "Bronze", minPoints: 0, benefits: ["Welcome kit"] },
  { key: "silver", name: "Silver", minPoints: 500, benefits: ["Welcome kit", "Priority support"] },
  { key: "gold", name: "Gold", minPoints: 1500, benefits: ["Welcome kit", "Priority support", "Early access", "Customer story feature"] },
];
export const DEFAULT_REWARDS = [
  { key: "swag", name: "Qorvexa swag pack", pointsCost: 500, description: "Hoodie + stickers" },
  { key: "discount", name: "10% renewal discount", pointsCost: 2000, description: "Applied to the next renewal invoice" },
  { key: "early", name: "Early access pass", pointsCost: 1000, description: "Try new features before GA" },
];

/** Derived tier for a member's points (loyalty rules, docs/34). */
export function tierFor(points: number, tiers: { key: string; name: string; minPoints: number }[]): { key: string; name: string } {
  const sorted = [...tiers].sort((a, b) => b.minPoints - a.minPoints);
  return sorted.find((t) => points >= t.minPoints) ?? { key: tiers[0]?.key ?? "bronze", name: tiers[0]?.name ?? "Bronze" };
}

export async function listPrograms(orgId: string, environment: string): Promise<any[]> {
  const programs = await db().loyaltyProgram.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" } });
  return Promise.all(programs.map(async (p) => {
    const [members, referrals] = await Promise.all([
      db().loyaltyMember.findMany({ where: { orgId, environment, programId: p.id }, orderBy: { points: "desc" }, take: 50 }),
      db().referralRecord.findMany({ where: { orgId, environment, programId: p.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const tiers = ((p.tiers ?? []) as { key: string; name: string; minPoints: number }[]);
    return {
      ...p,
      tiers,
      rewards: (p.rewards ?? []) as any[],
      pointsRules: (p.pointsRules ?? {}) as Record<string, number>,
      members: members.map((m) => ({ ...m, tier: tierFor(m.points, tiers) })),
      referrals,
    };
  }));
}

export async function createProgram(orgId: string, environment: string, input: { name: string; tiers?: any[]; rewards?: any[]; pointsRules?: Record<string, number> }, actor: { id: string }): Promise<any> {
  if (!input.name?.trim()) throw badRequest("Program name is required");
  const program = await db().loyaltyProgram.create({
    data: {
      orgId, environment, name: input.name.trim(), active: true,
      tiers: (input.tiers ?? DEFAULT_TIERS) as object, rewards: (input.rewards ?? DEFAULT_REWARDS) as object,
      pointsRules: (input.pointsRules ?? { referral: 500, survey: 50, review: 100 }) as object, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "loyalty.program_created", entity: "loyaltyProgram", entityId: program.id, actorId: actor.id, payload: { name: program.name } });
  return program;
}

export async function updateProgram(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: { id: string }): Promise<any> {
  const program = await db().loyaltyProgram.findFirst({ where: { id, orgId, environment } });
  if (!program) throw notFound("Program not found");
  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.active !== undefined) data.active = Boolean(input.active);
  if (input.tiers !== undefined) data.tiers = input.tiers as object;
  if (input.rewards !== undefined) data.rewards = input.rewards as object;
  if (input.pointsRules !== undefined) data.pointsRules = input.pointsRules as object;
  const updated = await db().loyaltyProgram.update({ where: { id: program.id }, data });
  await emitEvent({ orgId, environment, type: "loyalty.program_updated", entity: "loyaltyProgram", entityId: program.id, actorId: actor.id, payload: { name: updated.name } });
  return updated;
}

/** Enroll a member (one per program × contact — upsert by contactId). */
export async function enrollMember(orgId: string, environment: string, programId: string, input: { contactId?: string | null; profileId?: string | null }, actor: { id: string }): Promise<any> {
  const program = await db().loyaltyProgram.findFirst({ where: { id: programId, orgId, environment } });
  if (!program) throw notFound("Program not found");
  const existing = input.contactId
    ? await db().loyaltyMember.findFirst({ where: { orgId, environment, programId, contactId: input.contactId } })
    : null;
  if (existing) return existing;
  const contact = input.contactId ? await db().contact.findFirst({ where: { id: input.contactId, orgId, environment }, select: { id: true, accountId: true } }) : null;
  const member = await db().loyaltyMember.create({
    data: {
      orgId, environment, programId, contactId: input.contactId ?? null, profileId: input.profileId ?? null,
      accountId: contact?.accountId ?? null, points: 0,
    },
  });
  await emitEvent({ orgId, environment, type: "loyalty.member_enrolled", entity: "loyaltyMember", entityId: member.id, actorId: actor.id, payload: { program: program.name, contactId: member.contactId } });
  return member;
}

/** Award points to a member (loyalty.points_awarded + event). */
export async function awardPoints(orgId: string, environment: string, memberId: string, points: number, reason: string, actor: { id: string }): Promise<any> {
  const member = await db().loyaltyMember.findFirst({ where: { id: memberId, orgId, environment } });
  if (!member) throw notFound("Member not found");
  const n = Number(points);
  if (!Number.isInteger(n) || n <= 0) throw badRequest("Points must be a positive integer");
  const updated = await db().loyaltyMember.update({ where: { id: member.id }, data: { points: { increment: n }, updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "loyalty.points_awarded", entity: "loyaltyMember", entityId: member.id, actorId: actor.id, payload: { points: n, reason, total: updated.points } });
  return updated;
}

export async function listMembers(orgId: string, environment: string): Promise<any[]> {
  const members = await db().loyaltyMember.findMany({ where: { orgId, environment }, orderBy: { points: "desc" }, take: 100 });
  const [programs, contacts] = await Promise.all([
    db().loyaltyProgram.findMany({ where: { orgId, environment }, select: { id: true, name: true, tiers: true } }),
    db().contact.findMany({ where: { id: { in: [...new Set(members.map((m) => m.contactId).filter(Boolean) as string[])] } }, select: { id: true, firstName: true, lastName: true, email: true, accountId: true } }),
  ]);
  const programById = new Map(programs.map((p) => [p.id, p]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  return members.map((m) => {
    const program = programById.get(m.programId);
    const contact = m.contactId ? contactById.get(m.contactId) : undefined;
    const tiers = ((program?.tiers ?? []) as { key: string; name: string; minPoints: number }[]);
    return {
      ...m,
      programName: program?.name ?? null,
      contactName: contact ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.email : null,
      accountId: m.accountId ?? contact?.accountId ?? null,
      tier: tierFor(m.points, tiers),
    };
  });
}

/** Create a referral (a member referring a business email). */
export async function createReferral(orgId: string, environment: string, input: {
  programId: string; referredEmail: string; referredName?: string | null; referrerContactId?: string | null; referrerProfileId?: string | null;
}, actor: { id: string }): Promise<any> {
  const program = await db().loyaltyProgram.findFirst({ where: { id: input.programId, orgId, environment } });
  if (!program) throw notFound("Program not found");
  if (!input.referredEmail?.includes("@")) throw badRequest("A valid referred email is required");
  const referral = await db().referralRecord.create({
    data: {
      orgId, environment, programId: program.id, referredEmail: input.referredEmail.toLowerCase().trim(),
      referredName: input.referredName ?? null, referrerContactId: input.referrerContactId ?? null,
      referrerProfileId: input.referrerProfileId ?? null, status: "pending", createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "referral.created", entity: "referralRecord", entityId: referral.id, actorId: actor.id, payload: { program: program.name, referredEmail: referral.referredEmail } });
  return referral;
}

/**
 * Advance a referral's lifecycle. Converting awards the referrer points per
 * the program's pointsRules.referral (loyalty rules, docs/34) — a converted
 * referral is the advocacy win, so the points land on the referrer's member.
 */
export async function setReferralStatus(orgId: string, environment: string, referralId: string, status: "contacted" | "converted" | "expired", actor: { id: string }): Promise<any> {
  const referral = await db().referralRecord.findFirst({ where: { id: referralId, orgId, environment } });
  if (!referral) throw notFound("Referral not found");
  const FLOW: Record<string, string[]> = { pending: ["contacted", "expired"], contacted: ["converted", "expired"], converted: [], expired: [] };
  const allowed = FLOW[referral.status] ?? [];
  if (!allowed.includes(status)) throw badRequest(`Referral cannot move ${referral.status} → ${status}`);
  const data: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "converted") data.convertedAt = new Date();
  const updated = await db().referralRecord.update({ where: { id: referral.id }, data });
  await emitEvent({ orgId, environment, type: `referral.${status}`, entity: "referralRecord", entityId: referral.id, actorId: actor.id, payload: { referredEmail: referral.referredEmail } });

  if (status === "converted" && referral.referrerContactId) {
    const program = await db().loyaltyProgram.findFirst({ where: { id: referral.programId, orgId, environment } });
    const rules = ((program?.pointsRules ?? {}) as Record<string, number>);
    const points = Number(rules.referral) || 500;
    const member = await db().loyaltyMember.findFirst({ where: { orgId, environment, programId: referral.programId, contactId: referral.referrerContactId } });
    if (member) {
      await awardPoints(orgId, environment, member.id, points, `Referral converted: ${referral.referredEmail}`, actor);
      await db().referralRecord.update({ where: { id: referral.id }, data: { pointsAwarded: points, updatedAt: new Date() } });
    }
  }
  return getReferral(orgId, environment, referral.id);
}

export async function getReferral(orgId: string, environment: string, id: string): Promise<any> {
  const referral = await db().referralRecord.findFirst({ where: { id, orgId, environment } });
  if (!referral) throw notFound("Referral not found");
  const referrer = referral.referrerContactId
    ? await db().contact.findUnique({ where: { id: referral.referrerContactId }, select: { id: true, firstName: true, lastName: true, email: true } })
    : null;
  return { ...referral, referrerName: referrer ? `${referrer.firstName ?? ""} ${referrer.lastName ?? ""}`.trim() || referrer.email : null };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — event-bus usage mirror + 60s ticker (revenue.ts pattern)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One pass of the success engine (ticker or admin "tick"): adoption analysis,
 * churn refresh, expansion detection, and referral auto-conversion (a pending
 * referral whose referred email now matches a customer record converts).
 */
export async function runSuccessTicker(orgId: string, environment: string, actorId: string): Promise<{
  adoption: { dropped: number; recovered: number };
  churn: { refreshed: number; escalated: string[]; counts: Record<string, number> };
  expansion: { emitted: number; opportunities: number };
  referralsConverted: number;
}> {
  const adoption = await runAdoptionAnalysis(orgId, environment);
  const churn = await refreshChurn(orgId, environment, actorId);
  const expansion = await emitNewExpansionOpportunities(orgId, environment);
  const referralsConverted = await autoConvertReferrals(orgId, environment, actorId);
  return {
    adoption: { dropped: adoption.dropped.length, recovered: adoption.recovered },
    churn,
    expansion: { emitted: expansion.emitted, opportunities: expansion.opportunities.length },
    referralsConverted,
  };
}

/** Auto-convert pending referrals whose referred email now belongs to a customer. */
async function autoConvertReferrals(orgId: string, environment: string, actorId: string): Promise<number> {
  const pending = await db().referralRecord.findMany({ where: { orgId, environment, status: "pending" } });
  let converted = 0;
  for (const referral of pending) {
    const contact = await db().contact.findFirst({ where: { orgId, environment, email: referral.referredEmail }, select: { id: true, accountId: true } });
    if (!contact) continue;
    const [wonDeal, activeSub] = await Promise.all([
      db().opportunity.findFirst({ where: { orgId, environment, accountId: contact.accountId ?? undefined, stage: "won" } }),
      db().subscription.findFirst({ where: { orgId, environment, accountId: contact.accountId ?? undefined, status: { in: ["active", "past_due"] } } }),
    ]);
    if (!wonDeal && !activeSub) continue;
    await setReferralStatus(orgId, environment, referral.id, "converted", { id: actorId });
    converted++;
  }
  return converted;
}

/** Event-bus → usage mirror: system events become product usage (like CDP). */
const USAGE_MIRROR: Record<string, string> = {
  "email.opened": "email",
  "email.clicked": "email",
  "email.replied": "email",
  "form.submitted": "landing",
  "ticket.created": "tickets",
  "call.completed": "calls",
  "meeting.completed": "meetings",
};

async function mirrorUsageEvent(event: { orgId: string; environment: string; type: string; entity: string; entityId: string; actorId: string; id: string }) {
  try {
    const { orgId, environment } = event;
    let accountId: string | null = null;
    let contactId: string | null = null;
    if (event.type.startsWith("email.")) {
      const message = await db().message.findUnique({ where: { id: event.entityId }, select: { contactId: true } });
      contactId = message?.contactId ?? null;
    } else if (event.type === "ticket.created") {
      const ticket = await db().ticket.findUnique({ where: { id: event.entityId }, select: { accountId: true, contactId: true } });
      accountId = ticket?.accountId ?? null;
      contactId = ticket?.contactId ?? null;
    } else if (event.type === "form.submitted") {
      // Landing-captured leads have no account yet (they become routed leads);
      // usage lands on the lead's company, which is a lead-scoped signal.
      const lead = await db().lead.findUnique({ where: { id: event.entityId }, select: { id: true, company: true } });
      if (lead) {
        accountId = null;
        await db().usageEvent.create({
          data: {
            orgId, environment, accountId: null, contactId: null, type: "feature_used", feature: "landing",
            meta: { eventType: event.type, eventId: event.id, leadId: lead.id, company: lead.company } as object,
            source: "event-bus", occurredAt: new Date(),
          },
        });
        return;
      }
    } else if (event.type === "call.completed") {
      const call = await db().call.findUnique({ where: { id: event.entityId }, select: { contactId: true } });
      contactId = call?.contactId ?? null;
    } else if (event.type === "meeting.completed") {
      const meeting = await db().meeting.findUnique({ where: { id: event.entityId }, select: { contactId: true } });
      contactId = meeting?.contactId ?? null;
    }
    if (!accountId && contactId) {
      const contact = await db().contact.findUnique({ where: { id: contactId }, select: { accountId: true } });
      accountId = contact?.accountId ?? null;
    }
    await db().usageEvent.create({
      data: {
        orgId, environment, accountId, contactId, type: "feature_used", feature: USAGE_MIRROR[event.type],
        meta: { eventType: event.type, eventId: event.id } as object, source: "event-bus", occurredAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[cs usage mirror]", event.type, e);
  }
}

let engineStarted = false;

export function startSuccessEngine() {
  if (engineStarted) return;
  engineStarted = true;
  for (const systemType of Object.keys(USAGE_MIRROR)) {
    onEvent(systemType, (event) => void mirrorUsageEvent(event as any));
  }
  setInterval(() => {
    db().organization
      .findMany({ select: { id: true } })
      .then((orgs) => {
        for (const org of orgs) {
          runSuccessTicker(org.id, "production", org.id).catch((e) => console.error("[cs-engine]", org.id, (e as Error)?.message ?? e));
        }
      })
      .catch((e) => console.error("[cs-engine] ticker error:", (e as Error)?.message ?? e));
  }, 60_000);
  console.log("  Success      · customer success engine subscribed (usage mirror + ticker)");
}
