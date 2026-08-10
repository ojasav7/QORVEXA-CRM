// Custom-field registry — the blueprint's "no-code object builder" (v1).
// Admins define custom fields per object type; values live in each object's
// `custom` Json and are rendered dynamically by the UI (docs/02-data-model.md §Custom fields).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { OBJECTS } from "../lib/registry";
import { resolveEnvironment } from "../lib/environment";
import { fieldPermMap, canRead, canWrite } from "../lib/field-permissions";
import { writeAudit } from "../lib/audit";

const router = Router();

const TYPES = ["text", "number", "date", "boolean", "select", "multiselect", "url", "email"];

// GET /api/fields/:objectType — all fields (core def + custom) for an object type
// Custom fields are per-environment (ADR-008). `permissions` carries each field's
// read/write roles plus the EFFECTIVE read/write flags for the current user
// (the UI uses these to hide columns/inputs).
router.get(
  "/:objectType",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const def = OBJECTS.find((o) => o.type === req.params.objectType);
    if (!def) throw badRequest("Unknown object type");
    const custom = await db().fieldDef.findMany({
      where: { orgId: user.orgId, environment, objectType: def.type },
      orderBy: { order: "asc" },
    });
    const perms = await fieldPermMap(user.orgId, environment, def.type);
    const permissions = Object.entries(perms).map(([fieldKey, perm]) => ({
      fieldKey,
      readRoles: perm.readRoles,
      writeRoles: perm.writeRoles,
      read: canRead(perm, user.role),
      write: canWrite(perm, user.role),
    }));
    ok(res, { core: def.fields, custom, permissions });
  })
);

// PUT /api/fields/:objectType/permissions/:fieldKey — set read/write roles (admin)
const permSchema = z.object({
  readRoles: z.array(z.string()).optional(),
  writeRoles: z.array(z.string()).optional(),
});
router.put(
  "/:objectType/permissions/:fieldKey",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const objectType = String(req.params.objectType);
    const fieldKey = String(req.params.fieldKey);
    const def = OBJECTS.find((o) => o.type === objectType);
    if (!def) throw badRequest("Unknown object type");
    // Only real fields (core or custom, current environment) can be restricted.
    if (!def.fields.some((f) => f.key === fieldKey)) {
      const custom = await db().fieldDef.findFirst({ where: { orgId: user.orgId, environment, objectType, key: fieldKey } });
      if (!custom) throw badRequest(`Unknown field: "${fieldKey}"`);
    }
    const patch = permSchema.parse(req.body);
    const existing = await db().fieldPermission.findUnique({
      where: { orgId_environment_objectType_fieldKey: { orgId: user.orgId, environment, objectType, fieldKey } },
    });
    const before = existing ? { readRoles: existing.readRoles, writeRoles: existing.writeRoles } : { readRoles: [], writeRoles: [] };
    const after = existing
      ? await db().fieldPermission.update({
          where: { id: existing.id },
          data: { ...(patch.readRoles !== undefined ? { readRoles: patch.readRoles as string[] } : {}), ...(patch.writeRoles !== undefined ? { writeRoles: patch.writeRoles as string[] } : {}), updatedAt: new Date() },
        })
      : await db().fieldPermission.create({
          data: { orgId: user.orgId, environment, objectType, fieldKey, readRoles: (patch.readRoles ?? []) as string[], writeRoles: (patch.writeRoles ?? []) as string[] },
        });
    await writeAudit({
      orgId: user.orgId,
      environment,
      actorId: user.id,
      entity: "field",
      entityId: after.id,
      action: "permissions_updated",
      before: { fieldKey, ...before },
      after: { fieldKey, readRoles: after.readRoles, writeRoles: after.writeRoles },
      ip: req.ip,
    });
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "schema.field_permissions_updated",
      entity: "field",
      entityId: after.id,
      actorId: user.id,
      payload: { objectType, fieldKey, readRoles: after.readRoles, writeRoles: after.writeRoles },
    });
    ok(res, { permission: { fieldKey, readRoles: after.readRoles, writeRoles: after.writeRoles } });
  })
);

// DELETE /api/fields/:objectType/permissions/:fieldKey — remove the override (reset to open)
router.delete(
  "/:objectType/permissions/:fieldKey",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const objectType = String(req.params.objectType);
    const fieldKey = String(req.params.fieldKey);
    const existing = await db().fieldPermission.findUnique({
      where: { orgId_environment_objectType_fieldKey: { orgId: user.orgId, environment, objectType, fieldKey } },
    });
    if (!existing) throw badRequest("No permission override for this field");
    await db().fieldPermission.delete({ where: { id: existing.id } });
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "schema.field_permissions_updated",
      entity: "field",
      entityId: existing.id,
      actorId: user.id,
      payload: { objectType, fieldKey, readRoles: [], writeRoles: [] },
    });
    ok(res, { ok: true });
  })
);

// POST /api/fields/:objectType — create a custom field (admin only)
const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "Key must start with a letter and contain only letters/numbers"),
  label: z.string().min(1),
  type: z.enum(TYPES as [string, ...string[]]),
  required: z.boolean().optional().default(false),
  options: z.array(z.string()).optional().default([]),
});
router.post(
  "/:objectType",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const def = OBJECTS.find((o) => o.type === req.params.objectType);
    if (!def) throw badRequest("Unknown object type");
    const input = fieldSchema.parse(req.body);
    if (input.type === "select" || input.type === "multiselect") {
      if (!input.options.length) throw badRequest("Select fields need at least one option");
    }
    const existing = await db().fieldDef.findFirst({
      where: { orgId: user.orgId, environment, objectType: def.type, key: input.key },
    });
    if (existing) throw badRequest("A field with this key already exists on this object type");

    const count = await db().fieldDef.count({ where: { orgId: user.orgId, environment, objectType: def.type } });
    const field = await db().fieldDef.create({
      data: { ...input, orgId: user.orgId, environment, objectType: def.type, order: count },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "schema.field_created", entity: "field", entityId: field.id, actorId: user.id, payload: { objectType: def.type, key: input.key } });
    ok(res, { field }, 201);
  })
);

// PATCH /api/fields/:objectType/:id
router.patch(
  "/:objectType/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const field = await db().fieldDef.findUnique({ where: { id: String(req.params.id) } });
    if (!field || field.orgId !== user.orgId) throw badRequest("Field not found");
    const patch = fieldSchema.partial().parse(req.body);
    const updated = await db().fieldDef.update({ where: { id: field.id }, data: patch });
    await emitEvent({ orgId: user.orgId, environment: field.environment ?? "production", type: "schema.field_updated", entity: "field", entityId: updated.id, actorId: user.id });
    ok(res, { field: updated });
  })
);

// DELETE /api/fields/:objectType/:id
router.delete(
  "/:objectType/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const field = await db().fieldDef.findUnique({ where: { id: String(req.params.id) } });
    if (!field || field.orgId !== user.orgId) throw badRequest("Field not found");
    await db().fieldDef.delete({ where: { id: field.id } });
    await emitEvent({ orgId: user.orgId, environment: field.environment ?? "production", type: "schema.field_deleted", entity: "field", entityId: field.id, actorId: user.id, payload: { objectType: field.objectType, key: field.key } });
    ok(res, { ok: true });
  })
);

export default router;
