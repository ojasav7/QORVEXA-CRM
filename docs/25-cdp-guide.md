# 25 · CDP Reference — Identity Rules, Relationship Graph, Health Formula

> The three documentation deliverables the blueprint requires for Phase 7,
> in one reference: **identity resolution rules**, the **relationship graph
> schema**, and the **health score formula**. Implementation: `server/lib/cdp.ts`
> (identity + behaviors), `server/lib/graph.ts`, `server/lib/health.ts`; spec
> `docs/23-spec-phase7.md`; decision log ADR-019.

---

## 1 · Identity Resolution Rules (v1, deterministic)

### 1.1 The model

Every person is one **`IdentityProfile`** (org × environment). The profile
*is* the identity; the raw CRM records (contacts, leads) are its **members**
(`memberIds: ["contact:<id>", "lead:<id>", …]`). Behaviors, health history,
and the 360 view hang off the profile.

### 1.2 The rules (in priority order)

| # | Rule | Key | Behavior |
|---|---|---|---|
| 1 | **Canonical email** | `email` lowercased + trimmed, unique per org × env | A record with an email that matches a profile **joins it** (identity merge). A record with a brand-new email creates a profile. |
| 2 | **Phone** | `phone` (normalized) | Secondary — used at rebuild/merge time to *suggest* candidate profiles in the merge UI (v1: surfaced via the merge flow, never auto-merged without email evidence). |
| 3 | **Name + company** | `firstName lastName` + `company/account` | Tertiary — a weak signal, only used to rank merge suggestions. |

Records **without an email** stay anonymous: they are *tracked* (behaviors can
still carry `contactId`/`leadId`) but never unified into a profile (v1 limit —
device-ID stitching is a Phase 8/9 item).

### 1.3 When resolution runs

- **On record creation** — every `contact.created` / `lead.created` resolves
  the profile (the CDP engine subscribes to the event bus; the record email is
  the key). Attaching a record to a profile that already has members is an
  **identity merge** → `customer.identity_merged`.
- **On behavior ingestion** — `POST /api/cdp/behaviors` resolves the identity
  via `profileId` → `contactId`/`leadId` (via their email) → `email`.
- **Admin rebuild** (`POST /api/cdp/profiles/rebuild`) — reconciles *every*
  contact + lead (idempotent): creates missing profiles, attaches new records.
- **Admin merge** (`POST /api/cdp/profiles/merge`) — moves members, behaviors,
  and health history from one profile into another; the donor is deleted;
  lineage is kept in the target's `mergedFromIds`; `customer.identity_merged`
  fires with `{ from, into, memberIds }`.

### 1.4 Master-data preference

Contact beats lead for name / account; the lead supplies `company`. The
profile's `primaryContactId` / `primaryLeadId` keep the preferred record.

### 1.5 Known limits (v1, documented)

- No fuzzy name matching or ML scoring (Phase 8/9 AI layer owns that).
- No cross-org resolution (profiles are org × environment scoped by design).
- A profile is tied to exactly one canonical email (the unique key).

---

## 2 · Relationship Graph Schema (v1, derived)

The graph is **computed on read** from live rows (same discipline as the
Phase 6 metrics library) — there is no stored edge table in v1.

### 2.1 Node types

| Node | Source | Edge to |
|---|---|---|
| `account` | `Account` row | contacts (employment), deals (ownership) |
| `contact` | `Contact` row (`accountId`) | the account, deals (involvement) |
| `deal` | `Opportunity` row (`accountId`, `contactId`) | the account, contacts |

### 2.2 Involvement & influence scoring

A contact's **influence** on a deal is the sum of the real touchpoints
between them, weighted:

| Touchpoint | Weight | Source rows |
|---|---|---|
| Email sent | 1 | `Message.contactId + opportunityId`, best state reached |
| Email opened | 2 | status `opened` |
| Email clicked | 3 | status `clicked` |
| Email replied | 4 | status `replied` |
| Call completed | 3 | `Call.contactId + opportunityId`, status `completed` |
| Meeting completed | 5 | `Meeting.contactId + opportunityId`, status `completed` |
| Support ticket | 2 | `Ticket.contactId` on the account (deal view), capped +8 |
| **Primary contact** | **+10** | `Opportunity.contactId === contact.id` |

`influence = min(100, Σ weights)`.

### 2.3 API shapes

- `GET /api/cdp/graph?accountId=` →
  `{ account, deals[], contacts: [{ contact, name, deals: [{ dealId, name,
  stage, amount, probability, influence, touches[], primary }], totalInfluence }] }`
- `GET /api/cdp/graph?dealId=` → the **buying committee**: `{ deal, account?,
  committee: [{ contact, name, influence, touches[], primary }] }` ranked by
  influence.
- The person slice is embedded in the 360 (`GET /api/cdp/profiles/:id` →
  `graphs[]`).

### 2.4 Deferred

Manual edge curation (adding/removing edges, influence overrides) and
relationship graph v2 with full buying-committee mapping are Phase 15 items.

---

## 3 · Health Score Formula

### 3.1 The composite

```
health(0–100) = engagement(≤40) + support(≤25) + revenue(≤25) + recency(≤10)
churnRisk(0–100) = clamp(100 − health)
at risk  ⇔  churnRisk ≥ 70  ⇔  health ≤ 30
```

| Component | Weight | Formula | Inputs |
|---|---|---|---|
| **Engagement** | 40 | `min(40, touchpoints30 × 4)` | `touchpoints30` = behaviors + emails + calls + meetings in the last 30 days |
| **Support health** | 25 | `max(0, 25 − 8·open − 10·breached − 5·escalated)` | open tickets, SLA-breached, escalated |
| **Revenue & pipeline** | 25 | `min(25, (won90 + ½·openWeighted) ÷ 10 000)` | won revenue last 90d, weighted open pipeline (both on the profile's account/members) |
| **Recency** | 10 | `max(0, 10 − daysSinceLastActivity)` | newest behavior / email / call / meeting / ticket |

### 3.2 Worked example (demo seed — Elena Rodriguez)

- Engagement: ~3 touchpoints in 30 days → `min(40, 12)` = **12**
- Support: 1 open + 1 breached + 1 escalated ticket → `25 − 8 − 10 − 5` = **2**
- Revenue: won $12k + ½·~$135k weighted → `(12000 + 67500) ÷ 10000` ≈ **8**
- Recency: active ~1 day ago → **9**
- **Health 31 / 100 → churnRisk 69** — just below the at-risk line; one more
  silent week or a second breached ticket drops it below 30 (at risk).

### 3.3 Why derived + explained

Like the Phase 6 metrics, health is **computed on read** so it can never go
stale, and every score returns its components with the raw inputs + formula
(`GET /api/cdp/health?profileId=`). An admin **refresh** (`POST
/api/cdp/health/refresh`) persists one `HealthScore` row per profile so the
UI shows history + deltas, and emits `customer.health_changed` (all) and
`customer.churn_risk_changed` (churnRisk ≥ 70) so the notification bell and
workflow engine can react.

### 3.4 Deferred

ML churn prediction (Phase 8/9), product-usage telemetry at scale (Phase 11
usage intelligence), NPS/CSAT sentiment inputs (Phase 11 surveys).
