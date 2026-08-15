// Universal Business Query (Phase 15) — one search bar answering any
// cross-object question.
//
// A deterministic parser (mock-provider discipline, ADR-014) extracts
// { entity, metric, dimension, filters } from natural language and executes a
// REAL aggregation over live rows: "total pipeline by owner", "won deals this
// quarter", "top 5 accounts by MRR", "open tickets by priority". Every answer
// carries its intent + the rows it was computed from (evidence) — never a
// black box.
import { db } from "../db";

type Intent = {
  entity: "opportunity" | "account" | "contact" | "ticket" | "lead";
  metric: "sum" | "count" | "avg";
  dimension: string | null; // owner | stage | status | priority | industry | tier | source | plan
  filters: { stage?: string; amountGte?: number; timeWindow?: "month" | "quarter" | "year"; top?: number };
};

function entityOf(q: string): Intent["entity"] {
  const s = q.toLowerCase();
  if (/\b(tickets?|support|cases?)\b/.test(s)) return "ticket";
  if (/\b(leads?|prospects?)\b/.test(s)) return "lead";
  if (/\b(contacts?|people|persons?)\b/.test(s)) return "contact";
  if (/\b(accounts?|companies?|organizations?|orgs?)\b/.test(s)) return "account";
  return "opportunity"; // deals / opportunities / pipeline — default
}

function metricOf(q: string): Intent["metric"] {
  const s = q.toLowerCase();
  if (/\b(average|avg|mean)\b/.test(s)) return "avg";
  if (/\b(total|sum|pipeline|mrr|arr|value|amount|revenue|worth)\b/.test(s)) return "sum";
  return "count";
}

function dimensionOf(q: string): string | null {
  const s = q.toLowerCase();
  const by = s.match(/\bby\s+([a-z ]+?)(?:\b(top|over|under|this|last|in|for|that|which|with)\b|$)/);
  const d = by ? by[1].trim() : "";
  if (/\bowner|rep|user|person responsible|sales person/.test(d)) return "owner";
  if (/\bstage|pipeline/.test(d)) return "stage";
  if (/\bstatus/.test(d)) return "status";
  if (/\bpriority/.test(d)) return "priority";
  if (/\bindustry/.test(d)) return "industry";
  if (/\btier/.test(d)) return "tier";
  if (/\bsource/.test(d)) return "source";
  if (/\bplan|subscription/.test(d)) return "plan";
  return null;
}

function filtersOf(q: string): Intent["filters"] {
  const s = q.toLowerCase();
  const filters: Intent["filters"] = {};
  if (/\bwon\b|\bclosed won\b|\bclosed-won\b/.test(s)) filters.stage = "won";
  else if (/\blost\b|\bclosed lost\b/.test(s)) filters.stage = "lost";
  else if (/\bopen\b|\bactive\b/.test(s)) filters.stage = "open";
  const amt = s.match(/\bover\s*\$?(\d[\d,.]*)\s*(k|m)?\b/);
  if (amt) {
    const mult = amt[2] === "k" ? 1000 : amt[2] === "m" ? 1000000 : 1;
    filters.amountGte = Number(amt[1].replace(/,/g, "")) * mult;
  }
  if (/\bthis (quarter|qtr)\b/.test(s)) filters.timeWindow = "quarter";
  else if (/\bthis (month|mo)\b/.test(s)) filters.timeWindow = "month";
  else if (/\bthis (year|yr)\b/.test(s)) filters.timeWindow = "year";
  const top = s.match(/\btop\s+(\d+)\b/);
  if (top) filters.top = Math.max(1, Math.min(50, Number(top[1])));
  return filters;
}

