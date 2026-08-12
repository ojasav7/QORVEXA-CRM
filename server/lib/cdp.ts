// CDP / Customer 360 core (Phase 7) — ADR-019.
//
// Identity resolution + behavioral event tracking + the unified profile.
//   • Identity resolution v1 is DETERMINISTIC and documented (docs/25-cdp-guide.md):
//     email is the canonical key (lowercased, unique per org × env); phone and
//     name+company are secondary rules used by rebuild/merge suggestions. When a
//     contact/lead is created (or a behavior arrives), the engine resolves a
//     IdentityProfile and attaches the record as a member. Two records under one
//     profile = one identity → customer.identity_merged.
//   • Behavioral events (BehaviorEvent) are DISTINCT from the system Event log:
//     they record what the CUSTOMER did (page_view, purchase, email_opened,
//     support_ticket, …). Two ingestion paths: the authenticated API
//     (POST /api/cdp/behaviors — websites/products) and the event-bus mirror
//     (startCdpEngine maps selected system events → behaviors automatically).
//   • The profile is the anchor for the 360 view (profile360), the health engine
//     (lib/health.ts) and the relationship graph (lib/graph.ts).
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitEvent, onEvent } from "./events";
import { badRequest, notFound } from "./http";

// ── Identity resolution rules ────────────────────────────────────────────────

export const canonicalEmail = (email: string): string => email.trim().toLowerCase();

/** "contact:<id>" | "lead:<id>" — the member reference stored on a profile. */
export const memberRef = (type: string, id: string): string => `${type}:${id}`;

/** Parse a member ref back into { type, id }. */
export function parseMemberRef(ref: string): { type: string; id: string } {
  const idx = ref.indexOf(":");
  return { type: ref.slice(0, idx), id: ref.slice(idx + 1) };
}

export async function findProfileByEmail(orgId: string, environment: string, email: string) {
  const canonical = canonicalEmail(email);
  if (!canonical) return null;
  return db().identityProfile.findUnique({
    where: { orgId_environment_email: { orgId, environment, email: canonical } },
  });
}

/**
 * Resolve (or create) the profile for one contact/lead record and attach it as a
 * member. Returns { profile, attached, merged, created }:
 *   • created  — the profile did not exist and was created from this record.
 *   • attached — the record was added to an existing profile (merged = true when
 *     the profile already had other members → identity unified).
 */
export async function ensureProfileForRecord(
  orgId: string,
  environment: string,
  type: "contact" | "lead",
  record: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null; company?: string | null; accountId?: string | null; title?: string | null },
  actorId: string
): Promise<{ profile: any; attached: boolean; merged: boolean; created: boolean } | null> {
  const email = record.email ? canonicalEmail(record.email) : "";
  if (!email) return null; // anonymous records are tracked via behaviors, not unified profiles (v1)

  const name = `${record.firstName ?? ""} ${record.lastName ?? ""}`.trim() || null;
  let profile = await findProfileByEmail(orgId, environment, email);
  const ref = memberRef(type, record.id);

  if (!profile) {
    profile = await db().identityProfile.create({
      data: {
        orgId,
        environment,
        email,
        firstName: record.firstName ?? null,
        lastName: record.lastName ?? null,
        phone: record.phone ?? null,
        company: type === "lead" ? (record.company ?? null) : null,
        title: record.title ?? null,
        accountId: record.accountId ?? null,
        primaryContactId: type === "contact" ? record.id : null,
        primaryLeadId: type === "lead" ? record.id : null,
        memberIds: [ref],
        tags: [],
        custom: {},
      },
    });
    return { profile, attached: true, merged: false, created: true };
  }

  const members = (profile.memberIds as string[]) ?? [];
  if (members.includes(ref)) return { profile, attached: false, merged: false, created: false };

  const merged = members.length > 0;
  const memberList = [...members, ref];
  // Master-data preferences: contact beats lead for name/account; lead provides company.
  const contactMembers = memberList.filter((m) => m.startsWith("contact:"));
  const leadMembers = memberList.filter((m) => m.startsWith("lead:"));
  const primaryContactId = profile.primaryContactId ?? (type === "contact" ? record.id : (contactMembers[0]?.split(":")[1] ?? profile.primaryContactId));
  const primaryLeadId = profile.primaryLeadId ?? (type === "lead" ? record.id : (leadMembers[0]?.split(":")[1] ?? profile.primaryLeadId));
  const accountId = profile.accountId ?? record.accountId ?? null;
  const company = profile.company ?? (type === "lead" ? record.company ?? null : null);

  profile = await db().identityProfile.update({
    where: { id: profile.id },
    data: {
      memberIds: memberList,
      firstName: profile.firstName ?? record.firstName ?? null,
      lastName: profile.lastName ?? record.lastName ?? null,
      phone: profile.phone ?? record.phone ?? null,
      title: profile.title ?? record.title ?? null,
      company,
      accountId,
      primaryContactId,
      primaryLeadId,
      updatedAt: new Date(),
    },
  });

  if (merged) {
    await emitEvent({
      orgId,
      environment,
      type: "customer.identity_merged",
      entity: "identityProfile",
      entityId: profile.id,
      actorId,
      payload: { email, memberRef: ref, memberIds: memberList, memberCount: memberList.length, source: "record" },
    });
  }
  return { profile, attached: true, merged, created: false };
}

