// Lead-capture forms (Phase 1) — admin-managed config for public embeddable
// forms. The public side (no auth) lives in routes/public-leads.ts. A form
// defines which lead core fields it collects; submissions create routed leads.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { getObjectDef } from "../lib/registry";

const router = Router();
router.use(requireRole("admin"));

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

// Note: NO z.default() in these schemas — Zod applies defaults even through
// .partial(), which would silently reset fields on PATCH (e.g. a rename would
// wipe a form's submitLabel/active). Defaults are applied explicitly in create.
const formFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().optional(),
  type: z.enum(["text", "email", "phone", "number"]).optional(),
});

const formSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(SLUG_RE, "Slug: 2-40 chars, lowercase letters, numbers, hyphens"),
  fields: z.array(formFieldSchema).min(1).max(10),
  submitLabel: z.string().min(1).max(40).optional(),
  active: z.boolean().optional(),
});

const normalizeFields = (fields: z.infer<typeof formFieldSchema>[]) =>
  fields.map((f) => ({ ...f, required: f.required ?? false, type: f.type ?? "text" }));

// GET /api/lead-forms
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const items = await db().leadForm.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" } });
    ok(res, { items });
  })
);

// POST /api/lead-forms
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const input = formSchema.parse(req.body);
    const leadDef = getObjectDef("lead");
    // Every exposed field must be a real lead core field.
    for (const f of input.fields) {
      if (!leadDef.fields.some((x) => x.key === f.key)) throw badRequest(`Unknown lead field: "${f.key}"`);
    }
    const existing = await db().leadForm.findFirst({ where: { orgId: user.orgId, slug: input.slug } });
    if (existing) throw badRequest(`A form with slug "${input.slug}" already exists`);
    const form = await db().leadForm.create({
      data: { orgId: user.orgId, name: input.name, slug: input.slug, fields: normalizeFields(input.fields) as object[], submitLabel: input.submitLabel ?? "Send", active: input.active ?? true },
    });
    await emitEvent({ orgId: user.orgId, environment: "production", type: "leadform.created", entity: "leadForm", entityId: form.id, actorId: user.id, payload: { name: input.name, slug: input.slug } });
    ok(res, { form }, 201);
  })
);

// PATCH /api/lead-forms/:id
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const form = await db().leadForm.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!form) throw notFound("Form not found");
    const input = formSchema.partial().parse(req.body);
    if (input.fields) {
      const leadDef = getObjectDef("lead");
      for (const f of input.fields) {
        if (!leadDef.fields.some((x) => x.key === f.key)) throw badRequest(`Unknown lead field: "${f.key}"`);
      }
    }
    if (input.slug && input.slug !== form.slug) {
      const dup = await db().leadForm.findFirst({ where: { orgId: user.orgId, slug: input.slug } });
      if (dup) throw badRequest(`A form with slug "${input.slug}" already exists`);
    }
    const updated = await db().leadForm.update({
      where: { id: form.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.fields !== undefined ? { fields: normalizeFields(input.fields) as object[] } : {}),
        ...(input.submitLabel !== undefined ? { submitLabel: input.submitLabel } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment: "production", type: "leadform.updated", entity: "leadForm", entityId: form.id, actorId: user.id, payload: { slug: updated.slug } });
    ok(res, { form: updated });
  })
);

// DELETE /api/lead-forms/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const form = await db().leadForm.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!form) throw notFound("Form not found");
    await db().leadForm.delete({ where: { id: form.id } });
    await emitEvent({ orgId: user.orgId, environment: "production", type: "leadform.deleted", entity: "leadForm", entityId: form.id, actorId: user.id, payload: { slug: form.slug } });
    ok(res, { ok: true });
  })
);

export default router;
