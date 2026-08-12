// AI Assistant Layer (Phase 8) — flag ai.assistant.
//
// The non-agentic copilot surface: record/call/meeting/360 summaries, email
// drafts, explained AI scoring (lead/deal), sentiment + intent, semantic
// search, the AI feature catalog, the data firewall policy, and short-term AI
// memory. Every generation goes through the model router (which model would
// serve it, and why), is persisted as an AIInsight row, emits
// ai.summary_generated / ai.score_computed / ai.confidence_flagged, and is
// recorded in the audit trail via the events. Reads open to any authenticated
// user; the firewall policy write is admin-only.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { assertActiveUser, requireRole } from "../lib/auth";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http";
import { resolveEnvironment } from "../lib/environment";
import { emitEvent } from "../lib/events";
import {
  aiCatalog,
  analyzeSentiment,
  deleteMemory,
  detectIntent,
  draftEmail,
  firewallPolicy,
  listMemory,
  redactContext,
  routeModel,
  saveInsight,
  semanticSearch,
  scoreDeal,
  scoreLead,
  summarizeCall,
  summarizeMeeting,
  summarizeProfile,
  summarizeRecord,
  writeMemory,
  type InsightInput,
} from "../lib/ai";

const router = Router();

/** Route a feature, run the generator, persist the insight. Shared by every AI call. */
async function runAi<T extends InsightInput>(
  user: { orgId: string; id: string },
  environment: string,
  feature: string,
  generate: () => Promise<T>
) {
  const decision = await routeModel(user.orgId, environment, feature);
  const result = await generate();
  const insight = await saveInsight(user.orgId, environment, user.id, {
    ...result,
    modelId: decision.picked,
    latencyMs: decision.candidates.find((c) => c.name === decision.picked)?.latencyMs ?? 120,
  });
  return { insight, decision };
}

// GET /api/ai/catalog — the AI feature catalog (feature → capability → model).
router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    ok(res, { items: await aiCatalog(user.orgId, environment) });
  })
);

// POST /api/ai/summarize — record summary (contact | account | deal | lead | ticket).
const summarizeSchema = z.object({ entity: z.string().min(1), entityId: z.string().min(1) });
router.post(
  "/summarize",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { entity, entityId } = summarizeSchema.parse(req.body);
    if (!["contact", "account", "opportunity", "lead", "ticket"].includes(entity)) throw badRequest("entity must be contact | account | opportunity | lead | ticket");
    const { insight, decision } = await runAi(user, environment, `${entity}.summary`, () => summarizeRecord(user.orgId, environment, entity, entityId));
    ok(res, { insight, decision }, 201);
  })
);

// POST /api/ai/summarize/call — call summarization (transcript + notes).
router.post(
  "/summarize/call",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { callId } = z.object({ callId: z.string().min(1) }).parse(req.body);
    const { insight, decision } = await runAi(user, environment, "call.summary", () => summarizeCall(user.orgId, environment, callId));
    ok(res, { insight, decision }, 201);
  })
);

// POST /api/ai/summarize/meeting — meeting summarization (notes + attendees).
router.post(
  "/summarize/meeting",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { meetingId } = z.object({ meetingId: z.string().min(1) }).parse(req.body);
    const { insight, decision } = await runAi(user, environment, "meeting.summary", () => summarizeMeeting(user.orgId, environment, meetingId));
    ok(res, { insight, decision }, 201);
  })
);

// POST /api/ai/summarize/profile — the AI-generated Customer 360 summary card.
router.post(
  "/summarize/profile",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { profileId } = z.object({ profileId: z.string().min(1) }).parse(req.body);
    const { insight, decision } = await runAi(user, environment, "profile.summary", () => summarizeProfile(user.orgId, environment, profileId));
    ok(res, { insight, decision }, 201);
  })
);

// POST /api/ai/draft — tone-controlled email draft for a contact (+ optional deal).
const draftSchema = z.object({ contactId: z.string().min(1), dealId: z.string().optional(), tone: z.string().optional() });
router.post(
  "/draft",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = draftSchema.parse(req.body);
    const { insight, decision } = await runAi(user, environment, "email.draft", () => draftEmail(user.orgId, environment, input, user.name ?? "Your team"));
    ok(res, { insight, decision }, 201);
  })
);

// POST /api/ai/score — explained AI score (lead | opportunity).
const scoreSchema = z.object({ entity: z.string().min(1), entityId: z.string().min(1) });
router.post(
  "/score",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { entity, entityId } = scoreSchema.parse(req.body);
    if (!["lead", "opportunity"].includes(entity)) throw badRequest("entity must be lead | opportunity");
    const { insight, decision } = await runAi(user, environment, `${entity}.score`, () =>
      entity === "lead" ? scoreLead(user.orgId, environment, entityId) : scoreDeal(user.orgId, environment, entityId)
    );
    ok(res, { insight, decision }, 201);
  })
);

// POST /api/ai/sentiment — lexicon sentiment over any text.
router.post(
  "/sentiment",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { text } = z.object({ text: z.string().min(1).max(5000) }).parse(req.body);
    const { insight, decision } = await runAi(user, environment, "sentiment", () => analyzeSentiment(user.orgId, environment, text));
    ok(res, { insight, decision }, 201);
  })
);

// POST /api/ai/intent — intent signals from a profile's behavior stream.
router.post(
  "/intent",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const { profileId } = z.object({ profileId: z.string().min(1) }).parse(req.body);
    const { insight, decision } = await runAi(user, environment, "intent", () => detectIntent(user.orgId, environment, profileId));
    ok(res, { insight, decision }, 201);
  })
);

