// Business Brain core (Phase 15) — ADR-027.
//
// The blueprint's "org-wide AI layer synthesizing opportunities/risks/
// anomalies/recommendations across every module". Like every AI surface in
// this codebase, the Brain is DETERMINISTIC + EXPLAINABLE: each insight is
// derived from live rows + the event log with explicit evidence, never from a
// black box (ADR-014 mock-provider + ADR-018 derived-on-read discipline).
//
// Surfaces in this module:
//   • BusinessBrainInsight ledger — scanBrain() runs rule scans across deals,
//     pipeline, churn, expansion, tickets → upserts insights by fingerprint
//     and emits `insight.generated` for new ones (blueprint entity/event).
//   • Deal X-Ray — dealXray(): evidence-backed deal health scoring (0-100)
//     with per-factor inputs + risk flags.
//   • AI Deal Detective — dealDetective(): root-cause investigation for
//     won/lost (and at-risk) deals from the event + audit trail.
//   • Opportunity Radar — radarScan(): the early-warning system consolidating
//     upsell/cross-sell/expansion signals (Phase 11), churn risks (Phase 11),
//     weak deals (x-ray < 50) and brain risks; emits opportunity.detected /
//     risk.detected for NEW signals (24h dedup).
import { db } from "../db";
import { emitEvent } from "./events";
import { notFound, badRequest } from "./http";
import { expansionRadar, churnForAccount } from "./success";
import { graphV2ForDeal } from "./graph";
import { clamp } from "./ai";

const DAY = 86_400_000;

export type InsightInput = {
  category: "opportunity" | "risk" | "anomaly" | "recommendation";
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  source: string;
  entity?: string | null;
  entityId?: string | null;
  evidence: { kind: string; note: string; at?: Date | null }[];
  recommendation?: string;
  fingerprint: string;
};

function sevOf(n: number): "info" | "low" | "medium" | "high" | "critical" {
  return n >= 80 ? "critical" : n >= 60 ? "high" : n >= 40 ? "medium" : n >= 20 ? "low" : "info";
}

/** Upsert one insight by fingerprint. Emits insight.generated only when NEW. */
export async function upsertInsight(orgId: string, environment: string, actorId: string, input: InsightInput) {
  const existing = await db().businessBrainInsight.findUnique({ where: { fingerprint: input.fingerprint } });
  if (existing) {
    const updated = await db().businessBrainInsight.update({
      where: { id: existing.id },
      data: {
        category: input.category,
        severity: input.severity,
        title: input.title,
        summary: input.summary,
        source: input.source,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        evidence: input.evidence as object,
        recommendation: input.recommendation ?? null,
        updatedAt: new Date(),
      },
    });
    return { row: updated, created: false };
  }
  const row = await db().businessBrainInsight.create({
    data: {
      orgId,
      environment,
      category: input.category,
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      source: input.source,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      evidence: input.evidence as object,
      recommendation: input.recommendation ?? null,
      fingerprint: input.fingerprint,
      status: "open",
      createdBy: actorId,
    },
  });
  await emitEvent({
    orgId,
    environment,
    type: "insight.generated",
    entity: input.entity ?? "brain",
    entityId: row.id,
    actorId,
    payload: { category: input.category, severity: input.severity, title: input.title, fingerprint: input.fingerprint, insightId: row.id },
  });
  return { row, created: true };
}

async function recentEventCount(orgId: string, environment: string, entity: string, entityId: string, since: Date) {
  return db().event.count({ where: { orgId, environment, entity, entityId, createdAt: { gte: since } } });
}

function daysSince(d: Date | null | undefined): number | null {
  if (!d) return null;
  return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / DAY));
}

/**
 * The Brain scan — run every deterministic rule across the org × environment,
 * upserting insights by fingerprint. Returns created/updated counts + total.
 * Admin-triggered (POST /api/brain/refresh) + the engine ticker.
 */
