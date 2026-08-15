// Business Digital Twin / What-If Simulator (Phase 15).
//
// Deterministic scenario models over REAL org data — no black box, every run
// states its assumptions (docs/52-simulation-model-assumptions.md). Running a
// simulation NEVER mutates data: it recomputes derived metrics (weighted
// pipeline, MRR/ARR) under the scenario's parameter change and persists the
// run (SimulationRun) + emits simulation.completed.
//
// Scenarios:
//   pricing  — priceChangePct: what happens to weighted pipeline if every open
//              deal's amount moves by ±pct?
//   discount — discountPct: the negotiation-impact view — what is weighted
//              pipeline worth if the org gives an average discount?
//   churn    — churnRatePct + months: what is ARR/MRR worth N months out if
//              monthly churn runs at rate X?
//   hiring   — newReps: how does per-rep pipeline load (capacity) change?
//   mix      — shiftStage + shiftPct: what if X% of open deals' probability
//              moves to a target stage's probability?
import { db } from "../db";
import { emitEvent } from "./events";
import { badRequest } from "./http";

export type ScenarioModel = {
  key: string;
  label: string;
  description: string;
  params: { key: string; label: string; type: "number"; default: number; min: number; max: number; unit: string }[];
  assumptions: string[];
};

export function simulationModels(): ScenarioModel[] {
  return [
    {
      key: "pricing",
      label: "Price change",
      description: "Recompute weighted pipeline if every open deal's amount moves by a percentage.",
      params: [{ key: "priceChangePct", label: "Price change %", type: "number", default: 10, min: -50, max: 100, unit: "%" }],
      assumptions: ["Every open deal's amount scales by the same percentage.", "Stage probabilities are unchanged.", "The pipeline mix (stage distribution) is unchanged."],
    },
    {
      key: "discount",
      label: "Discount / negotiation impact",
      description: "What is the open pipeline worth if the org concedes an average discount?",
      params: [{ key: "discountPct", label: "Average discount %", type: "number", default: 10, min: 0, max: 60, unit: "%" }],
      assumptions: ["Discounts apply to the amount, not the probability.", "No volume uplift from the discount is modeled (conservative)."],
    },
    {
      key: "churn",
      label: "Churn projection",
      description: "Project MRR/ARR forward if monthly churn runs at a given rate.",
      params: [
        { key: "churnRatePct", label: "Monthly churn %", type: "number", default: 2, min: 0, max: 30, unit: "%" },
        { key: "months", label: "Months", type: "number", default: 12, min: 1, max: 36, unit: "mo" },
      ],
      assumptions: ["Current MRR is derived from active subscriptions (unitPrice × quantity, annualized /12, quarterly /3).", "Churn applies monthly to the remaining base (no growth, no win-back).", "ARR = MRR × 12."],
    },
    {
      key: "hiring",
      label: "Hiring / capacity",
      description: "How does per-rep pipeline load change when the team grows?",
      params: [{ key: "newReps", label: "New reps", type: "number", default: 2, min: 1, max: 50, unit: "reps" }],
      assumptions: ["Every active non-admin user is one selling seat.", "The open pipeline (weighted) is unchanged — new reps share the existing book until they source new deals."],
    },
    {
      key: "mix",
      label: "Stage mix shift",
      description: "What if a share of open deals' probability moves to a target stage's probability?",
      params: [
        { key: "shiftStage", label: "Target stage", type: "number", default: 80, min: 10, max: 100, unit: "% probability" },
        { key: "shiftPct", label: "Deals shifted %", type: "number", default: 20, min: 0, max: 100, unit: "%" },
      ],
      assumptions: ["shiftPct% of open deals (by count, smallest first) adopt the target stage probability.", "Amounts are unchanged.", "Probability uplift is capped at 100."],
    },
  ];
}

function monthlyMrr(sub: { unitPrice: number; quantity: number; billingPeriod: string }): number {
  const per = (Number(sub.unitPrice) || 0) * (Number(sub.quantity) || 1);
  if (sub.billingPeriod === "annual") return per / 12;
  if (sub.billingPeriod === "quarterly") return per / 3;
  return per;
}