/** Reconcile every contact + lead into profiles (admin rebuild). Idempotent. */
export async function rebuildProfiles(orgId: string, environment: string, actorId: string) {
  const [contacts, leads] = await Promise.all([
    db().contact.findMany({ where: { orgId, environment }, select: { id: true, email: true, firstName: true, lastName: true, phone: true, accountId: true, title: true } }),
    db().lead.findMany({ where: { orgId, environment }, select: { id: true, email: true, firstName: true, lastName: true, phone: true, company: true } }),
  ]);
  let created = 0;
  let attached = 0;
  let merged = 0;
  for (const c of contacts) {
    const res = await ensureProfileForRecord(orgId, environment, "contact", c, actorId);
    if (res?.created) created++;
    else if (res?.merged) merged++;
    else if (res?.attached) attached++;
  }
  for (const l of leads) {
    const res = await ensureProfileForRecord(orgId, environment, "lead", l, actorId);
    if (res?.created) created++;
    else if (res?.merged) merged++;
    else if (res?.attached) attached++;
  }
  return { contacts: contacts.length, leads: leads.length, created, attached, merged };
}

/**
 * Admin merge: move every member/behavior/health row from `fromId` into `intoId`
 * and delete the donor. Emits customer.identity_merged with full lineage.
 */
export async function mergeProfiles(orgId: string, environment: string, fromId: string, intoId: string, actorId: string) {
  if (fromId === intoId) throw badRequest("Cannot merge a profile into itself");
  const [from, into] = await Promise.all([
    db().identityProfile.findUnique({ where: { id: fromId } }),
    db().identityProfile.findUnique({ where: { id: intoId } }),
  ]);
  if (!from || from.orgId !== orgId || from.environment !== environment) throw notFound("Source profile not found");
  if (!into || into.orgId !== orgId || into.environment !== environment) throw notFound("Target profile not found");

  const fromMembers = (from.memberIds as string[]) ?? [];
  const intoMembers = (into.memberIds as string[]) ?? [];
  const memberIds = [...new Set([...intoMembers, ...fromMembers])];

  // Master-data preferences: adopt any richer identity fields the donor had.
  const contactMembers = memberIds.filter((m) => m.startsWith("contact:"));
  const leadMembers = memberIds.filter((m) => m.startsWith("lead:"));
  const updated = await db().identityProfile.update({
    where: { id: intoId },
    data: {
      memberIds,
      mergedFromIds: [...((into.mergedFromIds as string[]) ?? []), fromId],
      firstName: into.firstName ?? from.firstName ?? null,
      lastName: into.lastName ?? from.lastName ?? null,
      phone: into.phone ?? from.phone ?? null,
      company: into.company ?? from.company ?? null,
      title: into.title ?? from.title ?? null,
      accountId: into.accountId ?? from.accountId ?? null,
      primaryContactId: into.primaryContactId ?? (contactMembers[0]?.split(":")[1] ?? null),
      primaryLeadId: into.primaryLeadId ?? (leadMembers[0]?.split(":")[1] ?? null),
      updatedAt: new Date(),
    },
  });

  await db().behaviorEvent.updateMany({ where: { orgId, environment, profileId: fromId }, data: { profileId: intoId } });
  await db().healthScore.updateMany({ where: { orgId, environment, profileId: fromId }, data: { profileId: intoId } });
  await db().identityProfile.delete({ where: { id: fromId } });

  await emitEvent({
    orgId,
    environment,
    type: "customer.identity_merged",
    entity: "identityProfile",
    entityId: intoId,
    actorId,
    payload: { from: fromId, into: intoId, memberIds, memberCount: memberIds.length, mergedFromCount: (updated.mergedFromIds as string[]).length, source: "manual" },
  });
  return updated;
}

