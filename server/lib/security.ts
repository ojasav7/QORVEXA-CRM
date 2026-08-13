// Phase 14 — Enterprise Security, Compliance & Governance
// (blueprint §Phase 14, spec docs/44-spec-phase14.md, ADR-026)
//
// One module for the whole security surface so the discipline is central:
//   • MFA (TOTP RFC 6238 + one-time recovery codes)          [sec.mfa]
//   • DB-backed sessions + device management (revocation)     [sec.sessions]
//   • IP restriction (CIDR allowlist enforced per request)    [sec.sessions]
//   • Security alerts + security.threat_detected              [blueprint entity]
//   • Consent records (consent.updated) + DSRs (privacy)      [sec.consent]
//   • Retention policies (delete/anonymize, retention.policy_applied)
//   • Vendor/sub-processor transparency
//   • Status page: uptime ticks + incidents                   [sec.status]
//   • SCIM 2.0 provisioning (Users + Groups)                  [sec.scim]
//   • i18n: locale/currency/timezone config + translation QA  [i18n.localization]
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db";
import { badRequest, forbidden, notFound, unauthorized } from "./http";
import { emitEvent } from "./events";
import { env } from "../env";
import type { SessionUser } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// TOTP (RFC 6238) — implemented with node:crypto, no dependencies
// ─────────────────────────────────────────────────────────────────────────────

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** Verify a 6-digit code against the current ±1 30s windows (clock skew tolerant). */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const now = Date.now();
  for (const skew of [0, -1, 1]) {
    if (totpCode(secret, now + skew * 30_000) === code) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) codes.push(crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 10));
  return codes;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Verify a recovery code against the user's stored hashes; consumes it on match. */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const user = await db().user.findUnique({ where: { id: userId } });
  const hashes = ((user?.mfaRecoveryHashes as string[]) ?? []) as string[];
  const target = sha256(code.trim().toUpperCase());
  const idx = hashes.indexOf(target);
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  await db().user.update({ where: { id: userId }, data: { mfaRecoveryHashes: hashes } });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-backed sessions + device management (the Phase 14 cookie upgrade)
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (org policy can shorten)

function sign(payload: string): string {
  return crypto.createHmac("sha256", env.sessionSecret).update(payload).digest("base64url");
}

/**
 * Issue a DB-backed session for a just-authenticated user and return the
 * signed cookie value. The HMAC payload now embeds `sessionId`; loadSession
 * checks the SecuritySession row (revoked / expired) on every request and
 * falls back to the payload user for legacy cookies created before Phase 14.
 */
export async function issueSession(user: SessionUser, req: Request): Promise<string> {
  const now = Date.now();
  const session = await db().securitySession.create({
    data: {
      orgId: user.orgId,
      userId: user.id,
      device: deviceLabel(req),
      ip: clientIp(req),
      location: "Derived from IP",
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + SESSION_TTL_MS),
    },
  });
  const body = Buffer.from(
    JSON.stringify({ ...user, sessionId: session.id, exp: now + SESSION_TTL_MS }),
    "utf8"
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

function deviceLabel(req: Request): string {
  const ua = req.headers["user-agent"];
  if (!ua || typeof ua !== "string") return "Unknown device";
  const os = ua.match(/\((.*?)\)/)?.[1]?.split(";")[0]?.trim() ?? "Unknown OS";
  const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[\/\s](\d+)/)?.[0] ?? "Browser";
  return `${browser} · ${os}`.slice(0, 80);
}

export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  const direct = req.socket?.remoteAddress;
  return direct && direct !== "::1" && direct !== "::ffff:127.0.0.1" ? direct.replace(/^::ffff:/, "") : "127.0.0.1";
}

/**
 * Resolve a session cookie. Returns the user or null. Also refreshes the
 * session row's lastSeenAt (device management visibility) and rejects revoked
 * or expired DB sessions. Legacy HMAC cookies without a sessionId still work.
 */
export async function resolveSession(raw: string, req: Request): Promise<SessionUser | null> {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    const user: SessionUser = { id: parsed.id, orgId: parsed.orgId, email: parsed.email, name: parsed.name, role: parsed.role };
    const sessionId = parsed.sessionId as string | undefined;
    if (sessionId) {
      const session = await db().securitySession.findUnique({ where: { id: sessionId } });
      if (!session || session.revokedAt) return null;
      if (session.expiresAt.getTime() < Date.now()) return null;
      if (session.userId !== user.id) return null;
      // Opportunistic lastSeen refresh (no await blocking the request path is fine — fire & forget is avoided; this is cheap).
      await db().securitySession
        .updateMany({ where: { id: session.id, userId: user.id }, data: { lastSeenAt: new Date(), ip: clientIp(req) } })
        .catch(() => undefined);
    }
    return user;
  } catch {
    return null;
  }
}

