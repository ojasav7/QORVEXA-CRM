import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { emitEvent } from "../lib/events";

const router = Router();
router.use(requireRole("admin"));

// GET /api/users
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const users = await db().user.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "asc" } });
    ok(res, { items: users.map(publicUser) });
  })
);

// POST /api/users
const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "manager", "rep"]).default("rep"),
  title: z.string().optional(),
});
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const { name, email, password, role, title } = createSchema.parse(req.body);
    const existing = await db().user.findUnique({ where: { email } });
    if (existing) throw badRequest("A user with this email already exists");
    const created = await db().user.create({
      data: { orgId: user.orgId, name, email, passwordHash: await bcrypt.hash(password, 10), role, title },
    });
    await emitEvent({ orgId: user.orgId, type: "user.created", entity: "user", entityId: created.id, actorId: user.id });
    ok(res, { user: publicUser(created) }, 201);
  })
);

// PATCH /api/users/:id — role, active, title (not password; that's a later phase)
const patchSchema = z.object({
  role: z.enum(["admin", "manager", "rep"]).optional(),
  active: z.boolean().optional(),
  title: z.string().nullable().optional(),
});
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const actor = await assertActiveUser(req);
    const target = await db().user.findUnique({ where: { id: String(req.params.id) } });
    if (!target || target.orgId !== actor.orgId) throw badRequest("User not found");
    if (target.id === actor.id && req.body.active === false) throw badRequest("You cannot disable your own account");
    const patch = patchSchema.parse(req.body);
    const updated = await db().user.update({ where: { id: target.id }, data: patch });
    await emitEvent({ orgId: actor.orgId, type: "user.updated", entity: "user", entityId: updated.id, actorId: actor.id, payload: patch });
    ok(res, { user: publicUser(updated) });
  })
);

// DELETE /api/users/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const actor = await assertActiveUser(req);
    const target = await db().user.findUnique({ where: { id: String(req.params.id) } });
    if (!target || target.orgId !== actor.orgId) throw badRequest("User not found");
    if (target.id === actor.id) throw badRequest("You cannot delete your own account");
    await db().user.delete({ where: { id: target.id } });
    await emitEvent({ orgId: actor.orgId, type: "user.deleted", entity: "user", entityId: target.id, actorId: actor.id });
    ok(res, { ok: true });
  })
);

function publicUser(u: { id: string; orgId: string; email: string; name: string; role: string; title?: string | null; active: boolean; lastLoginAt?: Date | null; createdAt: Date }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, title: u.title ?? null, active: u.active, lastLoginAt: u.lastLoginAt ?? null, createdAt: u.createdAt };
}

export default router;