// ── Behavioral events ────────────────────────────────────────────────────────

/** The advisory behavior catalog — the API accepts any type string (documented). */
export const BEHAVIOR_TYPES = [
  "page_view",
  "product_use",
  "purchase",
  "ad_click",
  "form_submitted",
  "email_opened",
  "email_clicked",
  "email_replied",
  "call_completed",
  "meeting_completed",
  "support_ticket",
];

export type BehaviorInput = {
  type: string;
  email?: string;
  contactId?: string;
  leadId?: string;
  profileId?: string;
  entity?: string;
  entityId?: string;
  value?: number;
  meta?: Record<string, unknown>;
  occurredAt?: string;
};

/**
 * Record one customer behavior. Resolves the identity: explicit profileId wins,
 * then contactId/leadId (via their email), then email. Anonymous behaviors are
 * stored with profileId null (still counted, just not unified).
 */
export async function ingestBehavior(orgId: string, environment: string, input: BehaviorInput, opts: { source?: string; actorId?: string; ip?: string } = {}) {
  if (!input.type || !input.type.trim()) throw badRequest("Behavior type is required");
  if (input.type.length > 60) throw badRequest("Behavior type is too long");

  let profileId = input.profileId ?? null;
  if (profileId) {
    const profile = await db().identityProfile.findUnique({ where: { id: profileId } });
    if (!profile || profile.orgId !== orgId || profile.environment !== environment) throw badRequest("Unknown profileId");
  } else if (input.contactId) {
    // Scoped to the org × environment: a caller can never resolve (or probe) another tenant's records.
    const contact = await db().contact.findFirst({ where: { id: input.contactId, orgId, environment } });
    const profile = contact?.email ? await findProfileByEmail(orgId, environment, contact.email) : null;
    profileId = profile?.id ?? null;
  } else if (input.leadId) {
    const lead = await db().lead.findFirst({ where: { id: input.leadId, orgId, environment } });
    const profile = lead?.email ? await findProfileByEmail(orgId, environment, lead.email) : null;
    profileId = profile?.id ?? null;
  } else if (input.email) {
    const profile = await findProfileByEmail(orgId, environment, input.email);
    profileId = profile?.id ?? null;
  }

  const created = await db().behaviorEvent.create({
    data: {
      orgId,
      environment,
      type: input.type.trim(),
      profileId,
      contactId: input.contactId ?? null,
      leadId: input.leadId ?? null,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      value: typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null,
      meta: (input.meta ?? {}) as object,
      source: opts.source ?? "api",
      ip: opts.ip ?? null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    },
  });
  return created;
}

// ── Event-bus mirror (behavioral tracking from the existing event stream) ───

/**
 * The event-bus → behavior mirror. Selected system events (which are already
 * persisted + dispatched by lib/events.ts) are mirrored into BehaviorEvent rows
 * so the customer's touchpoint history is complete without any extra code at
 * the source. Record resolution always goes through the row by entityId so the
 * mapping never depends on event payload shapes.
 */
