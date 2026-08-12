// Customer health engine (Phase 7 · CDP / Customer 360) — ADR-019.
//
// Health is COMPUTED ON READ (never stored) — same discipline as the Phase 6
// metrics library — and every number is EXPLAINED: the score is a weighted sum
// of four documented components, and each component returns its raw inputs so
// the UI can show exactly why a customer scores what they do.
//
// Formula (documented in docs/25-cdp-guide.md):
//   score(0–100) = engagement(≤40) + support(≤25) + revenue(≤25) + recency(≤10)
//   • engagement — min(40, touchpoints30 × 4): behaviors + emails + calls +
//     meetings in the last 30 days (a fully-engaged customer touches ~10×/mo).
//   • support    — max(0, 25 − 8·open − 10·breached − 5·escalated): open,
//     SLA-breached and escalated tickets drag the score down.
//   • revenue    — min(25, (won90 + ½·openWeighted) ÷ $10k): won revenue in the
//     last 90 days plus half the weighted open pipeline.
//   • recency    — max(0, 10 − daysSinceLastActivity): 10 when active today.
//   churnRisk = clamp(100 − score, 0, 100); churnRisk ≥ 70 ⇒ at risk.
//
// An admin refresh persists one HealthScore row per profile (history + deltas),
// emits customer.health_changed (every profile) and customer.churn_risk_changed
// (churnRisk ≥ 70).
import { db } from "../db";
import { emitEvent } from "./events";

export type HealthComponent = { key: string; label: string; weight: number; value: number; inputs: Record<string, unknown> };
export type HealthResult = {
  profileId: string;
  score: number;
  churnRisk: number;
  atRisk: boolean;
  components: HealthComponent[];
  lastActivityAt: Date | null;
};

