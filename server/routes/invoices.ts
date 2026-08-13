// Invoices (Phase 10 · Revenue Cloud) — flag revenue.billing.
// Raised by the engine on subscription renewal or issued from lines/orders.
// Lifecycle: draft → issued → paid → overdue | voided. Payments are recorded
// against an invoice here (success settles it → invoice.paid; failure feeds
// dunning → payment.failed). Reads open, writes admin-only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { buildLines, issueInvoice, nextReference, recordPayment, voidInvoice } from "../lib/revenue";

const router = Router();

async function hydrate(orgId: string, environment: string, inv: any): Promise<any> {
  const [account, payments] = await Promise.all([
    inv.accountId ? db().account.findUnique({ where: { id: inv.accountId }, select: { name: true } }) : null,
    db().payment.findMany({ where: { orgId, environment, invoiceId: inv.id }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    id: inv.id, invoiceNumber: inv.invoiceNumber, accountId: inv.accountId, accountName: account?.name ?? null,
    contactId: inv.contactId, subscriptionId: inv.subscriptionId, orderId: inv.orderId, lines: inv.lines,
    subtotal: inv.subtotal, taxTotal: inv.taxTotal, total: inv.total, currency: inv.currency, status: inv.status,
    dueDate: inv.dueDate, issuedAt: inv.issuedAt, paidAt: inv.paidAt, dunningAttempts: inv.dunningAttempts,
    createdAt: inv.createdAt, updatedAt: inv.updatedAt, payments,
  };
}

// GET /api/invoices
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().invoice.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 200 });
    const items = await Promise.all(rows.map((i) => hydrate(user.orgId, environment, i)));
    ok(res, { items });
  })
);

// POST /api/invoices (admin) — manual invoice from line items (draft).
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({
      accountId: z.string().optional(),
      contactId: z.string().optional(),
      orderId: z.string().optional(),
      priceBookId: z.string().optional(),
      lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().positive(), discountPct: z.number().min(0).max(100).optional() })).min(1),
    }).parse(req.body ?? {});
    const { lines, subtotal, discountTotal, taxTotal, total } = await buildLines(user.orgId, environment, input.priceBookId, input.lines);
    const invoiceNumber = await nextReference(user.orgId, environment, "invoice", "INV");
    const invoice = await db().invoice.create({
      data: {
        orgId: user.orgId, environment, invoiceNumber, accountId: input.accountId ?? null, contactId: input.contactId ?? null,
        orderId: input.orderId ?? null, lines: lines as unknown as object, subtotal, taxTotal, total,
        currency: "USD", status: "draft", createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "invoice.created", entity: "invoice", entityId: invoice.id, actorId: user.id, payload: { invoiceNumber, total } });
    ok(res, { invoice }, 201);
  })
);

// GET /api/invoices/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const invoice = await db().invoice.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!invoice) throw notFound("Invoice not found");
    ok(res, { invoice: await hydrate(user.orgId, environment, invoice) });
  })
);

// POST /api/invoices/:id/issue (admin) — draft → issued (due in 14 days).
router.post(
  "/:id/issue",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const invoice = await db().invoice.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!invoice) throw notFound("Invoice not found");
    if (invoice.status !== "draft") throw badRequest(`Only draft invoices can be issued (status: ${invoice.status})`);
    const dueDate = new Date(Date.now() + 14 * 86_400_000);
    const updated = await db().invoice.update({ where: { id: invoice.id }, data: { status: "issued", issuedAt: new Date(), dueDate, updatedAt: new Date() } });
    await emitEvent({ orgId: user.orgId, environment, type: "invoice.issued", entity: "invoice", entityId: invoice.id, actorId: user.id, payload: { invoiceNumber: invoice.invoiceNumber, total: invoice.total, dueDate: dueDate.toISOString() } });
    ok(res, { invoice: await hydrate(user.orgId, environment, updated) });
  })
);

// POST /api/invoices/:id/pay (admin) — record a payment attempt.
// { amount, method?, fail?, failureReason? }
router.post(
  "/:id/pay",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = z.object({ amount: z.number().positive(), method: z.enum(["card", "bank", "other"]).optional(), fail: z.boolean().optional(), failureReason: z.string().optional() }).parse(req.body ?? {});
    ok(res, await recordPayment(user.orgId, environment, { invoiceId: String(req.params.id), amount: input.amount, method: input.method, fail: input.fail, failureReason: input.failureReason }, user), 201);
  })
);

// POST /api/invoices/:id/void (admin)
router.post(
  "/:id/void",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { invoice: await voidInvoice(user.orgId, environment, String(req.params.id), user) });
  })
);

// DELETE /api/invoices/:id (admin) — drafts only.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const invoice = await db().invoice.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!invoice) throw notFound("Invoice not found");
    if (invoice.status !== "draft") throw badRequest(`Only draft invoices can be deleted (status: ${invoice.status})`);
    await db().invoice.delete({ where: { id: invoice.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "invoice.deleted", entity: "invoice", entityId: invoice.id, actorId: user.id, payload: { invoiceNumber: invoice.invoiceNumber } });
    ok(res, { ok: true });
  })
);

export default router;
