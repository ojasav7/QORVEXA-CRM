// API tokens (Phase 0 OAuth for integrations) — bearer tokens issued by admins.
// Only the sha256 hash is stored; the raw token is shown once at creation.
// Tokens act as a role (admin|manager|rep) and are scoped per request like any
// session user (X-Environment still applies). `read` scope = GET only.
import crypto from "node:crypto";
import { db } from "../db";

export type TokenScopes = string[];

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function issueToken(opts: { orgId: string; name: string; role?: string; scopes?: string[]; ttlDays?: number }) {
  const raw = newToken();
  const record = await db().apiToken.create({
    data: {
      orgId: opts.orgId,
      name: opts.name,
      tokenHash: hashToken(raw),
      prefix: raw.slice(0, 8),
      role: opts.role ?? "admin",
      scopes: (opts.scopes ?? ["all"]) as string[],
      expiresAt: opts.ttlDays ? new Date(Date.now() + opts.ttlDays * 86_400_000) : null,
    },
  });
  return { raw, record };
}

/** Resolve a bearer token to a session-shaped user, or null. Never throws. */
export async function tokenSessionUser(raw: string): Promise<Record<string, unknown> | null> {
  if (!raw) return null;
  const token = await db().apiToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!token || !token.active) return null;
  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;
  void db()
    .apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  const scopes = ((token.scopes as string[]) ?? ["all"]) as TokenScopes;
  return {
    id: token.id,
    orgId: token.orgId,
    email: `token:${token.name}`,
    name: token.name,
    role: token.role,
    viaToken: true,
    scopes,
  };
}
