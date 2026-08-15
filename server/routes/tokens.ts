import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { issueToken } from "../lib/tokens";
import { emitEvent } from "../lib/events";

const router = Router();
router.use(requireRole("admin"));

// GET /api/tokens — list the org's API tokens (hash never returned)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().apiToken.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
    ok(res, {
      items: items.map((t) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        role: t.role,
        scopes: t.scopes,
        active: t.active,
        expiresAt: t.expiresAt,
        lastUsedAt: t.lastUsedAt,
        createdAt: t.createdAt,
      })),
    });
  })
);

// POST /api/tokens — issue a token; the raw secret is returned exactly once.
const createSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.enum(["admin", "manager", "rep"]).optional().default("admin"),
  scopes: z
    .array(z.enum(["all", "read", "write", "scim"]))
    .optional()
    .default(["all"])
    .transform((s) => (s.includes("all") ? ["all"] : s)), // "all" subsumes read+write; scim = SCIM 2.0 provisioning only
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const { name, role, scopes, expiresInDays } = createSchema.parse(req.body);
    const { raw, record } = await issueToken({ orgId: user.orgId, name, role, scopes, ttlDays: expiresInDays });
    await emitEvent({
      orgId: user.orgId,
      environment: "production",
      type: "token.created",
      entity: "apiToken",
      entityId: record.id,
      actorId: user.id,
      payload: { name, role, scopes },
    });
    ok(res, { token: raw, tokenId: record.id, name, role, scopes, expiresAt: record.expiresAt }, 201);
  })
);

// DELETE /api/tokens/:id — revoke (deactivate; row retained for audit)
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const token = await db().apiToken.findUnique({ where: { id: String(req.params.id) } });
    if (!token || token.orgId !== user.orgId) throw badRequest("Token not found");
    await db().apiToken.update({ where: { id: token.id }, data: { active: false } });
    await emitEvent({
      orgId: user.orgId,
      environment: "production",
      type: "token.revoked",
      entity: "apiToken",
      entityId: token.id,
      actorId: user.id,
      payload: { name: token.name },
    });
    ok(res, { ok: true });
  })
);

export default router;