export async function scanBrain(orgId: string, environment: string, actorId: string) {
  let created = 0;
  let updated = 0;
  const touched: string[] = [];

  const [deals, tickets] = await Promise.all([
    db().opportunity.findMany({ where: { orgId, environment }, select: { id: true, name: true, stage: true, amount: true, probability: true, closeDate: true, competitors: true, winReason: true, lostReason: true, accountId: true, ownerId: true, createdAt: true, updatedAt: true } }),
    db().ticket.findMany({ where: { orgId, environment }, select: { id: true, reference: true, subject: true, breachedAt: true } }),
  ]);
  const openDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const avgAmount = openDeals.length ? openDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0) / openDeals.length : 0;

  const push = async (input: InsightInput) => {
    const r = await upsertInsight(orgId, environment, actorId, input);
    if (r.created) created++;
    else updated++;
    touched.push(r.row.id);
  };

  // 1. Stalled deals (risk) — no recorded activity in 30d.
  for (const d of openDeals) {
    const lastActivity = await db().event.findFirst({ where: { orgId, environment, entity: "opportunity", entityId: d.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const idle = daysSince(lastActivity?.createdAt ?? d.createdAt);
    if (idle !== null && idle >= 30) {
      await push({
        category: "risk",
        severity: idle >= 60 ? "high" : "medium",
        title: `Stalled deal: ${d.name}`,
        summary: `"${d.name}" (${d.stage}, $${Number(d.amount).toLocaleString()}) has had no recorded activity in ${idle} days.`,
        source: "deals",
        entity: "opportunity",
        entityId: d.id,
        evidence: [{ kind: "event", note: `last activity ${idle} days ago` }],
        recommendation: "Re-engage the buyer this week — a touchpoint (call, email, meeting) restarts the clock.",
        fingerprint: `risk:deals:opportunity:${d.id}:stalled-30d`,
      });
    }
  }

  // 2. Stale pipeline (risk) — low-probability deals older than 60d.
  for (const d of openDeals) {
    const age = daysSince(d.createdAt);
    if (age !== null && age >= 60 && d.probability < 40) {
      await push({
        category: "risk",
        severity: "medium",
        title: `Stale pipeline: ${d.name}`,
        summary: `"${d.name}" has been open ${age} days at only ${d.probability}% — it is likely stuck.`,
        source: "pipeline",
        entity: "opportunity",
        entityId: d.id,
        evidence: [{ kind: "record", note: `age ${age} days, probability ${d.probability}%` }],
        recommendation: "Re-qualify the deal or move it to lost — keep the pipeline honest.",
        fingerprint: `risk:pipeline:opportunity:${d.id}:stale-60d`,
      });
    }
  }

  // 3. Outlier deal (anomaly) — amount > 3× the org average.
  for (const d of openDeals) {
    const a = Number(d.amount) || 0;
    if (avgAmount > 0 && a > avgAmount * 3) {
      await push({
        category: "anomaly",
        severity: "medium",
        title: `Outlier deal: ${d.name}`,
        summary: `"${d.name}" ($${a.toLocaleString()}) is ${(a / Math.max(avgAmount, 1)).toFixed(1)}× the org's average open deal ($${Math.round(avgAmount).toLocaleString()}).`,
        source: "deals",
        entity: "opportunity",
        entityId: d.id,
        evidence: [{ kind: "record", note: `amount $${a.toLocaleString()} vs avg $${Math.round(avgAmount).toLocaleString()}` }],
        recommendation: "Confirm the amount is accurate and the buying committee covers it (Deal X-Ray).",
        fingerprint: `anomaly:deals:opportunity:${d.id}:outlier`,
      });
    }
  }

  // 4. Unreasoned outcomes (recommendation) — won/lost without a recorded reason.
  for (const d of deals) {
    if (d.stage === "won" && !d.winReason) {
      await push({
        category: "recommendation",
        severity: "low",
        title: `Record the win reason: ${d.name}`,
        summary: `"${d.name}" was won but no win reason was recorded — future win-rate analysis will miss the signal.`,
        source: "deals",
        entity: "opportunity",
        entityId: d.id,
        evidence: [{ kind: "record", note: "winReason missing" }],
        recommendation: "Add the win reason (and competitor if any) to the deal.",
        fingerprint: `recommendation:deals:opportunity:${d.id}:win-reason`,
      });
    }
    if (d.stage === "lost" && !d.lostReason) {
      await push({
        category: "recommendation",
        severity: "low",
        title: `Record the loss reason: ${d.name}`,
        summary: `"${d.name}" was lost but no loss reason was recorded — the Deal Detective cannot explain it.`,
        source: "deals",
        entity: "opportunity",
        entityId: d.id,
        evidence: [{ kind: "record", note: "lostReason missing" }],
        recommendation: "Add the loss reason + competitor so the AI Deal Detective can do root-cause analysis.",
        fingerprint: `recommendation:deals:opportunity:${d.id}:lost-reason`,
      });
    }
  }

  // 5. At-risk accounts (risk) — Phase 11 churn risk ≥ 70.
  const accounts = await db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } });
  for (const acct of accounts) {
    const churn = await churnForAccount(orgId, environment, acct.id).catch(() => null);
    if (churn && churn.score >= 70) {
      await push({
        category: "risk",
        severity: sevOf(churn.score),
        title: `Churn risk: ${acct.name}`,
        summary: `${acct.name} scores ${churn.score}/100 churn risk (${churn.riskTier}) — ${churn.recommendation.toLowerCase()}`,
        source: "churn",
        entity: "account",
        entityId: acct.id,
        evidence: churn.factors.map((f) => ({ kind: "churn", note: `${f.label}: ${f.detail}` })),
        recommendation: churn.recommendation,
        fingerprint: `risk:churn:account:${acct.id}:score-${churn.score >= 80 ? "crit" : "high"}`,
      });
    }
  }

  // 6. Expansion opportunities (opportunity) — Phase 11 expansion radar.
  const radar = await expansionRadar(orgId, environment).catch(() => [] as any[]);
  for (const o of radar as any[]) {
    await push({
      category: "opportunity",
      severity: "low",
      title: `${o.title}`,
      summary: `${o.reason} — estimated ${o.estimatedValue ? `$${Math.round(o.estimatedValue).toLocaleString()}` : "n/a"} at ${Math.round((o.confidence ?? 0) * 100)}% confidence.`,
      source: "radar",
      entity: "account",
      entityId: o.accountId,
      evidence: [{ kind: "radar", note: o.reason }],
      recommendation: `Pursue the ${o.type} conversation with ${o.accountName ?? "the account"}.`,
      fingerprint: `opportunity:radar:account:${o.accountId}:${o.type}-${(o.title ?? "x").slice(0, 24)}`,
    });
  }

  // 7. Expected closes (opportunity) — high-probability deals closing this month.
  const monthEnd = new Date(Date.now() + 30 * DAY);
  for (const d of openDeals) {
    if (d.closeDate && d.probability >= 70 && new Date(d.closeDate) <= monthEnd) {
      await push({
        category: "opportunity",
        severity: "low",
        title: `Expected close: ${d.name}`,
        summary: `"${d.name}" ($${Number(d.amount).toLocaleString()}) is at ${d.probability}% closing by ${new Date(d.closeDate).toISOString().slice(0, 10)}.`,
        source: "pipeline",
        entity: "opportunity",
        entityId: d.id,
        evidence: [{ kind: "record", note: `close ${new Date(d.closeDate).toISOString().slice(0, 10)}, probability ${d.probability}%` }],
        recommendation: "Keep momentum — schedule the final review + signature step this week.",
        fingerprint: `opportunity:pipeline:opportunity:${d.id}:close-30d`,
      });
    }
  }

  // 8. Breached SLAs (risk) — open tickets past their SLA.
  for (const t of tickets) {
    if (t.breachedAt) {
      await push({
        category: "risk",
        severity: "high",
        title: `SLA breach: ${t.reference}`,
        summary: `Ticket ${t.reference} \"${t.subject}\" has breached its SLA.`,
        source: "service",
        entity: "ticket",
        entityId: t.id,
        evidence: [{ kind: "record", note: `breached ${new Date(t.breachedAt).toISOString().slice(0, 10)}` }],
        recommendation: "Escalate + respond now; the customer is already past the promise.",
        fingerprint: `risk:service:ticket:${t.id}:breached`,
      });
    }
  }

  // Prune: drop insights whose fingerprint no longer matches reality (stale
  // rules) — e.g. stalled deals that closed, breached tickets that resolved.
  const open = await db().businessBrainInsight.findMany({ where: { orgId, environment, status: "open" }, select: { id: true, fingerprint: true } });
  const stale = open.filter((i) => !touched.includes(i.id));
  for (const s of stale) await db().businessBrainInsight.delete({ where: { id: s.id } });

  const total = await db().businessBrainInsight.count({ where: { orgId, environment } });
  return { created, updated, pruned: stale.length, total };
}

