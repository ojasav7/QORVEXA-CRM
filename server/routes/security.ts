// Phase 14 — Enterprise Security, Compliance & Governance API
// (spec docs/44-spec-phase14.md). Mounted at /api/security with feature gates
// per area (sec.*). Reads are open to authenticated users (the page is a
// monitoring + governance surface); writes are admin-only; session/device
// management is admin-only except revoking your own session.
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { badRequest, asyncHandler, ok, notFound } from "../lib/http";
import { requireAuth, requireRole, getUser, assertActiveUser } from "../lib/auth";
import {
  clientIp,
  consumeRecoveryCode,
  createDsr,
  createSecurityAlert,
  fulfillDsr,
  generateRecoveryCodes,
  ipAllowed,
  orgSecuritySettings,
  recordUptimeTick,
  revokeSession,
  runRetentionScan,
  scimCreateGroup,
  scimCreateUser,
  scimListGroups,
  scimListUsers,
  scimPatchUser,
  scimUpdateGroup,
  seedTranslationCatalog,
  setConsent,
  totpCode,
  totpSecret,
  translationQA,
  updateOrgI18n,
  updateSecuritySettings,
  uptimeReport,
  verifyTotp,
  orgI18n,
  CONSENT_PURPOSES,
  RETENTION_ENTITIES,
  STATUS_COMPONENTS,
  I18N_LOCALES,
  I18N_CURRENCIES,
  I18N_TIMEZONES,
  TRANSLATION_CATALOG,
} from "../lib/security";
import { emitEvent } from "../lib/events";

const router = Router();

// ── Overview ────────────────────────────────────────────────────────────────
router.get(
  "/overview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const [alerts, sessions, consents, dsrs, policies, subProcessors, incidents] = await Promise.all([
      db().securityAlert.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" }, take: 20 }),
      db().securitySession.count({ where: { orgId: user.orgId, revokedAt: null } }),
      db().consentRecord.count({ where: { orgId: user.orgId } }),
      db().dataSubjectRequest.count({ where: { orgId: user.orgId, status: { not: "completed" } } }),
      db().retentionPolicy.count({ where: { orgId: user.orgId } }),
      db().subProcessor.count({ where: { orgId: user.orgId } }),
      db().statusIncident.count({ where: { orgId: user.orgId, status: { not: "resolved" } } }),
    ]);
    const unacked = alerts.filter((a) => !a.acknowledgedAt);
    const settings = await orgSecuritySettings(user.orgId);
    const i18n = await orgI18n(user.orgId);
    ok(res, {
      alerts: unacked,
      alertCount: unacked.length,
      sessions,
      consents,
      openDsrs: dsrs,
      policies,
      subProcessors,
      openIncidents: incidents,
      settings,
      i18n,
      report: {
        encryptionAtRest: settings.encryption.atRest,
        encryptionInTransit: settings.encryption.inTransit,
        mfaEnabledUsers: await db().user.count({ where: { orgId: user.orgId, mfaEnabled: true } }),
        mfaTotalUsers: await db().user.count({ where: { orgId: user.orgId } }),
      },
    });
  })
);

// ── Sessions & devices ─────────────────────────────────────────────────────
router.get(
  "/sessions",
  requireAuth,
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const sessions = await db().securitySession.findMany({
      where: { orgId: user.orgId },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    });
    const users = await db().user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    ok(res, {
      items: sessions.map((s) => ({
        ...s,
        user: byId.get(s.userId) ?? null,
        current: s.userId === user.id,
      })),
    });
  })
);

router.post(
  "/sessions/:id/revoke",
  requireAuth,
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const id = String(req.params.id);
    await revokeSession(user.orgId, id);
    await emitEvent({
      orgId: user.orgId,
      type: "session.revoked",
      entity: "securitySession",
      entityId: id,
      actorId: user.id,
      payload: { revokedBy: user.id },
    });
    ok(res, { ok: true });
  })
);

router.post(
  "/sessions/revoke-all",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const res2 = await db().securitySession.updateMany({
      where: { orgId: user.orgId, revokedAt: null, userId: { not: user.id } },
      data: { revokedAt: new Date() },
    });
    await emitEvent({ orgId: user.orgId, type: "session.revoked", entity: "securitySession", entityId: "all", actorId: user.id, payload: { count: res2.count } });
    ok(res, { ok: true, revoked: res2.count });
  })
);

