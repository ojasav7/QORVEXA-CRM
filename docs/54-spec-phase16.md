# 54 · Phase 16 Spec — Real-World Provider Integrations

> The spec that drives Phase 16 of QORVEXA CRM — the first phase **beyond the
> 16-phase blueprint** (which ends at Phase 15). Phase 16 lifts the one
> deferral every prior phase carried (ADR-014): the platform's communication,
> AI, and telephony surfaces are real, provider-backed integrations behind a
> small adapter layer — **while mock mode stays the default** so the demo,
> tests, and CI run with zero external credentials. Same stack (Express 5 +
> Mongo via Prisma + React 19 SPA), same discipline: every state change stays
> evented + audited, config writes stay admin-only, reads stay open to
> authenticated users, and every external call is optional + graceful (a
> missing key falls back to the deterministic mock path, never a crash).

## §0 · Current substrate (verified in repo)

- **Phase 2 email** — `Message` rows with an unguessable `trackingToken`;
  public open-pixel / click-redirect endpoints (`/api/t/*`) flip
  `sent → opened → clicked → replied` and emit `email.opened` / `email.clicked`;
  the "provider" is `EMAIL_MOCK=1` (no real sends); inbound mail is simulated
  (`/api/emails/sync` + `/api/emails/:id/reply`); deliverability events
  (bounce/unsubscribe/complaint) are simulated via the Phase 5
  `simulateDeliverabilityEvent` endpoint.
- **Phase 2 calling** — `Call` rows are manually logged; recording + transcript
  are mock placeholders when the org enables `settings.calling.recording`.
- **Phase 8 AI** — the model router (`ModelRoute` catalog + org routing policy)
  *decides* which model serves each feature and records the decision, but the
  catalog is all `provider: "mock"` (ADR-020): no external model API is ever
  called. The data firewall (`redactContext`) scrubs PII from the context
  BEFORE it would reach a model — with real providers this redaction finally
  matters.
- **Phase 14 security** — org × environment scoping (ADR-008), feature flags,
  RBAC, and the system-actor convention are reused unchanged; `enforceSecurityPolicy`
  skips unauthenticated requests, so public provider webhooks are not blocked
  by org IP allowlists.

## §1 · Scope (what this phase ships)

### 1.1 Provider configuration + status (env-driven, no new feature flags)

Provider choice is **environment configuration** (like `EMAIL_MOCK` today —
ADR-014), not org settings: keys are deployment concerns. New env vars
(documentation + `.env.example` + `docker-compose.prod.yml` pass-through):