export async function revokeSession(orgId: string, sessionId: string, userId?: string) {
  const where: { id: string; orgId: string; userId?: string } = { id: sessionId, orgId };
  if (userId) where.userId = userId;
  const updated = await db().securitySession.updateMany({ where, data: { revokedAt: new Date() } });
  if (updated.count === 0) throw notFound("Session not found");
}

// ─────────────────────────────────────────────────────────────────────────────
// IP restriction (CIDR allowlist) + org security settings
// ─────────────────────────────────────────────────────────────────────────────

export type OrgSecuritySettings = {
  ipRestrictionEnabled: boolean;
  ipAllowlist: string[];
  requireMfa: boolean;
  sessionTtlDays: number;
  encryption: { atRest: boolean; inTransit: boolean; fieldLevel: string[] };
};

export async function orgSecuritySettings(orgId: string): Promise<OrgSecuritySettings> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const s = ((org?.settings ?? {}) as Record<string, unknown>).security as Record<string, unknown> | undefined;
  return {
    ipRestrictionEnabled: Boolean(s?.ipRestrictionEnabled),
    ipAllowlist: Array.isArray(s?.ipAllowlist) ? (s.ipAllowlist as string[]).map(String) : [],
    requireMfa: Boolean(s?.requireMfa),
    sessionTtlDays: typeof s?.sessionTtlDays === "number" ? (s.sessionTtlDays as number) : 30,
    encryption: {
      atRest: s?.encryption ? Boolean((s.encryption as Record<string, unknown>).atRest) : false,
      inTransit: s?.encryption ? Boolean((s.encryption as Record<string, unknown>).inTransit) : false,
      fieldLevel: Array.isArray(s?.encryption && (s.encryption as Record<string, unknown>).fieldLevel)
        ? ((s.encryption as Record<string, unknown>).fieldLevel as string[]).map(String)
        : [],
    },
  };
}

export async function updateSecuritySettings(orgId: string, patch: Partial<OrgSecuritySettings>) {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound("Organization not found");
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const current = await orgSecuritySettings(orgId);
  const next: OrgSecuritySettings = {
    ...current,
    ...patch,
    encryption: { ...current.encryption, ...(patch.encryption ?? {}) },
  };
  settings.security = next;
  await db().organization.update({ where: { id: orgId }, data: { settings } });
  return next;
}

/** IPv4/IPv6-lite CIDR match — exact IPs and a.b.c.d/n ranges (IPv4). */
export function cidrMatch(ip: string, cidr: string): boolean {
  const candidate = ip.replace(/^::ffff:/, "");
  const c = cidr.trim();
  if (c === "*" || c === "0.0.0.0/0" || c === "::/0") return true;
  if (!c.includes("/")) return candidate === c;
  const [net, bitsRaw] = c.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(candidate);
  const netInt = ipv4ToInt(net);
  if (ipInt === null || netInt === null) return candidate === net;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  return allowlist.some((c) => cidrMatch(ip, c));
}

// ─────────────────────────────────────────────────────────────────────────────
// Security alerts (blueprint entity) + security.threat_detected
// ─────────────────────────────────────────────────────────────────────────────

export type NewAlert = {
  orgId: string;
  environment?: string;
  severity?: string;
  category: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  actorId?: string;
};

