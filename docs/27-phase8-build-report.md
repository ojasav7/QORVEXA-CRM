# 27 · Phase 8 Build Report — AI Assistant Layer

> What shipped to complete Phase 8 (the blueprint's "AI Assistant Layer
> (Non-Agentic AI)") end-to-end, the decisions behind it, and the
> verification evidence. Spec: `docs/26-spec-phase8.md` · Guide:
> `docs/28-ai-guide.md` · Decision: ADR-020 in `docs/08-decision-log.md`.
> Status overview in `PROGRESS.md`. All live checks below ran against the real
> server (`localhost:8787`, Mongo via Docker, freshly seeded demo org).

## What shipped

### 1. Model router (`server/lib/ai.ts`, `server/routes/models.ts`) — ADR-020
- `ModelRoute` rows are the model catalog: name, provider, tier, capabilities,
  cost per 1k in/out tokens, latency, region, active flag, routing weight.
  Default catalog seeded per org × env: `mock-fast` (standard, low latency),
  `mock-balanced` (standard), `eu-mock` (standard, EU-resident for the
  data-residency pin), `mock-premium` (premium tier).
- **Routing policy** (`GET/PUT /api/ai/policy`) is org-configurable:
  `{ defaultModel, preference: "cost" | "quality" | "latency", preferredRegion? }`.
  Every generation runs `routeModel` → returns `decision` with the **picked
  model + candidates + an English reason** (e.g. *"cost preference picked
  mock-fast from 4 candidate(s)"*). No black box: the UI shows exactly why
  each call went where it went.
- **Data-residency pin**: `preferredRegion: "eu"` pins routing to the
  EU-resident model, with the reason *"residency policy pinned to EU-region
  model"* — the 🆕 blueprint "data residency-aware AI routing" item.
- Admin CRUD (`/api/models`) for the catalog; feature flag `ai.modelRouter`
  gates it.

### 2. Data firewall (`redactContext`, `POST /api/ai/firewall`)
- Every prompt built server-side passes through the firewall **before the
  model sees it**: emails, phones, card numbers, long numeric strings
  (contract/account numbers) are redacted to `[REDACTED]`, and the redaction
  **log** (`{ type, value }`) rides along in the insight. The UI surfaces
  "X piece(s) of PII kept out of the model."
- Policy is org-configurable (`PUT /api/ai/firewall`): `maskMode` +
  per-type toggles (`redactEmails`, `redactPhones`, `redactCards`,
  `redactLongNumbers`). The firewall also ships a **receipt endpoint**
  (`GET /api/ai/firewall/check?text=`) so callers can verify what their text
  would redact before sending. Reads open, writes admin-only (rep → 403).

### 3. Explainable AI generators — every output is an `AIInsight`
All generators follow one shape: `{ insight: { kind, feature, entity,
entityId, title, content, confidence, lowConfidence, redacted, modelId,
latencyMs, payload }, decision: { picked, reason, candidates } }` — every
output is **audited** (an `AIInsight` row), **explained** (a confidence score
+ reason), and **firewalled** (redaction log). Events `ai.summary_generated`
/ `ai.score_computed` / `ai.confidence_flagged` fire per generation.

- **Record summaries** (`POST /api/ai/summarize`) — deal (stage, amount,
  age, owner), contact, account, ticket; **call summaries** from the
  transcript (`/summarize/call`), and **Customer-360 profile summaries**
  (`/summarize/profile`) pulling the Phase 7 graph + health data.
- **Email drafts** (`POST /api/ai/draft`) — tone-controlled
  (follow_up/proposal/casual/formal) for a contact, optional deal context.
- **Explained AI scoring** (`POST /api/ai/score`) — lead score: 5 components
  (behavior, engagement, fit, recency, negative), deal score: 4 components
  (amount, recency, activity, negative) — each with value + weight + why.
  Replaces/extends the Phase-1 static lead scoring with a transparent model.
- **Sentiment** (`POST /api/ai/sentiment`) — positive/negative/neutral +
  score + matched terms. **Intent** (`POST /api/ai/intent`) — given a
  profile, buying / churning / researching / inactive, from real behaviors.

### 4. Natural-language semantic search (`GET /api/ai/search`)
- Queries like *"won deals over 50k"* parse into a **predicate**
  (`{ field: "amount", op: "gte", value: 50000 }`) via a transparent
  keyword parser (`parsePredicate`), then search across all object types
  with ranked hits — every hit carries `evidence` (`matchedTerms` +
  reason) and a confidence score.
- Plain-name queries search all types (contact hit for "elena", etc.),
  and every search persists as an `AIInsight` (kind `search`) for audit.

### 5. Confidence scoring + flagging
- Every generator computes a confidence 0–100. Below threshold (40) the
  insight is `lowConfidence: true`, an **`ai.confidence_flagged`** event
  fires, and an **admin notification** (kind `ai`) is written — the header
  bell surfaces "Low AI confidence ⚠️ … review before acting on it."

### 6. Short-term AI memory (`POST/GET/DELETE /api/ai/memory`)
- `AIMemory` rows (`scopeType: org|user`, `scopeId`, `key`, `value`, TTL,
  updatedAt) — the assistant's scratchpad. User-scoped memory defaults the
  scope to the caller and is **private** (cross-user write → 400). Expired
  rows are excluded on read.

### 7. Feature gates + UI
- `ai.assistant` (pro/enterprise) gates the generator + search + memory +
  firewall APIs and the **Copilot** page; `ai.modelRouter` (admin) gates the
  catalog + policy APIs and the **Model router** admin page.
- **Copilot page** (`/copilot`) — chat-style composer (summarize, draft,
  score, sentiment, search), insight cards with confidence bars + model +
  latency + redaction receipts + "why" reasons, firewall policy editor, and
  memory list. **Models page** (`/models`, admin) — catalog table + routing
  policy form (preference, default model, region pin) with a live route
  demo. Both wired into `Layout` under a new "AI" nav section.

## Decisions (ADR-020)

**Non-agentic, human-in-the-loop**: every AI capability is a read-only
generator returning an *explained, audited, reversible suggestion* — nothing
autonomous writes to the CRM (the blueprint's explicit Phase 8 stance; agentic
autonomy is Phase 9+). **Deterministic-first models**: the routing, scoring,
sentiment, intent, and search all run on transparent arithmetic/keyword rules
so every output ships its inputs + reasons (same ADR-018 discipline as the
metrics library) — no black box, and the model router layer is where a real
LLM provider plugs in later without changing the API contract. **Every prompt
is server-built and firewalled** before the model sees it — PII never leaves
the tenant boundary except as the caller already authorized. **Everything is
audited**: `AIInsight` rows + events make every AI output a first-class,
searchable, deletable record. See `docs/26-spec-phase8.md` §2 for the full
rationale.

## Bugs found & fixed during verification

1. **Semantic-search predicate parser never matched "over 50k"** (found in
   live smoke) — a missing `\s*` and a bare `\$?` alternative made any
   number parse as `lte`; a real "won deals over 50k" query returned nothing.
   Fixed: `over/N+` → `gte`, `under/less than` → `lte`, `about` → `eq`,
   with currency + unit handling ("50k" → 50000).
2. **Plain-name queries only searched opportunities** (found in live smoke)
   — the type-selection logic was inverted: keyword hits narrowed types
   instead of falling back to all-types. Fixed: bare name/term queries search
   every registered type; predicate queries restrict to the mapped type.
3. **Phone regex over-redacted dates** (found in live smoke) — `2026-09-02`
   matched as a phone. Tightened to require real phone shapes.
4. **User-scoped memory wrote with a null scopeId** (found in live smoke) —
   now defaults to the caller's id (and enforces caller-privacy on cross-user
   writes).
5. **Verify-script bugs** (suite-side): the `jget` helper prints Python
   repr (single quotes) so piping it into `json.loads` broke redaction +
   predicate + catalog assertions — replaced with one-shot Python
   extraction; `$50k` expanded `$5` under `set -u` (escaped); the draft
   firewall check grepped the whole response (which legitimately carries
   `payload.recipientEmail`) instead of just the body; the sandbox
   isolation test reused the production contact id (sandbox is a fresh,
   empty env) — it now creates a sandbox-scoped contact first.
6. **Memory read privacy leak** (found in final code review) — the write
   path enforced "user memory is private to the caller" (cross-user write
   → 400) but the read and delete paths didn't: any authenticated user
   could read or delete another user's user-scoped memory by passing their
   id. Fixed: `GET /api/ai/memory` now rejects `scopeType=user` with a
   non-caller `scopeId` (400) and `deleteMemory` enforces caller ownership
   for user-scoped rows. Live-verified (cross-user read → 400).
7. **`GET /api/ai/firewall/check` was documented but missing** (found in
   final code review) — the receipt endpoint was advertised in the API
   reference + guide but never routed. Added the trivial wrapper around
   `redactContext` and locked it in with a suite check.

## Verification evidence

- `npm run typecheck` ✅ · `npm run build` ✅ (production bundle, `dist/`).
- **Live smoke suite (`verify-phase8.sh`, 49/49 green):**
  - Model router: default catalog seeded (4 models); policy = cost;
    quality preference routes to `mock-premium`; **EU residency pin routes
    to `eu-mock` with the reason**; admin policy CRUD works.
  - Firewall: contact summary redacts PII from context (redaction log
    populated) and the summary output contains no email; rep policy write
    → 403.
  - Summaries: deal summary includes stage + amount; call summary from
    transcript; Customer-360 summary includes purchases;
    `ai.summary_generated` event emitted.
  - Drafts: tone respected; **draft body contains no email (firewalled)**;
    redactions recorded.
  - Scoring: lead 5 components, deal 4, scores in [0,100];
    `ai.score_computed` emitted; rep generation → 201 (reads open).
  - Sentiment/intent: positive text → positive; Elena's profile → buying.
  - Search: "won deals over 50k" → `{ amount ≥ 50000 }` predicate with
    evidence; ranked hits; "elena" returns contact hits across all types;
    search persisted as an AIInsight.
  - Confidence: short text → `lowConfidence` flagged,
    `ai.confidence_flagged` event + admin notification (kind `ai`).
  - Memory: write/list/delete; user scope defaults to caller; cross-user
    write **and read** → 400 (privacy held both ways).
  - Firewall receipt: `GET /api/ai/firewall/check` redacts on demand in
    either mask mode (full `[email]` or partial `el******` depending on the
    org policy — the assertion checks the invariant that holds for both:
    the PII is gone from the redacted output + the log names the types).
  - Feature gates: `ai.assistant` + `ai.modelRouter` disable → 403 /
    re-enable → 200.
  - Sandbox isolation: sandbox AI generation isolated; production insight
    list stays in production; both envs seed the default catalog.
  - Cleanup: suite insights purged; demo data left pristine.
- **Regressions on the same fresh stack:** `verify-phase7.sh` 53/53,
  `verify-phase6.sh` 44/44, `verify-phase5.sh` 65/65, `verify-phase4.sh`
  61/61, `verify-phase3.sh` 34/34, `verify-phase2-comm.sh` 45/45,
  `verify-phase2.sh` 29/29, `verify-phase1.sh` 30/30 — **all nine suites
  green in one sequence on one clean DB (410 checks).**

## Docs updated

`docs/26-spec-phase8.md` (spec, new), `docs/27-phase8-build-report.md` (this
report), `docs/28-ai-guide.md` (routing policy, firewall, generators, search
syntax, memory — new), `docs/03-event-catalog.md` (Phase 8 events),
`docs/05-api-reference.md` (AI + Models sections),
`docs/08-decision-log.md` (ADR-020), `PROGRESS.md` (Phase 8 → ✅ 100%),
`docs/06-roadmap.md` (Phase 8 → ✅ shipped), `README.md` (Phase 8 feature
list), `docs/10-continuation-runbook.md` (Phases 0–8).