// ── MFA (self-service) ─────────────────────────────────────────────────────
router.post(
  "/mfa/setup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    if ((await db().user.findUnique({ where: { id: user.id } }))?.mfaEnabled) {
      throw badRequest("MFA is already enabled");
    }
    const secret = totpSecret();
    await db().user.update({ where: { id: user.id }, data: { mfaSecret: secret } });
    const issuer = "Qorvexa";
    const otpauth = `otpauth://totp/${issuer}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    ok(res, { secret, otpauth, qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauth)}`, previewCode: totpCode(secret) });
  })
);

router.post(
  "/mfa/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ code: z.string().min(6).max(6) }).parse(req.body);
    const user = await assertActiveUser(req);
    const fresh = await db().user.findUnique({ where: { id: user.id } });
    if (!fresh?.mfaSecret) throw badRequest("MFA setup was not started");
    if (fresh.mfaEnabled) throw badRequest("MFA is already enabled");
    if (!verifyTotp(fresh.mfaSecret, body.code)) throw badRequest("Invalid verification code");
    const recoveryCodes = generateRecoveryCodes();
    await db().user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaVerifiedAt: new Date(),
        mfaRecoveryHashes: recoveryCodes.map((c) => crypto.createHash("sha256").update(c).digest("hex")),
      },
    });
    await emitEvent({
      orgId: user.orgId,
      type: "mfa.enabled",
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      payload: { user: user.email },
    });
    ok(res, { ok: true, recoveryCodes });
  })
);

router.post(
  "/mfa/disable",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ code: z.string().min(6).max(16) }).parse(req.body);
    const user = await assertActiveUser(req);
    const fresh = await db().user.findUnique({ where: { id: user.id } });
    if (!fresh?.mfaEnabled) throw badRequest("MFA is not enabled");
    const recovery = /^[A-F0-9]{10}$/.test(body.code.trim().toUpperCase());
    const okCode = recovery ? await consumeRecoveryCode(user.id, body.code) : verifyTotp(fresh.mfaSecret ?? "", body.code.trim());
    if (!okCode) throw badRequest("Invalid verification code");
    await db().user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaVerifiedAt: null, mfaRecoveryHashes: null } });
    await emitEvent({ orgId: user.orgId, type: "mfa.disabled", entity: "user", entityId: user.id, actorId: user.id, payload: { user: user.email } });
    ok(res, { ok: true });
  })
);

// ── Security policy (admin) ────────────────────────────────────────────────
router.get(
  "/policy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    ok(res, { settings: await orgSecuritySettings(user.orgId), clientIp: clientIp(req) });
  })
);

router.put(
  "/policy",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      ipRestrictionEnabled: z.boolean().optional(),
      ipAllowlist: z.array(z.string()).optional(),
      requireMfa: z.boolean().optional(),
      sessionTtlDays: z.number().int().min(1).max(365).optional(),
      encryption: z.object({ atRest: z.boolean().optional(), inTransit: z.boolean().optional(), fieldLevel: z.array(z.string()).optional() }).optional(),
    });
    const patch = schema.parse(req.body);
    if (patch.ipAllowlist && !patch.ipAllowlist.every((c) => c === "*" || /^([0-9.]+|\*)(\/\d{1,2})?$/.test(c))) {
      throw badRequest("Invalid CIDR in allowlist — use a.b.c.d, a.b.c.d/n, or *");
    }
    const settings = await updateSecuritySettings(user.orgId, patch);
    await emitEvent({ orgId: user.orgId, type: "security.policy_updated", entity: "organization", entityId: user.orgId, actorId: user.id, payload: { patch } });
    ok(res, { settings });
  })
);

// ── Alerts ─────────────────────────────────────────────────────────────────
router.get(
  "/alerts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().securityAlert.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    ok(res, { items, total: items.length });
  })
);

router.post(
  "/alerts/:id/acknowledge",
  requireAuth,
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const id = String(req.params.id);
    const alert = await db().securityAlert.findFirst({ where: { id, orgId: user.orgId } });
    if (!alert) throw notFound("Alert not found");
    await db().securityAlert.update({ where: { id }, data: { acknowledgedAt: new Date() } });
    ok(res, { ok: true });
  })
);

// ── Consent & privacy ──────────────────────────────────────────────────────
router.get(
  "/consent",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().consentRecord.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" }, take: 200 });
    const granted = items.filter((c) => c.status === "granted").length;
    const withdrawn = items.filter((c) => c.status === "withdrawn").length;
    ok(res, { items, granted, withdrawn, total: items.length });
  })
);

router.post(
  "/consent",
  requireAuth,
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      contactEmail: z.string().email(),
      contactId: z.string().optional(),
      purpose: z.string(),
      status: z.string(),
      source: z.string().optional(),
    });
    const input = schema.parse(req.body);
    const record = await setConsent({ ...input, orgId: user.orgId, actorId: user.id });
    ok(res, { record }, 201);
  })
);