export async function createSecurityAlert(a: NewAlert): Promise<void> {
  const alert = await db().securityAlert.create({
    data: {
      orgId: a.orgId,
      environment: a.environment ?? "production",
      severity: a.severity ?? "medium",
      category: a.category,
      title: a.title,
      message: a.message,
      details: (a.details ?? {}) as object,
      createdBy: a.actorId ?? "system",
    },
  });
  // Threats (severity ≥ medium) go to the event bus — the blueprint event.
  if (a.severity === "high" || a.severity === "critical" || (a.severity ?? "medium") === "medium") {
    await emitEvent({
      orgId: a.orgId,
      environment: a.environment ?? "production",
      type: "security.threat_detected",
      entity: "securityAlert",
      entityId: alert.id,
      actorId: a.actorId ?? alert.createdBy,
      payload: { severity: alert.severity, category: alert.category, title: alert.title, message: alert.message },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consent records + privacy center + data-subject requests
// ─────────────────────────────────────────────────────────────────────────────

export const CONSENT_PURPOSES = ["marketing", "analytics", "processing", "communications"] as const;

export async function setConsent(input: {
  orgId: string;
  environment?: string;
  contactId?: string;
  contactEmail: string;
  purpose: string;
  status: string; // granted | withdrawn | pending
  source?: string;
  actorId: string;
}) {
  if (!CONSENT_PURPOSES.includes(input.purpose as (typeof CONSENT_PURPOSES)[number])) {
    throw badRequest(`Unknown consent purpose: ${input.purpose}`);
  }
  if (!["granted", "withdrawn", "pending"].includes(input.status)) {
    throw badRequest(`Unknown consent status: ${input.status}`);
  }
  const environment = input.environment ?? "production";
  const email = input.contactEmail.trim().toLowerCase();
  const existing = await db().consentRecord.findFirst({
    where: { orgId: input.orgId, contactEmail: email, purpose: input.purpose },
  });
  const now = new Date();
  let record;
  if (existing) {
    record = await db().consentRecord.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        grantedAt: input.status === "granted" ? (existing.grantedAt ?? now) : existing.grantedAt,
        withdrawnAt: input.status === "withdrawn" ? now : existing.withdrawnAt,
        source: input.source ?? existing.source,
        contactId: input.contactId ?? existing.contactId,
        updatedAt: now,
      },
    });
  } else {
    record = await db().consentRecord.create({
      data: {
        orgId: input.orgId,
        environment,
        contactId: input.contactId,
        contactEmail: email,
        purpose: input.purpose,
        status: input.status,
        source: input.source ?? "manual",
        grantedAt: input.status === "granted" ? now : null,
        withdrawnAt: input.status === "withdrawn" ? now : null,
        meta: { via: input.source ?? "manual" },
      },
    });
  }
  await emitEvent({
    orgId: input.orgId,
    environment,
    type: "consent.updated",
    entity: "consentRecord",
    entityId: record.id,
    actorId: input.actorId,
    payload: { contactEmail: email, purpose: input.purpose, status: input.status, source: input.source ?? "manual" },
  });
  return record;
}

export async function createDsr(input: {
  orgId: string;
  environment?: string;
  type: string; // access | export | delete | rectify
  requesterEmail: string;
  notes?: string;
  actorId?: string;
}) {
  if (!["access", "export", "delete", "rectify"].includes(input.type)) {
    throw badRequest(`Unknown DSR type: ${input.type}`);
  }
  const email = input.requesterEmail.trim().toLowerCase();
  const contact = await db().contact.findFirst({ where: { orgId: input.orgId, email } });
  const dsr = await db().dataSubjectRequest.create({
    data: {
      orgId: input.orgId,
      environment: input.environment ?? "production",
      type: input.type,
      requesterEmail: email,
      contactId: contact?.id,
      contactEmail: email,
      notes: input.notes,
      createdBy: input.actorId,
      meta: { contactFound: Boolean(contact) },
    },
  });
  await emitEvent({
    orgId: input.orgId,
    environment: input.environment ?? "production",
    type: "dsr.submitted",
    entity: "dataSubjectRequest",
    entityId: dsr.id,
    actorId: input.actorId ?? "system",
    payload: { type: input.type, requesterEmail: email, contactFound: Boolean(contact) },
  });
  return dsr;
}

/**
 * Approve a DSR — the actual fulfillment.
 *  • export / access → a contact-scoped JSON bundle (record + deals + notes +
 *    tasks + consent) written to disk under portability/ (reuses that root).
 *  • delete → consent records + the contact row are removed (right to be forgotten).
 *  • rectify → clears the contact's PII (anonymized in place).
 */
export async function fulfillDsr(orgId: string, dsrId: string, actorId: string, notes?: string) {
  const dsr = await db().dataSubjectRequest.findFirst({ where: { id: dsrId, orgId } });
  if (!dsr) throw notFound("DSR not found");
  if (dsr.status === "completed") throw badRequest("DSR already completed");
  const email = dsr.requesterEmail;
  const meta: Record<string, unknown> = { ...(dsr.meta as object) };
  if (dsr.type === "delete") {
    const contact = await db().contact.findFirst({ where: { orgId, email } });
    if (contact) {
      await db().consentRecord.deleteMany({ where: { orgId, contactEmail: email } });
      await db().contact.delete({ where: { id: contact.id } });
      meta.deletedContact = contact.id;
    } else {
      await db().consentRecord.deleteMany({ where: { orgId, contactEmail: email } });
    }
  } else if (dsr.type === "rectify") {
    const contact = await db().contact.findFirst({ where: { orgId, email } });
    if (contact) {
      await db().contact.update({
        where: { id: contact.id },
        data: { firstName: "Anonymous", lastName: "User", email: `redacted-${contact.id}@qorvexa.dev`, phone: null, title: null },
      });
      meta.rectifiedContact = contact.id;
    }
  } else {
    // export / access — build the subject's bundle
    const contact = await db().contact.findFirst({ where: { orgId, email } });
    const bundle: Record<string, unknown> = {
      format: "qorvexa-dsr",
      type: dsr.type,
      exportedAt: new Date().toISOString(),
      requesterEmail: email,
      contact: contact ?? null,
      deals: contact ? await db().opportunity.findMany({ where: { orgId, contactId: contact.id }, take: 500 }) : [],
      notes: contact ? await db().note.findMany({ where: { orgId, contactId: contact.id }, take: 500 }) : [],
      tasks: contact ? await db().task.findMany({ where: { orgId, contactId: contact.id }, take: 500 }) : [],
      consent: await db().consentRecord.findMany({ where: { orgId, contactEmail: email }, take: 500 }),
    };
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync("portability", { recursive: true });
    const fileName = `dsr-${dsr.type}-${email.replace(/[^a-z0-9@.-]/gi, "_")}-${Date.now()}.json`;
    fs.writeFileSync(path.join("portability", fileName), JSON.stringify(bundle, null, 2));
    meta.bundlePath = `portability/${fileName}`;
  }
  await db().dataSubjectRequest.update({
    where: { id: dsr.id },
    data: { status: "completed", completedAt: new Date(), notes: notes ?? dsr.notes, meta },
  });
  await emitEvent({
    orgId,
    environment: dsr.environment,
    type: "dsr.completed",
    entity: "dataSubjectRequest",
    entityId: dsr.id,
    actorId,
    payload: { type: dsr.type, requesterEmail: email },
  });
  return { ...dsr, status: "completed", meta };
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention policies + retention.policy_applied
// ─────────────────────────────────────────────────────────────────────────────

// PII fields per entity (used by the anonymize action).
const ANONYMIZE_FIELDS: Record<string, Record<string, unknown>> = {
  contact: { firstName: "Anonymous", lastName: "User", email: (id: string) => `redacted-${id}@qorvexa.dev`, phone: null },
  lead: { firstName: "Anonymous", lastName: "User", email: (id: string) => `redacted-${id}@qorvexa.dev`, phone: null, company: null },
  account: { name: (id: string) => `Redacted account ${id.slice(-6)}`, website: null, phone: null },
};

const RETENTION_MODELS: Record<string, "contact" | "lead" | "account" | "opportunity" | "ticket"> = {
  contact: "contact",
  lead: "lead",
  account: "account",
  opportunity: "opportunity",
  ticket: "ticket",
};

export const RETENTION_ENTITIES = Object.keys(RETENTION_MODELS);

export async function runRetentionScan(orgId: string, policyId?: string, actorId = "system") {
  const where: { orgId: string; id?: string } = { orgId };
  if (policyId) where.id = policyId;
  const policies = await db().retentionPolicy.findMany({ where });
  const summary: { policy: string; entity: string; action: string; deleted: number; anonymized: number; cutoff: string }[] = [];
  for (const policy of policies) {
    if (policy.status !== "active") continue;
    const model = RETENTION_MODELS[policy.entity];
    if (!model) continue;
    const cutoff = new Date(Date.now() - policy.olderThanDays * 24 * 60 * 60 * 1000);
    const delegate = (db() as any)[model];
    let deleted = 0;
    let anonymized = 0;
    if (policy.action === "delete") {
      const res = await delegate.deleteMany({ where: { orgId, environment: policy.environment, createdAt: { lt: cutoff } } });
      deleted = res.count;
    } else {
      const rows = await delegate.findMany({
        where: { orgId, environment: policy.environment, createdAt: { lt: cutoff } },
        select: { id: true },
      });
      const fieldMap = ANONYMIZE_FIELDS[policy.entity] ?? {};
      for (const row of rows) {
        const data: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(fieldMap)) {
          data[key] = typeof val === "function" ? (val as (id: string) => unknown)(row.id) : val;
        }
        await delegate.update({ where: { id: row.id }, data });
        anonymized++;
      }
    }
    await db().retentionPolicy.update({
      where: { id: policy.id },
      data: { lastRunAt: new Date(), lastProcessed: deleted + anonymized },
    });
    if (deleted + anonymized > 0) {
      await emitEvent({
        orgId,
        environment: policy.environment,
        type: "retention.policy_applied",
        entity: "retentionPolicy",
        entityId: policy.id,
        actorId,
        payload: { policy: policy.name, entity: policy.entity, action: policy.action, deleted, anonymized, cutoff: cutoff.toISOString() },
      });
    }
    summary.push({
      policy: policy.name,
      entity: policy.entity,
      action: policy.action,
      deleted,
      anonymized,
      cutoff: cutoff.toISOString(),
    });
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status page — uptime ticks + incidents
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_COMPONENTS = ["api", "webhooks", "email", "app"] as const;

export async function recordUptimeTick(
  orgId: string,
  component: string,
  status: "up" | "degraded" | "down",
  latencyMs?: number,
  message?: string
) {
  await db().uptimeEvent.create({ data: { orgId, component, status, latencyMs, message } });
}

/** Derived uptime report: per-component % over the window + open incidents. */
export async function uptimeReport(orgId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = await db().uptimeEvent.findMany({ where: { orgId, checkedAt: { gte: since } }, orderBy: { checkedAt: "desc" } });
  const components: Record<string, { up: number; degraded: number; down: number; total: number; uptimePct: number }> = {};
  for (const c of STATUS_COMPONENTS) components[c] = { up: 0, degraded: 0, down: 0, total: 0, uptimePct: 100 };
  for (const e of events) {
    const c = components[e.component] ?? { up: 0, degraded: 0, down: 0, total: 0, uptimePct: 100 };
    c[e.status as "up"]++;
    c.total++;
  }
  for (const c of Object.values(components)) {
    c.uptimePct = c.total ? Math.round((c.up / c.total) * 1000) / 10 : 100;
  }
  const incidents = await db().statusIncident.findMany({
    where: { orgId, status: { not: "resolved" } },
    orderBy: { startedAt: "desc" },
  });
  return { days, components, incidents, uptime: { last90: await pct90(orgId), last30: await pct30(orgId) } };
}

async function pct90(orgId: string) {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db().uptimeEvent.findMany({ where: { orgId, checkedAt: { gte: since } }, select: { status: true } });
  if (!rows.length) return 100;
  return Math.round((rows.filter((r) => r.status === "up").length / rows.length) * 1000) / 10;
}

async function pct30(orgId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db().uptimeEvent.findMany({ where: { orgId, checkedAt: { gte: since } }, select: { status: true } });
  if (!rows.length) return 100;
  return Math.round((rows.filter((r) => r.status === "up").length / rows.length) * 1000) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCIM 2.0 provisioning (Users + Groups)
// ─────────────────────────────────────────────────────────────────────────────

export async function scimListUsers(orgId: string) {
  const users = await db().user.findMany({ where: { orgId }, orderBy: { email: "asc" } });
  return users.map((u) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: u.id,
    externalId: u.scimExternalId,
    userName: u.email,
    name: { givenName: u.name.split(" ")[0] ?? u.name, familyName: u.name.split(" ").slice(1).join(" ") || undefined },
    emails: [{ value: u.email, primary: true }],
    active: u.active,
    roles: [{ value: u.role }],
    meta: { resourceType: "User", created: u.createdAt?.toISOString(), lastModified: u.lastLoginAt?.toISOString() ?? u.createdAt?.toISOString() },
  }));
}

export async function scimCreateUser(orgId: string, body: {
  userName?: string;
  emails?: { value: string }[];
  externalId?: string;
  active?: boolean;
  name?: { givenName?: string; familyName?: string };
}) {
  const email = (body.userName ?? body.emails?.[0]?.value ?? "").toLowerCase().trim();
  if (!email || !email.includes("@")) throw badRequest("SCIM user requires a userName or emails[0].value");
  const existing = await db().user.findUnique({ where: { email } });
  if (existing) throw badRequest(`User already exists: ${email}`);
  const bcrypt = await import("bcryptjs");
  const randomPassword = crypto.randomBytes(16).toString("hex");
  const name = [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ") || email.split("@")[0];
  const user = await db().user.create({
    data: {
      orgId,
      email,
      name,
      passwordHash: await bcrypt.hash(randomPassword, 10),
      role: "rep",
      active: body.active ?? true,
      scimExternalId: body.externalId,
    },
  });
  await emitEvent({ orgId, type: "scim.user_provisioned", entity: "user", entityId: user.id, actorId: "scim", payload: { email } });
  return user;
}

export async function scimPatchUser(orgId: string, id: string, patch: { active?: boolean; externalId?: string; name?: { givenName?: string; familyName?: string } }) {
  const user = await db().user.findFirst({ where: { id, orgId } });
  if (!user) throw notFound("SCIM user not found");
  const data: { active?: boolean; scimExternalId?: string; name?: string } = {};
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.externalId !== undefined) data.scimExternalId = patch.externalId;
  if (patch.name) {
    data.name = [patch.name.givenName, patch.name.familyName].filter(Boolean).join(" ") || user.name;
  }
  await db().user.update({ where: { id }, data });
  await emitEvent({ orgId, type: "scim.user_updated", entity: "user", entityId: id, actorId: "scim", payload: { active: patch.active } });
  return { ok: true };
}

export const SCIM_ROLES = ["admin", "manager", "rep"] as const;

export async function scimListGroups(orgId: string) {
  const groups = await db().scimGroup.findMany({ where: { orgId } });
  return groups.map((g) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: g.id,
    externalId: g.externalId,
    displayName: g.displayName,
    members: (g.memberIds as string[]).map((id) => ({ value: id, type: "User" })),
    meta: { resourceType: "Group", role: g.role },
  }));
}