function money(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}k` : `$${n.toLocaleString()}`;
}

function monthlyMrr(sub: { unitPrice: number; quantity: number; billingPeriod: string }): number {
  const per = (Number(sub.unitPrice) || 0) * (Number(sub.quantity) || 1);
  if (sub.billingPeriod === "annual") return per / 12;
  if (sub.billingPeriod === "quarterly") return per / 3;
  return per;
}

function timeWindowStart(window?: "month" | "quarter" | "year"): Date {
  const now = new Date();
  if (window === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (window === "quarter") return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  if (window === "year") return new Date(now.getFullYear(), 0, 1);
  return new Date(0);
}

/** Answer one natural-language question with a real aggregation + evidence. */
export async function ubqAnswer(orgId: string, environment: string, q: string) {
  const question = q.trim();
  const intent: Intent = { entity: entityOf(q), metric: metricOf(q), dimension: dimensionOf(q), filters: filtersOf(q) };
  const { entity, metric, dimension, filters } = intent;
  const rows: { key: string; value: number; count: number }[] = [];

  if (entity === "opportunity") {
    const where: any = { orgId, environment };
    if (filters.stage === "won") where.stage = "won";
    else if (filters.stage === "lost") where.stage = "lost";
    else if (filters.stage === "open") where.stage = { notIn: ["won", "lost"] };
    if (filters.amountGte) where.amount = { gte: filters.amountGte };
    if (filters.timeWindow) {
      const field = filters.stage === "won" || filters.stage === "lost" ? "updatedAt" : "createdAt";
      where[field] = { gte: timeWindowStart(filters.timeWindow) };
    }
    const deals = await db().opportunity.findMany({ where, select: { id: true, amount: true, probability: true, stage: true, ownerId: true, accountId: true } });
    const owners = await db().user.findMany({ where: { orgId }, select: { id: true, name: true } });
    const ownerName = new Map(owners.map((o) => [o.id, o.name]));
    const keyOf = (d: any) =>
      dimension === "owner" ? (ownerName.get(d.ownerId) ?? "unassigned")
      : dimension === "stage" ? d.stage
      : "all";
    const groups = new Map<string, { value: number; count: number }>();
    for (const d of deals) {
      const key = keyOf(d);
      const g = groups.get(key) ?? { value: 0, count: 0 };
      g.count++;
      g.value += Number(d.amount) || 0;
      groups.set(key, g);
    }
    for (const [key, g] of groups) rows.push({ key, value: Math.round(g.value), count: g.count });
  } else if (entity === "ticket") {
    const where: any = { orgId, environment };
    if (filters.stage === "open") where.status = { notIn: ["resolved", "closed"] };
    if (filters.timeWindow) where.createdAt = { gte: timeWindowStart(filters.timeWindow) };
    const tickets = await db().ticket.findMany({ where, select: { id: true, status: true, priority: true } });
    const groups = new Map<string, { value: number; count: number }>();
    for (const t of tickets) {
      const key = dimension === "priority" ? t.priority : dimension === "status" ? t.status : "all";
      const g = groups.get(key) ?? { value: 0, count: 0 };
      g.count++;
      g.value++;
      groups.set(key, g);
    }
    for (const [key, g] of groups) rows.push({ key, value: g.value, count: g.count });
  } else if (entity === "contact") {
    const where: any = { orgId, environment };
    if (filters.timeWindow) where.createdAt = { gte: timeWindowStart(filters.timeWindow) };
    const contacts = await db().contact.findMany({ where, select: { id: true, status: true, source: true } });
    const groups = new Map<string, { value: number; count: number }>();
    for (const c of contacts) {
      const key = dimension === "status" ? c.status : dimension === "source" ? c.source ?? "unknown" : "all";
      const g = groups.get(key) ?? { value: 0, count: 0 };
      g.count++;
      g.value++;
      groups.set(key, g);
    }
    for (const [key, g] of groups) rows.push({ key, value: g.value, count: g.count });
  } else if (entity === "lead") {
    const where: any = { orgId, environment };
    if (filters.timeWindow) where.createdAt = { gte: timeWindowStart(filters.timeWindow) };
    const leads = await db().lead.findMany({ where, select: { id: true, status: true, source: true } });
    const groups = new Map<string, { value: number; count: number }>();
    for (const l of leads) {
      const key = dimension === "source" ? l.source ?? "unknown" : dimension === "status" ? l.status : "all";
      const g = groups.get(key) ?? { value: 0, count: 0 };
      g.count++;
      g.value++;
      groups.set(key, g);
    }
    for (const [key, g] of groups) rows.push({ key, value: g.value, count: g.count });
  } else {
    // account
    if (/\bmrr\b|\barr\b/.test(q.toLowerCase())) {
      const subs = await db().subscription.findMany({ where: { orgId, environment, status: { in: ["active", "past_due"] } }, select: { accountId: true, unitPrice: true, quantity: true, billingPeriod: true, name: true } });
      const accounts = await db().account.findMany({ where: { orgId, environment }, select: { id: true, name: true } });
      const name = new Map(accounts.map((a) => [a.id, a.name]));
      const groups = new Map<string, { value: number; count: number }>();
      for (const s of subs) {
        if (!s.accountId) continue;
        const key = dimension === "plan" ? s.name : name.get(s.accountId) ?? "unknown";
        const g = groups.get(key) ?? { value: 0, count: 0 };
        g.count++;
        g.value += monthlyMrr(s);
        groups.set(key, g);
      }
      for (const [key, g] of groups) rows.push({ key, value: Math.round(g.value), count: g.count });
    } else {
      const where: any = { orgId, environment };
      if (filters.timeWindow) where.createdAt = { gte: timeWindowStart(filters.timeWindow) };
      const accounts = await db().account.findMany({ where, select: { id: true, name: true, industry: true, tier: true } });
      const groups = new Map<string, { value: number; count: number }>();
      for (const a of accounts) {
        const key = dimension === "industry" ? a.industry ?? "unknown" : dimension === "tier" ? a.tier ?? "unknown" : "all";
        const g = groups.get(key) ?? { value: 0, count: 0 };
        g.count++;
        g.value++;
        groups.set(key, g);
      }
      for (const [key, g] of groups) rows.push({ key, value: g.value, count: g.count });
    }
  }

  rows.sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + (metric === "sum" ? r.value : r.count), 0);
  const data = rows.slice(0, filters.top ?? 12);

  const stageLabel = filters.stage ? ` ${filters.stage} ` : " ";
  const metricLabel = metric === "sum" ? (entity === "opportunity" ? "value" : "total") : metric === "avg" ? "average" : "count";
  const entityLabel = entity === "opportunity" ? (stageLabel.trim() === "open" ? "open deals" : `deal${filters.stage ? "s" : "s"}`) : `${entity}s`;

  let answer = "";
  if (dimension) {
    const parts = data.map((r) => `${r.key}: ${metric === "sum" ? money(r.value) : r.count}`);
    answer = `By ${dimension}, ${metricLabel} of ${entityLabel}${stageLabel}: ${parts.join(", ")}${filters.top && data.length ? ` (top ${data.length})` : ""}.`;
  } else {
    answer =
      metric === "sum" ? `Total ${entityLabel}${stageLabel}${filters.amountGte ? ` over ${money(filters.amountGte)}` : ""} is ${money(total)}.`
      : metric === "avg" ? `Average ${entityLabel} value is ${money(rows.length ? Math.round(total / Math.max(1, rows.reduce((s, r) => s + r.count, 0))) : 0)}.`
      : `There ${total === 1 ? "is" : "are"} ${total} ${entityLabel}${stageLabel}${filters.amountGte ? ` worth over ${money(filters.amountGte)}` : ""}.`;
  }

  return {
    question,
    intent,
    answer,
    data,
    total: metric === "sum" ? total : rows.reduce((s, r) => s + r.count, 0),
    evidence: { entity, metric, dimension, filters, rowsScanned: rows.reduce((s, r) => s + r.count, 0) },
  };
}

/** A few example questions for the UI's query bar. */
export function ubqExamples() {
  return [
    "total pipeline by owner",
    "won deals this quarter",
    "top 5 accounts by MRR",
    "open tickets by priority",
    "how many contacts",
    "average deal size",
    "leads by source",
  ];
}
