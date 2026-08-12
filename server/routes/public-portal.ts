// Public self-service portal (Phase 4 · Customer Service) — NO authentication,
// like public lead capture and booking. The portal slug is the handle; a
// honeypot + per-IP rate limit guard abuse (same discipline as ADR-012).
// Submissions create tickets (channel web, source portal) owned by the org's
// support owner — we use the portal page id as the actor for provenance, and
// auto-create/link the contact by email (autoCreateContact). The lookup is
// no-leak: email + reference must match, else a generic "not found".
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { createObjectService } from "../lib/object-service";
import { responseHoursFor, slaDueFor, RESOLVED_STATUSES } from "../lib/slas";

const router = Router();

// Minimal in-memory rate limit: 20 submissions / min / IP (a bit above the
// public-leads threshold — the portal fires more legit requests per session,
// but still guards abuse). Shared across submit + lookup.
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.resetAt < now) {
    if (hits.size > 500) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  rec.count++;
  return rec.count > 20;
}

const HONEYPOT = "favorite_color"; // hidden field; bots fill it, humans don't

async function loadPortal(slug: string) {
  const portal = await db().portalPage.findFirst({ where: { slug: String(slug).toLowerCase(), active: true } });
  if (!portal) throw badRequest("Portal not found");
  return portal;
}

// GET /api/public/portal/:slug — public config + published KB articles.
router.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const portal = await loadPortal(String(req.params.slug));
    const articles = await db().knowledgeArticle.findMany({
      where: { orgId: portal.orgId, environment: portal.environment, published: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, title: true, slug: true, category: true, updatedAt: true },
    });
    ok(res, { name: portal.name, description: portal.description, slug: portal.slug, articles });
  })
);

// POST /api/public/portal/:slug/tickets — submit a ticket (creates the ticket).
const submitSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  subject: z.string().min(1).max(240),
  body: z.string().max(10_000).optional(),
  [HONEYPOT]: z.any().optional(),
});
router.post(
  "/:slug/tickets",
  asyncHandler(async (req, res) => {
    const ip = String(req.ip ?? "unknown");
    if (rateLimited(ip)) throw badRequest("Too many submissions — try again shortly");
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body[HONEYPOT] && String(body[HONEYPOT]).trim() !== "") return ok(res, { ok: true, reference: null }); // honeypot: fake success, no write

    const portal = await loadPortal(String(req.params.slug));
    const input = submitSchema.parse({ ...body, [HONEYPOT]: body[HONEYPOT] ?? "" });
    const email = input.email.toLowerCase().trim();
    const environment = portal.environment;
    const sysUser = { id: portal.id, orgId: portal.orgId, email: `portal:${portal.slug}`, name: portal.name, role: "admin", environment };

    // Contact: link by email; auto-create when enabled (portal page is the actor).
    let contact = await db().contact.findFirst({ where: { orgId: portal.orgId, environment, email } });
    if (!contact && portal.autoCreateContact) {
      const contactService = () => createObjectService({ type: "contact" });
      try {
        contact = await contactService().create(
          sysUser,
          { firstName: input.name.trim().split(/\s+/)[0] ?? "Portal", lastName: input.name.trim().split(/\s+/).slice(1).join(" ") || "User", email, source: "Other", status: "new" },
          ip
        );
      } catch (e: any) {
        if (e?.status === 400 && /already exists/i.test(String(e?.message ?? ""))) {
          contact = await db().contact.findFirst({ where: { orgId: portal.orgId, environment, email } });
        } else throw e;
      }
    }

    // Reference + SLA deadline (portal tickets enter as low priority).
    const seq = await (async () => {
      const rows = await db().ticket.findMany({ where: { orgId: portal.orgId, environment }, select: { reference: true } });
      let max = 0;
      for (const r of rows) {
        const n = parseInt(String(r.reference).replace(/\D/g, ""), 10);
        if (!Number.isNaN(n) && n > max) max = n;
      }
      return `TKT-${String(max + 1).padStart(4, "0")}`;
    })();
    const hours = await responseHoursFor(portal.orgId, environment, "low");
    const ticketService = () => createObjectService({ type: "ticket" });
    const ticket = await ticketService().create(
      sysUser,
      {
        subject: input.subject.trim(),
        description: input.body ?? "",
        priority: "low",
        channel: "web",
        source: "portal",
        ...(contact ? { contactId: contact.id } : {}),
        reference: seq,
        slaDueAt: slaDueFor(new Date(), hours),
      },
      ip
    );
    await emitEvent({
      orgId: portal.orgId,
      environment,
      type: "ticket.captured",
      entity: "ticket",
      entityId: ticket.id,
      actorId: portal.id,
      payload: { reference: ticket.reference, channel: "web", from: email, slug: portal.slug },
    });
    ok(res, { ok: true, reference: ticket.reference }, 201);
  })
);

// POST /api/public/portal/:slug/lookup — { email, reference } → safe summary
// (public replies only). No-leak: mismatched email → generic not found.
const lookupSchema = z.object({ email: z.string().email().max(200), reference: z.string().min(3).max(40) });
router.post(
  "/:slug/lookup",
  asyncHandler(async (req, res) => {
    const ip = String(req.ip ?? "unknown");
    if (rateLimited(ip)) throw badRequest("Too many requests — try again shortly");
    const portal = await loadPortal(String(req.params.slug));
    const input = lookupSchema.parse(req.body ?? {});
    const email = input.email.toLowerCase().trim();
    const ticket = await db().ticket.findFirst({ where: { orgId: portal.orgId, environment: portal.environment, reference: String(input.reference).toUpperCase() } });
    if (!ticket) return ok(res, { found: false, ticket: null });
    // No-leak: the ticket must belong to a contact whose email matches the
    // lookup email — knowing a reference alone is not enough to read a ticket.
    const contact = ticket.contactId ? await db().contact.findUnique({ where: { id: ticket.contactId } }) : null;
    const matches = Boolean(contact && String(contact.email ?? "").toLowerCase() === email);
    if (!matches) return ok(res, { found: false, ticket: null });

    const replies = await db().ticketReply.findMany({
      where: { orgId: portal.orgId, environment: portal.environment, ticketId: ticket.id, internal: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, body: true, createdAt: true },
    });
    ok(res, {
      found: true,
      ticket: {
        reference: ticket.reference,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        resolved: RESOLVED_STATUSES.includes(ticket.status),
        updatedAt: ticket.updatedAt,
        replies,
      },
    });
  })
);

export default router;