export async function scimCreateGroup(orgId: string, body: { displayName?: string; externalId?: string; members?: { value?: string }[] }) {
  const displayName = body.displayName?.trim();
  if (!displayName) throw badRequest("SCIM group requires a displayName");
  const role = displayName.toLowerCase();
  if (!(SCIM_ROLES as readonly string[]).includes(role)) {
    throw badRequest(`SCIM group displayName must be one of: ${SCIM_ROLES.join(", ")}`);
  }
  const externalId = body.externalId ?? `group-${crypto.randomBytes(6).toString("hex")}`;
  const memberIds = (body.members ?? []).map((m) => m.value ?? "").filter(Boolean);
  const group = await db().scimGroup.create({
    data: { orgId, externalId, displayName, role, memberIds: memberIds as object },
  });
  if (memberIds.length) {
    await db().user.updateMany({ where: { id: { in: memberIds }, orgId }, data: { role } });
  }
  await emitEvent({ orgId, type: "scim.group_provisioned", entity: "scimGroup", entityId: group.id, actorId: "scim", payload: { displayName, role, members: memberIds.length } });
  return group;
}

export async function scimUpdateGroup(orgId: string, id: string, body: { displayName?: string; members?: { value?: string }[] }) {
  const group = await db().scimGroup.findFirst({ where: { id, orgId } });
  if (!group) throw notFound("SCIM group not found");
  const displayName = body.displayName?.trim() ?? group.displayName;
  const role = displayName.toLowerCase();
  if (!(SCIM_ROLES as readonly string[]).includes(role)) throw badRequest(`SCIM group displayName must be one of: ${SCIM_ROLES.join(", ")}`);
  const memberIds = (body.members ?? []).map((m) => m.value ?? "").filter(Boolean);
  await db().scimGroup.update({ where: { id }, data: { displayName, role, memberIds: memberIds as object } });
  if (memberIds.length) await db().user.updateMany({ where: { id: { in: memberIds }, orgId }, data: { role } });
  await emitEvent({ orgId, type: "scim.group_updated", entity: "scimGroup", entityId: id, actorId: "scim", payload: { displayName, role } });
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// i18n — org locale/currency/timezone config + translation catalog QA
// ─────────────────────────────────────────────────────────────────────────────

export const I18N_LOCALES = ["en", "es", "fr", "de", "ja", "pt-BR"] as const;
export const I18N_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "BRL", "INR", "CAD", "AUD"] as const;
export const I18N_TIMEZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Kolkata", "Australia/Sydney", "America/Sao_Paulo"] as const;

