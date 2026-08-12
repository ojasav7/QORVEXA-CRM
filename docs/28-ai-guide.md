# 28 · AI Guide — Feature Catalog, Data Firewall & Explainability

> Phase 8's three blueprint docs in one: the **AI feature catalog** (feature →
> model used per feature), the **data firewall policy doc** (what is redacted,
> when, and how), and the **explainability spec** (how every output shows its
> work). Everything here describes the *live, deterministic* engine in
> `server/lib/ai.ts` (ADR-020) — no external model is called in v1; the router,
> firewall, and insight log are the integration point where a real provider
> plugs in later.

## 1 · AI feature catalog (model used per feature)

Every AI feature maps to a **capability**; the router picks a model that has
that capability (region pin first, then the org's preference). The catalog is
served live by `GET /api/ai/catalog` and each decision is recorded on the
AIInsight row it produced.

| Feature | Capability | Default model (cost pref) | Notes |
|---|---|---|---|
| `contact.summary` · `account.summary` | summary | mock-fast | record headline + recent activity |
| `deal.summary` | summary | mock-fast | stage, amount, probability, close date + event momentum |
| `ticket.summary` | summary | mock-fast | status, priority, SLA state, escalation, legal hold |
| `lead.summary` | summary | mock-fast | score, source, status |
| `call.summary` | summary | mock-fast | transcript + notes → key points, next-step detection |
| `meeting.summary` | summary | mock-fast | notes + attendees |
| `profile.summary` | summary | mock-fast | the AI Customer 360 card (touchpoints/purchases/tickets) |
| `email.draft` | draft | mock-fast | tone-controlled draft from firewalled context |
| `lead.score` · `deal.score` | score | mock-fast | transparent component-weighted scores |
| `sentiment` | sentiment | mock-fast | lexicon-based, positive/neutral/negative |
| `intent` | intent | mock-fast | behavior-stream signals with per-signal confidence |
| `search` | search | mock-fast | semantic search with evidence per hit |

**The default catalog** (lazily seeded per org × env, `ModelRoute` rows):

| Model | Tier | Cost /1k | Latency | Region | Weight |
|---|---|---|---|---|---|
| `mock-fast` | standard | $0.30 | 120ms | any | 3 |
| `mock-balanced` | standard | $1.50 | 320ms | any | 2 |
| `mock-premium` | premium | $6.00 | 900ms | any | 1 |
| `eu-mock` | standard | $2.40 | 380ms | eu | 2 |

**Routing policy** (`Organization.settings.ai`): `preference` ranks candidates
— `cost` (cheapest first), `quality` (premium tier first), `latency` (fastest
first) — with `routingWeight` as the tie-break. `preferredRegion` pins to
models hosted in that region (**data residency-aware routing**: when `eu` is
set, only `eu-mock` qualifies and the reason records the pin). `defaultModel`
names the fallback for features without a capability match.

## 2 · Data firewall policy

The firewall is the **redaction/policy engine that runs before any data
reaches a model**. The assembled context string is scrubbed, and the
generator reads only the scrubbed text — so a stripped value can **never**
echo back into a summary, draft, or output.

**What is redacted** (all on by default):

| Pattern | Example | Default mask (partial) |
|---|---|---|
| Emails | `elena@northwind.example` | `el***` |
| Phone numbers (real shapes: `+1 212 555 0111`, `(415) 555-0100`) | | `+1 2***` |
| Card-like numbers (13–16 digit groups) | | `[card]` |
| Long numeric IDs (9+ digits) | | `[id]` |

- **Allowlist** — exact values never redacted (e.g. the org's own support
  address).
- **Mask modes** — `partial` (keep the first 2 chars) or `full` (`[email]`).
- **What it deliberately does NOT redact** — dates like `2026-09-02` (the phone
  pattern is digit-shape-aware), names, and business fields; the context still
  needs enough signal to summarize.
- **Where it shows up** — every AIInsight row records `redacted: [{ type,
  count }]`; the Copilot page's Firewall tab shows the policy + the 10 most
  recent redactions; the summary/draft output cards show the count per type.

Admin edits the policy via `PUT /api/ai/firewall` (`Organization.settings.ai.firewall`).

## 3 · Explainability spec (how every output shows its work)

Three things are true of every AI output in Phase 8:

1. **It has evidence.** Summaries carry recent-event bullets; scores carry a
   component table (`{ key, label, weight, value, inputs }`); search results
   carry `matchedTerms` + optional `predicate` + a one-line `reason`;
   sentiment lists its positive/negative hits; intent lists per-signal
   evidence.
2. **It has a confidence score.** 0–100, with explicit reasons, computed from
   the *amount and quality of signal* — not a black box:
   - summary: completeness (fields filled) + recent-activity + event count;
   - lead/deal score: how many components had real inputs + engagement;
   - sentiment: lexicon hit density (short texts are honestly low-confidence);
   - search: the per-result match strength.
   Below **40** the row is flagged `lowConfidence` → `ai.confidence_flagged`
   + an admin notification ("review before acting on it").
3. **It is audited.** Every generation persists an `AiInsight` row (content,
   payload, model, latency, confidence, redactions, actor) and emits the
   blueprint events (`ai.summary_generated`, `ai.score_computed`,
   `ai.confidence_flagged`) into the same event log every other phase writes —
   so the AI layer is subject to the same webhooks, feeds, and future
   Time Machine as everything else.

### The scores, documented

**Lead quality** (0–100): `base lead score × 50% + source quality × 15% +
recency × 15% + 30-day behavioral engagement × 10% + data completeness × 10%`.
Source quality: Referral 90 · Website 78 · Landing page 74 · Event 68 · Cold
outreach 45 · unknown 55. Recency: ≤3d 100 · ≤14d 70 · ≤45d 40 · else 15.

**Deal health** (0–100): `stage probability × 35% + deal size vs org average ×
20% + 14-day momentum (events) × 25% + 30-day buyer engagement (emails + calls
×1.5 + meetings ×2) × 20%`.

## 4 · Non-goals (where real AI plugs in)

- **Swapping in a real provider** — add a `ModelRoute` row per model, keep the
  policy, and replace the deterministic generators with calls to the model
  using the *already-scrubbed, already-routed* context; AIInsight + events
  record everything unchanged.
- **Autonomy** — nothing in Phase 8 writes to the CRM except the explicit
  user-invoked insight log; actions (create task, send email) remain Phase 9
  (risk-tiered) territory.