async function mirrorEvent(event: { orgId: string; environment: string; type: string; entity: string; entityId: string; actorId: string; id: string }, behaviorType: string) {
  try {
    const { orgId, environment } = event;
    let contactId: string | null = null;
    let leadId: string | null = null;
    let entity = event.entity;
    let meta: Record<string, unknown> = { eventType: event.type, eventId: event.id };

    if (event.type.startsWith("email.")) {
      const message = await db().message.findUnique({ where: { id: event.entityId } });
      contactId = message?.contactId ?? null;
      meta = { ...meta, subject: message?.subject ?? null, direction: message?.direction ?? null };
    } else if (event.type === "form.submitted") {
      const lead = await db().lead.findUnique({ where: { id: event.entityId } });
      leadId = lead?.id ?? null;
      meta = { ...meta, source: lead?.source ?? null, company: lead?.company ?? null };
    } else if (event.type === "ticket.created") {
      const ticket = await db().ticket.findUnique({ where: { id: event.entityId } });
      contactId = ticket?.contactId ?? null;
      meta = { ...meta, subject: ticket?.subject ?? null, channel: ticket?.channel ?? null };
    } else if (event.type === "call.completed") {
      const call = await db().call.findUnique({ where: { id: event.entityId } });
      contactId = call?.contactId ?? null;
      meta = { ...meta, durationSec: call?.durationSec ?? null };
    } else if (event.type === "meeting.completed") {
      const meeting = await db().meeting.findUnique({ where: { id: event.entityId } });
      contactId = meeting?.contactId ?? null;
      meta = { ...meta, title: meeting?.title ?? null };
    }

    let profileId: string | null = null;
    if (contactId) {
      const contact = await db().contact.findUnique({ where: { id: contactId } });
      const profile = contact?.email ? await findProfileByEmail(orgId, environment, contact.email) : null;
      profileId = profile?.id ?? null;
    } else if (leadId) {
      const lead = await db().lead.findUnique({ where: { id: leadId } });
      const profile = lead?.email ? await findProfileByEmail(orgId, environment, lead.email) : null;
      profileId = profile?.id ?? null;
    }

    await db().behaviorEvent.create({
      data: {
        orgId,
        environment,
        type: behaviorType,
        profileId,
        contactId,
        leadId,
        entity,
        entityId: event.entityId,
        value: null,
        meta: meta as object,
        source: "event-bus",
        occurredAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[cdp mirror]", event.type, e);
  }
}

/** Mirror map: system event type → behavior type. */
const MIRROR: Record<string, string> = {
  "email.opened": "email_opened",
  "email.clicked": "email_clicked",
  "email.replied": "email_replied",
  "form.submitted": "form_submitted",
  "ticket.created": "support_ticket",
  "call.completed": "call_completed",
  "meeting.completed": "meeting_completed",
};

let engineStarted = false;

/**
 * Real-time record attach: contact.created / lead.created → unified profile.
 * Resolves the row by entityId (same discipline as the mirror) and scopes it
 * to the event's org × environment before attaching.
 */
async function attachRecordEvent(event: { orgId: string; environment: string; type: string; entityId: string; actorId: string }) {
  try {
    const { orgId, environment } = event;
    if (event.type === "contact.created") {
      const contact = await db().contact.findFirst({
        where: { id: event.entityId, orgId, environment },
        select: { id: true, email: true, firstName: true, lastName: true, phone: true, accountId: true, title: true },
      });
      if (contact) await ensureProfileForRecord(orgId, environment, "contact", contact, event.actorId);
    } else if (event.type === "lead.created") {
      const lead = await db().lead.findFirst({
        where: { id: event.entityId, orgId, environment },
        select: { id: true, email: true, firstName: true, lastName: true, phone: true, company: true },
      });
      if (lead) await ensureProfileForRecord(orgId, environment, "lead", lead, event.actorId);
    }
  } catch (e) {
    console.error("[cdp attach]", event.type, e);
  }
}

/** Subscribe the mirror + record attach to the event bus (called once at boot). */
export function startCdpEngine() {
  if (engineStarted) return;
  engineStarted = true;
  for (const [systemType, behaviorType] of Object.entries(MIRROR)) {
    onEvent(systemType, (event) => void mirrorEvent(event, behaviorType));
  }
  // Identity resolution: a newly created contact/lead is attached to its
  // profile in real time (docs/25-cdp-guide.md — the docs claim this, the
  // engine must deliver it).
  onEvent("contact.created", (event) => void attachRecordEvent(event as any));
  onEvent("lead.created", (event) => void attachRecordEvent(event as any));
  console.log("  CDP           · identity + behavior mirror engine subscribed");
}

// ── Profile summaries + 360 ──────────────────────────────────────────────────

/** Hydrate a profile with its member records + display name. */
export async function hydrateProfile(orgId: string, environment: string, profile: any) {
  const members = (profile.memberIds as string[]) ?? [];
  const contactIds = members.filter((m) => m.startsWith("contact:")).map((m) => m.split(":")[1]);
  const leadIds = members.filter((m) => m.startsWith("lead:")).map((m) => m.split(":")[1]);
  const [contacts, leads, account] = await Promise.all([
    contactIds.length ? db().contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, email: true, title: true, status: true, accountId: true, createdAt: true } }) : Promise.resolve([]),
    leadIds.length ? db().lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, firstName: true, lastName: true, email: true, company: true, status: true, score: true, source: true, createdAt: true } }) : Promise.resolve([]),
    profile.accountId ? db().account.findUnique({ where: { id: profile.accountId }, select: { id: true, name: true, industry: true, tier: true, website: true } }) : Promise.resolve(null),
  ]);
  const contact = contacts[0] ?? null;
  const lead = leads[0] ?? null;
  return {
    ...profile,
    memberIds: members,
    contactCount: contacts.length,
    leadCount: leads.length,
    name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || contact?.firstName || lead?.firstName || profile.email.split("@")[0] || "Unnamed customer",
    contacts,
    leads,
    account,
    memberCount: members.length,
  };
}

