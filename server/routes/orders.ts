// Orders (Phase 10 · Revenue Cloud CPQ) — flag revenue.cpq.
// An order is created from a signed/approved quote (or manually from line
// items) and walks draft → confirmed → fulfilled → cancelled. Reads open,
// writes admin-only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { buildLines, createOrderFromQuote, nextReference } from "../lib/revenue";

const router = Router();

const ORDER_FLOW: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: ["cancelled"],
  cancelled: [],
};

// GET /api/orders
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().order.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 200 });
    const accountIds = [...new Set(rows.map((r) => r.accountId).filter(Boolean))] as string[];
    const accounts = accountIds.length ? await db().account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [];
    const byId = new Map(accounts.map((a) => [a.id, a.name]));
    ok(res, { items: rows.map((o) => ({ ...o, accountName: o.accountId ? byId.get(o.accountId) ?? null : null })) });
  })
);

// POST /api/orders (admin) — { quoteId } (from a signed/approved quote) or
// { name, accountId?, contactId?, lines } (manual).
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.quoteId) {
      const order = await createOrderFromQuote(user.orgId, environment, String(body.quoteId), user);
      return ok(res, { order }, 201);
    }

    const input = z.object({
      name: z.string().min(1).max(200),
      accountId: z.string().optional(),
      contactId: z.string().optional(),
      priceBookId: z.string().optional(),
      lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().positive(), discountPct: z.number().min(0).max(100).optional() })).min(1),
    }).parse(body);

    const orderNumber = await nextReference(user.orgId, environment, "order", "ORD");
    const { lines, subtotal, discountTotal, taxTotal, total } = await buildLines(user.orgId, environment, input.priceBookId, input.lines);
    const order = await db().order.create({
      data: {
        orgId: user.orgId, environment, orderNumber, accountId: input.accountId ?? null, contactId: input.contactId ?? null,
        status: "draft", lines: lines as unknown as object, subtotal, discountTotal, taxTotal, total, currency: "USD", createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "order.created", entity: "order", entityId: order.id, actorId: user.id, payload: { orderNumber, total } });
    ok(res, { order }, 201);
  })
);

// GET /api/orders/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const order = await db().order.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!order) throw notFound("Order not found");
    ok(res, { order });
  })
);

// PATCH /api/orders/:id (admin) — status transition or line re-pricing.
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const order = await db().order.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!order) throw notFound("Order not found");
    const input = z.object({ status: z.enum(["confirmed", "fulfilled", "cancelled"]).optional(), lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().positive(), discountPct: z.number().min(0).max(100).optional() })).optional() }).parse(req.body ?? {});
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) {
      const allowed = ORDER_FLOW[order.status] ?? [];
      if (!allowed.includes(input.status)) throw badRequest(`Order cannot move ${order.status} → ${input.status}`);
      data.status = input.status;
      if (input.status === "confirmed" && !order.placedAt) data.placedAt = new Date();
    }
    if (input.lines !== undefined) {
      const { lines, subtotal, discountTotal, taxTotal, total } = await buildLines(user.orgId, environment, null, input.lines);
      data.lines = lines as unknown as object;
      data.subtotal = subtotal; data.discountTotal = discountTotal; data.taxTotal = taxTotal; data.total = total;
    }
    const updated = await db().order.update({ where: { id: order.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: `order.${updated.status}`, entity: "order", entityId: updated.id, actorId: user.id, payload: { orderNumber: updated.orderNumber } });
    ok(res, { order: updated });
  })
);

// DELETE /api/orders/:id (admin) — drafts only.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const order = await db().order.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!order) throw notFound("Order not found");
    if (order.status !== "draft" && order.status !== "cancelled") throw badRequest(`Only draft/cancelled orders can be deleted (status: ${order.status})`);
    await db().order.delete({ where: { id: order.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "order.deleted", entity: "order", entityId: order.id, actorId: user.id, payload: { orderNumber: order.orderNumber } });
    ok(res, { ok: true });
  })
);

export default router;
