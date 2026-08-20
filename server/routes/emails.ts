// Email (Phase 2) — the org's mailbox. Sends create outbound Message rows with
// a tracking token (open pixel + click redirect); the mock provider simulates
// SMTP (EMAIL_MOCK=1 — no real sends, ADR-014). Sync drains the mock inbound
// queue; replies are simulated for demo/tests. Auto-logging: sending to a
// contact/deal links the Message to those records (record timeline + feed).
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import { mergeTemplate, trackingToken, drainMockInbound, mockReplyBody, openPixelUrl, clickRedirectUrl } from "../lib/comm";
import { sendOutboundWithProvider } from "../lib/integrations/email";

const router = Router();

// GET /api/emails?direction=&contactId=&opportunityId=&accountId=&q=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { direction, contactId, opportunityId, accountId, q } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { orgId: user.orgId, environment };
    if (direction) where.direction = direction;
    if (contactId) where.contactId = contactId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (accountId) where.accountId = accountId;
    if (q) {
      where.AND = [{ OR: [{ subject: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }, { toEmail: { contains: q, mode: "insensitive" } }, { fromEmail: { contains: q, mode: "insensitive" } }] }];
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const [items, total] = await Promise.all([
      db().message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db().message.count({ where }),
    ]);
    ok(res, { items, total });
  })
);

// GET /api/emails/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const message = await db().message.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!message) throw notFound("Message not found");
    ok(res, { message });
  })
);

// POST /api/emails — send an email (mock provider). Body:
//   { toEmail, subject, body, templateId?, contactId?, accountId?, opportunityId?, threadId? }
// When templateId is given, {{variables}} are merged from the linked record.
const sendSchema = z.object({
  toEmail: z.string().email().max(200),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  templateId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
});
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = sendSchema.parse(req.body);

    let body = input.body;
    let templateId: string | null = input.templateId ?? null;
    if (input.templateId) {
      const tpl = await db().emailTemplate.findFirst({ where: { id: input.templateId, orgId: user.orgId, environment } });
      if (!tpl) throw notFound("Template not found");
      // Merge {{variables}} from the linked record (contact/account/opportunity).
      const vars: Record<string, unknown> = {};
      if (input.contactId) {
        const c = await db().contact.findFirst({ where: { id: input.contactId, orgId: user.orgId, environment }, select: { firstName: true, lastName: true, email: true, title: true } });
        if (c) vars.contact = c;
      }
      if (input.accountId) {
        const a = await db().account.findFirst({ where: { id: input.accountId, orgId: user.orgId, environment }, select: { name: true } });
        if (a) vars.account = a;
      }
      if (input.opportunityId) {
        const o = await db().opportunity.findFirst({ where: { id: input.opportunityId, orgId: user.orgId, environment }, select: { name: true, amount: true } });
        if (o) vars.deal = o;
      }
      body = mergeTemplate(tpl.body, vars);
    }

    const token = trackingToken();
    const created = await db().message.create({
      data: {
        orgId: user.orgId,
        environment,
        direction: "out",
        threadId: input.threadId ?? cryptoToken(), // unique thread per first send
        trackingToken: token,
        fromEmail: `${user.email}`,
        toEmail: input.toEmail,
        subject: input.subject,
        body,
        status: "sent",
        templateId,
        contactId: input.contactId ?? null,
        accountId: input.accountId ?? null,
        opportunityId: input.opportunityId ?? null,
        ownerId: user.id,
      },
    });
    // Phase 16 (ADR-028): when a real email provider is configured, fire the
    // actual send AFTER the row exists (async) — success stores the provider
    // message id, failure flips the row to "failed" + emits email.failed.
    void sendOutboundWithProvider(created);
    // Tracking links are attached in the payload so webhooks/UI can render them.
    const tracking = { openUrl: openPixelUrl(token), clickUrl: (u: string) => clickRedirectUrl(token, u) };
    await emitEvent({
      orgId: user.orgId,
      environment,
      type: "email.sent",
      entity: "message",
      entityId: created.id,
      actorId: user.id,
      payload: { to: input.toEmail, subject: input.subject, trackingToken: token, contactId: input.contactId ?? null, opportunityId: input.opportunityId ?? null },
    });
    ok(res, { message: created, tracking }, 201);
  })
);

// POST /api/emails/sync — drain the mock inbound queue into the org's inbox.
router.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 3));
    const drained = drainMockInbound(user.orgId, limit);
    const created: any[] = [];
    for (const m of drained) {
      const row = await db().message.create({
        data: {
          orgId: user.orgId,
          environment,
          direction: "in",
          threadId: cryptoToken(),
          fromEmail: m.from,
          toEmail: user.email,
          subject: m.subject,
          body: m.body,
          status: "sent",
          ownerId: user.id,
        },
      });
      created.push(row);
      await emitEvent({ orgId: user.orgId, environment, type: "email.received", entity: "message", entityId: row.id, actorId: user.id, payload: { from: m.from, subject: m.subject } });
    }
    ok(res, { synced: created.length, items: created }, 201);
  })
);

// POST /api/emails/:id/reply — simulate the recipient replying (mock provider).
router.post(
  "/:id/reply",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const original = await db().message.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!original) throw notFound("Message not found");
    const reply = await db().message.create({
      data: {
        orgId: user.orgId,
        environment,
        direction: "in",
        threadId: original.threadId,
        fromEmail: original.toEmail,
        toEmail: original.fromEmail,
        subject: `Re: ${original.subject}`,
        body: mockReplyBody(original.body),
        status: "replied",
        repliedAt: new Date(),
        contactId: original.contactId,
        accountId: original.accountId,
        opportunityId: original.opportunityId,
        ownerId: original.ownerId,
      },
    });
    await db().message.update({ where: { id: original.id }, data: { status: "replied", repliedAt: new Date(), updatedAt: new Date() } });
    await emitEvent({ orgId: user.orgId, environment, type: "email.replied", entity: "message", entityId: reply.id, actorId: user.id, payload: { threadId: original.threadId, subject: reply.subject, contactId: original.contactId ?? null } });
    ok(res, { message: reply }, 201);
  })
);

// POST /api/emails/:id/delete
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const message = await db().message.findFirst({ where: { id: String(req.params.id), orgId: user.orgId, environment } });
    if (!message) throw notFound("Message not found");
    await db().message.delete({ where: { id: message.id } });
    await emitEvent({ orgId: user.orgId, environment, type: "email.deleted", entity: "message", entityId: message.id, actorId: user.id, payload: { subject: message.subject } });
    ok(res, { ok: true });
  })
);
function cryptoToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export default router;
