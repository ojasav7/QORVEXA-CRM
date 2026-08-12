# 26 · Phase 8 Spec — AI Assistant Layer (Non-Agentic AI)

> The spec that drives Phase 8 of QORVEXA CRM. Goal (from the blueprint):
> **AI embedded everywhere as a copilot, no autonomous actions yet.** Everything
> in here is scoped to what can be built, verified live, and demoed on the
> existing stack (Express 5 + Mongo via Prisma + React 19 SPA) with the
> project's mock-provider discipline (ADR-014): every "AI" output is
> **deterministic, in-process, and EXPLAINABLE** — the model router is a real
> admin-editable catalog that *decides* and *records* which model would serve
> each feature (cost/latency/quality + region residency), the data firewall
> redacts PII from model-bound context, and every generation persists an
> AIInsight row with confidence + evidence + the firewall log.

## §0 · Current substrate (verified in repo)

- **Event + audit history** — every `Event` row (deal.stage_changed, call.completed,
  …) and `AuditLog` row already persists; summaries and momentum scores read
  them directly (the blueprint's "Event + audit history is the context
  substrate").
- **Phase 6 predictive v1 + Phase 7 health** — transparent arithmetic with
  documented inputs is the established "explained number" pattern; Phase 8's
  AI scoring extends it with model routing + confidence + persisted insights.
- **CDP profiles + behaviors** — `IdentityProfile` (email-keyed) + `BehaviorEvent`
  are the raw material for intent detection, engagement signals, and the 360
  summary card.
- **Mock transcripts + notes** — Phase 2 call recordings carry mock transcripts;
  meetings carry notes — the summarization raw material.
- **Feature-flag + engine-subscriber patterns** — every phase ships flags
  (`requireFeature`) and boot engines (`startXEngine`); Phase 8 follows both.

## §1 · Scope (what this phase ships)

### 1.1 Model router + multi-model support — `ModelRoute` (flag `ai.modelRouter`) 🆕
- One row per model: `{ name, provider, tier, capabilities[], costPer1kIn/Out,
  latencyMs, region (any|eu|us), active, routingWeight }`. The default catalog
  (mock-fast / mock-balanced / mock-premium / eu-mock) is **lazily seeded** per
  org × env (same as SlaPolicy/pipelines).
- Org routing policy (`Organization.settings.ai`): `defaultModel`,
  `preference: cost|quality|latency`, `preferredRegion` (**🆕 data
  residency-aware routing** — when a region is pinned, only models hosted there
  qualify).
- `routeModel(feature)` maps feature → required capability, ranks candidates by
  the preference (weight tie-break), and returns an **explainable decision**
  (`picked`, `reason`, `candidates`) that is recorded on the AIInsight row the
  call produces.
- `GET /api/models/route?feature=` dry-runs the decision; `GET /api/models`
  lists catalog + policy; writes admin-only (add/edit/remove models, edit
  policy).

### 1.2 Data firewall (redaction/policy engine) 🆕
- `redactContext(text, policy)` runs **before any context reaches a model**:
  emails, phone numbers, card-like numbers, and long numeric IDs are masked
  (full or partial), with an allowlist. Outputs are generated from the
  **scrubbed** context, so a stripped value can never echo back into a summary
  or draft.
- Policy lives in `Organization.settings.ai.firewall`; `GET /api/ai/firewall`
  returns the policy + recent redactions (from AIInsight rows); `PUT` (admin)
  edits it.

### 1.3 Summaries — record / call / meeting / Customer 360 card
- `POST /api/ai/summarize` — contact | account | deal | lead | ticket: the
  record's firewalled context + recent events synthesize a headline +
  activity note, with evidence bullets.
- `POST /api/ai/summarize/call` — transcript + notes → key points + next-step
  detection. `POST /api/ai/summarize/meeting` — notes + attendees.
- `POST /api/ai/summarize/profile` — the **AI-generated Customer 360 summary
  card** (touchpoints, purchases, open tickets, email volume).
- Every summary persists an AIInsight (kind `summary`) and emits
  **`ai.summary_generated`**.

### 1.4 AI email writing
- `POST /api/ai/draft` — tone-controlled (follow-up / proposal / check-in /
  thank-you) email for a contact, optionally about a deal; composed from the
  firewalled context. Kind `summary` → `ai.summary_generated`.

### 1.5 AI lead/deal scoring + sentiment + intent (explained)
- `POST /api/ai/score` — **lead quality** (base score 50% + source 15% +
  recency 15% + engagement 10% + completeness 10%) and **deal health** (stage
  probability 35% + size vs org avg 20% + momentum 25% + buyer engagement
  20%), each with a component breakdown + inputs. Emits **`ai.score_computed`**.
- `POST /api/ai/sentiment` — lexicon-based over any text (positive/neutral/
  negative + hit evidence).
- `POST /api/ai/intent` — behavior-stream signals (buying / active user /
  considering / needs support / awareness) with per-signal confidence.

### 1.6 Natural-language semantic search
- `GET /api/ai/search?q=` — token-group matching with **synonyms** ("won" →
  closed/signed, "over 50k" → amount ≥ $50k predicate, entity words steer
  types), field-weighted ranking, per-hit **evidence + confidence**, and a
  persisted AIInsight (kind `search`) for audit. Every result explains why it
  matched.

### 1.7 Confidence scoring (🆕) + explainability
- Every output carries `confidence` (0–100) with explicit inputs/reasons.
  Below the threshold (40) the row is flagged `lowConfidence` → emits
  **`ai.confidence_flagged`** + an admin notification (`kind: ai`, header
  bell). The UI renders a confidence gauge on every insight, search result,
  and score component.

### 1.8 Short-term AI memory — `AIMemory`
- `{ scopeType: user|entity, scopeId, key, value, expiresAt }` — the copilot's
  scratchpad, TTL-based. `GET/POST/DELETE /api/ai/memory`; user-scoped rows are
  private to the caller; the engine ticker (`startAiEngine`) purges expired
  rows every 60s.

### 1.9 AI feature catalog + UI
- `GET /api/ai/catalog` — every feature → capability → routed model (the AI
  feature catalog doc, `docs/28-ai-guide.md`).
- **Copilot page** (`/copilot`, flag `ai.assistant`, new "AI" nav section):
  Ask (semantic search with evidence + confidence), Generate (summaries /
  drafts / scores / text tools), Insights (AIInsight history with
  low-confidence + redaction badges), Memory, and the Firewall policy panel.
- **Model router page** (`/models`, flag `ai.modelRouter`): catalog table,
  policy editor, and the route explainer.

### 1.10 Demo data (`npm run seed`)
- The 4 default models + org routing/firewall policy (settings.ai), a seeded
  deal summary + lead score (via the real engine), and one memory row so every
  Copilot tab has data on first login.

## §2 · Key decisions (becomes ADR-020)

1. **AI is deterministic + explainable (mock provider)** — the same ADR-014
   discipline as email/calling: no external model API in v1. The router, the
   firewall, and the insight log make the system *ready* for a real model
   (the context is assembled, scrubbed, routed, and recorded — only the
   generator would change), and every output can already defend itself with
   evidence + confidence.
2. **Model routing is data, not code** — `ModelRoute` rows + a settings policy;
   admins tune cost/latency/quality/residency without a deploy (SlaPolicy /
   pipeline precedent).
3. **The firewall is a hard boundary** — model-bound context is scrubbed and
   the *scrubbed* text feeds generation, so PII cannot leak into outputs; the
   redaction log rides on every AIInsight.
4. **AIInsight is the audit + explainability surface** — one row per
   generation (content, payload/evidence, model, latency, confidence,
   redactions) + the blueprint's three events
   (`ai.summary_generated` / `ai.score_computed` / `ai.confidence_flagged`);
   search/draft/sentiment/intent persist rows and reuse the three events.
5. **Feature-gated** — `ai.assistant` (pro/enterprise) and `ai.modelRouter`
   (enterprise), exactly like every earlier phase.

## §3 · Events added (catalog `docs/03-event-catalog.md`)

| Event | When | Payload |
|---|---|---|
| `ai.summary_generated` | A summary or email draft was generated | `{ feature, confidence, modelId }` |
| `ai.score_computed` | An AI lead/deal score was computed | `{ feature, confidence, modelId }` |
| `ai.confidence_flagged` | An output scored below the confidence threshold | `{ feature, confidence, threshold }` (also writes an admin notification `kind: ai`) |

## §4 · Non-goals (deferred, documented)

- Autonomous actions, agent loops, tool use (Phase 9 agent platform owns the
  risk-tiered 🟢🟡🔴 action system).
- Real model providers / embeddings — the router + firewall + context pipeline
  are the integration point; external APIs arrive with real API keys.
- Human-in-the-loop approval of AI outputs (Phase 9); memory consolidation /
  long-term memory (Phase 15 Organizational Memory).
- Fuzzy-name identity resolution via ML (Phase 8/9 per `docs/25-cdp-guide.md`).

## §5 · Verification plan (`verify-phase8.sh`)

- **Router** — default catalog seeded (4 models); cost pref picks `mock-fast`,
  quality pref picks `mock-premium`, EU residency pin picks `eu-mock` (policy
  changed + restored in a sandbox env to keep prod pristine); rep model write
  403; dry-run returns a decision.
- **Firewall** — context with an email + phone redacts both (counts on the
  insight); a summary's output never contains the email; maskMode full vs
  partial; rep policy write 403.
- **Summaries** — deal summary contains stage/amount; call summary from the
  seeded transcript; profile 360 summary includes purchases; `ai.summary_generated`
  event.
- **Drafts** — tone respected; `ai.summary_generated` fires; copy contains the
  contact's first name but no email/phone (firewalled).
- **Scores** — lead + deal scores 0–100 with 4 components each; component
  values + weights sum correctly; `ai.score_computed` event; rep can generate
  (reads open).
- **Sentiment + intent** — positive text → positive; intent on Elena's profile
  → buying (purchased) with per-signal confidence.
- **Semantic search** — "won deals over 50k" parses `amount ≥ 50000` and ranks
  the won deal with predicate evidence; "elena" searches all types; a search
  insight is persisted.
- **Confidence** — a low-confidence generation (short sentiment text) flags
  `lowConfidence`, emits `ai.confidence_flagged`, and writes an admin
  notification.
- **Memory** — write/list/delete scoped; user rows private to the caller.
- **Feature gates** — `ai.assistant` + `ai.modelRouter` 403/restore; sandbox
  isolation (sandbox models/insights invisible in production).
- **Full regressions** — phases 1–7 suites green on the same stack.
