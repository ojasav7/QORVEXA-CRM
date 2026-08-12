// Campaign engine (Phase 5 · Marketing Automation) — ADR-017.
//
// Sending a campaign resolves the audience from a Phase-1 dynamic Segment,
// splits recipients by A/B variant, and writes one Message row per recipient
// through the existing email path (tracking token, open/click events) plus a
// CampaignRecipient row linking variant + message to the campaign. Open/click
// tracking (server/routes/tracking.ts) rolls up into campaign stats.
// Attribution: ROI = sum of `won` deal amounts whose linked contact was a
// recipient of the campaign (v1 first-touch-ish model; documented in the
// attribution model reference, docs/19-spec-phase5.md §2).
import { db } from "../db";
import { emitEvent } from "./events";
import { trackingToken, mergeTemplate, openPixelUrl, clickRedirectUrl } from "./comm";
import { listConditions } from "./access";
import { parseCriteria, criteriaWhere } from "./segments";
import { getObjectDef } from "./registry";
import { badRequest, notFound } from "./http";

export type CampaignAb = { enabled: boolean; splitA: number; subjectB?: string };
export type CampaignLike = {
  id: string;
  orgId: string;
  environment: string;
  name: string;
  status: string;
  subject: string;
  body: string;
  templateId: string | null;
  audienceSegmentId: string | null;
  ab: unknown;
  winner: string | null;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
};

/** Effective A/B config for a campaign row. */
export function campaignAb(ab: unknown): CampaignAb {
  const r = (ab ?? {}) as Record<string, unknown>;
  return {
    enabled: Boolean(r.enabled),
    splitA: typeof r.splitA === "number" ? r.splitA : 50,
    subjectB: typeof r.subjectB === "string" && r.subjectB.trim() ? r.subjectB.trim() : undefined,
  };
}

/** Subject for a recipient: A = campaign.subject, B = ab.subjectB. */
export function subjectForVariant(c: CampaignLike, variant: "A" | "B"): string {
  if (variant === "B") {
    const b = campaignAb(c.ab).subjectB;
    if (b) return b;
  }
  return c.subject;
}

/**
 * Resolve the campaign's audience from its segment. Returns contact rows
 * (org + environment + visibility scoped, paginated snapshot at send time).
 */
export async function audienceFor(campaign: CampaignLike, actor: { id: string; orgId: string; environment: string; role: string }): Promise<any[]> {
  if (!campaign.audienceSegmentId) return [];
  const segment = await db().segment.findFirst({
    where: { id: campaign.audienceSegmentId, orgId: campaign.orgId, environment: campaign.environment },
  });
  if (!segment) throw badRequest("Audience segment not found");
  const criteria = parseCriteria(segment.objectType, segment.criteria);
  const scope = listConditions({ ...actor, id: actor.id } as any, "ownerId");
  // v1 audiences target contacts; a lead/opportunity segment is allowed but
  // the engine sends to the segment rows' linked contact where present.
  const delegate = (db() as any)[segment.objectType];
  if (!delegate) throw badRequest(`Unknown segment object type "${segment.objectType}"`);
  const rows = await delegate.findMany({ where: criteriaWhere(segment.objectType, criteria, scope), take: 1000 });
  if (segment.objectType === "contact") return rows;
  // Non-contact segments: fall back to contactId when the row carries one.
  const contactIds = [...new Set(rows.map((r: any) => r.contactId).filter(Boolean))] as string[];
  if (!contactIds.length) return [];
  return db().contact.findMany({ where: { id: { in: contactIds }, orgId: campaign.orgId, environment: campaign.environment } });
}

/**
 * Send a campaign now: resolve audience, A/B-split, write per-recipient
 * Message + CampaignRecipient rows, bump counts, status → sent. Returns the
 * send summary. Idempotency guard: a `sent` campaign refuses unless force.
 */