async function weightedPipeline(orgId: string, environment: string): Promise<{ weighted: number; totalAmount: number; open: number }> {
  const deals = await db().opportunity.findMany({ where: { orgId, environment, stage: { notIn: ["won", "lost"] } }, select: { amount: true, probability: true } });
  const weighted = deals.reduce((s, d) => s + (Number(d.amount) || 0) * (Math.min(100, d.probability) / 100), 0);
  return { weighted: Math.round(weighted), totalAmount: Math.round(deals.reduce((s, d) => s + (Number(d.amount) || 0), 0)), open: deals.length };
}

async function currentMrr(orgId: string, environment: string): Promise<number> {
  const subs = await db().subscription.findMany({ where: { orgId, environment, status: { in: ["active", "past_due"] } }, select: { unitPrice: true, quantity: true, billingPeriod: true } });
  return Math.round(subs.reduce((s, sub) => s + monthlyMrr(sub), 0));
}

async function activeSeats(orgId: string): Promise<number> {
  const users = await db().user.count({ where: { orgId, active: true, role: { not: "admin" } } });
  return Math.max(1, users);
}

async function runScenario(orgId: string, environment: string, scenario: string, params: Record<string, number>) {
  const m = simulationModels().find((x) => x.key === scenario);
  if (!m) throw badRequest(`scenario must be one of ${simulationModels().map((x) => x.key).join(", ")}`);

  if (scenario === "pricing") {
    const pct = Number(params.priceChangePct) || 0;
    if (pct < -50 || pct > 100) throw badRequest("priceChangePct must be between -50 and 100");
    const before = await weightedPipeline(orgId, environment);
    const multiplier = 1 + pct / 100;
    const afterWeighted = Math.round(before.weighted * multiplier);
    return {
      metrics: { beforeWeighted: before.weighted, afterWeighted, delta: afterWeighted - before.weighted, totalAmountBefore: before.totalAmount, totalAmountAfter: Math.round(before.totalAmount * multiplier) },
      inputs: { priceChangePct: pct },
      summary: `A ${pct >= 0 ? "+" : ""}${pct}% price change moves weighted open pipeline from $${before.weighted.toLocaleString()} to $${afterWeighted.toLocaleString()} (${afterWeighted - before.weighted >= 0 ? "+" : ""}$${(afterWeighted - before.weighted).toLocaleString()}).`,
    };
  }

  if (scenario === "discount") {
    const pct = Number(params.discountPct) || 0;
    if (pct < 0 || pct > 60) throw badRequest("discountPct must be between 0 and 60");
    const before = await weightedPipeline(orgId, environment);
    const afterWeighted = Math.round(before.weighted * (1 - pct / 100));
    return {
      metrics: { beforeWeighted: before.weighted, afterWeighted, delta: afterWeighted - before.weighted, discountPct: pct },
      inputs: { discountPct: pct },
      summary: `An average ${pct}% discount on ${before.open} open deal(s) reduces weighted pipeline from $${before.weighted.toLocaleString()} to $${afterWeighted.toLocaleString()} (−$${(before.weighted - afterWeighted).toLocaleString()}).`,
    };
  }

  if (scenario === "churn") {
    const rate = Number(params.churnRatePct) || 0;
    const months = Math.round(Number(params.months) || 12);
    if (rate < 0 || rate > 30) throw badRequest("churnRatePct must be between 0 and 30");
    if (months < 1 || months > 36) throw badRequest("months must be between 1 and 36");
    const mrr = await currentMrr(orgId, environment);
    const keep = 1 - rate / 100;
    const projected: number[] = [];
    let remaining = mrr;
    for (let i = 1; i <= months; i++) {
      remaining = Math.round(remaining * keep);
      projected.push(remaining);
    }
    const arrBefore = mrr * 12;
    const arrAfter = projected[projected.length - 1] * 12;
    const cumulativeLoss = mrr * months - projected.reduce((s, v) => s + v, 0);
    return {
      metrics: { mrrToday: mrr, arrToday: arrBefore, mrrAfter: projected[projected.length - 1], arrAfter, projected, cumulativeMrrLost: Math.round(cumulativeLoss) },
      inputs: { churnRatePct: rate, months },
      summary: `At ${rate}% monthly churn, MRR of $${mrr.toLocaleString()}/mo declines to $${projected[projected.length - 1].toLocaleString()}/mo after ${months} month(s) (ARR $${arrBefore.toLocaleString()} → $${arrAfter.toLocaleString()}); ~$${Math.round(cumulativeLoss).toLocaleString()} MRR is lost cumulatively.`,
    };
  }

  if (scenario === "hiring") {
    const newReps = Math.round(Number(params.newReps) || 2);
    if (newReps < 1 || newReps > 50) throw badRequest("newReps must be between 1 and 50");
    const before = await weightedPipeline(orgId, environment);
    const seats = await activeSeats(orgId);
    const perRepBefore = Math.round(before.weighted / seats);
    const perRepAfter = Math.round(before.weighted / (seats + newReps));
    return {
      metrics: { weightedPipeline: before.weighted, seatsBefore: seats, seatsAfter: seats + newReps, perRepBefore, perRepAfter, loadReductionPct: Math.round((1 - perRepAfter / Math.max(1, perRepBefore)) * 100) },
      inputs: { newReps },
      summary: `With ${seats} selling seat(s) carrying $${before.weighted.toLocaleString()} weighted pipeline ($${perRepBefore.toLocaleString()}/rep), adding ${newReps} rep(s) eases load to $${perRepAfter.toLocaleString()}/rep (−${Math.round((1 - perRepAfter / Math.max(1, perRepBefore)) * 100)}%).`,
    };
  }

  // mix
  const targetProb = Math.round(Number(params.shiftStage) || 80);
  const shiftPct = Number(params.shiftPct) || 0;
  if (targetProb < 10 || targetProb > 100) throw badRequest("shiftStage must be between 10 and 100");
  if (shiftPct < 0 || shiftPct > 100) throw badRequest("shiftPct must be between 0 and 100");
  const deals = await db().opportunity.findMany({ where: { orgId, environment, stage: { notIn: ["won", "lost"] } }, orderBy: { amount: "asc" }, select: { amount: true, probability: true } });
  const shiftCount = Math.min(deals.length, Math.max(0, Math.round((deals.length * shiftPct) / 100)));
  const beforeWeighted = Math.round(deals.reduce((s, d) => s + (Number(d.amount) || 0) * (d.probability / 100), 0));
  const afterWeighted = deals.reduce((s, d, i) => {
    const p = i < shiftCount ? Math.min(100, targetProb) : d.probability;
    return s + (Number(d.amount) || 0) * (p / 100);
  }, 0);
  return {
    metrics: { beforeWeighted, afterWeighted: Math.round(afterWeighted), delta: Math.round(afterWeighted) - beforeWeighted, dealsShifted: shiftCount, dealsTotal: deals.length },
    inputs: { shiftStage: targetProb, shiftPct },
    summary: `Moving ${shiftCount} of ${deals.length} open deal(s) to ${targetProb}% probability lifts weighted pipeline from $${beforeWeighted.toLocaleString()} to $${Math.round(afterWeighted).toLocaleString()} (+$${Math.round(afterWeighted - beforeWeighted).toLocaleString()}).`,
  };
}