export type OrgI18n = { locale: string; timezone: string; currency: string };

export async function orgI18n(orgId: string): Promise<OrgI18n> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const s = ((org?.settings ?? {}) as Record<string, unknown>).i18n as Record<string, unknown> | undefined;
  return {
    locale: typeof s?.locale === "string" ? (s.locale as string) : "en",
    timezone: typeof s?.timezone === "string" ? (s.timezone as string) : "UTC",
    currency: typeof s?.currency === "string" ? (s.currency as string) : "USD",
  };
}

export async function updateOrgI18n(orgId: string, patch: Partial<OrgI18n>) {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound("Organization not found");
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const current = await orgI18n(orgId);
  const next: OrgI18n = { ...current, ...patch };
  if (!(I18N_LOCALES as readonly string[]).includes(next.locale as (typeof I18N_LOCALES)[number])) {
    throw badRequest(`Unknown locale: ${next.locale}`);
  }
  if (!(I18N_CURRENCIES as readonly string[]).includes(next.currency as (typeof I18N_CURRENCIES)[number])) {
    throw badRequest(`Unknown currency: ${next.currency}`);
  }
  if (!(I18N_TIMEZONES as readonly string[]).includes(next.timezone as (typeof I18N_TIMEZONES)[number])) {
    throw badRequest(`Unknown timezone: ${next.timezone}`);
  }
  settings.i18n = next;
  await db().organization.update({ where: { id: orgId }, data: { settings } });
  return next;
}