// DSRs — the privacy center
router.get(
  "/dsrs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().dataSubjectRequest.findMany({ where: { orgId: user.orgId }, orderBy: { submittedAt: "desc" }, take: 100 });
    ok(res, { items });
  })
);

router.post(
  "/dsrs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      type: z.string(),
      requesterEmail: z.string().email(),
      notes: z.string().optional(),
    });
    const input = schema.parse(req.body);
    const dsr = await createDsr({ ...input, orgId: user.orgId, actorId: user.id });
    await createSecurityAlert({
      orgId: user.orgId,
      category: "consent",
      severity: "low",
      title: `DSR submitted: ${input.type}`,
      message: `A ${input.type} request was submitted by ${input.requesterEmail}.`,
      actorId: user.id,
    });
    ok(res, { dsr }, 201);
  })
);

router.post(
  "/dsrs/:id/fulfill",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const body = z.object({ notes: z.string().optional() }).parse(req.body ?? {});
    const dsr = await fulfillDsr(user.orgId, String(req.params.id), user.id, body.notes);
    ok(res, { dsr });
  })
);

// ── Retention ──────────────────────────────────────────────────────────────
router.get(
  "/retention",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().retentionPolicy.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
    ok(res, { items, entities: RETENTION_ENTITIES });
  })
);

router.post(
  "/retention",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      name: z.string().min(2),
      entity: z.string(),
      olderThanDays: z.number().int().min(1).max(3650),
      action: z.enum(["delete", "anonymize"]),
      status: z.enum(["active", "paused"]).default("active"),
    });
    const input = schema.parse(req.body);
    if (!RETENTION_ENTITIES.includes(input.entity)) throw badRequest(`Unsupported entity: ${input.entity}`);
    const policy = await db().retentionPolicy.create({
      data: { orgId: user.orgId, name: input.name, entity: input.entity, olderThanDays: input.olderThanDays, action: input.action, status: input.status, createdBy: user.id },
    });
    await emitEvent({ orgId: user.orgId, type: "retention.policy_created", entity: "retentionPolicy", entityId: policy.id, actorId: user.id, payload: { name: input.name, entity: input.entity } });
    ok(res, { policy }, 201);
  })
);

router.post(
  "/retention/:id/run",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const summary = await runRetentionScan(user.orgId, String(req.params.id), user.id);
    ok(res, { summary });
  })
);

router.post(
  "/retention/:id/toggle",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const policy = await db().retentionPolicy.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!policy) throw notFound("Policy not found");
    const next = policy.status === "active" ? "paused" : "active";
    await db().retentionPolicy.update({ where: { id: policy.id }, data: { status: next } });
    ok(res, { status: next });
  })
);

// ── Sub-processors (vendor transparency) ───────────────────────────────────
router.get(
  "/subprocessors",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().subProcessor.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" } });
    ok(res, { items });
  })
);

router.post(
  "/subprocessors",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      name: z.string().min(1),
      purpose: z.string().min(1),
      region: z.string().min(1),
      dataCategories: z.array(z.string()).default([]),
      link: z.string().url().optional().or(z.literal("")),
      status: z.enum(["active", "retired", "pending"]).default("active"),
    });
    const input = schema.parse(req.body);
    const sub = await db().subProcessor.create({ data: { orgId: user.orgId, ...input } });
    await emitEvent({ orgId: user.orgId, type: "subprocessor.updated", entity: "subProcessor", entityId: sub.id, actorId: user.id, payload: { name: input.name, status: input.status } });
    ok(res, { sub }, 201);
  })
);

router.patch(
  "/subprocessors/:id",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      name: z.string().min(1).optional(),
      purpose: z.string().min(1).optional(),
      region: z.string().min(1).optional(),
      dataCategories: z.array(z.string()).optional(),
      link: z.string().optional(),
      status: z.enum(["active", "retired", "pending"]).optional(),
    });
    const input = schema.parse(req.body);
    const sub = await db().subProcessor.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!sub) throw notFound("Sub-processor not found");
    const updated = await db().subProcessor.update({ where: { id: sub.id }, data: input });
    await emitEvent({ orgId: user.orgId, type: "subprocessor.updated", entity: "subProcessor", entityId: sub.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { sub: updated });
  })
);

// ── Status page & uptime ───────────────────────────────────────────────────
router.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const days = Number(String(req.query.days ?? "30"));
    const report = await uptimeReport(user.orgId, Number.isFinite(days) && days > 0 ? days : 30);
    ok(res, { ...report, components: STATUS_COMPONENTS });
  })
);