export async function runSimulation(orgId: string, environment: string, actorId: string, input: { name: string; scenario: string; params: Record<string, number> }) {
  if (!input.name || !input.name.trim()) throw badRequest("name is required");
  try {
    const result = await runScenario(orgId, environment, input.scenario, input.params);
    const run = await db().simulationRun.create({
      data: {
        orgId, environment, name: input.name, scenario: input.scenario,
        params: input.params as object, results: result as object, summary: result.summary, status: "completed", createdBy: actorId,
      },
    });
    await emitEvent({
      orgId, environment, type: "simulation.completed", entity: "brain", entityId: run.id, actorId,
      payload: { scenario: input.scenario, name: input.name, metrics: result.metrics, summary: result.summary, runId: run.id },
    });
    return { run, ...result };
  } catch (e: any) {
    const run = await db().simulationRun.create({
      data: { orgId, environment, name: input.name, scenario: input.scenario, params: input.params as object, results: {}, status: "failed", error: String(e?.message ?? e), createdBy: actorId },
    });
    return { run, status: "failed", error: String(e?.message ?? e) };
  }
}

export async function listSimulations(orgId: string, environment: string) {
  return db().simulationRun.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 100 });
}

/** Engine ticker — nothing periodic needed (simulations are on-demand). */
export function startSimulatorEngine() {
  // on-demand only
}