/** The app's source-of-truth UI strings (en). Localization QA measures how many are translated. */
export const TRANSLATION_CATALOG: { key: string; en: string }[] = [
  { key: "nav.dashboard", en: "Dashboard" },
  { key: "nav.contacts", en: "Contacts" },
  { key: "nav.deals", en: "Deals" },
  { key: "nav.tickets", en: "Tickets" },
  { key: "nav.settings", en: "Settings" },
  { key: "common.save", en: "Save" },
  { key: "common.cancel", en: "Cancel" },
  { key: "common.delete", en: "Delete" },
  { key: "common.search", en: "Search" },
  { key: "common.create", en: "Create" },
  { key: "common.edit", en: "Edit" },
  { key: "common.close", en: "Close" },
  { key: "common.apply", en: "Apply" },
  { key: "common.filter", en: "Filter" },
  { key: "common.export", en: "Export" },
  { key: "common.import", en: "Import" },
  { key: "common.upload", en: "Upload" },
  { key: "common.download", en: "Download" },
  { key: "common.confirm", en: "Confirm" },
  { key: "common.back", en: "Back" },
  { key: "common.next", en: "Next" },
  { key: "common.previous", en: "Previous" },
  { key: "auth.login", en: "Log in" },
  { key: "auth.logout", en: "Log out" },
  { key: "auth.register", en: "Create account" },
  { key: "auth.email", en: "Email address" },
  { key: "auth.password", en: "Password" },
  { key: "auth.forgot", en: "Forgot password?" },
  { key: "record.owner", en: "Owner" },
  { key: "record.created", en: "Created" },
  { key: "record.updated", en: "Updated" },
  { key: "status.active", en: "Active" },
  { key: "status.inactive", en: "Inactive" },
  { key: "status.pending", en: "Pending" },
  { key: "status.resolved", en: "Resolved" },
  { key: "status.closed", en: "Closed" },
  { key: "status.open", en: "Open" },
  { key: "field.amount", en: "Amount" },
  { key: "field.name", en: "Name" },
  { key: "field.email", en: "Email" },
  { key: "field.phone", en: "Phone" },
  { key: "field.company", en: "Company" },
  { key: "field.industry", en: "Industry" },
  { key: "field.notes", en: "Notes" },
];