export async function sendCampaign(
  campaign: CampaignLike,
  actor: { id: string; orgId: string; environment: string; email: string },
  opts: { force?: boolean } = {}
): Promise<{ sent: number; recipients: string[] }> {
  if (campaign.status === "sent" && !opts.force) {
    throw badRequest("This campaign was already sent — pass force: true to resend");
  }
  const ab = campaignAb(campaign.ab);
  const audience = await audienceFor(campaign, { id: actor.id, orgId: campaign.orgId, environment: campaign.environment, role: "admin" });
  if (!audience.length) throw badRequest("The audience segment has no members");

  // Template merge vars — the campaign body may reference {{contact.*}}.
  const template = campaign.templateId
    ? await db().emailTemplate.findFirst({ where: { id: campaign.templateId, orgId: campaign.orgId, environment: campaign.environment } })
    : null;

  const recipients: string[] = [];
  // A/B split: ab.splitA is a PERCENTAGE (0–100) of the audience that gets
  // variant A — `index / audience.length` so variant B always appears even for
  // small audiences (previously an index cutoff, which made B vanish whenever
  // the audience was smaller than splitA — the phase-7 verification caught it).
  for (let i = 0; i < audience.length; i++) {
    const contact = audience[i];
    const variant: "A" | "B" = ab.enabled && (i / audience.length) * 100 >= ab.splitA ? "B" : "A";
    const vars = { contact };
    const body = template ? mergeTemplate(campaign.body, vars) : campaign.body;
    const token = trackingToken();
    const message = await db().message.create({
      data: {
        orgId: campaign.orgId,
        environment: campaign.environment,
        direction: "out",
        threadId: token,
        trackingToken: token,
        fromEmail: actor.email,
        toEmail: String(contact.email ?? ""),
        subject: subjectForVariant(campaign, variant),
        body,
        status: "sent",
        campaignId: campaign.id,
        templateId: campaign.templateId,
        contactId: contact.id,
        ownerId: actor.id,
      },
    });
    const recipient = await db().campaignRecipient.create({
      data: {
        orgId: campaign.orgId,
        environment: campaign.environment,
        campaignId: campaign.id,
        contactId: contact.id,
        messageId: message.id,
        variant,
        status: "sent",
      },
    });
    recipients.push(recipient.id);
    await emitEvent({
      orgId: campaign.orgId,
      environment: campaign.environment,
      type: "email.sent",
      entity: "message",
      entityId: message.id,
      actorId: actor.id,
      payload: {
        to: message.toEmail,
        subject: message.subject,
        trackingToken: token,
        contactId: contact.id,
        campaignId: campaign.id,
        openUrl: openPixelUrl(token),
        clickUrl: (u: string) => clickRedirectUrl(token, u),
      },
    });
  }

  await db().campaign.update({
    where: { id: campaign.id },
    data: { status: "sent", sentCount: recipients.length, updatedAt: new Date() },
  });
  await emitEvent({
    orgId: campaign.orgId,
    environment: campaign.environment,
    type: "campaign.sent",
    entity: "campaign",
    entityId: campaign.id,
    actorId: actor.id,
    payload: { name: campaign.name, sent: recipients.length, ab: ab.enabled },
  });
  return { sent: recipients.length, recipients };
}

/**
 * Campaign stats — computed on read from CampaignRecipient + Message rows so
 * they can never go stale. ROI = sum of `won` deal amounts whose contact was
 * a recipient (attribution model reference, spec §2).
 */
export async function campaignStats(
  orgId: string,
  environment: string,
  campaignId: string
): Promise<{
  sent: number; opened: number; clicked: number; openRate: number; clickRate: number;
  roi: number; wonDealIds: string[]; byVariant: { A: { sent: number; opened: number; openedRate: number }; B: { sent: number; opened: number; openedRate: number } | null };
}> {
  const recipients = await db().campaignRecipient.findMany({ where: { orgId, environment, campaignId } });
  const opened = recipients.filter((r) => r.openedAt).length;
  const clicked = recipients.filter((r) => r.clickedAt).length;
  const sent = recipients.length;
  const openRate = sent ? Math.round((opened / sent) * 1000) / 10 : 0;
  const clickRate = sent ? Math.round((clicked / sent) * 1000) / 10 : 0;

  const byVariant: any = { A: { sent: 0, opened: 0, openedRate: 0 } };
  const ab = campaignAb((await db().campaign.findUnique({ where: { id: campaignId } }))?.ab);
  if (ab.enabled) byVariant.B = { sent: 0, opened: 0, openedRate: 0 };
  for (const r of recipients) {
    const v = byVariant[r.variant];
    if (v) {
      v.sent++;
      if (r.openedAt) v.opened++;
    }
  }
  for (const v of Object.values(byVariant) as any[]) {
    v.openedRate = v.sent ? Math.round((v.opened / v.sent) * 1000) / 10 : 0;
  }

  // Attribution: won deals whose contactId appears among recipients.
  const contactIds = [...new Set(recipients.map((r) => r.contactId).filter(Boolean))] as string[];
  const deals = contactIds.length
    ? await db().opportunity.findMany({ where: { orgId, environment, stage: "won", contactId: { in: contactIds } }, select: { id: true, amount: true } })
    : [];
  const roi = deals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  return { sent, opened, clicked, openRate, clickRate, roi, wonDealIds: deals.map((d) => d.id), byVariant };
}

