// Public landing pages (Phase 5 · Marketing Automation) — NO authentication,
// like public lead capture / booking / portal. A slug is the handle; a
// honeypot + per-IP rate limit guard abuse (same discipline as ADR-012).
// Submissions create ROUTED leads (the generic lead service assigns an owner)
// with source "Landing page"; when the page is linked to a Campaign the lead's
// custom.campaignId is tagged for attribution. Emits form.submitted +
// lead.captured + intent.detected.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { emitEvent } from "../lib/events";
import { createObjectService } from "../lib/object-service";

const router = Router();

// 20 submissions / min / IP (shared across GET + submit) — same shape as the
// portal limiter (Phase 4).
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

const HONEYPOT = "website"; // hidden field; bots fill it, humans don't

async function loadPage(slug: string) {
  const page = await db().landingPage.findFirst({ where: { slug: String(slug).toLowerCase(), active: true } });
  if (!page) throw badRequest("Landing page not found");
  return page;
}

// GET /api/public/pages/:slug — public config (no contact data exposed).
router.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const page = await loadPage(String(req.params.slug));
    ok(res, {
      name: page.name,
      headline: page.headline,
      subtext: page.subtext,
      ctaLabel: page.ctaLabel,
      successMessage: page.successMessage,
      theme: page.theme,
      fields: page.fields,
    });
  })
);

// POST /api/public/pages/:slug/submit — create a routed lead.
const submitSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(60).optional(),
  company: z.string().max(160).optional(),
  [HONEYPOT]: z.any().optional(),
});
router.post(
  "/:slug/submit",
  asyncHandler(async (req, res) => {
    const ip = String(req.ip ?? "unknown");
    if (rateLimited(ip)) throw badRequest("Too many submissions — try again shortly");
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body[HONEYPOT] && String(body[HONEYPOT]).trim() !== "") return ok(res, { ok: true, duplicate: false }); // honeypot: fake success, no write

    const page = await loadPage(String(req.params.slug));
    const input = submitSchema.parse({ ...body, [HONEYPOT]: body[HONEYPOT] ?? "" });
    const environment = page.environment;
    const email = input.email.toLowerCase().trim();
    const sysUser = { id: page.id, orgId: page.orgId, email: `landing:${page.slug}`, name: page.name, role: "admin", environment };

    const leadService = () => createObjectService({ type: "lead" });
    const payload: Record<string, unknown> = {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email,
      ...(input.phone ? { phone: input.phone.trim() } : {}),
      ...(input.company ? { company: input.company.trim() } : {}),
      source: "Landing page",
      status: "new",
      score: 0,
      campaignId: page.campaignId ?? null,
    };
    let lead: any = null;
    let duplicate = false;
    try {
      lead = await leadService().create(sysUser, payload, ip);
    } catch (e: any) {
      // No-leak duplicate: report success without revealing the lead exists.
      if (e?.status === 400 && /already exists/i.test(String(e?.message ?? ""))) {
        duplicate = true;
      } else throw e;
    }

    // Emit only when a lead was actually created: a no-leak duplicate has no
    // entityId, and the workflow engine must never fire against an empty record.
    if (lead) {
      await emitEvent({
        orgId: page.orgId,
        environment,
        type: "form.submitted",
        entity: "lead",
        entityId: lead.id,
        actorId: page.id,
        payload: { slug: page.slug, campaignId: page.campaignId ?? null, email, duplicate: false },
      });
      await emitEvent({
        orgId: page.orgId,
        environment,
        type: "intent.detected",
        entity: "lead",
        entityId: lead.id,
        actorId: page.id,
        payload: { leadId: lead.id, signal: "landing_page_submit", slug: page.slug, campaignId: page.campaignId ?? null },
      });
    }
    ok(res, { ok: true, duplicate, leadId: lead?.id ?? null }, lead ? 201 : 200);
  })
);

export default router;