export const TRANSLATION_SAMPLE: Record<string, Record<string, string>> = {
  es: { "nav.dashboard": "Panel", "common.save": "Guardar", "common.cancel": "Cancelar", "auth.login": "Iniciar sesión", "field.email": "Correo electrónico" },
  fr: { "nav.dashboard": "Tableau de bord", "common.save": "Enregistrer", "common.cancel": "Annuler", "auth.login": "Se connecter", "field.name": "Nom" },
  de: { "nav.dashboard": "Übersicht", "common.save": "Speichern", "common.cancel": "Abbrechen", "auth.login": "Anmelden", "field.amount": "Betrag" },
  ja: { "nav.dashboard": "ダッシュボード", "common.save": "保存", "common.cancel": "キャンセル", "auth.login": "ログイン", "common.search": "検索" },
  "pt-BR": { "nav.dashboard": "Painel", "common.save": "Salvar", "common.cancel": "Cancelar", "auth.login": "Entrar", "field.phone": "Telefone" },
};

/** Seed the translation catalog for an org (idempotent). Returns counts per locale. */
export async function seedTranslationCatalog(orgId: string): Promise<{ en: number; partial: number }> {
  const existing = await db().translationEntry.count({ where: { orgId, locale: "en" } });
  if (existing) return { en: existing, partial: 5 };
  for (const entry of TRANSLATION_CATALOG) {
    await db().translationEntry.create({
      data: { orgId, locale: "en", key: entry.key, value: entry.en, status: "translated" },
    });
  }
  for (const [locale, map] of Object.entries(TRANSLATION_SAMPLE)) {
    for (const [key, value] of Object.entries(map)) {
      await db().translationEntry.create({ data: { orgId, locale, key, value, status: "translated" } });
    }
  }
  return { en: TRANSLATION_CATALOG.length, partial: Object.values(TRANSLATION_SAMPLE).reduce((a, m) => a + Object.keys(m).length, 0) };
}