router.post(
  "/status/tick",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      component: z.string(),
      status: z.enum(["up", "degraded", "down"]),
      latencyMs: z.number().int().optional(),
      message: z.string().optional(),
    });
    const input = schema.parse(req.body);
    if (!(STATUS_COMPONENTS as readonly string[]).includes(input.component)) throw badRequest(`Unknown component: ${input.component}`);
    await recordUptimeTick(user.orgId, input.component, input.status, input.latencyMs, input.message);
    ok(res, { ok: true });
  })
);

router.post(
  "/status/incidents",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({
      component: z.string().default("api"),
      title: z.string().min(2),
      severity: z.enum(["minor", "major", "critical"]).default("minor"),
      message: z.string().min(1),
    });
    const input = schema.parse(req.body);
    const incident = await db().statusIncident.create({
      data: { orgId: user.orgId, component: input.component, title: input.title, severity: input.severity, message: input.message, createdBy: user.id },
    });
    await emitEvent({ orgId: user.orgId, type: "status.incident_created", entity: "statusIncident", entityId: incident.id, actorId: user.id, payload: { title: input.title, severity: input.severity } });
    ok(res, { incident }, 201);
  })
);

router.post(
  "/status/incidents/:id/resolve",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const incident = await db().statusIncident.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!incident) throw notFound("Incident not found");
    await db().statusIncident.update({ where: { id: incident.id }, data: { status: "resolved", resolvedAt: new Date() } });
    await emitEvent({ orgId: user.orgId, type: "status.incident_resolved", entity: "statusIncident", entityId: incident.id, actorId: user.id, payload: { title: incident.title } });
    ok(res, { ok: true });
  })
);

// ── i18n & localization QA ─────────────────────────────────────────────────
router.get(
  "/i18n",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const i18n = await orgI18n(user.orgId);
    const qa = await translationQA(user.orgId);
    ok(res, {
      i18n,
      locales: I18N_LOCALES,
      currencies: I18N_CURRENCIES,
      timezones: I18N_TIMEZONES,
      catalogSize: TRANSLATION_CATALOG.length,
      qa,
    });
  })
);

router.put(
  "/i18n",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({ locale: z.string().optional(), timezone: z.string().optional(), currency: z.string().optional() });
    const i18n = await updateOrgI18n(user.orgId, schema.parse(req.body));
    await emitEvent({ orgId: user.orgId, type: "i18n.config_updated", entity: "organization", entityId: user.orgId, actorId: user.id, payload: i18n });
    ok(res, { i18n });
  })
);

router.post(
  "/i18n/seed",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const counts = await seedTranslationCatalog(user.orgId);
    ok(res, { counts });
  })
);

router.put(
  "/i18n/translations",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const schema = z.object({ locale: z.string(), key: z.string(), value: z.string() });
    const input = schema.parse(req.body);
    if (!(I18N_LOCALES as readonly string[]).includes(input.locale as (typeof I18N_LOCALES)[number])) throw badRequest(`Unknown locale: ${input.locale}`);
    if (!TRANSLATION_CATALOG.some((t) => t.key === input.key)) throw badRequest(`Unknown key: ${input.key}`);
    await db().translationEntry.upsert({
      where: { orgId_locale_key: { orgId: user.orgId, locale: input.locale, key: input.key } },
      create: { orgId: user.orgId, locale: input.locale, key: input.key, value: input.value, status: "translated", source: "custom" },
      update: { value: input.value, status: "translated", source: "custom", updatedAt: new Date() },
    });
    const qa = await translationQA(user.orgId);
    ok(res, { ok: true, qa });
  })
);

// ── SCIM (admin view of provisioned users/groups) ─────────────────────────
router.get(
  "/scim",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const [users, groups] = await Promise.all([scimListUsers(user.orgId), scimListGroups(user.orgId)]);
    const tokens = await db().apiToken.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, scopes: true, createdAt: true } });
    ok(res, { users: users.length, groups: groups.length, scimTokens: tokens.filter((t) => (t.scopes as string[]).includes("scim") || (t.scopes as string[]).includes("all")) });
  })
);

// ── SCIM provisioning endpoints (bearer token, RFC 7644 shape) ─────────────
// Mounted separately at /api/scim/v2 in index.ts (scimAuth middleware).

// ── Diagnostics used by the UI / verify suite ──────────────────────────────
router.post(
  "/debug/ip-allowed",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const settings = await orgSecuritySettings(user.orgId);
    const ip = String((req.body as { ip?: unknown })?.ip ?? clientIp(req));
    ok(res, { ip, allowed: ipAllowed(ip, settings.ipAllowlist), allowlist: settings.ipAllowlist });
  })
);

export default router;
