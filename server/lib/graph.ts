// Relationship graph v1 (Phase 7 · CDP / Customer 360) — ADR-019.
//
// The graph is DERIVED ON READ from live rows (never stored — same discipline
// as the metrics library): contacts hang off accounts (employment edge), deals
// hang off accounts, and a contact's INVOLVEMENT in a deal is scored from the
// actual touchpoints between them (emails, calls, meetings, tickets). The UI
// renders the buying committee ranked by influence. Schema documented in
// docs/25-cdp-guide.md; manual edge curation is deferred.
//
// Influence scoring (documented):
//   email sent=1 · opened=2 · clicked=3 · replied=4 (best state per message)
//   call completed=3 · meeting completed=5
//   deal.contactId (primary contact) = +10
//   score = min(100, Σ weights) — no hard cap per touch class, capped at 100.
import { db } from "../db";
import { notFound } from "./http";

const EMAIL_WEIGHT: Record<string, number> = { sent: 1, opened: 2, clicked: 3, replied: 4 };

export type Touch = { kind: string; count: number; weight: number };

function emailState(message: { status: string }): string {
  if (message.status === "replied") return "replied";
  if (message.status === "clicked") return "clicked";
  if (message.status === "opened") return "opened";
  return "sent";
}

/** Aggregate per-(contact, deal) involvement from comm rows. */
function aggregateTouches(
  messages: { contactId: string | null; opportunityId: string | null; status: string }[],
  calls: { contactId: string | null; opportunityId: string | null; status: string }[],
  meetings: { contactId: string | null; opportunityId: string | null; status: string }[]
): Map<string, { dealId: string; points: number; touches: Touch[] }[]> {
  const map = new Map<string, { dealId: string; points: number; touches: Touch[] }[]>();
  const add = (contactId: string | null, dealId: string | null, points: number, touch: Touch) => {
    if (!contactId || !dealId) return;
    const list = map.get(contactId) ?? [];
    let entry = list.find((e) => e.dealId === dealId);
    if (!entry) {
      entry = { dealId, points: 0, touches: [] };
      list.push(entry);
      map.set(contactId, list);
    }
    entry.points += points;
    const existing = entry.touches.find((t) => t.kind === touch.kind);
    if (existing) existing.count += touch.count;
    else entry.touches.push({ ...touch });
  };

  for (const m of messages) add(m.contactId, m.opportunityId, EMAIL_WEIGHT[emailState(m)], { kind: `email_${emailState(m)}`, count: 1, weight: EMAIL_WEIGHT[emailState(m)] });
  for (const c of calls) {
    if (c.status === "completed") add(c.contactId, c.opportunityId, 3, { kind: "call", count: 1, weight: 3 });
  }
  for (const m of meetings) {
    if (m.status === "completed") add(m.contactId, m.opportunityId, 5, { kind: "meeting", count: 1, weight: 5 });
  }
  return map;
}