| Capability | Env vars | Default |
|---|---|---|
| Email | `EMAIL_PROVIDER=mock\|resend\|sendgrid`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `EMAIL_WEBHOOK_SECRET` | `mock` (back-compat: `EMAIL_MOCK=false` → `resend`) |
| AI | `AI_PROVIDER=mock\|openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | `mock` (auto-`openai` when `OPENAI_API_KEY` set) |
| Telephony | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | `mock` (unset = mock) |

- **`GET /api/integrations/status`** (admin-only) returns each capability's
  active provider + configured flags (key present, from-address set) + the
  routing policy for AI — **never any secret**. This drives the Settings →
  Integrations card.
- `server/env.ts` centralises the reads (nothing else touches `process.env`).

### 1.2 Email — real send adapters (Resend + SendGrid)

- One adapter interface (`sendEmail({ from, to, subject, body, headers })`
  → `{ providerMessageId }`) with three implementations: `mock` (existing
  behavior — no-op), `resend` (REST `POST /emails`), `sendgrid`
  (REST `POST /v3/mail/send`, tracking token carried in `custom_args`).
- Implemented with **global `fetch`** — no new npm dependencies (Node 20+,
  the runtime image is Node 24).
- **Every outbound send site** (manual `/api/emails`, Phase 5 campaigns,
  Phase 5 journeys, Phase 9 agent email actions) funnels through one helper
  (`sendOutboundWithProvider`): after the `Message` row is created, the
  configured real provider is called; success stores `providerMessageId` +
  `provider`, failure flips the row to `status: "failed"` and emits a new
  **`email.failed`** event (payload: provider + error class). Mock mode is
  unchanged (no call, instant row).
- `Message` gains two nullable fields: `provider` and `providerMessageId`
  (additive — no backfill needed).
- The mock inbox sync + simulated reply endpoints stay exactly as they are
  (demo surface).

### 1.3 Email — provider event webhooks (open/click/bounce/unsubscribe/complaint/delivered)

- **`POST /api/integrations/email/webhook`** (public, provider → us) accepts
  the raw **Resend** payload (`{ type, data: { email_id, … } }`), the raw
  **SendGrid** array (`[{ event, sg_message_id, … }]`), and a documented
  **normalized** shape for tests/other providers. It correlates the message by
  `providerMessageId` (or `trackingToken`, for mock-mode testing) and:
  - flips the row (`openedAt`/`clickedAt`/`bouncedAt`/`unsubscribedAt`,
    best-state `status`) — reusing the exact engagement logic the tracking
    endpoints use (campaign recipient rollup included),
  - emits `email.opened` / `email.clicked` / `email.bounced` /
    `email.unsubscribed` / `email.complained` / **`email.delivered`** (new —
    mock never simulates delivery, real providers report it),
  - the CDP behavior mirror (Phase 7) + memory learning (Phase 15) then pick
    the events up automatically via the event bus — no new code there.
- **Security:** when `EMAIL_WEBHOOK_SECRET` is set, SendGrid's
  `X-Twilio-Email-Event-Webhook-Signature` (HMAC-SHA256) and Resend's svix
  signature (`svix-*` headers) are verified and bad signatures get 401. When
  no secret is configured (dev), the payload must still *resolve* to a real
  Message row by its unguessable `trackingToken`/`providerMessageId`
  (capability proof) — an unknown id/token → 404.
- The existing mock deliverability simulation endpoint is untouched (it stays
  the demo path for Phase 5 metrics).

### 1.4 Telephony — Twilio outbound calls + status callbacks

- **`POST /api/calls/:id/place`** (admin/manager) initiates a **real** call
  when Twilio is configured (REST `POST /2010-04-01/Accounts/{sid}/Calls.json`
  with `StatusCallback` + `StatusCallbackEvent=initiated ringing answered
  completed` URLs that embed our `callId`). Returns the `callSid`. Without a
  configured provider it returns 400 with an actionable message (never a
  silent mock).
- **`POST /api/integrations/twilio/status/:callId`** — Twilio status
  callbacks: updates the row (status, duration from `CallDuration`), and on
  `completed` with recording enabled fetches the recording media URL
  (REST recordings list) + best-effort transcript (Twilio Transcriptions),
  then emits `call.completed`. Callback signature verified with
  `X-Twilio-Signature` (HMAC-SHA1 over the full URL, `TWILIO_AUTH_TOKEN`)
  whenever Twilio is configured; otherwise the `:callId` must resolve to a
  real Call row in the org (capability proof).
- Mock mode: `POST /api/calls` logging + `settings.calling.recording` mock
  placeholder stays byte-for-byte.

### 1.5 AI — real model execution behind the existing router

- The `ModelRoute` catalog already carries `provider`; Phase 16 makes
  `provider: "openai"` executable:
  - **`ensureDefaultModels` seeds two real routes lazily when
    `OPENAI_API_KEY` is set**: `openai-gpt-4o-mini` (cheap/standard) and
    `openai-gpt-4o` (premium), with realistic cost/latency metadata. The
    router's cost/quality preference + region pin then pick between them and
    the mock catalog exactly as before — the decision stays explainable.
  - One helper **`maybeCallLlm(orgId, environment, feature, prompt, opts)`**:
    resolves the routed model; if it is `provider: "openai"` AND a key is
    configured, calls `POST {baseUrl}/v1/chat/completions` (global `fetch`)
    and returns `{ text, modelId, latencyMs, usage }`. Any miss (no key,
    provider mock, network/parse error) returns `null` — callers fall back to
    the deterministic generator, so **a real model is a strict enhancement,
    never a failure mode**.
  - Wired into the two highest-value surfaces: **record summaries**
    (`summarizeRecord`, capability `summary`) and **email drafts**
    (`draftEmail`, capability `draft`). The prompt is built from the **already
    firewalled context** (PII scrubbed before the API call), the output is
    validated (drafts must parse as JSON `{subject, body}`), and the
    `AIInsight` row records `modelId` + `latencyMs` + the redaction log —
    the audit/explainability contract (ADR-020) holds for real models.
  - `GET /api/integrations/status` also reports the AI provider + default
    model so admins can see what's actually serving.
- Everything else (scores, sentiment, intent, semantic search, agents,
  brain, builder) stays deterministic — documented as the Phase-16 non-goal
  (same interface, drop-in later).

### 1.6 Settings UI + docs

- Settings gains an **Integrations** tab: read-only provider status cards
  (email / AI / telephony) + the docs links — no secrets, no writes (config is
  env-level).
- `.env.example`, `docker-compose.prod.yml`, `docs/07-setup.md`,
  `docs/14-communication-guide.md`, and `docs/28-ai-guide.md` document every
  var + the webhook URLs to register with the providers.

## §2 · Schema (additive only)

```prisma
model Message {
  // …
  provider           String?  // "mock" | "resend" | "sendgrid" (which adapter sent it)
  providerMessageId  String?  // provider's message id (webhook correlation)
}
```

No other model changes. `prisma db push` (additive) — no backfill.

## §3 · Events (new)

| Event | Emitted when |
|---|---|
| `email.failed` | a real provider send rejects (payload: provider, errorClass) |
| `email.delivered` | provider reports delivery (real webhooks only) |

Reused unchanged: `email.sent/opened/clicked/bounced/unsubscribed/complained`,
`call.completed`, `model.created`, `ai.summary_generated` (with `modelId`).

## §4 · Security posture

- Webhook endpoints are public by nature (providers can't log in); they are
  protected by (a) signature verification when secrets are configured, and
  (b) a **capability proof** — the payload must reference a real row by its
  unguessable token/id, so a forged payload can only touch rows whose token
  the attacker already knows (which is no additional exposure).
- Provider keys live in env (never org settings, never exposed by
  `/api/integrations/status`).
- The Phase 8 data firewall runs **before** any real model call; the redaction
  log rides the insight row exactly as in mock mode.

## §5 · Non-goals (deferred, documented)

- **Inbound email routing** — real provider inbound (Resend inbound / SendGrid
  Inbound Parse) is a follow-up; the mock inbox sync + reply simulation and the
  email→ticket intake stay as-is.
- **SDK-based adapters** — REST-over-`fetch` keeps the dependency tree flat;
  a provider SDK can replace an adapter without changing the interface.
- **Multi-region AI hosting** — `OPENAI_BASE_URL` covers Azure/enterprise
  gateways; true region-pinned routing is a hosting concern (Phase 0 note).
- **Other AI features** (scores/sentiment/intent/search/agents/brain/builder)
  remain deterministic — the `maybeCallLlm` interface is the drop-in point.
- **Twilio transcription** is best-effort (may be empty — the recording URL is
  the durable artifact).
- **SMS/WhatsApp/chat channels** (Phase 4) remain channel metadata; provider
  integrations for them are still deferred.

## §6 · Verification plan

- **Mock-mode live suite (`verify-phase16.sh`)** against the fresh seeded
  stack — all checks run with NO provider keys configured, proving the
  platform works unchanged:
  1. `GET /api/integrations/status` → email `mock`, ai `mock`, telephony
     `mock`; rep → 403.
  2. Send via `/api/emails` (mock) → row `sent`; normalized webhook
     (opened/clicked/bounced) referencing the returned `trackingToken` →
     status flips + `email.opened/clicked/bounced` events persisted; unknown
     token → 404; SendGrid-format + Resend-format payloads both parse.
  3. Twilio: `POST /api/calls/:id/place` without config → 400; status
     callback with a valid callId → row updated + `call.completed` event;
     unknown callId → 404.
  4. AI: seeded catalog has 4 mock models (no openai without a key);
     `POST /api/models` with `provider: "openai"` still validates; a record
     summary still generates deterministically with `modelId: null`; the
     router decision is explainable.
  5. Regressions: `verify-phase8.sh` (49) + `verify-phase2-comm.sh` (45) +
     `verify-phase1.sh` (30) green on the same stack.
- **Adapter contract tests (`server/scripts/p16-adapter-test.ts`, `npx tsx`)** —
  no network, `fetch` stubbed: Resend/SendGrid request construction + response
  parsing, webhook payload → normalized event mapping for both providers,
  SendGrid + Resend signature verify (accept/reject), Twilio call-create
  request + signature + status-callback parsing, OpenAI chat-completions
  request + content parsing + error handling.
- `npm run typecheck` + `npm run build` green.
