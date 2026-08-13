// SCIM 2.0 provisioning endpoints (Phase 14 · RFC 7643/7644 shape).
// Mounted at /api/scim/v2 — authenticated by a bearer ApiToken with the
// `scim` scope (see server/routes/security.ts → /api/security/scim for the
// admin view of provisioned users/groups).
import { Router } from "express";
import { db } from "../db";
import { asyncHandler, badRequest, ok, notFound } from "../lib/http";
import {
  scimAuth,
  scimCreateGroup,
  scimCreateUser,
  scimListGroups,
  scimListUsers,
  scimPatchUser,
  scimUpdateGroup,
} from "../lib/security";

const router = Router();

router.use(scimAuth);

// ── Users ──────────────────────────────────────────────────────────────────
router.get("/Users", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const users = await scimListUsers(orgId);
  ok(res, { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: users.length, Resources: users });
}));

router.get("/Users/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const user = await db().user.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!user) throw notFound("SCIM user not found");
  const list = await scimListUsers(orgId);
  ok(res, list.find((u) => u.id === user.id) ?? {});
}));

router.post("/Users", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const body = req.body as { userName?: string; emails?: { value: string }[]; externalId?: string; active?: boolean; name?: { givenName?: string; familyName?: string } };
  const user = await scimCreateUser(orgId, body);
  ok(res, {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    externalId: user.scimExternalId,
    userName: user.email,
    active: user.active,
    roles: [{ value: user.role }],
  }, 201);
}));

router.patch("/Users/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const ops = (req.body as { Operations?: { op?: string; value?: Record<string, unknown> }[] }).Operations ?? [];
  const patch: { active?: boolean; externalId?: string; name?: { givenName?: string; familyName?: string } } = {};
  for (const op of ops) {
    if (op.value && typeof op.value.active === "boolean") patch.active = op.value.active;
    if (op.value && typeof op.value.externalId === "string") patch.externalId = op.value.externalId;
    if (op.value && typeof op.value.name === "object" && op.value.name) patch.name = op.value.name as { givenName?: string; familyName?: string };
  }
  await scimPatchUser(orgId, String(req.params.id), patch);
  ok(res, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], ok: true });
}));

router.delete("/Users/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const user = await db().user.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!user) throw notFound("SCIM user not found");
  // SCIM deactivate (soft) — the account is disabled, the row is retained for audit.
  await db().user.update({ where: { id: user.id }, data: { active: false } });
  ok(res, { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "deactivated" }, 204);
}));

// ── Groups ─────────────────────────────────────────────────────────────────
router.get("/Groups", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const groups = await scimListGroups(orgId);
  ok(res, { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: groups.length, Resources: groups });
}));

router.get("/Groups/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const groups = await scimListGroups(orgId);
  const group = groups.find((g) => g.id === String(req.params.id));
  if (!group) throw notFound("SCIM group not found");
  ok(res, group);
}));

router.post("/Groups", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const body = req.body as { displayName?: string; externalId?: string; members?: { value?: string }[] };
  const group = await scimCreateGroup(orgId, body);
  ok(res, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], id: group.id, externalId: group.externalId, displayName: group.displayName }, 201);
}));

router.put("/Groups/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const body = req.body as { displayName?: string; members?: { value?: string }[] };
  await scimUpdateGroup(orgId, String(req.params.id), body);
  ok(res, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], ok: true });
}));

router.delete("/Groups/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).scimOrgId as string;
  const group = await db().scimGroup.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!group) throw notFound("SCIM group not found");
  await db().scimGroup.delete({ where: { id: group.id } });
  res.status(204).send();
}));

// ── Service provider config (discovery) ────────────────────────────────────
router.get("/ServiceProviderConfig", asyncHandler(async (_req, res) => {
  ok(res, {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: false },
    etag: { supported: false },
    sort: { supported: false },
    authenticationSchemes: [{ name: "OAuth Bearer Token", type: "oauthbearertoken" }],
  });
}));

// ── Schema (discovery) ─────────────────────────────────────────────────────
router.get("/Schemas", asyncHandler(async (_req, res) => {
  ok(res, {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    Resources: [
      { id: "urn:ietf:params:scim:schemas:core:2.0:User", name: "User", attributes: [{ name: "userName", type: "string", required: true }, { name: "active", type: "boolean" }, { name: "externalId", type: "string" }] },
      { id: "urn:ietf:params:scim:schemas:core:2.0:Group", name: "Group", attributes: [{ name: "displayName", type: "string", required: true }, { name: "members", type: "complex", multiValued: true }] },
    ],
  });
}));

export default router;