// GET /api/ai/search?q= — semantic search (ranked, explainable). Persists an insight.
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const q = String(req.query.q ?? "").trim();
    if (!q) throw badRequest("q is required");
    const decision = await routeModel(user.orgId, environment, "search");
    const result = await semanticSearch(user.orgId, environment, q);
    const confidence = result.items.length ? Math.round(result.items.reduce((s, i) => s + i.confidence, 0) / result.items.length) : 0;
    await saveInsight(user.orgId, environment, user.id, {
      kind: "search",
      feature: "search",
      title: `Semantic search: "${q}"`,
      content: `${result.items.length} result(s)`,
      confidence,
      modelId: decision.picked,
      latencyMs: decision.candidates.find((c) => c.name === decision.picked)?.latencyMs ?? 120,
      payload: { query: result.query, groups: result.groups, predicate: result.predicate, types: result.types, results: result.items },
    });
    ok(res, { query: result.query, groups: result.groups, predicate: result.predicate, types: result.types, items: result.items, decision });
  })
);

// GET /api/ai/insights — the AIInsight history (audit + explainability surface).
router.get(
  "/insights",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const where: Record<string, unknown> = { orgId: user.orgId, environment };
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.entity) where.entity = String(req.query.entity);
    if (req.query.entityId) where.entityId = String(req.query.entityId);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const [items, total] = await Promise.all([
      db().aiInsight.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
      db().aiInsight.count({ where }),
    ]);
    ok(res, { items, total });
  })
);

// DELETE /api/ai/insights/:id (admin) — remove one AI output (governance, like behaviors).
router.delete(
  "/insights/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const id = String(req.params.id);
    const row = await db().aiInsight.findUnique({ where: { id } });
    if (!row || row.orgId !== user.orgId || row.environment !== environment) throw notFound("Insight not found");
    await db().aiInsight.delete({ where: { id } });
    ok(res, { ok: true });
  })
);

// ── Short-term AI memory ─────────────────────────────────────────────────────
router.get(
  "/memory",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const scopeType = String(req.query.scopeType ?? "user");
    const scopeId = String(req.query.scopeId ?? user.id);
    // User-scoped memory is private to the caller — same rule as the write path.
    if (scopeType === "user" && scopeId !== user.id) throw badRequest("User memory is private to the caller");
    ok(res, { items: await listMemory(user.orgId, environment, scopeType, scopeId) });
  })
);

const memorySchema = z.object({
  scopeType: z.string().default("user"),
  scopeId: z.string().min(1).optional(),
  key: z.string().min(1).max(80),
  value: z.unknown(),
  ttlSeconds: z.number().int().positive().max(86_400 * 30).optional(),
});
router.post(
  "/memory",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    const input = memorySchema.parse(req.body);
    const scopeId = input.scopeId ?? (input.scopeType === "user" ? user.id : null);
    if (!scopeId) throw badRequest("scopeId is required for entity-scoped memory");
    // Users can only write to their own user-scoped memory (entity-scoped is open like notes).
    if (input.scopeType === "user" && scopeId !== user.id) throw badRequest("User memory is private to the caller");
    const row = await writeMemory(user.orgId, environment, user.id, { ...input, scopeId });
    ok(res, { memory: row }, 201);
  })
);

router.delete(
  "/memory/:id",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const environment = await resolveEnvironment(req, user.orgId);
    await deleteMemory(user.orgId, environment, String(req.params.id), user.id);
    ok(res, { ok: true });
  })
);

// ── Data firewall (🆕 blueprint) ─────────────────────────────────────────────
// GET: the policy (read open — the UI shows what's protected).
// PUT: admin — edit the policy (Organization.settings.ai.firewall).
router.get(
  "/firewall",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const policy = await firewallPolicy(user.orgId);
    const recent = await db().aiInsight.findMany({ where: { orgId: user.orgId, redacted: { not: [] } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, feature: true, redacted: true, createdAt: true } });
    ok(res, { policy, recent });
  })
);

// GET /api/ai/firewall/check?text= — redaction receipt (verify before sending).
router.get(
  "/firewall/check",
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const policy = await firewallPolicy(user.orgId);
    const original = String(req.query.text ?? "");
    if (!original) throw badRequest("text is required");
    const { text: redacted, redactions } = redactContext(original, policy);
    ok(res, { original, redacted, redactions });
  })
);

const firewallSchema = z.object({
  enabled: z.boolean().optional(),
  redactEmails: z.boolean().optional(),
  redactPhones: z.boolean().optional(),
  redactCards: z.boolean().optional(),
  redactLongNumbers: z.boolean().optional(),
  maskMode: z.enum(["full", "partial"]).optional(),
  allowlist: z.array(z.string()).optional(),
});
router.put(
  "/firewall",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const user = await assertActiveUser(req);
    const patch = firewallSchema.parse(req.body ?? {});
    const org = await db().organization.findUnique({ where: { id: user.orgId } });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const ai = ((settings.ai ?? {}) as Record<string, unknown>) ?? {};
    const current = await firewallPolicy(user.orgId);
    ai.firewall = { ...current, ...patch, allowlist: patch.allowlist ?? current.allowlist };
    await db().organization.update({ where: { id: user.orgId }, data: { settings: { ...settings, ai } as object } });
    const environment = await resolveEnvironment(req, user.orgId);
    await emitEvent({ orgId: user.orgId, environment, type: "ai.firewall_updated", entity: "ai", entityId: user.orgId, actorId: user.id, payload: { maskMode: patch.maskMode ?? current.maskMode, redactEmails: patch.redactEmails ?? current.redactEmails, redactPhones: patch.redactPhones ?? current.redactPhones, redactCards: patch.redactCards ?? current.redactCards, redactLongNumbers: patch.redactLongNumbers ?? current.redactLongNumbers } });
    ok(res, { policy: await firewallPolicy(user.orgId) });
  })
);

export default router;
