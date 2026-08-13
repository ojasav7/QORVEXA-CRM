// Subscriptions (Phase 10 · Revenue Cloud) — flag revenue.billing.
// Recurring-revenue units: the engine ticker advances currentPeriodEnd and
// raises renewal invoices; payment failures flip status to past_due (dunning).
// MRR contribution is derived at read (unitPrice × quantity ÷ period months).
// Reads open, writes admin-only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { cancelSubscription, getSubscription, issueInvoice, mrrOf, periodEnd, periodMonths, r2 } from "../lib/revenue";

const router = Router();

const subSchema = z.object({
  name: z.string().min(1).max(200),
  accountId: z.string().optional(),
  productId: z.string().min(1),
  quoteId: z.string().optional(),
  orderId: z.string().optional(),
  billingPeriod: z.enum(["monthly", "quarterly", "annual"]).optional(),
  unitPrice: z.number().nonnegative().optional(),
  quantity: z.number().int().positive().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
  autoRenew: z.boolean().optional(),
});

async function hydrate(orgId: string, environment: string, s: any): Promise<any> {
  const [product, account] = await Promise.all([
    db().product.findUnique({ where: { id: s.productId }, select: { name: true, sku: true } }),
    s.accountId ? db().account.findUnique({ where: { id: s.accountId }, select: { name: true } }) : null,
  ]);
  return {
    id: s.id, name: s.name, accountId: s.accountId, accountName: account?.name ?? null, productId: s.productId,
    productName: product?.name ?? null, sku: product?.sku ?? null, quoteId: s.quoteId, orderId: s.orderId,
    billingPeriod: s.billingPeriod, unitPrice: s.unitPrice, quantity: s.quantity, status: s.status,
    startedAt: s.startedAt, currentPeriodEnd: s.currentPeriodEnd, autoRenew: s.autoRenew, cancelledAt: s.cancelledAt,
    mrr: mrrOf(s), createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

// GET /api/subscriptions
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().subscription.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 200 });
    const items = await Promise.all(rows.map((s) => hydrate(user.orgId, environment, s)));
    ok(res, { items });
  })
);

// POST /api/subscriptions (admin)
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = subSchema.parse(req.body);
    const product = await db().product.findFirst({ where: { id: input.productId, orgId: user.orgId, environment } });
    if (!product) throw badRequest("Product not found");
    const startedAt = new Date();
    const sub = await db().subscription.create({
      data: {
        orgId: user.orgId, environment, accountId: input.accountId ?? null, productId: input.productId,
        quoteId: input.quoteId ?? null, orderId: input.orderId ?? null, name: input.name,
        billingPeriod: input.billingPeriod ?? "monthly", unitPrice: input.unitPrice ?? product.listPrice,
        quantity: input.quantity ?? 1, status: "active", startedAt,
        currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : new Date(startedAt.getTime() + periodMonths(input.billingPeriod ?? "monthly") * 30 * 86_400_000),
        autoRenew: input.autoRenew ?? true,
        createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "subscription.created", entity: "subscription", entityId: sub.id, actorId: user.id, payload: { name: sub.name, productId: sub.productId, mrr: mrrOf(sub) } });
    ok(res, { subscription: await hydrate(user.orgId, environment, sub) }, 201);
  })
);

// GET /api/subscriptions/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const sub = await getSubscription(user.orgId, environment, String(req.params.id));
    ok(res, { subscription: await hydrate(user.orgId, environment, sub) });
  })
);

// PATCH /api/subscriptions/:id (admin)
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const sub = await getSubscription(user.orgId, environment, String(req.params.id));
    const input = subSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name;
    if (input.accountId !== undefined) data.accountId = input.accountId ?? null;
    if (input.quoteId !== undefined) data.quoteId = input.quoteId ?? null;
    if (input.orderId !== undefined) data.orderId = input.orderId ?? null;
    if (input.billingPeriod !== undefined) data.billingPeriod = input.billingPeriod;
    if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
    if (input.quantity !== undefined) data.quantity = input.quantity;
    if (input.currentPeriodEnd !== undefined) data.currentPeriodEnd = new Date(input.currentPeriodEnd);
    if (input.autoRenew !== undefined) data.autoRenew = input.autoRenew;
    const updated = await db().subscription.update({ where: { id: sub.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "subscription.updated", entity: "subscription", entityId: sub.id, actorId: user.id, payload: { name: updated.name } });
    ok(res, { subscription: await hydrate(user.orgId, environment, updated) });
  })
);

// POST /api/subscriptions/:id/cancel (admin)
router.post(
  "/:id/cancel",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { subscription: await hydrate(user.orgId, environment, await cancelSubscription(user.orgId, environment, String(req.params.id), user)) });
  })
);

// POST /api/subscriptions/:id/renew (admin) — advance the billing period now
// (raises the next invoice + emits subscription.renewal_due) — same logic as
// the engine ticker, exposed for deterministic manual verification.
router.post(
  "/:id/renew",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const sub = await getSubscription(user.orgId, environment, String(req.params.id));
    if (!["active", "past_due"].includes(sub.status)) throw badRequest(`Only active subscriptions renew (status: ${sub.status})`);
    if (!sub.autoRenew) throw badRequest("Subscription auto-renew is off");
    const product = await db().product.findUnique({ where: { id: sub.productId } });
    const line = {
      productId: sub.productId, productName: product?.name ?? sub.name, sku: product?.sku ?? "—",
      quantity: sub.quantity, unitPrice: r2(sub.unitPrice), discountPct: 0, lineTotal: r2(sub.unitPrice * sub.quantity),
    };
    const invoice = await issueInvoice(user.orgId, environment, { accountId: sub.accountId, subscriptionId: sub.id, lines: [line] }, user);
    const next = periodEnd(sub);
    const updated = await db().subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: next, status: "active", updatedAt: new Date() } });
    await emitEvent({ orgId: user.orgId, environment, type: "subscription.renewal_due", entity: "subscription", entityId: sub.id, actorId: user.id, payload: { name: sub.name, nextPeriodEnd: next.toISOString() } });
    ok(res, { invoice, subscription: await hydrate(user.orgId, environment, updated) }, 201);
  })
);

// DELETE /api/subscriptions/:id (admin) — cancelled/expired only.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const sub = await getSubscription(user.orgId, environment, String(req.params.id));
    if (!["cancelled", "expired"].includes(sub.status)) throw badRequest(`Only cancelled/expired subscriptions can be deleted (status: ${sub.status})`);
    await db().subscription.delete({ where: { id: sub.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "subscription.deleted", entity: "subscription", entityId: sub.id, actorId: user.id, payload: { name: sub.name } });
    ok(res, { ok: true });
  })
);

export default router;
