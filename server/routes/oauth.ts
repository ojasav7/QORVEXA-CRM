// OAuth SSO (Phase 0 OAuth, provider-client side) — sign in with Google or GitHub.
// Standard authorization-code flow: state is stored in a short-lived httpOnly
// cookie, the callback exchanges the code for a token, fetches the profile email,
// and logs in the EXISTING user with that email (account must exist — registration
// stays email/password; provisioning is a documented limitation).
// Dev/testing: with OAUTH_MOCK=1 (non-production only), GET /:provider?mockEmail=x
// completes the flow directly without hitting the provider.
import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../env";
import { db } from "../db";
import { asyncHandler, badRequest } from "../lib/http";
import { SESSION_COOKIE } from "../lib/auth";
import { issueSession } from "../lib/security";
import { emitEvent } from "../lib/events";

const router = Router();
const STATE_COOKIE = "qorvexa.oauthstate";
const APP_ORIGIN = process.env.OAUTH_REDIRECT_ORIGIN ?? "http://localhost:8787";

type ProviderCfg = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
};

function providerConfig(provider: string): ProviderCfg | null {
  if (provider === "google" && env.googleClientId) {
    return {
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
    };
  }
  if (provider === "github" && env.githubClientId) {
    return {
      clientId: env.githubClientId,
      clientSecret: env.githubClientSecret,
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userUrl: "https://api.github.com/user",
      scope: "read:user user:email",
    };
  }
  return null;
}

const mockEnabled = () => env.oauthMock && process.env.NODE_ENV !== "production";

// GET /api/auth/oauth/providers — which SSO buttons to render
router.get(
  "/providers",
  asyncHandler(async (_req, res) => {
    const providers = (["google", "github"] as const).filter((p) => providerConfig(p) || mockEnabled());
    res.json({ providers });
  })
);

// GET /api/auth/oauth/:provider — start the flow (redirect to the provider)
router.get(
  "/:provider",
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider);
    const cfg = providerConfig(provider);
    if (!cfg && !mockEnabled()) throw badRequest("OAuth provider not configured");
    if (mockEnabled()) {
      // Dev shortcut: complete immediately with a mock email.
      const email = String(req.query.mockEmail ?? req.query.email ?? "admin@qorvexa.dev");
      const user = await db().user.findUnique({ where: { email } });
      if (!user || !user.active) return res.redirect(`${APP_ORIGIN}/?oauth=error=no_account`);
      finishLogin(user, provider, null, req, res);
      return;
    }
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/" });
    const redirectUri = encodeURIComponent(`${APP_ORIGIN}/api/auth/oauth/${provider}/callback`);
    const url = `${cfg!.authUrl}?client_id=${encodeURIComponent(cfg!.clientId)}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(cfg!.scope)}&state=${state}`;
    res.redirect(url);
  })
);

// GET /api/auth/oauth/:provider/callback — exchange code, find user, set session
router.get(
  "/:provider/callback",
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider);
    const cfg = providerConfig(provider);
    if (!cfg && !mockEnabled()) throw badRequest("OAuth provider not configured");
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const cookieState = (req as any).cookies?.[STATE_COOKIE] as string | undefined;
    if (!code || !state || !cookieState || state !== cookieState) throw badRequest("OAuth state mismatch");
    res.clearCookie(STATE_COOKIE);

    // 1. Exchange the code for an access token.
    const tokenRes = await fetch(cfg!.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: cfg!.clientId,
        client_secret: cfg!.clientSecret,
        redirect_uri: `${APP_ORIGIN}/api/auth/oauth/${provider}/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!tokenData.access_token) throw badRequest(`OAuth token exchange failed: ${tokenData.error ?? "unknown"}`);

    // 2. Fetch the profile.
    const profileRes = await fetch(cfg!.userUrl, { headers: { authorization: `Bearer ${tokenData.access_token}` } });
    const profile = (await profileRes.json().catch(() => ({}))) as Record<string, any>;
    let email: string | undefined = profile.email;
    if (!email && provider === "github") {
      const emailsRes = await fetch("https://api.github.com/user/emails", { headers: { authorization: `Bearer ${tokenData.access_token}` } });
      const emails = (await emailsRes.json().catch(() => [])) as { email?: string; primary?: boolean }[];
      email = emails.find((e) => e.primary)?.email ?? emails[0]?.email;
    }
    if (!email) throw badRequest("Provider did not return an email");

    // Provider's stable user id for linking (User.oauthProvider/oauthId).
    let oauthId: string | null = null;
    if (provider === "google" && typeof profile.sub === "string") oauthId = profile.sub;
    if (provider === "github" && (typeof profile.id === "number" || typeof profile.id === "string")) oauthId = String(profile.id);

    const user = await db().user.findUnique({ where: { email } });
    if (!user || !user.active) return res.redirect(`${APP_ORIGIN}/?oauth=error=no_account`);
    await finishLogin(user, provider, oauthId, req, res);
  })
);

async function finishLogin(user: { id: string; orgId: string; email: string; name: string; role: string }, provider: string, oauthId: string | null, req: any, res: any) {
  const session = { id: user.id, orgId: user.orgId, email: user.email, name: user.name, role: user.role };
  res.cookie(SESSION_COOKIE, await issueSession(session, req), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  void db()
    .user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), oauthProvider: provider, ...(oauthId ? { oauthId } : {}) },
    })
    .catch(() => {});
  void emitEvent({ orgId: user.orgId, environment: "production", type: "user.logged_in", entity: "user", entityId: user.id, actorId: user.id, payload: { via: "oauth" } });
  res.redirect(`${APP_ORIGIN}/?oauth=success`);
}

export default router;
