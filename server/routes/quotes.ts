// Quotes + quote templates (Phase 10 · Revenue Cloud CPQ) — flag revenue.cpq.
// A quote is built from line items against a price book (bundle expansion +
// discounts, totals computed server-side), then walks the approval → e-sign
// lifecycle: draft → needs_approval → approved → sent → signed → won/lost/
// voided. Reads open; writes + lifecycle admin-only (approval is the
// manager/admin gate, mirroring agent approvals). Mock e-signature (ADR-014).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { buildLines, getQuote, nextReference, submitQuote, approveQuote, sendQuote, signQuote, setQuoteOutcome } from "../lib/revenue";

const router = Router();

// ── Quote templates ─────────────────────────────────────────────────────────
const templateSchema = z.object({
  name: z.string().min(1).max(120),
  layout: z.enum(["standard", "professional", "compact"]).optional(),
  language: z.enum(["en", "de", "fr", "es"]).optional(),
  header: z.string().max(500).optional(),
  footer: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

router.get(
  "/templates",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const items = await db().quoteTemplate.findMany({ where: { orgId: user.orgId, environment }, orderBy: { name: "asc" } });
    ok(res, { items });
  })
);

router.post(
  "/templates",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = templateSchema.parse(req.body);
    const tpl = await db().quoteTemplate.create({
      data: { orgId: user.orgId, environment, name: input.name, layout: input.layout ?? "standard", language: input.language ?? "en", header: input.header ?? null, footer: input.footer ?? null, active: input.active ?? true },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "quoteTemplate.created", entity: "quoteTemplate", entityId: tpl.id, actorId: user.id, payload: { name: tpl.name } });
    ok(res, { template: tpl }, 201);
  })
);

router.patch(
  "/templates/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const tpl = await db().quoteTemplate.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!tpl) throw notFound("Quote template not found");
    const input = templateSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name;
    if (input.layout !== undefined) data.layout = input.layout;
    if (input.language !== undefined) data.language = input.language;
    if (input.header !== undefined) data.header = input.header ?? null;
    if (input.footer !== undefined) data.footer = input.footer ?? null;
    if (input.active !== undefined) data.active = input.active;
    const updated = await db().quoteTemplate.update({ where: { id: tpl.id }, data });
    ok(res, { template: updated });
  })
);

router.delete(
  "/templates/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const tpl = await db().quoteTemplate.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!tpl) throw notFound("Quote template not found");
    await db().quoteTemplate.delete({ where: { id: tpl.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "quoteTemplate.deleted", entity: "quoteTemplate", entityId: tpl.id, actorId: user.id, payload: { name: tpl.name } });
    ok(res, { ok: true });
  })
);

// ── Quotes ──────────────────────────────────────────────────────────────────
const quoteSchema = z.object({
  name: z.string().min(1).max(200),
  opportunityId: z.string().optional(),
  accountId: z.string().optional(),
  contactId: z.string().optional(),
  priceBookId: z.string().optional(),
  templateId: z.string().optional(),
  validUntil: z.string().datetime().optional(),
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().positive(), discountPct: z.number().min(0).max(100).optional() })).min(1),
});

async function hydrateQuote(orgId: string, environment: string, q: any): Promise<any> {
  const opportunityId = q.opportunityId;
  const [opportunity, account, contact, template] = await Promise.all([
    opportunityId ? db().opportunity.findUnique({ where: { id: opportunityId }, select: { name: true } }) : null,
    q.accountId ? db().account.findUnique({ where: { id: q.accountId }, select: { name: true } }) : null,
    q.contactId ? db().contact.findUnique({ where: { id: q.contactId }, select: { firstName: true, lastName: true } }) : null,
    q.templateId ? db().quoteTemplate.findUnique({ where: { id: q.templateId }, select: { name: true, layout: true, language: true } }) : null,
  ]);
  return {
    id: q.id, quoteNumber: q.quoteNumber, name: q.name, status: q.status, lines: q.lines, subtotal: q.subtotal,
    discountTotal: q.discountTotal, taxTotal: q.taxTotal, total: q.total, currency: q.currency,
    validUntil: q.validUntil, signature: q.signature, approvals: q.approvals, opportunityId: q.opportunityId,
    opportunityName: opportunity?.name ?? null, accountId: q.accountId, accountName: account?.name ?? null,
    contactId: q.contactId, contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
    templateId: q.templateId, template: template ? { name: template.name, layout: template.layout, language: template.language } : null,
    createdAt: q.createdAt, updatedAt: q.updatedAt,
  };
}

// GET /api/quotes
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const rows = await db().quote.findMany({ where: { orgId: user.orgId, environment }, orderBy: { createdAt: "desc" }, take: 200 });
    const items = await Promise.all(rows.map((q) => hydrateQuote(user.orgId, environment, q)));
    ok(res, { items });
  })
);

