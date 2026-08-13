// Product catalog (Phase 10 · Revenue Cloud) — flag revenue.products.
// Reads open (pricing is org-internal), writes admin-only (same pattern as
// every config entity). `components` makes a product a bundle: the CPQ line
// builder expands it into component lines.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";

const router = Router();

const productSchema = z.object({
  name: z.string().min(1).max(120),
  sku: z.string().min(1).max(60),
  description: z.string().max(1000).optional(),
  category: z.enum(["software", "service", "hardware", "bundle", "other"]).optional(),
  listPrice: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  taxable: z.boolean().optional(),
  components: z.array(z.object({ productId: z.string().min(1), quantity: z.number().positive() })).optional(),
  active: z.boolean().optional(),
});

function normalizeComponents(raw: unknown): { productId: string; quantity: number }[] {
  const list = (raw ?? []) as { productId?: string; quantity?: number }[];
  const out: { productId: string; quantity: number }[] = [];
  for (const c of list) {
    const id = String(c.productId ?? "").trim();
    const qty = Number(c.quantity);
    if (!id || !Number.isFinite(qty) || qty <= 0) throw badRequest("components entries need a valid productId + positive quantity");
    out.push({ productId: id, quantity: qty });
  }
  return out;
}

// GET /api/products
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().product.findMany({ where: { orgId: user.orgId, environment }, orderBy: { name: "asc" } });
    ok(res, { items: rows });
  })
);

// POST /api/products (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = productSchema.parse(req.body);
    const dup = await db().product.findFirst({ where: { orgId: user.orgId, environment, sku: input.sku } });
    if (dup) throw badRequest(`SKU ${input.sku} already exists`);
    const product = await db().product.create({
      data: {
        orgId: user.orgId, environment, name: input.name, sku: input.sku, description: input.description ?? null,
        category: input.category ?? "software", listPrice: input.listPrice ?? 0, cost: input.cost ?? 0,
        taxable: input.taxable ?? true, components: normalizeComponents(input.components) as unknown as object,
        active: input.active ?? true,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "product.created", entity: "product", entityId: product.id, actorId: user.id, payload: { name: product.name, sku: product.sku, listPrice: product.listPrice } });
    ok(res, { product }, 201);
  })
);

// GET /api/products/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const product = await db().product.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!product) throw notFound("Product not found");
    ok(res, { product });
  })
);

// PATCH /api/products/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const product = await db().product.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!product) throw notFound("Product not found");
    const input = productSchema.partial().parse(req.body);
    if (input.sku !== undefined) {
      const dup = await db().product.findFirst({ where: { orgId: user.orgId, environment, sku: input.sku, id: { not: product.id } } });
      if (dup) throw badRequest(`SKU ${input.sku} already exists`);
    }
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.category !== undefined) data.category = input.category;
    if (input.listPrice !== undefined) data.listPrice = input.listPrice;
    if (input.cost !== undefined) data.cost = input.cost;
    if (input.taxable !== undefined) data.taxable = input.taxable;
    if (input.components !== undefined) data.components = normalizeComponents(input.components) as unknown as object;
    if (input.active !== undefined) data.active = input.active;
    const updated = await db().product.update({ where: { id: product.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "product.updated", entity: "product", entityId: product.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { product: updated });
  })
);

// DELETE /api/products/:id (admin)
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const product = await db().product.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!product) throw notFound("Product not found");
    const inBook = ((await db().priceBook.findMany({ where: { orgId: user.orgId, environment } })) as any[]).some((b) =>
      ((b.entries ?? []) as { productId: string }[]).some((e) => e.productId === product.id)
    );
    if (inBook) throw badRequest("Product is referenced by a price book — remove it there first");
    await db().product.delete({ where: { id: product.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "product.deleted", entity: "product", entityId: product.id, actorId: user.id, payload: { name: product.name } });
    ok(res, { ok: true });
  })
);

export default router;