/**
 * Deliverability metrics (flag marketing.deliverability) — computed from
 * Message rows in the current environment, so they can never go stale.
 * Bounced/unsubscribed/complaint events are simulated by the route (ADR-014);
 * the derived metrics are real.
 */
export async function deliverabilityMetrics(orgId: string, environment: string): Promise<{
  sent: number; opened: number; openedRate: number; clicked: number; clickRate: number;
  bounced: number; bounceRate: number; unsubscribed: number; complaints: number;
  health: number; grades: Record<string, number>;
}> {
  const messages = await db().message.findMany({
    where: { orgId, environment, direction: "out" },
    select: { status: true, openedAt: true, clickedAt: true, bouncedAt: true, unsubscribedAt: true },
  });
  const sent = messages.length;
  const opened = messages.filter((m) => m.openedAt).length;
  const clicked = messages.filter((m) => m.clickedAt).length;
  const bounced = messages.filter((m) => m.bouncedAt).length;
  const unsubscribed = messages.filter((m) => m.unsubscribedAt).length;
  // v1: complaints are tracked as unsubscribed (a complaint + opt-out both
  // stop delivery) — the simulate endpoint can mark either; the metric bucket
  // is shared to keep the dashboard honest.
  const complaints = unsubscribed;
  const openedRate = sent ? Math.round((opened / sent) * 1000) / 10 : 0;
  const clickRate = sent ? Math.round((clicked / sent) * 1000) / 10 : 0;
  const bounceRate = sent ? Math.round((bounced / sent) * 1000) / 10 : 0;

  // Health score 0–100: start at 100, subtract for bounce + low engagement.
  let health = 100;
  if (sent > 0) {
    health -= bounceRate >= 10 ? 25 : bounceRate >= 3 ? 12 : bounceRate > 0 ? 5 : 0;
    health -= openedRate < 20 ? 20 : openedRate < 35 ? 10 : 0;
    health -= clickRate < 1 ? 10 : clickRate < 3 ? 5 : 0;
    health = Math.max(0, Math.min(100, health));
  } else {
    health = 0;
  }

  const grades: Record<string, number> = {};
  for (const m of messages) grades[m.status] = (grades[m.status] ?? 0) + 1;
  return { sent, opened, openedRate, clicked, clickRate, bounced, bounceRate, unsubscribed, complaints, health, grades };
}

/** Simulate a mock provider deliverability event (ADR-014): bounce / unsubscribe. */
export async function simulateDeliverabilityEvent(
  orgId: string,
  environment: string,
  messageId: string,
  kind: "bounce" | "unsubscribe" | "complaint",
  actorId: string
): Promise<any> {
  const message = await db().message.findFirst({ where: { id: messageId, orgId, environment } });
  if (!message) throw notFound("Message not found");
  const data: Record<string, unknown> = { updatedAt: new Date() };
  let type = "email.bounced";
  if (kind === "bounce") data.bouncedAt = new Date();
  else if (kind === "unsubscribe") {
    data.unsubscribedAt = new Date();
    type = "email.unsubscribed";
  } else {
    data.unsubscribedAt = new Date();
    type = "email.complained";
  }
  const updated = await db().message.update({ where: { id: message.id }, data });
  await emitEvent({
    orgId,
    environment,
    type,
    entity: "message",
    entityId: message.id,
    actorId,
    payload: { to: message.toEmail, subject: message.subject, contactId: message.contactId ?? null, campaignId: message.campaignId ?? null },
  });
  return updated;
}

/** Declare the A/B winner (by open rate, or forced) and persist it. */
export async function declareCampaignWinner(
  orgId: string,
  environment: string,
  campaignId: string,
  variant: "A" | "B",
  actorId: string
): Promise<any> {
  const campaign = await db().campaign.findFirst({ where: { id: campaignId, orgId, environment } });
  if (!campaign) throw notFound("Campaign not found");
  const updated = await db().campaign.update({ where: { id: campaign.id }, data: { winner: variant, updatedAt: new Date() } });
  await emitEvent({
    orgId,
    environment,
    type: "campaign.winner_declared",
    entity: "campaign",
    entityId: campaign.id,
    actorId,
    payload: { name: campaign.name, winner: variant },
  });
  return updated;
}

