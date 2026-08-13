// Phase 13 · Ecosystem — the extensibility loop: an app/agent marketplace
// (MarketplaceListing → App installs), partner & channel management
// (PartnerAccount + registered deals with derived commissions), change sets
// that promote config/schema changes between environments (ChangeSet,
// changeset.promoted), and schema change-impact analysis (docs/43-schema-change-safety.md).
// All logic lives here (ADR-015/017 row-as-config pattern); routes/ecosystem.ts
// is a thin REST surface.
import { db } from "../db";
import { emitEvent } from "./events";
import { badRequest, notFound } from "./http";
import { templateFor } from "./agents";
import { PRODUCTION_ENV, SANDBOX_ENV } from "./environment";

type Actor = { id: string };

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Marketplace (ecosystem.marketplace) ────────────────────────────────────
export async function listListings(orgId: string, environment: string): Promise<any[]> {
  const rows = await db().marketplaceListing.findMany({
    where: { orgId, environment }, orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  const installed = await db().app.findMany({ where: { orgId, environment, status: "installed" }, select: { listingId: true, slug: true } });
  const installedSlugs = new Set(installed.map((a) => a.listingId ?? a.slug));
  return rows.map((l) => ({
    id: l.id, slug: l.slug, name: l.name, kind: l.kind, description: l.description,
    publisher: l.publisher, version: l.version, icon: l.icon, active: l.active,
    installCount: l.installCount, installed: installedSlugs.has(l.id),
    createdAt: l.createdAt,
  }));
}

export async function createListing(orgId: string, environment: string, input: {
  slug: string; name: string; kind?: string; description?: string | null; publisher?: string; version?: string; icon?: string | null; config?: Record<string, unknown>;
}, actor: Actor): Promise<any> {
  const slug = (input.slug ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const name = (input.name ?? "").trim();
  if (!slug || !name) throw badRequest("Slug and name are required");
  const kind = input.kind ?? "app";
  if (!["app", "agent", "integration", "template"].includes(kind)) throw badRequest(`Unknown kind: "${kind}"`);
  const existing = await db().marketplaceListing.findFirst({ where: { orgId, environment, slug } });
  if (existing) throw badRequest(`Listing already exists: ${slug}`);
  const listing = await db().marketplaceListing.create({
    data: {
      orgId, environment, slug, name, kind, description: input.description ?? null,
      publisher: input.publisher ?? "Qorvexa", version: input.version ?? "1.0.0", icon: input.icon ?? null,
      config: (input.config ?? {}) as object, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "marketplace.listing_created", entity: "marketplaceListing", entityId: listing.id, actorId: actor.id, payload: { slug, name, kind } });
  return (await listListings(orgId, environment)).find((x) => x.id === listing.id) ?? null;
}

export async function updateListing(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: Actor): Promise<any> {
  const l = await db().marketplaceListing.findFirst({ where: { id, orgId, environment } });
  if (!l) throw notFound("Listing not found");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.description !== undefined) data.description = input.description === null ? null : String(input.description);
  if (input.version !== undefined) data.version = String(input.version);
  if (input.icon !== undefined) data.icon = input.icon === null ? null : String(input.icon);
  if (input.config !== undefined) data.config = input.config as object;
  if (input.active !== undefined) data.active = Boolean(input.active);
  if (!Object.keys(data).length) throw badRequest("Nothing to update");
  const updated = await db().marketplaceListing.update({ where: { id }, data });
  await emitEvent({ orgId, environment, type: "marketplace.listing_updated", entity: "marketplaceListing", entityId: id, actorId: actor.id, payload: { slug: updated.slug } });
  return (await listListings(orgId, environment)).find((x) => x.id === id) ?? null;
}

export async function deleteListing(orgId: string, environment: string, id: string, actor: Actor): Promise<void> {
  const l = await db().marketplaceListing.findFirst({ where: { id, orgId, environment } });
  if (!l) throw notFound("Listing not found");
  await db().marketplaceListing.delete({ where: { id } });
  await emitEvent({ orgId, environment, type: "marketplace.listing_deleted", entity: "marketplaceListing", entityId: id, actorId: actor.id, payload: { slug: l.slug } });
}

// ── Apps (install/uninstall — app.installed) ───────────────────────────────
export async function listApps(orgId: string, environment: string): Promise<any[]> {
  const rows = await db().app.findMany({ where: { orgId, environment }, orderBy: { installedAt: "desc" } });
  return rows.map((a) => ({
    id: a.id, listingId: a.listingId, slug: a.slug, name: a.name, kind: a.kind,
    status: a.status, config: (a.config ?? {}) as Record<string, unknown>,
    installedBy: a.installedBy, installedAt: a.installedAt, uninstalledAt: a.uninstalledAt,
  }));
}

export async function installApp(orgId: string, environment: string, input: { listingId: string }, actor: Actor): Promise<any> {
  const listing = await db().marketplaceListing.findFirst({ where: { id: input.listingId, orgId, environment } });
  if (!listing) throw notFound("Marketplace listing not found");
  const existing = await db().app.findFirst({ where: { orgId, environment, slug: listing.slug } });
  if (existing?.status === "installed") throw badRequest(`"${listing.name}" is already installed`);

  const config = (listing.config ?? {}) as Record<string, unknown>;
  const applied: Record<string, unknown> = {};

  // Apply the listing's install payload: an agent template (Phase 9 engine),
  // webhook subscriptions, or feature-flag hints.
  const agentTemplate = config.agentTemplate as string | undefined;
  if (agentTemplate) {
    const tpl = templateFor(agentTemplate);
    if (tpl) {
      const agent = await db().agent.findFirst({ where: { orgId, environment, kind: agentTemplate } });
      if (!agent) {
        const created = await db().agent.create({
          data: {
            orgId, environment, name: tpl.name, kind: tpl.kind, description: tpl.description,
            trigger: tpl.trigger as object, rules: [] as any, tools: tpl.tools as any,
            tierPolicy: {} as any, memoryEnabled: true, active: true, createdBy: actor.id,
          },
        });
        applied.agentId = created.id;
        await emitEvent({ orgId, environment, type: "agent.created", entity: "agent", entityId: created.id, actorId: actor.id, payload: { name: created.name, kind: created.kind, source: "marketplace" } });
      } else {
        applied.agentId = agent.id;
      }
    }
  }
  const webhookEvents = config.webhookEvents as string[] | undefined;
  if (webhookEvents?.length) {
    const webhook = await db().webhook.create({
      data: {
        orgId, environment, url: `https://hooks.example.com/${listing.slug}`,
        secret: randomHex(16), events: webhookEvents as any, active: true,
      },
    });
    applied.webhookId = webhook.id;
  }

  if (existing) {
    await db().app.update({ where: { id: existing.id }, data: { status: "installed", config: { ...((existing.config ?? {}) as object), ...applied } as any, uninstalledAt: null } });
  } else {
    await db().app.create({
      data: {
        orgId, environment, listingId: listing.id, slug: listing.slug, name: listing.name, kind: listing.kind,
        config: applied as any, installedBy: actor.id,
      },
    });
  }
  await db().marketplaceListing.update({ where: { id: listing.id }, data: { installCount: { increment: 1 } } });
  await emitEvent({ orgId, environment, type: "app.installed", entity: "app", entityId: listing.id, actorId: actor.id, payload: { slug: listing.slug, name: listing.name, kind: listing.kind, config: applied } });
  return (await listApps(orgId, environment)).find((x) => x.slug === listing.slug && x.status === "installed") ?? null;
}

export async function uninstallApp(orgId: string, environment: string, id: string, actor: Actor): Promise<any> {
  const app = await db().app.findFirst({ where: { id, orgId, environment } });
  if (!app) throw notFound("App not found");
  if (app.status !== "installed") throw badRequest("App is not installed");
  const updated = await db().app.update({ where: { id }, data: { status: "uninstalled", uninstalledAt: new Date() } });
  await emitEvent({ orgId, environment, type: "app.uninstalled", entity: "app", entityId: id, actorId: actor.id, payload: { slug: app.slug, name: app.name } });
  return updated;
}

// ── Partners (ecosystem.partners) ──────────────────────────────────────────
export async function listPartners(orgId: string, environment: string): Promise<any[]> {
  const rows = await db().partnerAccount.findMany({ where: { orgId, environment }, orderBy: { name: "asc" } });
  const deals = await db().partnerDeal.findMany({ where: { orgId, environment } });
  return rows.map((p) => {
    const pDeals = deals.filter((d) => d.partnerId === p.id);
    const won = pDeals.filter((d) => d.status === "won");
    const pipeline = pDeals.filter((d) => ["registered", "approved"].includes(d.status)).reduce((s, d) => s + d.amount, 0);
    const commission = won.reduce((s, d) => s + d.amount * p.commissionRate, 0);
    return {
      id: p.id, name: p.name, type: p.type, contactName: p.contactName, email: p.email, phone: p.phone,
      commissionRate: p.commissionRate, status: p.status, notes: p.notes,
      deals: pDeals.map((d) => ({
        id: d.id, name: d.name, amount: d.amount, status: d.status, opportunityId: d.opportunityId,
        registeredAt: d.registeredAt, wonAt: d.wonAt, commission: d.status === "won" ? Math.round(d.amount * p.commissionRate * 100) / 100 : 0,
      })),
      dealCount: pDeals.length, wonCount: won.length, pipelineValue: Math.round(pipeline * 100) / 100,
      commissionEarned: Math.round(commission * 100) / 100,
    };
  });
}

export async function createPartner(orgId: string, environment: string, input: {
  name: string; type?: string; contactName?: string | null; email?: string | null; phone?: string | null; commissionRate?: number; notes?: string | null;
}, actor: Actor): Promise<any> {
  const name = (input.name ?? "").trim();
  if (!name) throw badRequest("Partner name is required");
  const rate = input.commissionRate ?? 0.1;
  if (rate < 0 || rate > 1) throw badRequest("Commission rate must be between 0 and 1");
  const type = input.type ?? "reseller";
  if (!["reseller", "referral", "technology", "consultant"].includes(type)) throw badRequest(`Unknown partner type: "${type}"`);
  const partner = await db().partnerAccount.create({
    data: {
      orgId, environment, name, type, contactName: input.contactName ?? null, email: input.email ?? null,
      phone: input.phone ?? null, commissionRate: rate, notes: input.notes ?? null, createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "partner.created", entity: "partnerAccount", entityId: partner.id, actorId: actor.id, payload: { name, type } });
  return (await listPartners(orgId, environment)).find((x) => x.id === partner.id) ?? null;
}

export async function updatePartner(orgId: string, environment: string, id: string, input: Record<string, unknown>, actor: Actor): Promise<any> {
  const p = await db().partnerAccount.findFirst({ where: { id, orgId, environment } });
  if (!p) throw notFound("Partner not found");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.type !== undefined) data.type = String(input.type);
  if (input.contactName !== undefined) data.contactName = input.contactName === null ? null : String(input.contactName);
  if (input.email !== undefined) data.email = input.email === null ? null : String(input.email);
  if (input.phone !== undefined) data.phone = input.phone === null ? null : String(input.phone);
  if (input.commissionRate !== undefined) {
    const r = Number(input.commissionRate);
    if (r < 0 || r > 1) throw badRequest("Commission rate must be between 0 and 1");
    data.commissionRate = r;
  }
  if (input.status !== undefined) data.status = String(input.status);
  if (input.notes !== undefined) data.notes = input.notes === null ? null : String(input.notes);
  if (!Object.keys(data).length) throw badRequest("Nothing to update");
  const updated = await db().partnerAccount.update({ where: { id }, data });
  await emitEvent({ orgId, environment, type: "partner.updated", entity: "partnerAccount", entityId: id, actorId: actor.id, payload: { name: updated.name } });
  return (await listPartners(orgId, environment)).find((x) => x.id === id) ?? null;
}

export async function registerPartnerDeal(orgId: string, environment: string, input: {
  partnerId: string; name: string; amount?: number; opportunityId?: string | null;
}, actor: Actor): Promise<any> {
  const partner = await db().partnerAccount.findFirst({ where: { id: input.partnerId, orgId, environment } });
  if (!partner) throw notFound("Partner not found");
  const name = (input.name ?? "").trim();
  if (!name) throw badRequest("Deal name is required");
  const amount = Number(input.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw badRequest("Amount must be a non-negative number");
  const deal = await db().partnerDeal.create({
    data: { orgId, environment, partnerId: partner.id, opportunityId: input.opportunityId ?? null, name, amount, createdBy: actor.id },
  });
  await emitEvent({ orgId, environment, type: "partner.deal_registered", entity: "partnerDeal", entityId: deal.id, actorId: actor.id, payload: { partner: partner.name, name, amount, opportunityId: deal.opportunityId } });
  return (await listPartners(orgId, environment)).find((x) => x.id === partner.id) ?? null;
}

export async function setPartnerDealStatus(orgId: string, environment: string, dealId: string, status: string, actor: Actor): Promise<any> {
  const deal = await db().partnerDeal.findFirst({ where: { id: dealId, orgId, environment } });
  if (!deal) throw notFound("Partner deal not found");
  if (!["registered", "approved", "won", "lost"].includes(status)) throw badRequest(`Unknown deal status: "${status}"`);
  const partner = await db().partnerAccount.findFirst({ where: { id: deal.partnerId, orgId, environment } });
  const data: Record<string, unknown> = { status };
  if (status === "won") data.wonAt = new Date();
  const updated = await db().partnerDeal.update({ where: { id: dealId }, data });
  if (status === "won") {
    const commission = Math.round((deal.amount * (partner?.commissionRate ?? 0)) * 100) / 100;
    await emitEvent({ orgId, environment, type: "partner.commission_earned", entity: "partnerDeal", entityId: dealId, actorId: actor.id, payload: { partner: partner?.name, deal: deal.name, amount: deal.amount, rate: partner?.commissionRate, commission } });
  } else {
    await emitEvent({ orgId, environment, type: "partner.deal_updated", entity: "partnerDeal", entityId: dealId, actorId: actor.id, payload: { name: deal.name, status } });
  }
  return updated;
}

// ── Change sets + env promotion (ecosystem.changesets) ─────────────────────
// A change set bundles schema/config changes from one environment and replays
// them in another (dev → staging → prod). Supported entities: fieldDef
// (custom fields), agent, featureFlag. Diff mode compares two environments
// and produces the items automatically.
export async function diffEnvironments(orgId: string, from: string, to: string): Promise<any[]> {
  if (from === to) throw badRequest("Source and target environments must differ");
  const items: any[] = [];
  // FieldDefs — new in `from` but absent in `to`, or changed.
  const fromFields = await db().fieldDef.findMany({ where: { orgId, environment: from } });
  const toFields = await db().fieldDef.findMany({ where: { orgId, environment: to } });
  const toByKey = new Map(toFields.map((f) => [`${f.objectType}:${f.key}`, f]));
  for (const f of fromFields) {
    const existing = toByKey.get(`${f.objectType}:${f.key}`);
    if (!existing) {
      items.push({ entity: "fieldDef", op: "create", key: `${f.objectType}:${f.key}`, data: { objectType: f.objectType, key: f.key, label: f.label, type: f.type, required: f.required, options: f.options, order: f.order } });
    } else if ((f as any).updatedAt && (existing as any).updatedAt && new Date((existing as any).updatedAt).getTime() < new Date((f as any).updatedAt).getTime()) {
      items.push({ entity: "fieldDef", op: "update", key: `${f.objectType}:${f.key}`, data: { label: f.label, type: f.type, required: f.required, options: f.options, order: f.order } });
    }
  }
  // Agents — new in `from`.
  const fromAgents = await db().agent.findMany({ where: { orgId, environment: from } });
  const toAgents = await db().agent.findMany({ where: { orgId, environment: to } });
  const toAgentByKind = new Map(toAgents.map((a) => [a.kind, a]));
  for (const a of fromAgents) {
    if (!toAgentByKind.has(a.kind)) {
      items.push({ entity: "agent", op: "create", key: a.kind, data: { name: a.name, kind: a.kind, trigger: a.trigger, rules: a.rules, tools: a.tools, tierPolicy: a.tierPolicy, memoryEnabled: a.memoryEnabled, active: a.active } });
    }
  }
  return items;
}

export async function createChangeSet(orgId: string, environment: string, input: {
  name: string; description?: string | null; items?: { entity: string; op: string; key: string; data?: Record<string, unknown> }[]; fromEnv?: string | null; toEnv?: string | null;
}, actor: Actor): Promise<any> {
  const name = (input.name ?? "").trim();
  if (!name) throw badRequest("Change set name is required");
  const items = (input.items ?? []) as any[];
  if (!items.length) throw badRequest("A change set needs at least one item");
  for (const it of items) {
    if (!["fieldDef", "agent", "featureFlag"].includes(it.entity)) throw badRequest(`Unsupported change-set entity: ${it.entity}`);
    if (!["create", "update", "delete"].includes(it.op)) throw badRequest(`Unsupported change-set op: ${it.op}`);
  }
  const cs = await db().changeSet.create({
    data: { orgId, environment, name, description: input.description ?? null, items: items as any, fromEnv: input.fromEnv ?? null, toEnv: input.toEnv ?? null, createdBy: actor.id },
  });
  await emitEvent({ orgId, environment, type: "changeset.created", entity: "changeSet", entityId: cs.id, actorId: actor.id, payload: { name, itemCount: items.length } });
  return cs;
}

export async function listChangeSets(orgId: string, environment: string): Promise<any[]> {
  return db().changeSet.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" } });
}

/** Promote a change set into the target environment — replays each item and
 *  records the outcome. Emits changeset.promoted (blueprint event). */
export async function promoteChangeSet(orgId: string, environment: string, id: string, toEnv: string, actor: Actor): Promise<any> {
  const cs = await db().changeSet.findFirst({ where: { id, orgId, environment } });
  if (!cs) throw notFound("Change set not found");
  if (cs.status === "promoted") throw badRequest("Change set already promoted");
  const items = (cs.items ?? []) as { entity: string; op: string; key: string; data?: Record<string, unknown> }[];
  let applied = 0;
  const errors: string[] = [];
  for (const item of items) {
    try {
      if (item.entity === "fieldDef") {
        const key = item.key.includes(":") ? item.key.split(":")[1] : item.key;
        const objectType = (item.data as any)?.objectType ?? (item.key.includes(":") ? item.key.split(":")[0] : "contact");
        if (item.op === "delete") {
          await db().fieldDef.deleteMany({ where: { orgId, environment: toEnv, objectType, key } });
          await emitEvent({ orgId, environment: toEnv, type: "schema.field_deleted", entity: "field", entityId: id, actorId: actor.id, payload: { objectType, key, via: "changeset" } });
        } else {
          const existing = await db().fieldDef.findFirst({ where: { orgId, environment: toEnv, objectType, key } });
          const data: Record<string, unknown> = { ...(item.data ?? {}), orgId, environment: toEnv };
          if (existing) {
            const { objectType: _o, key: _k, ...rest } = data;
            await db().fieldDef.update({ where: { id: existing.id }, data: rest as any });
          } else {
            await db().fieldDef.create({ data: data as any });
          }
        }
      } else if (item.entity === "agent") {
        const kind = item.key;
        const existing = await db().agent.findFirst({ where: { orgId, environment: toEnv, kind } });
        if (item.op === "delete") {
          if (existing) await db().agent.delete({ where: { id: existing.id } });
        } else if (existing) {
          const { name, kind: _k, ...rest } = item.data ?? {};
          await db().agent.update({ where: { id: existing.id }, data: { ...rest, name: name ?? existing.name } });
        } else {
          await db().agent.create({ data: { orgId, environment: toEnv, createdBy: actor.id, ...(item.data ?? {}) } as any });
        }
      } else if (item.entity === "featureFlag") {
        const existing = await db().featureFlag.findFirst({ where: { orgId, environment: toEnv, key: item.key } });
        const enabled = Boolean(item.data?.enabled ?? true);
        if (existing) {
          await db().featureFlag.update({ where: { id: existing.id }, data: { enabled } });
        } else {
          await db().featureFlag.create({ data: { orgId, environment: toEnv, key: item.key, label: item.key, enabled } });
        }
      }
      applied++;
    } catch (e: any) {
      errors.push(`${item.entity}:${item.key} — ${e?.message ?? "failed"}`);
    }
  }
  const status = errors.length && !applied ? "failed" : "promoted";
  const updated = await db().changeSet.update({
    where: { id }, data: { status, fromEnv: environment, toEnv, promotedBy: actor.id, promotedAt: new Date(), error: errors.length ? errors.join("; ") : null },
  });
  await emitEvent({ orgId, environment, type: "changeset.promoted", entity: "changeSet", entityId: id, actorId: actor.id, payload: { name: cs.name, fromEnv: environment, toEnv, applied, errors: errors.length } });
  return updated;
}

// ── Schema change safety (ecosystem.schema) ────────────────────────────────
// Change-impact analysis: before a custom field is deleted, scan every config
// surface that could reference it (segments, automations, agents, forms,
// reports, field permissions, record values) and report the impact.
export async function fieldImpact(orgId: string, environment: string, objectType: string, key: string): Promise<{ field: any; references: { surface: string; name: string; id: string; detail: string }[]; total: number; recordValues: number }> {
  const field = await db().fieldDef.findFirst({ where: { orgId, environment, objectType, key } });
  if (!field) throw notFound(`Field ${objectType}.${key} not found`);
  const refs: { surface: string; name: string; id: string; detail: string }[] = [];

  // Segments — criteria filters reference fields.
  const segments = await db().segment.findMany({ where: { orgId, environment } });
  for (const s of segments) {
    const filters = ((s.criteria as any)?.filters ?? []) as { field?: string }[];
    if (filters.some((f) => f.field === key)) {
      refs.push({ surface: "segment", name: s.name, id: s.id, detail: "used as a segment filter" });
    }
  }
  // Automations — conditions + actions.
  const automations = await db().automation.findMany({ where: { orgId, environment } });
  for (const a of automations) {
    const conditions = (a.conditions ?? []) as { field?: string }[];
    const actions = (a.actions ?? []) as Record<string, unknown>[];
    const condHit = conditions.some((c) => c.field === key);
    const actHit = actions.some((x) => JSON.stringify(x).includes(`"${key}"`));
    if (condHit || actHit) {
      refs.push({ surface: "automation", name: a.name, id: a.id, detail: condHit ? "used in a condition" : "referenced in an action" });
    }
  }
  // Agents — rules.
  const agents = await db().agent.findMany({ where: { orgId, environment } });
  for (const ag of agents) {
    const rules = (ag.rules ?? []) as { field?: string }[];
    if (rules.some((r) => r.field === key)) {
      refs.push({ surface: "agent", name: ag.name, id: ag.id, detail: "used in an agent rule" });
    }
  }
  // Lead forms — exposed fields.
  const forms = await db().leadForm.findMany({ where: { orgId } });
  for (const f of forms) {
    const fields = (f.fields ?? []) as { key?: string }[];
    if (fields.some((x) => x.key === key)) {
      refs.push({ surface: "leadForm", name: f.name, id: f.id, detail: "exposed on the form" });
    }
  }
  // Reports — metric keys.
  const reports = await db().report.findMany({ where: { orgId, environment } });
  for (const r of reports) {
    const keys = (r.keys ?? []) as string[];
    if (keys.includes(key) || JSON.stringify(r.keys).includes(`.${key}`)) {
      refs.push({ surface: "report", name: r.name, id: r.id, detail: "referenced in report keys" });
    }
  }
  // Field permissions — a permission row exists for this field.
  const perms = await (db() as any).fieldPermission.findMany({ where: { orgId, environment, objectType, fieldKey: key } }).catch(() => []);
  if (perms.length) {
    refs.push({ surface: "fieldPermission", name: `${objectType}.${key}`, id: perms[0].id, detail: `${perms.length} permission row(s)` });
  }
  // Record values — custom values stored on real records.
  const recordValues = await countCustomValues(orgId, environment, objectType, key);

  return { field, references: refs, total: refs.length, recordValues };
}

async function countCustomValues(orgId: string, environment: string, objectType: string, key: string): Promise<number> {
  const model = (db() as any)[objectType];
  if (!model) return 0;
  try {
    const rows = await model.findMany({ where: { orgId, environment }, select: { custom: true } });
    let n = 0;
    for (const r of rows) {
      const custom = (r.custom ?? {}) as Record<string, unknown>;
      if (custom[key] !== undefined && custom[key] !== null && custom[key] !== "") n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Safe delete: refuses when the field is referenced by config surfaces or
 *  has stored values; otherwise deletes and emits schema.field_deleted. */
export async function safeDeleteField(orgId: string, environment: string, id: string, actor: Actor): Promise<{ deleted: boolean; impact?: any }> {
  const field = await db().fieldDef.findUnique({ where: { id } });
  if (!field || field.orgId !== orgId) throw notFound("Field not found");
  const impact = await fieldImpact(orgId, field.environment ?? environment, field.objectType, field.key);
  if (impact.total > 0 || impact.recordValues > 0) {
    throw badRequest(`Field is in use: ${impact.total} config reference(s), ${impact.recordValues} record value(s). Remove references first (see docs/43-schema-change-safety.md).`);
  }
  await db().fieldDef.delete({ where: { id } });
  await emitEvent({ orgId, environment: field.environment ?? environment, type: "schema.field_deleted", entity: "field", entityId: id, actorId: actor.id, payload: { objectType: field.objectType, key: field.key, via: "safe-delete" } });
  return { deleted: true };
}

// ── Ecosystem overview (dashboard data) ────────────────────────────────────
export async function ecosystemOverview(orgId: string, environment: string): Promise<any> {
  const [listings, apps, partners, changeSets] = await Promise.all([
    listListings(orgId, environment),
    listApps(orgId, environment),
    listPartners(orgId, environment),
    listChangeSets(orgId, environment),
  ]);
  return {
    listings: listings.length,
    installed: apps.filter((a) => a.status === "installed").length,
    partners: partners.filter((p) => p.status === "active").length,
    partnerDeals: partners.reduce((s, p) => s + p.dealCount, 0),
    commissionEarned: Math.round(partners.reduce((s, p) => s + p.commissionEarned, 0) * 100) / 100,
    pipelineValue: Math.round(partners.reduce((s, p) => s + p.pipelineValue, 0) * 100) / 100,
    changeSets: changeSets.filter((c) => c.status === "draft").length,
    promoted: changeSets.filter((c) => c.status === "promoted").length,
  };
}
