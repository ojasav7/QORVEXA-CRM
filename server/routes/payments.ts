// Payments (Phase 10 · Revenue Cloud) — flag revenue.billing.
// Payments are recorded against invoices (POST /api/invoices/:id/pay); this
// router lists them org-wide and handles refunds (a refunded payment linked
// via refundOf). Reads open, writes admin-only.
import { Router } from "express";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { refundPayment } from "../lib/revenue";

const router = Router();

// GET /api/payments
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().payment.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 200 });
    const invoiceIds = [...new Set(rows.map((p) => p.invoiceId))];
    const invoices = invoiceIds.length ? await db().invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNumber: true } }) : [];
    const byId = new Map(invoices.map((i) => [i.id, i.invoiceNumber]));
    ok(res, { items: rows.map((p) => ({ ...p, invoiceNumber: byId.get(p.invoiceId) ?? null })) });
  })
);

// POST /api/payments/:id/refund (admin) — refund a succeeded payment.
router.post(
  "/:id/refund",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const payment = await db().payment.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!payment) throw notFound("Payment not found");
    ok(res, await refundPayment(user.orgId, environment, payment.id, user), 201);
  })
);

export default router;