export async function listInsights(orgId: string, environment: string, status?: string) {
  return db().businessBrainInsight.findMany({
    where: { orgId, environment, ...(status ? { status } : {}) },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  });
}

export async function setInsightStatus(orgId: string, environment: string, id: string, status: string, actorId: string) {
  const row = await db().businessBrainInsight.findUnique({ where: { id } });
  if (!row || row.orgId !== orgId || row.environment !== environment) throw notFound("Insight not found");
  if (!["open", "acknowledged", "actioned", "dismissed"].includes(status)) throw badRequest("status must be open | acknowledged | actioned | dismissed");
  return db().businessBrainInsight.update({ where: { id }, data: { status, updatedAt: new Date() } });
}

// ── Deal X-Ray (explainable, evidence-backed deal health) ───────────────────

export type XrayFactor = { key: string; label: string; weight: number; value: number; inputs: Record<string, unknown> };

/** Evidence-backed deal health score 0-100 with per-factor inputs + risk flags. */
export async function dealXray(orgId: string, environment: string, dealId: string) {
  const deal = await db().opportunity.findUnique({ where: { id: dealId } });
  if (!deal || deal.orgId !== orgId || deal.environment !== environment) throw notFound("Deal not found");

  const events14 = await recentEventCount(orgId, environment, "opportunity", dealId, new Date(Date.now() - 14 * DAY));
  const events30 = await recentEventCount(orgId, environment, "opportunity", dealId, new Date(Date.now() - 30 * DAY));
  const age = daysSince(deal.createdAt) ?? 0;

  let coverage = 0;
  let roles: { name: string; role: string; influence: number }[] = [];
  let gaps: string[] = [];
  if (deal.accountId) {
    const g = await graphV2ForDeal(orgId, environment, dealId).catch(() => null);
    if (g) {
      roles = g.committee.map((c: any) => ({ name: c.name, role: c.role, influence: c.influence }));
      coverage = g.coverage;
      gaps = g.gaps;
    }
  }

  const stageV = clamp(deal.probability);
  const activityV = events14 >= 3 ? 100 : events14 >= 1 ? 70 : events30 >= 1 ? 45 : 15;
  const coverageV = coverage;
  const competitorV = !deal.competitors ? 100 : (deal.competitors.match(/,/g)?.length ?? 0) + 1 >= 2 ? 35 : 60;
  const ageV = age < 30 ? 90 : age < 60 ? 70 : age < 90 ? 50 : 30;

  const factors: XrayFactor[] = [
    { key: "stage", label: "Stage probability", weight: 0.3, value: stageV, inputs: { stage: deal.stage, probability: deal.probability } },
    { key: "activity", label: "Activity (14d)", weight: 0.25, value: activityV, inputs: { events14d: events14, events30d: events30 } },
    { key: "coverage", label: "Committee coverage", weight: 0.2, value: coverageV, inputs: { coveragePct: coverage, roles, gaps } },
    { key: "competition", label: "Competitive pressure", weight: 0.1, value: competitorV, inputs: { competitors: deal.competitors ?? null } },
    { key: "age", label: "Deal age", weight: 0.15, value: ageV, inputs: { ageDays: age } },
  ];
  const score = clamp(factors.reduce((s, f) => s + f.value * f.weight, 0));

  const flags: string[] = [];
  if (events30 === 0) flags.push("no activity in 30 days");
  if (coverage < 50) flags.push("thin buying committee");
  for (const g of gaps) flags.push(g);
  if (deal.competitors) flags.push("competitor present");
  if (age >= 90) flags.push(`open ${age} days`);

  const recommendation =
    score >= 75 ? "Strong deal — protect momentum and push to close."
    : score >= 55 ? "Healthy — address the flagged items to avoid slippage."
    : "Weak deal — re-qualify, widen the committee, or walk away.";

  return {
    deal: { id: deal.id, name: deal.name, stage: deal.stage, amount: deal.amount, probability: deal.probability, closeDate: deal.closeDate, ownerId: deal.ownerId, accountId: deal.accountId },
    score,
    confidence: clamp(45 + events14 * 10 + (coverage > 0 ? 15 : 0)),
    factors,
    flags,
    coverage: { pct: coverage, roles, gaps },
    recommendation,
    explanation: factors.map((f) => `${f.label}: ${f.value}/100 × ${Math.round(f.weight * 100)}%`),
  };
}