const DAY = 86_400_000;
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Newest activity timestamp across behaviors + comm rows (0 when none). */
async function lastActivityMs(orgId: string, environment: string, profileId: string, contactIds: string[]): Promise<number> {
  const [b, m, c, mt, t] = await Promise.all([
    db().behaviorEvent.findFirst({ where: { orgId, environment, profileId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    contactIds.length ? db().message.findFirst({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : Promise.resolve(null),
    contactIds.length ? db().call.findFirst({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }) : Promise.resolve(null),
    contactIds.length ? db().meeting.findFirst({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { startsAt: "desc" }, select: { startsAt: true } }) : Promise.resolve(null),
    contactIds.length ? db().ticket.findFirst({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : Promise.resolve(null),
  ]);
  const stamps = [b?.occurredAt, m?.createdAt, c?.startedAt, mt?.startsAt, t?.createdAt].filter(Boolean).map((d) => new Date(d as Date).getTime());
  return stamps.length ? Math.max(...stamps) : 0;
}

/** Compute the explained health score for one profile. */
export async function healthFor(orgId: string, environment: string, profile: { id: string; memberIds: unknown; accountId: string | null }): Promise<HealthResult> {
  const memberIds = (profile.memberIds as string[]) ?? [];
  const contactIds = memberIds.filter((m) => m.startsWith("contact:")).map((m) => m.split(":")[1]);
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);

  const [behaviorCount, messageCount, callCount, meetingCount, tickets, deals, lastMs] = await Promise.all([
    db().behaviorEvent.count({ where: { orgId, environment, profileId: profile.id, occurredAt: { gte: since30 } } }),
    contactIds.length ? db().message.count({ where: { orgId, environment, contactId: { in: contactIds }, createdAt: { gte: since30 } } }) : 0,
    contactIds.length ? db().call.count({ where: { orgId, environment, contactId: { in: contactIds }, startedAt: { gte: since30 } } }) : 0,
    contactIds.length ? db().meeting.count({ where: { orgId, environment, contactId: { in: contactIds }, startsAt: { gte: since30 } } }) : 0,
    contactIds.length
      ? db().ticket.findMany({ where: { orgId, environment, contactId: { in: contactIds } }, select: { status: true, breachedAt: true, escalated: true } })
      : Promise.resolve([]),
    db().opportunity.findMany({
      where: {
        orgId,
        environment,
        OR: [...(profile.accountId ? [{ accountId: profile.accountId }] : []), ...(contactIds.length ? [{ contactId: { in: contactIds } }] : [])],
      },
      select: { stage: true, amount: true, probability: true },
    }),
    lastActivityMs(orgId, environment, profile.id, contactIds),
  ]);

  const openTickets = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const breached = openTickets.filter((t) => t.breachedAt);
  const escalated = openTickets.filter((t) => t.escalated);

  const won90 = deals.filter((d) => d.stage === "won").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const openWeighted = deals
    .filter((d) => d.stage !== "won" && d.stage !== "lost")
    .reduce((s, d) => s + (Number(d.amount) || 0) * ((Number(d.probability) || 0) / 100), 0);

  const touches30 = behaviorCount + messageCount + callCount + meetingCount;
  const engagement = Math.min(40, touches30 * 4);
  const support = Math.max(0, 25 - openTickets.length * 8 - breached.length * 10 - escalated.length * 5);
  const revenue = Math.min(25, (won90 + 0.5 * openWeighted) / 10_000);
  const daysSince = lastMs ? Math.round((now - lastMs) / DAY) : 9999;
  const recency = Math.max(0, 10 - daysSince);

  const score = Math.round(engagement + support + revenue + recency);
  const churnRisk = Math.max(0, Math.min(100, 100 - score));

  const components: HealthComponent[] = [
    {
      key: "engagement",
      label: "Engagement",
      weight: 40,
      value: Math.round(engagement),
      inputs: { touchpoints30: touches30, behaviors30: behaviorCount, emails30: messageCount, calls30: callCount, meetings30: meetingCount, formula: "min(40, touchpoints30 × 4)" },
    },
    {
      key: "support",
      label: "Support health",
      weight: 25,
      value: Math.round(support),
      inputs: { openTickets: openTickets.length, breachedTickets: breached.length, escalatedTickets: escalated.length, formula: "max(0, 25 − 8·open − 10·breached − 5·escalated)" },
    },
    {
      key: "revenue",
      label: "Revenue & pipeline",
      weight: 25,
      value: Math.round(revenue),
      inputs: { won90d: r1(won90), openWeighted: r1(openWeighted), formula: "min(25, (won90 + ½·openWeighted) ÷ $10k)" },
    },
    {
      key: "recency",
      label: "Recency",
      weight: 10,
      value: recency,
      inputs: { daysSinceLastActivity: daysSince === 9999 ? null : daysSince, formula: "max(0, 10 − days)" },
    },
  ];

  return { profileId: profile.id, score, churnRisk, atRisk: churnRisk >= 70, components, lastActivityAt: lastMs ? new Date(lastMs) : null };
}

/**
 * Persist one HealthScore per profile (history + deltas), emit the
 * customer.health_changed / customer.churn_risk_changed events, and return a
 * summary (admin refresh endpoint). refreshId groups one pass.
 */
export async function refreshHealth(orgId: string, environment: string, actorId: string) {
  const profiles = await db().identityProfile.findMany({ where: { orgId, environment }, select: { id: true, memberIds: true, accountId: true } });
  if (!profiles.length) return { refreshed: 0, refreshId: null, avgScore: 0, atRisk: 0, churnWarnings: 0 };

  const refreshId = `${Date.now()}`;
  const latest = await db().healthScore.findMany({
    where: { orgId, environment, profileId: { in: profiles.map((p) => p.id) } },
    orderBy: { createdAt: "desc" },
    take: profiles.length * 2,
    select: { profileId: true, score: true },
  });
  const previous = new Map<string, number>();
  for (const h of latest) {
    if (!previous.has(h.profileId)) previous.set(h.profileId, h.score);
  }

  let atRisk = 0;
  let churnWarnings = 0;
  const scores: number[] = [];
  for (const profile of profiles) {
    const result = await healthFor(orgId, environment, profile);
    scores.push(result.score);
    await db().healthScore.create({
      data: {
        orgId,
        environment,
        profileId: profile.id,
        score: result.score,
        churnRisk: result.churnRisk,
        components: result.components as object,
        previousScore: previous.get(profile.id) ?? null,
        refreshId,
      },
    });
    if (result.atRisk) atRisk++;
    await emitEvent({
      orgId,
      environment,
      type: "customer.health_changed",
      entity: "identityProfile",
      entityId: profile.id,
      actorId,
      payload: { score: result.score, churnRisk: result.churnRisk, components: result.components.map((c) => ({ key: c.key, value: c.value })), refreshId },
    });
    if (result.churnRisk >= 70) {
      churnWarnings++;
      await emitEvent({
        orgId,
        environment,
        type: "customer.churn_risk_changed",
        entity: "identityProfile",
        entityId: profile.id,
        actorId,
        payload: { score: result.score, churnRisk: result.churnRisk, atRisk: true, refreshId },
      });
    }
  }
  const avgScore = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
  return { refreshed: profiles.length, refreshId, avgScore, atRisk, churnWarnings };
}