// POST /api/quotes (admin) — build from line items against the price book.
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = quoteSchema.parse(req.body);
    const quoteNumber = await nextReference(user.orgId, environment, "quote", "Q");
    const { lines, subtotal, discountTotal, taxTotal, total } = await buildLines(user.orgId, environment, input.priceBookId, input.lines);
    const quote = await db().quote.create({
      data: {
        orgId: user.orgId, environment, quoteNumber, name: input.name, opportunityId: input.opportunityId ?? null,
        accountId: input.accountId ?? null, contactId: input.contactId ?? null, priceBookId: input.priceBookId ?? null,
        templateId: input.templateId ?? null, status: "draft", lines: lines as unknown as object,
        subtotal, discountTotal, taxTotal, total, currency: "USD",
        validUntil: input.validUntil ? new Date(input.validUntil) : null, createdBy: user.id,
      },
    });
    await emitEvent({ orgId: user.orgId, environment, type: "quote.created", entity: "quote", entityId: quote.id, actorId: user.id, payload: { quoteNumber, total } });
    ok(res, { quote }, 201);
  })
);

// GET /api/quotes/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const quote = await getQuote(user.orgId, environment, String(req.params.id));
    ok(res, { quote: await hydrateQuote(user.orgId, environment, quote) });
  })
);

// PATCH /api/quotes/:id (admin) — edit draft metadata/lines (re-totals).
router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const quote = await getQuote(user.orgId, environment, String(req.params.id));
    if (!["draft", "needs_approval"].includes(quote.status)) throw badRequest(`Only draft quotes can be edited (status: ${quote.status})`);
    const input = quoteSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name;
    if (input.opportunityId !== undefined) data.opportunityId = input.opportunityId ?? null;
    if (input.accountId !== undefined) data.accountId = input.accountId ?? null;
    if (input.contactId !== undefined) data.contactId = input.contactId ?? null;
    if (input.priceBookId !== undefined) data.priceBookId = input.priceBookId ?? null;
    if (input.templateId !== undefined) data.templateId = input.templateId ?? null;
    if (input.validUntil !== undefined) data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
    if (input.lines !== undefined) {
      const { lines, subtotal, discountTotal, taxTotal, total } = await buildLines(user.orgId, environment, data.priceBookId as string | undefined ?? quote.priceBookId, input.lines);
      data.lines = lines as unknown as object;
      data.subtotal = subtotal; data.discountTotal = discountTotal; data.taxTotal = taxTotal; data.total = total;
    }
    const updated = await db().quote.update({ where: { id: quote.id }, data });
    await emitEvent({ orgId: user.orgId, environment, type: "quote.updated", entity: "quote", entityId: quote.id, actorId: user.id, payload: { quoteNumber: quote.quoteNumber } });
    ok(res, { quote: updated });
  })
);

// DELETE /api/quotes/:id (admin) — drafts only.
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const quote = await getQuote(user.orgId, environment, String(req.params.id));
    if (quote.status !== "draft" && quote.status !== "voided") throw badRequest(`Only draft/voided quotes can be deleted (status: ${quote.status})`);
    await db().quote.delete({ where: { id: quote.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "quote.deleted", entity: "quote", entityId: quote.id, actorId: user.id, payload: { quoteNumber: quote.quoteNumber } });
    ok(res, { ok: true });
  })
);

// ── Lifecycle (admin/manager — the approval gate) ───────────────────────────
router.post("/:id/submit", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, { quote: await submitQuote(user.orgId, environment, String(req.params.id), user) });
}));

router.post("/:id/approve", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, { quote: await approveQuote(user.orgId, environment, String(req.params.id), user) });
}));

router.post("/:id/send", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  ok(res, { quote: await sendQuote(user.orgId, environment, String(req.params.id), user) });
}));

// POST /api/quotes/:id/sign — mock e-signature (the counterparty's action).
router.post("/:id/sign", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const { name, email } = z.object({ name: z.string().min(1), email: z.string().email().optional() }).parse(req.body ?? {});
  ok(res, { quote: await signQuote(user.orgId, environment, String(req.params.id), { name, email }, user) });
}));

// POST /api/quotes/:id/outcome { outcome: won | lost | voided }
router.post("/:id/outcome", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const { outcome } = z.object({ outcome: z.enum(["won", "lost", "voided"]) }).parse(req.body ?? {});
  ok(res, { quote: await setQuoteOutcome(user.orgId, environment, String(req.params.id), outcome, user) });
}));

// POST /api/quotes/preview — dry-run line pricing (admin: pricing is internal).
router.post("/preview", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const user = await assertActiveUser(req);
  const environment = await resolveEnvironment(req, user.orgId);
  const { priceBookId, lines } = z.object({ priceBookId: z.string().optional(), lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().positive(), discountPct: z.number().min(0).max(100).optional() })).min(1) }).parse(req.body ?? {});
  ok(res, await buildLines(user.orgId, environment, priceBookId, lines));
}));

export default router;