/** Localization QA — per-locale translation completeness against the catalog. */
export async function translationQA(orgId: string) {
  const locales = (await db().translationEntry.findMany({ where: { orgId }, distinct: ["locale"] })).map((r) => r.locale);
  const rows = await db().translationEntry.findMany({ where: { orgId } });
  const byLocale: Record<string, Map<string, string>> = {};
  for (const r of rows) {
    (byLocale[r.locale] ??= new Map()).set(r.key, r.value);
  }
  const total = TRANSLATION_CATALOG.length;
  const localesOut: { locale: string; translated: number; missing: number; completenessPct: number; sample: { key: string; en: string; value?: string }[] }[] = [];
  for (const locale of [...locales].sort()) {
    const map = byLocale[locale] ?? new Map();
    const translated = TRANSLATION_CATALOG.filter((e) => map.has(e.key)).length;
    const missing = total - translated;
    localesOut.push({
      locale,
      translated,
      missing,
      completenessPct: Math.round((translated / total) * 1000) / 10,
      sample: TRANSLATION_CATALOG.slice(0, 5).map((e) => ({ key: e.key, en: e.en, value: map.get(e.key) })),
    });
  }
  return { total, locales: localesOut, overallPct: localesOut.length ? Math.round((localesOut.reduce((a, l) => a + l.completenessPct, 0) / localesOut.length) * 10) / 10 : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enforcement middleware — IP restriction + session checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mounted after loadSession on /api/* (and /api/scim). Enforces the org's IP
 * allowlist for session-authenticated users and raises a SecurityAlert when a
 * request is blocked. Token auth is checked separately by the SCIM routes.
 */
export function enforceSecurityPolicy(req: Request, _res: Response, next: NextFunction) {
  const user = (req as any).sessionUser as SessionUser | null;
  if (!user) return next();
  const policyPromise = (async () => {
    const policy = await orgSecuritySettings(user.orgId);
    if (policy.ipRestrictionEnabled) {
      const ip = clientIp(req);
      if (!ipAllowed(ip, policy.ipAllowlist)) {
        await createSecurityAlert({
          orgId: user.orgId,
          category: "ip",
          severity: "high",
          title: "Request blocked by IP allowlist",
          message: `Request from ${ip} was blocked by the org's IP restriction policy.`,
          details: { ip, path: req.path, method: req.method },
          actorId: user.id,
        });
        next(forbidden(`IP ${ip} is not allowed by this workspace's security policy`));
        return;
      }
    }
    next();
  })();
  policyPromise.catch((e) => next(e));
}

/** SCIM bearer-token auth — requires a valid ApiToken with the `scim` scope. */
export async function scimAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return next(unauthorized("SCIM requires a Bearer token"));
    const raw = auth.slice(7).trim();
    const { tokenSessionUser } = await import("./tokens");
    const tokenUser = await tokenSessionUser(raw);
    if (!tokenUser) return next(unauthorized("Invalid SCIM token"));
    const scopes = (tokenUser.scopes as string[]) ?? ["all"];
    if (!scopes.includes("scim") && !scopes.includes("all")) return next(forbidden("Token lacks the scim scope"));
    (req as any).scimOrgId = tokenUser.orgId as string;
    next();
  } catch {
    next(unauthorized("Invalid SCIM token"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine — retention scan + uptime ticks + session hygiene
// ─────────────────────────────────────────────────────────────────────────────

let engineTimer: NodeJS.Timeout | null = null;

export function startSecurityEngine() {
  if (engineTimer) return;
  const tick = async () => {
    try {
      const orgs = await db().organization.findMany({ select: { id: true }, take: 200 });
      for (const org of orgs) {
        // Retention — active policies only; scan is idempotent by cutoff.
        const active = await db().retentionPolicy.count({ where: { orgId: org.id, status: "active" } });
        if (active) await runRetentionScan(org.id).catch(() => undefined);
        // Uptime tick — ping the local health endpoint, record api component.
        try {
          const start = Date.now();
          const res = await fetch(`http://localhost:${env.port}/api/health`, { signal: AbortSignal.timeout(3000) });
          const body = (await res.json()) as { status?: string };
          const latency = Date.now() - start;
          const status = body.status === "ok" ? "up" : "degraded";
          await recordUptimeTick(org.id, "api", status, latency, status === "up" ? undefined : `health reported ${body.status}`);
        } catch {
          await recordUptimeTick(org.id, "api", "down", undefined, "health check failed");
        }
        // Session hygiene — revoke sessions past their TTL.
        await db().securitySession.updateMany({
          where: { orgId: org.id, revokedAt: null, expiresAt: { lt: new Date() } },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      /* engine tick errors are non-fatal */
    }
  };
  tick();
  engineTimer = setInterval(tick, 60_000);
}
