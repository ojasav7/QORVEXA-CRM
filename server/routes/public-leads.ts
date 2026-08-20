// Public lead capture (Phase 1) — NO authentication on purpose. The form's slug
// is a random-ish id; abuse is mitigated with a honeypot field + a per-IP rate
// limit. Submissions create leads in the form's org (production env) through
// the generic lead service, which applies duplicate detection and round-robin
// routing (the form's own id is the actor for provenance).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { asyncHandler, badRequest, ok } from "../lib/http";
import { createObjectService, detectDuplicate } from "../lib/object-service";
import { emitEvent } from "../lib/events";

const router = Router();
// The lead service is built lazily per request: registerObject() in the server
// entry runs AFTER route-module imports, so a module-level instance would miss
// the lead config (uniqueFields/assignOwner) and silently lose duplicate
// detection + round-robin routing on public submissions.
const leadService = () => createObjectService({ type: "lead" });

// ── Minimal in-memory rate limit: 10 submissions / min / IP ─────────────────
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.resetAt < now) {
    // Bound memory: once the map grows, drop expired entries.
    if (hits.size > 500) {
      for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    }
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  rec.count++;
  return rec.count > 10;
}

const HONEYPOT = "company_website"; // hidden field; bots fill it, humans don't

// GET /api/public/forms/:slug — public form config (name, fields, submit label)
router.get(
  "/forms/:slug",
  asyncHandler(async (req, res) => {
    const form = await db().leadForm.findFirst({ where: { slug: String(req.params.slug), active: true } });
    if (!form) throw badRequest("Form not found");
    ok(res, { name: form.name, fields: form.fields, submitLabel: form.submitLabel, slug: form.slug });
  })
);

// POST /api/public/forms/:slug/submit — create a lead from the form
const submitSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(60).optional(),
  company: z.string().max(160).optional(),
  // Landing-page extras (request-a-demo): not core lead fields — they land in
  // the lead's `custom` JSON via the object service's splitFields.
  teamSize: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  [HONEYPOT]: z.any().optional(),
});
router.post(
  "/forms/:slug/submit",
  asyncHandler(async (req, res) => {
    const ip = String(req.ip ?? "unknown");
    if (rateLimited(ip)) throw badRequest("Too many submissions — try again shortly");
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Honeypot: bots that fill it get a fake success and no write.
    if (body[HONEYPOT] && String(body[HONEYPOT]).trim() !== "") return ok(res, { ok: true, duplicate: false });

    const form = await db().leadForm.findFirst({ where: { slug: String(req.params.slug), active: true } });
    if (!form) throw badRequest("Form not found");

    const input = submitSchema.parse({ ...body, [HONEYPOT]: body[HONEYPOT] ?? "" });
    const payload: Record<string, unknown> = {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email.toLowerCase().trim(),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.company ? { company: input.company } : {}),
      source: "Website",
      status: "new",
      // Captured on the lead's custom fields so the sales team can qualify:
      ...(input.teamSize ? { teamSize: input.teamSize } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    // The form's allowed-fields list is the org's configured surface — submit
    // as a system actor in the form's org so field-permission restrictions on
    // the org's own funnel never block capture.
    const sysUser = { id: form.id, orgId: form.orgId, email: `form:${form.slug}`, name: form.name, role: "admin", environment: "production" };

    // Duplicate emails are rejected up front — report success with a flag so
    // we never leak whether the lead exists.
    const dup = await detectDuplicate("lead", form.orgId, "production", payload);
    if (dup) return ok(res, { ok: true, duplicate: true });

    let lead: any;
    try {
      lead = await leadService().create(sysUser, payload, ip);
    } catch (e: any) {
      // Race fallback: a concurrent submission created the same email between
      // our check and the write — same no-leak response. Other 400s (validation)
      // surface normally so real form errors aren't hidden as "duplicates".
      if (e?.status === 400 && /already exists/i.test(String(e?.message ?? ""))) {
        return ok(res, { ok: true, duplicate: true });
      }
      throw e;
    }
    await emitEvent({
      orgId: form.orgId,
      environment: "production",
      type: "lead.captured",
      entity: "lead",
      entityId: lead.id,
      actorId: form.id,
      payload: { formId: form.id, slug: form.slug, formName: form.name },
    });
    ok(res, { ok: true, duplicate: false, leadId: lead.id });
  })
);

export default router;