/** The account-level graph: account node + contact (employment) edges + deal involvement. */
export async function graphForAccount(orgId: string, environment: string, accountId: string) {
  const account = await db().account.findUnique({ where: { id: accountId } });
  if (!account || account.orgId !== orgId || account.environment !== environment) throw notFound("Account not found");

  const [contacts, deals] = await Promise.all([
    db().contact.findMany({ where: { orgId, environment, accountId }, select: { id: true, firstName: true, lastName: true, email: true, title: true } }),
    db().opportunity.findMany({ where: { orgId, environment, accountId }, select: { id: true, name: true, stage: true, amount: true, probability: true, contactId: true, ownerId: true } }),
  ]);
  const contactIds = contacts.map((c) => c.id);
  const dealIds = deals.map((d) => d.id);
  const primaryContact = new Set(deals.map((d) => d.contactId).filter(Boolean));

  const [messages, calls, meetings] = await Promise.all([
    contactIds.length && dealIds.length ? db().message.findMany({ where: { orgId, environment, contactId: { in: contactIds }, opportunityId: { in: dealIds } }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
    contactIds.length && dealIds.length ? db().call.findMany({ where: { orgId, environment, contactId: { in: contactIds }, opportunityId: { in: dealIds } }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
    contactIds.length && dealIds.length ? db().meeting.findMany({ where: { orgId, environment, contactId: { in: contactIds }, opportunityId: { in: dealIds } }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
  ]);
  const involvement = aggregateTouches(messages, calls, meetings);

  const contactNodes = contacts.map((c) => {
    const entries = involvement.get(c.id) ?? [];
    return {
      contact: c,
      name: `${c.firstName} ${c.lastName}`.trim(),
      deals: deals.map((d) => {
        const entry = entries.find((e) => e.dealId === d.id);
        const primaryBonus = primaryContact.has(c.id) && d.contactId === c.id ? 10 : 0;
        const influence = Math.min(100, (entry?.points ?? 0) + primaryBonus);
        return {
          dealId: d.id,
          name: d.name,
          stage: d.stage,
          amount: d.amount,
          probability: d.probability,
          influence,
          touches: entry?.touches ?? [],
          primary: d.contactId === c.id,
        };
      }),
      totalInfluence: deals.reduce((s, d) => s + Math.min(100, (entries.find((e) => e.dealId === d.id)?.points ?? 0) + (primaryContact.has(c.id) && d.contactId === c.id ? 10 : 0)), 0),
    };
  });

  return {
    account: { id: account.id, name: account.name, industry: account.industry, tier: account.tier, website: account.website },
    deals: deals.map((d) => ({ id: d.id, name: d.name, stage: d.stage, amount: d.amount, probability: d.probability, ownerId: d.ownerId })),
    contacts: contactNodes.sort((a, b) => b.totalInfluence - a.totalInfluence),
  };
}

/** The deal-level graph: the buying committee (contacts at the account ranked by influence). */
export async function graphForDeal(orgId: string, environment: string, dealId: string) {
  const deal = await db().opportunity.findUnique({ where: { id: dealId } });
  if (!deal || deal.orgId !== orgId || deal.environment !== environment) throw notFound("Deal not found");

  const account = deal.accountId
    ? await db().account.findUnique({ where: { id: deal.accountId }, select: { id: true, name: true, industry: true, tier: true } })
    : null;
  const contacts = deal.accountId
    ? await db().contact.findMany({ where: { orgId, environment, accountId: deal.accountId }, select: { id: true, firstName: true, lastName: true, email: true, title: true } })
    : [];

  const contactIds = contacts.map((c) => c.id);
  const [messages, calls, meetings, tickets] = await Promise.all([
    contactIds.length ? db().message.findMany({ where: { orgId, environment, contactId: { in: contactIds }, opportunityId: dealId }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
    contactIds.length ? db().call.findMany({ where: { orgId, environment, contactId: { in: contactIds }, opportunityId: dealId }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
    contactIds.length ? db().meeting.findMany({ where: { orgId, environment, contactId: { in: contactIds }, opportunityId: dealId }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
    contactIds.length ? db().ticket.findMany({ where: { orgId, environment, contactId: { in: contactIds }, accountId: deal.accountId ?? undefined }, select: { contactId: true } }) : Promise.resolve([]),
  ]);
  const involvement = aggregateTouches(messages, calls, meetings);
  const ticketCount = new Map<string, number>();
  for (const t of tickets) ticketCount.set(t.contactId ?? "", (ticketCount.get(t.contactId ?? "") ?? 0) + 1);

  const committee = contacts.map((c) => {
    const entry = (involvement.get(c.id) ?? []).find((e) => e.dealId === dealId);
    const ticketPoints = Math.min(8, (ticketCount.get(c.id) ?? 0) * 2); // support involvement = 2/ticket, capped
    const primaryBonus = deal.contactId === c.id ? 10 : 0;
    const touches = [...(entry?.touches ?? [])];
    const t = ticketCount.get(c.id) ?? 0;
    if (t > 0) touches.push({ kind: "ticket", count: t, weight: 2 });
    return {
      contact: c,
      name: `${c.firstName} ${c.lastName}`.trim(),
      influence: Math.min(100, (entry?.points ?? 0) + ticketPoints + primaryBonus),
      touches,
      primary: deal.contactId === c.id,
    };
  });

  return {
    deal: { id: deal.id, name: deal.name, stage: deal.stage, amount: deal.amount, probability: deal.probability, closeDate: deal.closeDate, ownerId: deal.ownerId },
    account,
    committee: committee.sort((a, b) => b.influence - a.influence),
  };
}

/** The person's slice of the graph (used by the 360 view): their deals + influence. */
export async function graphForContact(orgId: string, environment: string, contactId: string) {
  const contact = await db().contact.findUnique({ where: { id: contactId }, select: { id: true, firstName: true, lastName: true, email: true, title: true, accountId: true, orgId: true, environment: true } });
  if (!contact || contact.orgId !== orgId || contact.environment !== environment) return null;

  const deals = contact.accountId
    ? await db().opportunity.findMany({ where: { orgId, environment, accountId: contact.accountId }, select: { id: true, name: true, stage: true, amount: true, probability: true, contactId: true } })
    : [];
  const dealIds = deals.map((d) => d.id);
  const [messages, calls, meetings] = await Promise.all([
    dealIds.length ? db().message.findMany({ where: { orgId, environment, contactId, opportunityId: { in: dealIds } }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
    dealIds.length ? db().call.findMany({ where: { orgId, environment, contactId, opportunityId: { in: dealIds } }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
    dealIds.length ? db().meeting.findMany({ where: { orgId, environment, contactId, opportunityId: { in: dealIds } }, select: { contactId: true, opportunityId: true, status: true } }) : Promise.resolve([]),
  ]);
  const involvement = aggregateTouches(messages, calls, meetings);

  return {
    contact,
    deals: deals.map((d) => {
      const entry = (involvement.get(contactId) ?? []).find((e) => e.dealId === d.id);
      const influence = Math.min(100, (entry?.points ?? 0) + (d.contactId === contactId ? 10 : 0));
      return { dealId: d.id, name: d.name, stage: d.stage, amount: d.amount, probability: d.probability, influence, touches: entry?.touches ?? [], primary: d.contactId === contactId };
    }),
  };
}
