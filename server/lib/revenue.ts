// Revenue Cloud (Phase 10 · ADR-022) — the money half of the CRM.
//
// Products → price books → quotes (CPQ approval + mock e-signature) → orders
// → contracts (with intelligence) → subscriptions → invoices → payments +
// dunning, with MRR/ARR derived on read (the Phase 6 / ADR-018 discipline:
// totals and recurring-revenue numbers are COMPUTED, never stored as truth).
// The engine (runRevenueTicker) advances subscription billing and dunning on
// a ticker — like the journey engine — and can be run synchronously by the
// admin "tick" endpoint for deterministic verification.
import { db } from "../db";
import { badRequest, notFound } from "./http";
import { emitEvent } from "./events";

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** How many calendar months one billing period covers. */
export const PERIOD_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

/** Org-configurable sales tax rate (Organization.settings.revenue.taxRate). */
export async function taxRateFor(orgId: string): Promise<number> {
  const org = await db().organization.findUnique({ where: { id: orgId } });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const revenue = (settings.revenue ?? {}) as Record<string, unknown>;
  const rate = Number(revenue.taxRate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.08;
}

// ── Reference numbers (PREFIX-####, per org × env — ticket pattern) ────────
export async function nextReference(orgId: string, environment: string, model: string, prefix: string): Promise<string> {
  const rows = await (db() as any)[model].findMany({ where: { orgId, environment }, select: { [model === "quote" ? "quoteNumber" : model === "order" ? "orderNumber" : model === "contract" ? "contractNumber" : "invoiceNumber"]: true } });
  let max = 0;
  for (const r of rows) {
    const field = model === "quote" ? r.quoteNumber : model === "order" ? r.orderNumber : model === "contract" ? r.contractNumber : r.invoiceNumber;
    const n = parseInt(String(field).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

// ── Price books (lazy default seed — SlaPolicy/pipeline precedent) ──────────
export async function ensureDefaultPriceBook(orgId: string, environment: string): Promise<string> {
  const existing = await db().priceBook.findFirst({ where: { orgId, environment, isDefault: true } });
  if (existing) return existing.id;
  const book = await db().priceBook.create({ data: { orgId, environment, name: "Standard", isDefault: true, entries: [], discounts: [] } });
  return book.id;
}

export async function priceBookFor(orgId: string, environment: string, id?: string | null): Promise<any> {
  if (id) {
    const book = await db().priceBook.findFirst({ where: { id, orgId, environment } });
    if (book) return book;
  }
  const def = await db().priceBook.findFirst({ where: { orgId, environment, isDefault: true } });
  if (def) return def;
  const id2 = await ensureDefaultPriceBook(orgId, environment);
  return db().priceBook.findUnique({ where: { id: id2 } });
}

/** Effective per-unit price for a product: price book entry → product listPrice. */
export async function unitPriceFor(orgId: string, environment: string, priceBookId: string | null | undefined, productId: string): Promise<number> {
  const product = await db().product.findFirst({ where: { id: productId, orgId, environment } });
  if (!product) throw badRequest(`Product not found`);
  const book = await priceBookFor(orgId, environment, priceBookId);
  const entries = ((book?.entries ?? []) as { productId: string; price: number }[]);
  const entry = entries.find((e) => e.productId === productId);
  return entry ? r2(Number(entry.price) || 0) : r2(product.listPrice);
}

// ── Quote/order line building (CPQ): bundle expansion + totals ──────────────
export type LineItem = { productId: string; quantity: number; discountPct?: number };
export type PriceLine = { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; discountPct: number; lineTotal: number };
export type Totals = { lines: PriceLine[]; subtotal: number; discountTotal: number; taxTotal: number; total: number; taxRate: number };

/**
 * Build priced lines from line items. A product whose `components` is
 * non-empty is a BUNDLE and expands to its component lines (component price ×
 * quantity), so a quote/order can sell a bundle as one line item. Per-line
 * discountPct overrides the price book's discount for that product.
 */
export async function buildLines(orgId: string, environment: string, priceBookId: string | null | undefined, items: LineItem[]): Promise<Totals> {
  if (!items.length) throw badRequest("At least one line item is required");
  const book = await priceBookFor(orgId, environment, priceBookId);
  const discounts = ((book?.discounts ?? []) as { productId: string; pct: number }[]);
  const discFor = (productId: string) => discounts.find((d) => d.productId === productId)?.pct ?? 0;

  const lines: PriceLine[] = [];
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest("Quantity must be a positive number");
    const product = await db().product.findFirst({ where: { id: item.productId, orgId, environment } });
    if (!product) throw badRequest(`Product not found`);
    const components = (product.components ?? []) as { productId: string; quantity: number }[];
    if (components.length) {
      for (const c of components) {
        const price = await unitPriceFor(orgId, environment, priceBookId, c.productId);
        const pct = item.discountPct ?? discFor(c.productId);
        const total = r2(price * qty * c.quantity);
        lines.push({
          productId: c.productId, productName: (await productName(orgId, environment, c.productId)), sku: (await productSku(orgId, environment, c.productId)),
          quantity: qty * c.quantity, unitPrice: price, discountPct: r2(pct), lineTotal: r2(total * (1 - pct / 100)),
        });
      }
    } else {
      const price = await unitPriceFor(orgId, environment, priceBookId, product.id);
      const pct = item.discountPct ?? discFor(product.id);
      lines.push({
        productId: product.id, productName: product.name, sku: product.sku,
        quantity: qty, unitPrice: price, discountPct: r2(pct), lineTotal: r2(price * qty * (1 - pct / 100)),
      });
    }
  }
  return computeTotals(lines, await taxRateFor(orgId));
}

export async function productName(orgId: string, environment: string, productId: string): Promise<string> {
  const p = await db().product.findFirst({ where: { id: productId, orgId, environment }, select: { name: true } });
  return p?.name ?? "Unknown product";
}
export async function productSku(orgId: string, environment: string, productId: string): Promise<string> {
  const p = await db().product.findFirst({ where: { id: productId, orgId, environment }, select: { sku: true } });
  return p?.sku ?? "—";
}

/** Recompute { subtotal, discountTotal, taxTotal, total } from priced lines. */
export function computeTotals(lines: PriceLine[], taxRate: number): Totals {
  const subtotal = r2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const discountTotal = r2(lines.reduce((s, l) => s + l.unitPrice * l.quantity * (l.discountPct / 100), 0));
  const taxTotal = r2((subtotal - discountTotal) * taxRate);
  const total = r2(subtotal - discountTotal + taxTotal);
  return { lines, subtotal, discountTotal, taxTotal, total, taxRate };
}

// ── Quote lifecycle (CPQ approval + mock e-signature) ───────────────────────
export const QUOTE_FLOW: Record<string, string[]> = {
  draft: ["needs_approval", "voided"],
  needs_approval: ["approved", "voided"],
  approved: ["sent", "voided"],
  sent: ["signed", "lost", "voided"],
  signed: ["won", "lost", "voided"],
  won: [],
  lost: [],
  voided: [],
};

export function assertQuoteTransition(current: string, next: string): void {
  const allowed = QUOTE_FLOW[current] ?? [];
  if (!allowed.includes(next)) throw badRequest(`Quote cannot move ${current} → ${next}`);
}

export async function submitQuote(orgId: string, environment: string, quoteId: string, actor: { id: string }): Promise<any> {
  const quote = await getQuote(orgId, environment, quoteId);
  assertQuoteTransition(quote.status, "needs_approval");
  const updated = await db().quote.update({ where: { id: quote.id }, data: { status: "needs_approval", updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "quote.submitted", entity: "quote", entityId: quote.id, actorId: actor.id, payload: { quoteNumber: quote.quoteNumber } });
  return updated;
}

export async function approveQuote(orgId: string, environment: string, quoteId: string, actor: { id: string; name?: string; role: string }): Promise<any> {
  const quote = await getQuote(orgId, environment, quoteId);
  assertQuoteTransition(quote.status, "approved");
  const approvals = [...((quote.approvals ?? []) as Record<string, unknown>[]), { by: actor.id, name: actor.name ?? null, role: actor.role, at: new Date().toISOString(), decision: "approved" }];
  const updated = await db().quote.update({ where: { id: quote.id }, data: { status: "approved", approvals: approvals as object, updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "quote.approved", entity: "quote", entityId: quote.id, actorId: actor.id, payload: { quoteNumber: quote.quoteNumber } });
  return updated;
}

export async function sendQuote(orgId: string, environment: string, quoteId: string, actor: { id: string }): Promise<any> {
  const quote = await getQuote(orgId, environment, quoteId);
  assertQuoteTransition(quote.status, "sent");
  const updated = await db().quote.update({ where: { id: quote.id }, data: { status: "sent", updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "quote.sent", entity: "quote", entityId: quote.id, actorId: actor.id, payload: { quoteNumber: quote.quoteNumber } });
  return updated;
}

/** Mock e-signature (ADR-014: no external e-sign provider in v1). */
export async function signQuote(orgId: string, environment: string, quoteId: string, signature: { name: string; email?: string }, actor: { id: string }): Promise<any> {
  const quote = await getQuote(orgId, environment, quoteId);
  assertQuoteTransition(quote.status, "signed");
  if (!signature?.name?.trim()) throw badRequest("Signature name is required");
  const updated = await db().quote.update({
    where: { id: quote.id },
    data: { status: "signed", signature: { name: signature.name.trim(), email: signature.email ?? null, at: new Date().toISOString() } as object, updatedAt: new Date() },
  });
  await emitEvent({ orgId, environment, type: "quote.signed", entity: "quote", entityId: quote.id, actorId: actor.id, payload: { quoteNumber: quote.quoteNumber, signer: signature.name.trim() } });
  return updated;
}

export async function setQuoteOutcome(orgId: string, environment: string, quoteId: string, outcome: "won" | "lost" | "voided", actor: { id: string }): Promise<any> {
  const quote = await getQuote(orgId, environment, quoteId);
  assertQuoteTransition(quote.status, outcome);
  const updated = await db().quote.update({ where: { id: quote.id }, data: { status: outcome, updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: `quote.${outcome}`, entity: "quote", entityId: quote.id, actorId: actor.id, payload: { quoteNumber: quote.quoteNumber } });
  return updated;
}

export async function getQuote(orgId: string, environment: string, quoteId: string): Promise<any> {
  const quote = await db().quote.findFirst({ where: { id: quoteId, orgId, environment } });
  if (!quote) throw notFound("Quote not found");
  return quote;
}

// ── Orders (from signed/approved quotes, or manual) ─────────────────────────
/** Create an order from a signed (or approved) quote — same lines + totals. */
export async function createOrderFromQuote(orgId: string, environment: string, quoteId: string, actor: { id: string }): Promise<any> {
  const quote = await getQuote(orgId, environment, quoteId);
  if (!["signed", "approved", "won"].includes(quote.status)) throw badRequest(`Order requires a signed/approved quote (quote is ${quote.status})`);
  const orderNumber = await nextReference(orgId, environment, "order", "ORD");
  const order = await db().order.create({
    data: {
      orgId, environment, orderNumber, quoteId: quote.id, accountId: quote.accountId, contactId: quote.contactId,
      status: "confirmed", lines: quote.lines as object, subtotal: quote.subtotal, discountTotal: quote.discountTotal,
      taxTotal: quote.taxTotal, total: quote.total, currency: quote.currency, placedAt: new Date(), createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "order.created", entity: "order", entityId: order.id, actorId: actor.id, payload: { orderNumber, quoteId: quote.id, total: order.total } });
  return order;
}

// ── Subscriptions ───────────────────────────────────────────────────────────
export function periodMonths(billingPeriod: string): number {
  return PERIOD_MONTHS[billingPeriod] ?? 1;
}

/** Monthly recurring revenue contribution of one subscription. */
export function mrrOf(sub: { unitPrice: number; quantity: number; billingPeriod: string }): number {
  return r2((sub.unitPrice * sub.quantity) / periodMonths(sub.billingPeriod));
}

export function periodEnd(sub: { currentPeriodEnd: Date | null; billingPeriod: string; startedAt: Date }): Date {
  const base = sub.currentPeriodEnd ?? sub.startedAt ?? new Date();
  return new Date(base.getTime() + periodMonths(sub.billingPeriod) * 30 * 86_400_000);
}

export async function cancelSubscription(orgId: string, environment: string, subscriptionId: string, actor: { id: string }): Promise<any> {
  const sub = await getSubscription(orgId, environment, subscriptionId);
  if (!["active", "past_due"].includes(sub.status)) throw badRequest(`Only active subscriptions can be cancelled (status: ${sub.status})`);
  const updated = await db().subscription.update({ where: { id: sub.id }, data: { status: "cancelled", cancelledAt: new Date(), autoRenew: false, updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "subscription.cancelled", entity: "subscription", entityId: sub.id, actorId: actor.id, payload: { name: sub.name } });
  return updated;
}

export async function getSubscription(orgId: string, environment: string, id: string): Promise<any> {
  const sub = await db().subscription.findFirst({ where: { id, orgId, environment } });
  if (!sub) throw notFound("Subscription not found");
  return sub;
}

// ── Invoices + payments + dunning ────────────────────────────────────────────
export async function issueInvoice(orgId: string, environment: string, input: {
  accountId?: string | null; contactId?: string | null; subscriptionId?: string | null; orderId?: string | null;
  lines: PriceLine[]; dueInDays?: number;
}, actor: { id: string }): Promise<any> {
  const { subtotal, discountTotal, taxTotal, total, taxRate } = computeTotals(input.lines, await taxRateFor(orgId));
  const invoiceNumber = await nextReference(orgId, environment, "invoice", "INV");
  const dueDate = new Date(Date.now() + (input.dueInDays ?? 14) * 86_400_000);
  const invoice = await db().invoice.create({
    data: {
      orgId, environment, invoiceNumber, accountId: input.accountId ?? null, contactId: input.contactId ?? null,
      subscriptionId: input.subscriptionId ?? null, orderId: input.orderId ?? null,
      lines: input.lines as object, subtotal, taxTotal, total, currency: "USD",
      status: "issued", dueDate, issuedAt: new Date(), createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "invoice.issued", entity: "invoice", entityId: invoice.id, actorId: actor.id, payload: { invoiceNumber, total, dueDate: dueDate.toISOString(), taxRate } });
  return invoice;
}

/** Record a payment attempt. Success settles the invoice; failure feeds dunning. */
export async function recordPayment(orgId: string, environment: string, input: {
  invoiceId: string; amount: number; method?: string; fail?: boolean; failureReason?: string;
}, actor: { id: string }): Promise<any> {
  const invoice = await db().invoice.findFirst({ where: { id: input.invoiceId, orgId, environment } });
  if (!invoice) throw notFound("Invoice not found");
  if (invoice.status === "paid") throw badRequest("Invoice is already paid");
  if (invoice.status === "voided") throw badRequest("Invoice is voided");
  const amount = r2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("Amount must be positive");

  const payment = await db().payment.create({
    data: {
      orgId, environment, invoiceId: invoice.id, accountId: invoice.accountId, amount,
      method: input.method ?? "card", status: input.fail ? "failed" : "succeeded",
      failureReason: input.fail ? (input.failureReason ?? "Card declined (mock)") : null,
      paidAt: input.fail ? null : new Date(), createdBy: actor.id,
    },
  });

  if (input.fail) {
    await db().invoice.update({ where: { id: invoice.id }, data: { dunningAttempts: { increment: 1 }, updatedAt: new Date() } });
    if (invoice.subscriptionId) {
      await db().subscription.update({ where: { id: invoice.subscriptionId }, data: { status: "past_due", updatedAt: new Date() } });
      await emitEvent({ orgId, environment, type: "subscription.past_due", entity: "subscription", entityId: invoice.subscriptionId, actorId: actor.id, payload: { invoiceNumber: invoice.invoiceNumber, amount } });
    }
    await emitEvent({ orgId, environment, type: "payment.failed", entity: "payment", entityId: payment.id, actorId: actor.id, payload: { invoiceNumber: invoice.invoiceNumber, amount, reason: payment.failureReason } });
    await notifyAdmins(orgId, environment, `Payment failed — ${invoice.invoiceNumber}`, `${money(amount)} could not be collected (${payment.failureReason}). Dunning attempt ${invoice.dunningAttempts + 1}.`, `/revenue?tab=billing`);
  } else {
    await db().invoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt: new Date(), updatedAt: new Date() } });
    // Dunning recovery: a settled invoice reactivates a past-due subscription.
    if (invoice.subscriptionId) {
      const sub = await db().subscription.findUnique({ where: { id: invoice.subscriptionId } });
      if (sub && sub.status === "past_due") {
        await db().subscription.update({ where: { id: sub.id }, data: { status: "active", updatedAt: new Date() } });
        await emitEvent({ orgId, environment, type: "subscription.reactivated", entity: "subscription", entityId: sub.id, actorId: actor.id, payload: { invoiceNumber: invoice.invoiceNumber } });
      }
    }
    await emitEvent({ orgId, environment, type: "payment.succeeded", entity: "payment", entityId: payment.id, actorId: actor.id, payload: { invoiceNumber: invoice.invoiceNumber, amount } });
    await emitEvent({ orgId, environment, type: "invoice.paid", entity: "invoice", entityId: invoice.id, actorId: actor.id, payload: { invoiceNumber: invoice.invoiceNumber, amount } });
  }
  return { payment, invoice: await db().invoice.findUnique({ where: { id: invoice.id } }) };
}

/** Refund a succeeded payment — creates a refunded payment linked via refundOf. */
export async function refundPayment(orgId: string, environment: string, paymentId: string, actor: { id: string }): Promise<any> {
  const payment = await db().payment.findFirst({ where: { id: paymentId, orgId, environment } });
  if (!payment) throw notFound("Payment not found");
  if (payment.status !== "succeeded") throw badRequest("Only succeeded payments can be refunded");
  const refund = await db().payment.create({
    data: {
      orgId, environment, invoiceId: payment.invoiceId, accountId: payment.accountId, amount: payment.amount,
      method: payment.method, status: "refunded", refundOf: payment.id, paidAt: new Date(), createdBy: actor.id,
    },
  });
  await emitEvent({ orgId, environment, type: "payment.refunded", entity: "payment", entityId: refund.id, actorId: actor.id, payload: { invoiceId: payment.invoiceId, amount: payment.amount, refundOf: payment.id } });
  await notifyAdmins(orgId, environment, `Refund issued`, `${money(payment.amount)} refunded to the original payment.`, `/revenue?tab=billing`);
  return { refund, original: payment };
}

export async function voidInvoice(orgId: string, environment: string, invoiceId: string, actor: { id: string }): Promise<any> {
  const invoice = await db().invoice.findFirst({ where: { id: invoiceId, orgId, environment } });
  if (!invoice) throw notFound("Invoice not found");
  if (!["draft", "issued", "overdue"].includes(invoice.status)) throw badRequest(`Invoice ${invoice.status} cannot be voided`);
  const updated = await db().invoice.update({ where: { id: invoice.id }, data: { status: "voided", updatedAt: new Date() } });
  await emitEvent({ orgId, environment, type: "invoice.voided", entity: "invoice", entityId: invoice.id, actorId: actor.id, payload: { invoiceNumber: invoice.invoiceNumber } });
  return updated;
}

// ── Notifications (kind: revenue) ───────────────────────────────────────────
export async function notifyAdmins(orgId: string, environment: string, title: string, body: string, link: string): Promise<void> {
  const admins = await db().user.findMany({ where: { orgId, role: "admin", active: true }, select: { id: true } });
  for (const a of admins) {
    await db().notification.create({ data: { orgId, environment, userId: a.id, title, body, kind: "revenue", link } });
  }
}

export const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// ── The engine: subscription renewals + dunning + contract warnings ─────────
export type TickerResult = {
  renewed: number; issued: number; overdue: number; contractWarnings: number; contractsExpired: number; subsExpired: number;
};

/**
 * One pass of the revenue engine (ticker or manual "tick"):
 * 1. Renew subscriptions whose currentPeriodEnd has passed (issue the next
 *    invoice, advance the period) — subscription.renewal_due + invoice.issued.
 * 2. Expire non-auto-renew subscriptions whose period ended.
 * 3. Mark issued invoices past their due date overdue — invoice.overdue.
 * 4. Flag active contracts entering their renewal-notice window
 *    (contract.renewal_due) and expire ones past endDate.
 */
export async function runRevenueTicker(orgId: string, environment: string): Promise<TickerResult> {
  const now = new Date();
  const result: TickerResult = { renewed: 0, issued: 0, overdue: 0, contractWarnings: 0, contractsExpired: 0, subsExpired: 0 };

  // 1 + 2. Subscription renewals / expiry
  const subs = await db().subscription.findMany({ where: { orgId, environment, status: { in: ["active", "past_due"] } } });
  for (const sub of subs) {
    if (sub.currentPeriodEnd && sub.currentPeriodEnd <= now) {
      if (!sub.autoRenew) {
        await db().subscription.update({ where: { id: sub.id }, data: { status: "expired", updatedAt: new Date() } });
        await emitEvent({ orgId, environment, type: "subscription.expired", entity: "subscription", entityId: sub.id, actorId: sub.createdBy ?? sub.id, payload: { name: sub.name } });
        result.subsExpired++;
        continue;
      }
      const product = await db().product.findUnique({ where: { id: sub.productId } });
      const line: PriceLine = {
        productId: sub.productId, productName: product?.name ?? sub.name, sku: product?.sku ?? "—",
        quantity: sub.quantity, unitPrice: r2(sub.unitPrice), discountPct: 0, lineTotal: r2(sub.unitPrice * sub.quantity),
      };
      await issueInvoice(orgId, environment, { accountId: sub.accountId, subscriptionId: sub.id, lines: [line] }, { id: sub.createdBy ?? sub.id });
      await db().subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: periodEnd(sub), status: "active", updatedAt: new Date() } });
      await emitEvent({ orgId, environment, type: "subscription.renewal_due", entity: "subscription", entityId: sub.id, actorId: sub.createdBy ?? sub.id, payload: { name: sub.name, nextPeriodEnd: periodEnd(sub).toISOString() } });
      result.renewed++;
      result.issued++;
    }
  }

  // 3. Dunning: issued invoices past due → overdue
  const due = await db().invoice.findMany({ where: { orgId, environment, status: "issued", dueDate: { lte: now } } });
  for (const inv of due) {
    await db().invoice.update({ where: { id: inv.id }, data: { status: "overdue", updatedAt: new Date() } });
    await emitEvent({ orgId, environment, type: "invoice.overdue", entity: "invoice", entityId: inv.id, actorId: inv.createdBy ?? inv.id, payload: { invoiceNumber: inv.invoiceNumber, total: inv.total } });
    await notifyAdmins(orgId, environment, `Invoice ${inv.invoiceNumber} is overdue`, `${money(inv.total)} past due — dunning attempt ${inv.dunningAttempts + 1}.`, `/revenue?tab=billing`);
    result.overdue++;
  }

  // 4. Contract lifecycle: renewal notices + expiry
  const contracts = await db().contract.findMany({ where: { orgId, environment, status: { in: ["active", "expiring"] } } });
  for (const c of contracts) {
    if (c.endDate && c.endDate <= now) {
      await db().contract.update({ where: { id: c.id }, data: { status: "expired", updatedAt: new Date() } });
      await emitEvent({ orgId, environment, type: "contract.expired", entity: "contract", entityId: c.id, actorId: c.createdBy ?? c.id, payload: { contractNumber: c.contractNumber } });
      result.contractsExpired++;
      continue;
    }
    if (c.endDate && c.status === "active") {
      const noticeMs = c.renewalNoticeDays * 86_400_000;
      if (c.endDate.getTime() - now.getTime() <= noticeMs) {
        await db().contract.update({ where: { id: c.id }, data: { status: "expiring", updatedAt: new Date() } });
        await emitEvent({ orgId, environment, type: "contract.renewal_due", entity: "contract", entityId: c.id, actorId: c.createdBy ?? c.id, payload: { contractNumber: c.contractNumber, endDate: c.endDate.toISOString(), autoRenew: c.autoRenew } });
        await notifyAdmins(orgId, environment, `Contract ${c.contractNumber} renews soon`, `${c.name} ends ${c.endDate.toISOString().slice(0, 10)} (auto-renew ${c.autoRenew ? "on" : "off"}).`, `/revenue?tab=contracts`);
        result.contractWarnings++;
      }
    }
  }

  return result;
}

// ── MRR / ARR metrics (derived on read — ADR-018 lineage) ───────────────────
export type RevenueMetric = { key: string; label: string; value: number; format: "currency" | "count" | "pct"; sources: { entity: string; query: string; note: string }[] };

export async function revenueMetrics(orgId: string, environment: string): Promise<{ metrics: RevenueMetric[]; byAccount: { accountId: string | null; accountName: string | null; mrr: number; subs: number }[]; totals: Record<string, number> }> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [subs, invoices, payments, contracts] = await Promise.all([
    db().subscription.findMany({ where: { orgId, environment } }),
    db().invoice.findMany({ where: { orgId, environment } }),
    db().payment.findMany({ where: { orgId, environment, status: "succeeded" } }),
    db().contract.findMany({ where: { orgId, environment } }),
  ]);

  const active = subs.filter((s) => ["active", "past_due"].includes(s.status));
  const mrr = r2(active.reduce((s, x) => s + mrrOf(x), 0));
  const arr = r2(mrr * 12);
  const churnedMrr = r2(subs.filter((s) => s.status === "cancelled" && s.cancelledAt && s.cancelledAt >= monthStart).reduce((s, x) => s + mrrOf(x), 0));
  const newMrr = r2(subs.filter((s) => s.startedAt >= monthStart && ["active", "past_due"].includes(s.status)).reduce((s, x) => s + mrrOf(x), 0));
  const outstanding = r2(invoices.filter((i) => ["issued", "overdue"].includes(i.status)).reduce((s, i) => s + i.total, 0));
  const overdueTotal = r2(invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + i.total, 0));
  const paidThisMonth = r2(payments.filter((p) => p.paidAt && p.paidAt >= monthStart).reduce((s, p) => s + p.amount, 0));
  const pastDue = subs.filter((s) => s.status === "past_due").length;
  const totalContracts = contracts.length;
  const activeContracts = contracts.filter((c) => c.status === "active").length;

  const metrics: RevenueMetric[] = [
    { key: "mrr", label: "Monthly recurring revenue", value: mrr, format: "currency", sources: [{ entity: "subscription", query: "sum(mrrOf) where status in (active, past_due)", note: "unitPrice × quantity ÷ period months, computed live" }] },
    { key: "arr", label: "Annual recurring revenue", value: arr, format: "currency", sources: [{ entity: "subscription", query: "mrr × 12", note: "annualized from live MRR" }] },
    { key: "activeSubs", label: "Active subscriptions", value: active.length, format: "count", sources: [{ entity: "subscription", query: "count where status in (active, past_due)", note: "live row count" }] },
    { key: "pastDueSubs", label: "Past-due subscriptions", value: pastDue, format: "count", sources: [{ entity: "subscription", query: "count where status = past_due", note: "dunning loop is active on these" }] },
    { key: "newMrr", label: "New MRR (this month)", value: newMrr, format: "currency", sources: [{ entity: "subscription", query: "sum(mrrOf) where startedAt ≥ month start", note: "expansion + new business" }] },
    { key: "churnedMrr", label: "Churned MRR (this month)", value: churnedMrr, format: "currency", sources: [{ entity: "subscription", query: "sum(mrrOf) where cancelledAt ≥ month start", note: "contraction / churn" }] },
    { key: "outstanding", label: "Outstanding receivables", value: outstanding, format: "currency", sources: [{ entity: "invoice", query: "sum(total) where status in (issued, overdue)", note: "open invoices not yet collected" }] },
    { key: "overdueTotal", label: "Overdue receivables", value: overdueTotal, format: "currency", sources: [{ entity: "invoice", query: "sum(total) where status = overdue", note: "dunning is chasing these" }] },
    { key: "paidThisMonth", label: "Collected this month", value: paidThisMonth, format: "currency", sources: [{ entity: "payment", query: "sum(amount) where status = succeeded and paidAt ≥ month start", note: "realized cash" }] },
    { key: "activeContracts", label: "Active contracts", value: activeContracts, format: "count", sources: [{ entity: "contract", query: "count where status = active (of ${totalContracts} total)", note: "contract lifecycle health" }] },
  ];

  const byAccount = active.reduce<Record<string, { accountId: string | null; mrr: number; subs: number }>>((acc, s) => {
    const k = s.accountId ?? "none";
    acc[k] = acc[k] ?? { accountId: s.accountId, mrr: 0, subs: 0 };
    acc[k].mrr = r2(acc[k].mrr + mrrOf(s));
    acc[k].subs += 1;
    return acc;
  }, {});
  const ids = Object.keys(byAccount).filter((k) => k !== "none");
  const accounts = ids.length ? await db().account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));

  const totals: Record<string, number> = {};
  for (const m of metrics) totals[m.key] = m.value;

  return {
    metrics,
    byAccount: Object.values(byAccount)
      .map((b) => ({ accountId: b.accountId, accountName: b.accountId ? nameById.get(b.accountId) ?? null : null, mrr: b.mrr, subs: b.subs }))
      .sort((a, b) => b.mrr - a.mrr),
    totals,
  };
}

// ── Engine (ticker) ─────────────────────────────────────────────────────────
let engineStarted = false;

export function startRevenueEngine() {
  if (engineStarted) return;
  engineStarted = true;
  // Every 60s, advance renewals + dunning for every org × environment that
  // has revenue data (lazy: only rows that exist).
  setInterval(async () => {
    try {
      const orgs = await db().organization.findMany({ select: { id: true } });
      for (const org of orgs) {
        const envs = await db().product.groupBy({ by: ["environment"], where: { orgId: org.id } });
        const envList = envs.map((e) => e.environment);
        for (const env of envList.length ? envList : ["production"]) {
          await runRevenueTicker(org.id, env).catch((e) => console.error("[revenue-engine]", org.id, env, (e as Error)?.message ?? e));
        }
      }
    } catch (e) {
      console.error("[revenue-engine] ticker error:", (e as Error)?.message ?? e);
    }
  }, 60_000);
  console.log("  Revenue      · billing engine subscribed (renewals + dunning ticker)");
}
