import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db";
import { env } from "../env";
import { unauthorized, forbidden } from "./http";
import { tokenSessionUser } from "./tokens";
import { issueSession, resolveSession } from "./security";

export const SESSION_COOKIE = "qorvexa.session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionUser = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
};

// ── DB-backed sessions (Phase 14) ────────────────────────────────────────────
// The cookie payload embeds a SecuritySession id; resolveSession checks the
// row (revoked / expired) and refreshes lastSeenAt. `createSessionCookie` is
// kept for legacy cookies issued before the Phase 14 upgrade — loadSession
// falls back to the payload user when the row is missing.

function sign(payload: string): string {
  return crypto.createHmac("sha256", env.sessionSecret).update(payload).digest("base64url");
}

export function createSessionCookie(user: SessionUser): string {
  const body = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + SESSION_TTL_MS }),
    "utf8"
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Attach req.sessionUser when a valid cookie is present (never throws). */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
    if (!raw) {
      (req as any).sessionUser = null;
      return next();
    }
    const session = await resolveSession(raw, req);
    if (!session) {
      // Legacy cookie without a DB session — verify the HMAC payload directly.
      const legacy = verifyLegacy(raw);
      (req as any).sessionUser = legacy;
      return next();
    }
    (req as any).sessionUser = session;
    next();
  } catch {
    (req as any).sessionUser = null;
    next();
  }
}

function verifyLegacy(token: string): SessionUser | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    if (parsed.sessionId) return null; // DB session row missing → treat as logged out
    return { id: parsed.id, orgId: parsed.orgId, email: parsed.email, name: parsed.name, role: parsed.role };
  } catch {
    return null;
  }
}

/** Short-lived signed token for the MFA challenge step (10 min). */
export function createMfaToken(userId: string): string {
  const body = Buffer.from(JSON.stringify({ mfa: true, userId, exp: Date.now() + 10 * 60 * 1000 }), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyMfaToken(token: string): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed.mfa || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed.userId as string;
  } catch {
    return null;
  }
}

/**
 * Bearer-token auth (Phase 0 OAuth for integrations). If an `Authorization:
 * Bearer <token>` header is present it OVERRIDES the session cookie. A valid
 * token becomes the request user (acting as its role); read-scoped tokens are
 * rejected on non-GET methods. Invalid tokens are ignored → 401 downstream.
 */
export async function loadTokenAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      const raw = auth.slice(7).trim();
      const tokenUser = await tokenSessionUser(raw);
      if (tokenUser) {
        const scopes = (tokenUser.scopes as string[]) ?? ["all"];
        const only = (s: string) => scopes.length === 1 && scopes[0] === s;
        // read-scoped tokens can only GET; write-scoped tokens can only mutate.
        if ((only("read") && req.method !== "GET") || (only("write") && req.method === "GET")) {
          (req as any).sessionUser = null;
          next();
          return;
        }
        // Phase 14: scim-scoped tokens authenticate ONLY the SCIM 2.0 routes
        // (server/routes/scim.ts → scimAuth) — they must not become a session
        // user on the rest of the API.
        if (only("scim")) {
          (req as any).sessionUser = null;
          (req as any).tokenAuth = tokenUser;
          next();
          return;
        }
        (req as any).sessionUser = {
          id: tokenUser.id as string,
          orgId: tokenUser.orgId as string,
          email: tokenUser.email as string,
          name: tokenUser.name as string,
          role: tokenUser.role as string,
        };
        (req as any).tokenAuth = tokenUser;
      }
    }
  } catch {
    /* invalid token — treat as unauthenticated */
  }
  next();
}

/** Require an authenticated user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const user = (req as any).sessionUser as SessionUser | null;
  if (!user) return next(unauthorized());
  next();
}

/** Require one of the given roles (admin, manager, rep). */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as any).sessionUser as SessionUser | null;
    if (!user) return next(unauthorized());
    if (!roles.includes(user.role)) return next(forbidden(`Requires role: ${roles.join(" | ")}`));
    next();
  };
}

export function getUser(req: Request): SessionUser {
  const user = (req as any).sessionUser as SessionUser | null;
  if (!user) throw unauthorized();
  return user;
}

/** Hydrate the current user row (fresh role/active state from DB). API tokens bypass the user table. */
export async function assertActiveUser(req: Request): Promise<SessionUser> {
  const user = getUser(req);
  if ((req as any).tokenAuth) return user;
  const fresh = await db().user.findUnique({ where: { id: user.id } });
  if (!fresh || !fresh.active) throw unauthorized("Account disabled");
  return { id: fresh.id, orgId: fresh.orgId, email: fresh.email, name: fresh.name, role: fresh.role };
}