// ── AI Deal Detective (root-cause for won/lost deals) ───────────────────────

/** Walk the deal's event + audit trail into an explained timeline + factors. */
export async function dealDetective(orgId: string, environment: string, dealId: string) {
  const deal = await db().opportunity.findUnique({ where: { id: dealId } });
  if (!deal || deal.orgId !== orgId || deal.environment !== environment) throw notFound("Deal not found");

  const [events, audits] = await Promise.all([
    db().event.findMany({ where: { orgId, environment, entity: "opportunity", entityId: dealId }, orderBy: { createdAt: "asc" }, select: { type: true, payload: true, createdAt: true, actorId: true } }),
    db().auditLog.findMany({ where: { orgId, environment, entity: "opportunity", entityId: dealId }, orderBy: { createdAt: "asc" }, select: { action: true, changed: true, createdAt: true } }),
  ]);

  const timeline = events.map((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    let note = "";
    if (e.type === "deal.stage_changed") note = `moved ${p.from ? `${p.from} → ` : ""}${p.to ?? "stage"}`;
    else if (e.type === "deal.created") note = "deal created";
    else if (e.type === "deal.updated") note = "updated";
    else if (e.type === "deal.deleted") note = "deleted";
    else note = e.type.replace(/^deal\./, "");
    return { type: e.type, note, at: e.createdAt };
  });

  // Stage durations from stage_changed events (state machine over the trail).
  const stages: { stage: string; days: number }[] = [];
  let current: { stage: string; from: number } | null = null;
  const first = events[0]?.createdAt ?? deal.createdAt;
  const last = events[events.length - 1]?.createdAt ?? deal.updatedAt;
  for (const e of events) {
    if (e.type === "deal.stage_changed") {
      const to = ((e.payload ?? {}) as Record<string, unknown>).to as string;
      if (current) stages.push({ stage: current.stage, days: Math.max(0, Math.round((new Date(e.createdAt).getTime() - current.from) / DAY)) });
      current = { stage: to ?? "?", from: new Date(e.createdAt).getTime() };
    }
  }
  if (current) stages.push({ stage: current.stage, days: Math.max(0, Math.round((new Date(last).getTime() - current.from) / DAY)) });
  else if (events.length) stages.push({ stage: deal.stage, days: Math.max(0, Math.round((new Date(last).getTime() - new Date(first).getTime()) / DAY)) });

  const totalDays = Math.max(0, Math.round((new Date(last).getTime() - new Date(first).getTime()) / DAY));

  // Price changes from the audit diff.
  const amountChanges = audits.flatMap((a) => {
    const c = (a.changed ?? {}) as Record<string, { from?: unknown; to?: unknown }>;
    if (c.amount) return [{ from: Number(c.amount.from) || 0, to: Number(c.amount.to) || 0, at: a.createdAt }];
    return [];
  });

  const factors: { kind: string; label: string; detail: string }[] = [];
  const open = deal.stage !== "won" && deal.stage !== "lost";
  if (open) {
    const idle = daysSince(await db().event.findFirst({ where: { orgId, environment, entity: "opportunity", entityId: dealId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).then((r) => r?.createdAt ?? deal.createdAt));
    if (idle !== null && idle >= 14) factors.push({ kind: "risk", label: "Stalled", detail: `No recorded activity in ${idle} days — the deal is losing momentum.` });
    const longest = stages.sort((a, b) => b.days - a.days)[0];
    if (longest && longest.days >= 21) factors.push({ kind: "risk", label: `Long stage: ${longest.stage}`, detail: `Spent ${longest.days} days in ${longest.stage}.` });
    if (deal.competitors) factors.push({ kind: "risk", label: "Competition", detail: `${deal.competitors} competing for the deal.` });
    if (!factors.length) factors.push({ kind: "note", label: "Healthy momentum", detail: "No stall signals — the trail shows consistent activity." });
  } else if (deal.stage === "won") {
    if (deal.winReason) factors.push({ kind: "cause", label: "Win reason", detail: deal.winReason });
    else factors.push({ kind: "gap", label: "No win reason", detail: "Closed won without a recorded win reason." });
    if (amountChanges.length) {
      const net = amountChanges[amountChanges.length - 1].to - amountChanges[0].from;
      if (net < 0) factors.push({ kind: "cause", label: "Price concession", detail: `Amount dropped $${Math.abs(net).toLocaleString()} over the deal's life.` });
    }
  } else {
    if (deal.lostReason) factors.push({ kind: "cause", label: "Loss reason", detail: deal.lostReason });
    else factors.push({ kind: "gap", label: "No loss reason", detail: "Closed lost without a recorded loss reason." });
    if (deal.competitors) factors.push({ kind: "cause", label: "Competitor", detail: `${deal.competitors} was named in the deal.` });
    if (amountChanges.length) {
      const net = amountChanges[amountChanges.length - 1].to - amountChanges[0].from;
      if (net < 0) factors.push({ kind: "signal", label: "Price pressure", detail: `Amount dropped $${Math.abs(net).toLocaleString()} before the close — possible discount-driven loss.` });
    }
  }

  const verdict = deal.stage === "won" ? "won" : deal.stage === "lost" ? "lost" : "in_progress";
  return {
    deal: { id: deal.id, name: deal.name, stage: deal.stage, amount: deal.amount, probability: deal.probability, winReason: deal.winReason, lostReason: deal.lostReason, competitors: deal.competitors },
    verdict,
    totalDays,
    timeline: timeline.slice(-40),
    stages,
    amountChanges,
    factors,
    summary:
      verdict === "won" ? `"${deal.name}" closed won in ${totalDays} days. ${factors.map((f) => f.detail).join(" ")}`
      : verdict === "lost" ? `"${deal.name}" closed lost after ${totalDays} days. ${factors.map((f) => f.detail).join(" ")}`
      : `"${deal.name}" is still open after ${totalDays} days. ${factors.map((f) => f.detail).join(" ")}`,
  };
}

// ── Opportunity Radar / early-warning system ────────────────────────────────

export type RadarSignal = {
  kind: "opportunity" | "risk";
  signalType: string; // upsell | cross_sell | expansion | churn | weak_deal | breach | stall
  targetType: string;
  targetId: string;
  title: string;
  detail: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  estimatedValue?: number | null;
  fingerprint: string;
};

/** Emit opportunity.detected / risk.detected for a NEW signal (24h dedup by fingerprint). */
async function emitIfNew(orgId: string, environment: string, sig: RadarSignal, actorId: string) {
  const type = sig.kind === "opportunity" ? "opportunity.detected" : "risk.detected";
  const recent = await db().event.findMany({ where: { orgId, environment, type, createdAt: { gte: new Date(Date.now() - 24 * DAY) } }, select: { payload: true }, take: 200 });
  if (recent.some((e) => ((e.payload ?? {}) as Record<string, unknown>).fingerprint === sig.fingerprint)) return false;
  await emitEvent({
    orgId,
    environment,
    type,
    entity: sig.targetType,
    entityId: sig.targetId,
    actorId,
    payload: { fingerprint: sig.fingerprint, signalType: sig.signalType, targetType: sig.targetType, targetId: sig.targetId, title: sig.title, detail: sig.detail, severity: sig.severity, estimatedValue: sig.estimatedValue ?? null },
  });
  return true;
}

/** Compute the radar signals (pure derivation — no events). */
async function computeRadar(orgId: string, environment: string): Promise<RadarSignal[]> {
  const signals: RadarSignal[] = [];
  const seen = new Set<string>();

  // Upsell / cross-sell / expansion from Phase 11.
  const radar = await expansionRadar(orgId, environment).catch(() => [] as any[]);
  for (const o of radar as any[]) {
    const fp = `opportunity:${o.type}:${o.accountId}:${(o.title ?? "x").slice(0, 24)}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    signals.push({
      kind: "opportunity", signalType: o.type, targetType: "account", targetId: o.accountId,
      title: o.title, detail: o.reason, severity: "medium",
      estimatedValue: o.estimatedValue ?? null, fingerprint: fp,
    });
  }

  // Churn risks (Phase 11) ≥ 70.
  const accounts = await db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } });
  for (const a of accounts) {
    const c = await churnForAccount(orgId, environment, a.id).catch(() => null);
    if (c && c.score >= 70) {
      const fp = `risk:churn:${a.id}:${c.score}`;
      if (seen.has(fp)) continue;
      seen.add(fp);
      signals.push({
        kind: "risk", signalType: "churn", targetType: "account", targetId: a.id,
        title: `Churn risk: ${a.name}`, detail: `${c.score}/100 (${c.riskTier}) — ${c.recommendation}`, severity: sevOf(c.score), estimatedValue: null, fingerprint: fp,
      });
    }
  }

  // Weak deals (x-ray < 50) + stalls.
  const deals = await db().opportunity.findMany({ where: { orgId, environment, stage: { notIn: ["won", "lost"] } }, select: { id: true, name: true } });
  for (const d of deals) {
    const x = await dealXray(orgId, environment, d.id).catch(() => null);
    if (x && x.score < 50) {
      const fp = `risk:weak_deal:${d.id}`;
      if (seen.has(fp)) continue;
      seen.add(fp);
      signals.push({
        kind: "risk", signalType: "weak_deal", targetType: "opportunity", targetId: d.id,
        title: `Weak deal: ${d.name}`, detail: `X-Ray scores ${x.score}/100. ${x.flags.slice(0, 3).join("; ") || "multiple risk factors"}.`, severity: "high", estimatedValue: x.deal.amount, fingerprint: fp,
      });
    }
  }

  // Breached-SLA tickets.
  const breached = await db().ticket.findMany({ where: { orgId, environment, breachedAt: { not: null } }, select: { id: true, reference: true, subject: true, breachedAt: true } });
  for (const t of breached) {
    const fp = `risk:breach:${t.id}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    signals.push({
      kind: "risk", signalType: "breach", targetType: "ticket", targetId: t.id,
      title: `SLA breach: ${t.reference}`, detail: `"${t.subject}" breached its SLA.`, severity: "high", estimatedValue: null, fingerprint: fp,
    });
  }

  signals.sort((a, b) => (a.kind === b.kind ? b.severity.localeCompare(a.severity) : a.kind === "risk" ? -1 : 1));
  return signals;
}

/** Admin-triggered radar scan: compute the feed + emit events for NEW signals. */
export async function radarScan(orgId: string, environment: string, actorId: string) {
  const signals = await computeRadar(orgId, environment);
  let emitted = 0;
  for (const s of signals) if (await emitIfNew(orgId, environment, s, actorId)) emitted++;
  return { emitted, signals };
}

/** The radar feed without re-emitting (read path). */
export async function radarFeed(orgId: string, environment: string) {
  return { emitted: 0, signals: await computeRadar(orgId, environment) };
}

/** Brain engine — the ticker runs a periodic scan (best-effort, guarded).
 * Deliberately does NOT scan at boot: scans are admin-triggered (POST
 * /api/brain/refresh) so the seeded/measured state on a fresh stack is exact;
 * the ticker keeps insights fresh on long-running instances. */
export function startBrainEngine() {
  const tick = async () => {
    try {
      const orgs = await db().organization.findMany({ select: { id: true } });
      for (const o of orgs) {
        for (const environment of ["production", "sandbox"]) {
          const actors = await db().user.findFirst({ where: { orgId: o.id, role: "admin" }, select: { id: true } });
          if (!actors) continue;
          try {
            await scanBrain(o.id, environment, actors.id);
          } catch (e) {
            console.error("[brain scan failed]", o.id, environment, e);
          }
        }
      }
    } catch (e) {
      console.error("[brain engine tick]", e);
    }
  };
  setInterval(tick, 6 * 60 * 60 * 1000);
}
