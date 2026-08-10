import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import { badRequest, asyncHandler, ok } from "../lib/http";
import { createSessionCookie, loadSession, SESSION_COOKIE, type SessionUser } from "../lib/auth";
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
    const session = { id: user.id, orgId: org.id, email, name, role: user.role };
    res.cookie(SESSION_COOKIE, createSessionCookie(session), cookieOpts());
    await emitEvent({ orgId: org.id, type: "org.created", entity: "organization", entityId: org.id, actorId: user.id });
    ok(res, { user: publicUser(user) });
  })
);

// POST /api/auth/login
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
    const session = { id: user.id, orgId: user.orgId, email: user.email, name: user.name, role: user.role };
    res.cookie(SESSION_COOKIE, createSessionCookie(session), cookieOpts());
    await emitEvent({ orgId: user.orgId, type: "user.logged_in", entity: "user", entityId: user.id, actorId: user.id });
    ok(res, { user: publicUser(user) });
  })
);

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  ok(res, { ok: true });
});

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

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production", // https-only in prod
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

export default router;