/** The full 360 view for one profile. */
export async function profile360(orgId: string, environment: string, profileId: string) {
  const profile = await db().identityProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.orgId !== orgId || profile.environment !== environment) throw notFound("Profile not found");
  const hydrated = await hydrateProfile(orgId, environment, profile);

  const contactIds = (profile.memberIds as string[]).filter((m) => m.startsWith("contact:")).map((m) => m.split(":")[1]);
  const leadIds = (profile.memberIds as string[]).filter((m) => m.startsWith("lead:")).map((m) => m.split(":")[1]);

  const [behaviors, messages, calls, meetings, tickets] = await Promise.all([
    db().behaviorEvent.findMany({ where: { orgId, environment, profileId }, orderBy: { occurredAt: "desc" }, take: 100 }),
    contactIds.length ? db().message.findMany({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
    contactIds.length ? db().call.findMany({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { startedAt: "desc" }, take: 50 }) : Promise.resolve([]),
    contactIds.length ? db().meeting.findMany({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { startsAt: "desc" }, take: 50 }) : Promise.resolve([]),
    contactIds.length ? db().ticket.findMany({ where: { orgId, environment, contactId: { in: contactIds } }, orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
  ]);

  const lastActivity = [behaviors[0]?.occurredAt, messages[0]?.createdAt, calls[0]?.startedAt, meetings[0]?.startsAt, tickets[0]?.createdAt]
    .filter(Boolean)
    .map((d) => new Date(d as Date).getTime())
    .sort((a, b) => b - a)[0] ?? null;

  return { profile: hydrated, behaviors, messages, calls, meetings, tickets, lastActivity };
}

/** Cheap list row: profile + member counts + last activity. */
export async function listProfiles(orgId: string, environment: string, opts: { q?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const where: Prisma.IdentityProfileWhereInput = { orgId, environment };
  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    db().identityProfile.findMany({ where, orderBy: { updatedAt: "desc" }, skip: offset, take: limit }),
    db().identityProfile.count({ where }),
  ]);
  const items = await Promise.all(rows.map((r) => hydrateProfile(orgId, environment, r)));
  return { items, total };
}
