import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import { badRequest, asyncHandler, ok } from "../lib/http";
import { createMfaToken, createSessionCookie, loadSession, SESSION_COOKIE, sessionCookieOpts, type SessionUser, verifyMfaToken } from "../lib/auth";
import { issueSession, consumeRecoveryCode, verifyTotp, createSecurityAlert } from "../lib/security";
import { emitEvent } from "../lib/events";
import { env } from "../env";

const router = Router();

// POST /api/auth/register — creates the org (first user) or joins (by invite domain in Phase 2+).
const registerSchema = z.object({
  orgName: z.string().min(2),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { orgName, name, email, password } = registerSchema.parse(req.body);
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

    const existingUser = await db().user.findUnique({ where: { email } });
    if (existingUser) throw badRequest("An account with this email already exists");

    const org = await db().organization.create({ data: { name: orgName, slug, settings: {} } });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db().user.create({
      data: { orgId: org.id, email, name, passwordHash, role: "admin" },
    });
    const session: SessionUser = { id: user.id, orgId: org.id, email, name, role: user.role };
    res.cookie(SESSION_COOKIE, await issueSession(session, req), sessionCookieOpts(req));
    await emitEvent({ orgId: org.id, type: "org.created", entity: "organization", entityId: org.id, actorId: user.id });
    ok(res, { user: publicUser(user) });
  })
);

// POST /api/auth/login — password step. When the user has MFA enabled the
// response carries an mfaToken and NO session cookie; the client then calls
// /api/auth/mfa-verify to complete the handshake (Phase 14).
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await db().user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw badRequest("Invalid email or password");
    }
    if (!user.active) throw badRequest("This account has been disabled");
    await db().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    if (user.mfaEnabled) {
      await createSecurityAlert({
        orgId: user.orgId,
        category: "mfa",
        severity: "info",
        title: "MFA challenge issued",
        message: `Second-factor challenge issued for ${email}.`,
        actorId: user.id,
      });
      ok(res, { mfaRequired: true, mfaToken: createMfaToken(user.id), user: { email: user.email, mfaEnabled: true } });
      return;
    }
    await completeLogin(req, res, user.id);
  })
);

// POST /api/auth/mfa-verify — completes a challenged login with a TOTP code
// or one-time recovery code (Phase 14).
const mfaSchema = z.object({ mfaToken: z.string().min(10), code: z.string().min(6).max(16) });
router.post(
  "/mfa-verify",
  asyncHandler(async (req, res) => {
    const { mfaToken, code } = mfaSchema.parse(req.body);
    const userId = verifyMfaToken(mfaToken);
    if (!userId) throw badRequest("MFA challenge expired — log in again");
    const user = await db().user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled) throw badRequest("MFA is not enabled for this account");
    const recovery = /^[A-F0-9]{10}$/.test(code.trim().toUpperCase());
    const okCode = recovery
      ? await consumeRecoveryCode(user.id, code)
      : verifyTotp(user.mfaSecret ?? "", code.trim());
    if (!okCode) {
      await createSecurityAlert({
        orgId: user.orgId,
        category: "mfa",
        severity: "high",
        title: "Failed MFA attempt",
        message: `An invalid second factor was submitted for ${user.email}.`,
        actorId: user.id,
      });
      throw badRequest("Invalid verification code");
    }
    await completeLogin(req, res, user.id);
  })
);

async function completeLogin(req: Request, res: Response, userId: string) {
  const user = await db().user.findUnique({ where: { id: userId } });
  if (!user) throw badRequest("Account not found");
  const session: SessionUser = { id: user.id, orgId: user.orgId, email: user.email, name: user.name, role: user.role };
  res.cookie(SESSION_COOKIE, await issueSession(session, req), sessionCookieOpts(req));
  await emitEvent({ orgId: user.orgId, type: "user.logged_in", entity: "user", entityId: user.id, actorId: user.id });
  ok(res, { user: publicUser(user) });
}

// POST /api/auth/logout — clears the cookie and revokes the DB session row.
router.post(
  "/logout",
  loadSession,
  asyncHandler(async (req, res) => {
    const s = (req as any).sessionUser as SessionUser | null;
    const raw = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
    if (s && raw?.includes(".")) {
      try {
        const [body] = raw.split(".");
        const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (parsed.sessionId) {
          await db().securitySession.updateMany({ where: { id: parsed.sessionId, orgId: s.orgId }, data: { revokedAt: new Date() } });
        }
      } catch {
        /* best effort */
      }
    }
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax" as const, secure: !!sessionCookieOpts(req)["secure"], path: "/" });
    ok(res, { ok: true });
  })
);

// GET /api/auth/me — used by the client to restore the session on refresh.
router.get(
  "/me",
  loadSession,
  asyncHandler(async (req, res) => {
    const s = (req as any).sessionUser as SessionUser | null;
    if (!s) {
      ok(res, { user: null });
      return;
    }
    const user = await db().user.findUnique({ where: { id: s.id } });
    if (!user || !user.active) {
      ok(res, { user: null });
      return;
    }
    ok(res, { user: publicUser(user), org: await db().organization.findUnique({ where: { id: user.orgId } }) });
  })
);

function publicUser(u: { id: string; orgId: string; email: string; name: string; role: string; title?: string | null }) {
  return { id: u.id, orgId: u.orgId, email: u.email, name: u.name, role: u.role, title: u.title ?? null };
}

export default router;
