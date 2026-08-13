// Price books (Phase 10 · Revenue Cloud) — flag revenue.products.
// Named price lists: entries = [{ productId, price }] (per-product override
// over the catalog listPrice), discounts = [{ productId, pct }] (applied at
// quote/order build). One book per org × env is the DEFAULT (lazily seeded);
// quotes resolve line prices from a book, falling back to the default.
// Reads open, writes admin-only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";

const router = Router();

const bookSchema = z.object({
  name: z.string().min(1).max(120),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});
const entrySchema = z.array(z.object({ productId: z.string().min(1), price: z.number().nonnegative() }));
const discountSchema = z.array(z.object({ productId: z.string().min(1), pct: z.number().min(0).max(100) }));

async function assertProductsExist(orgId: string, environment: string, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return;
  const found = await db().product.findMany({ where: { id: { in: ids }, orgId, environment }, select: { id: true } });
  if (found.length !== ids.length) throw badRequest("One or more product ids are unknown in this org");
}

// GET /api/price-books
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().priceBook.findMany({ where: { orgId: user.orgId, environment }, orderBy: { isDefault: "desc" } });
    const productIds = [...new Set(rows.flatMap((b) => ((b.entries ?? []) as { productId: string }[]).map((e) => e.productId)))];
    const products = productIds.length ? await db().product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } }) : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    ok(res, {
      items: rows.map((b) => ({
        id: b.id, name: b.name, isDefault: b.isDefault, active: b.active, createdAt: b.createdAt, updatedAt: b.updatedAt,
        entries: ((b.entries ?? []) as { productId: string; price: number }[]).map((e) => ({ productId: e.productId, price: e.price, productName: byId.get(e.productId)?.name ?? null, sku: byId.get(e.productId)?.sku ?? null })),
        discounts: b.discounts ?? [],
      })),
    });
  })
);

// POST /api/price-books (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = bookSchema.parse(req.body);
    if (input.isDefault) await db().priceBook.updateMany({ where: { orgId: user.orgId, environment }, data: { isDefault: false } });
    const book = await db().priceBook.create({
      data: { orgId: user.orgId, environment, name: input.name, isDefault: input.isDefault ?? false, entries: [], discounts: [], active: input.active ?? true },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "priceBook.created", entity: "priceBook", entityId: book.id, actorId: user.id, payload: { name: book.name, isDefault: book.isDefault } });
    ok(res, { book }, 201);
  })
);

// GET /api/price-books/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const book = await db().priceBook.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!book) throw notFound("Price book not found");
    ok(res, { book });
  })
);

// PATCH /api/price-books/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const book = await db().priceBook.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!book) throw notFound("Price book not found");
    const input = bookSchema.partial().parse(req.body);
    if (input.isDefault) await db().priceBook.updateMany({ where: { orgId: user.orgId, environment, id: { not: book.id } }, data: { isDefault: false } });
    const updated = await db().priceBook.update({
      where: { id: book.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: new Date(),
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "priceBook.updated", entity: "priceBook", entityId: book.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { book: updated });
  })
);

// PUT /api/price-books/:id/entries (admin) — replace the price entries.
router.put(
  "/:id/entries",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const book = await db().priceBook.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!book) throw notFound("Price book not found");
    const entries = entrySchema.parse(req.body);
    await assertProductsExist(user.orgId, environment, entries.map((e) => e.productId));
    const updated = await db().priceBook.update({ where: { id: book.id }, data: { entries: entries as unknown as object, updatedAt: new Date() } });
    ok(res, { book: updated });
  })
);

// PUT /api/price-books/:id/discounts (admin) — replace the discount list.
router.put(
  "/:id/discounts",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const book = await db().priceBook.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!book) throw notFound("Price book not found");
    const discounts = discountSchema.parse(req.body);
    await assertProductsExist(user.orgId, environment, discounts.map((d) => d.productId));
    const updated = await db().priceBook.update({ where: { id: book.id }, data: { discounts: discounts as unknown as object, updatedAt: new Date() } });
    ok(res, { book: updated });
  })
);

// DELETE /api/price-books/:id (admin) — default books cannot be deleted.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const book = await db().priceBook.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!book) throw notFound("Price book not found");
    if (book.isDefault) throw badRequest("The default price book cannot be deleted");
    await db().priceBook.delete({ where: { id: book.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "priceBook.deleted", entity: "priceBook", entityId: book.id, actorId: user.id, payload: { name: book.name } });
    ok(res, { ok: true });
  })
);

export default router;
