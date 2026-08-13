# 34 · Customer Success Operating Guide

> How to run the Customer Success, Retention & Expansion suite (Phase 11) for
> real: the playbooks, the scoring models (explained), and the operational
> loop. Companion to the spec (`docs/32-spec-phase11.md`) and build report
> (`docs/33-phase11-build-report.md`). Everything the platform computes is
> deterministic and explained — these are the formulas, so the numbers in the
> UI are auditable, not magic.

## The operating loop

1. **Onboard** — create a `SuccessPlan` (kind `onboarding`) per new account,
   assign a CSM (`ownerId`), set milestones + a target date. The plan hydrates
   the account's live health score + churn tier, so status is always current.
2. **Watch usage** — the usage tab shows feature adoption per account; the
   event-bus mirror ingests activity automatically, so "last active" and
   adoption drops need no manual entry. A ≥ 50% drop in distinct features vs
   the prior window fires `usage.adoption_dropped` and notifies admins.
3. **Score churn** — refresh scores (or let the ticker) to persist snapshot
   history; an escalation to a higher tier fires `churn.risk_scored` + an
   admin notification. The factor list is the playbook trigger (below).
4. **Expand** — the expansion radar lists seat upsells, plan upsells, and
   cross-sells with reasons; work the list at QBR time.
5. **Listen + feed the roadmap** — run NPS/CSAT/CES surveys; negative feedback
   promotes into the roadmap with votes — the backlog self-prioritizes.
6. **Advocate** — enroll happy customers in the loyalty program; referrals
   convert to points, tiers, and pipeline.

## Success plans — the playbook

- **Status is derived-plus-manual** — `draft → active → completed | archived`,
  with `at_risk` *suggested* automatically when the account's health < 60 or
  churn tier ≥ `high`. The UI shows `atRisk: true`; the CSM owns the response.
- **Milestones** — one row per deliverable (`{ title, dueDate }`). Completing
  a milestone emits `milestone.completed` (the event bus + timeline see it).
- **QBRs** — log the date, attendees, and notes per review; the plan's QBR
  history is the account narrative.

## Usage intelligence — what the numbers mean

- **Activity trend** is derived from `UsageEvent.occurredAt` recency vs the
  prior window (rising / steady / declining) — the "inactive" flag is simply
  "no events in N days".
- **Seat utilization** = active seats ÷ licensed seats (from the account's
  subscription quantity); ≥ 90% is the radar's upsell trigger.
- **Adoption** = which features the account has used (and how recently).
  Catalog features never used are the cross-sell list.
- **bySource** splits api / event-bus / seed so mirrored activity is
  distinguishable from product-posted telemetry.

## Churn model v2 — the five signal groups (explained)

Score 0–100, tiered `low | medium | high | critical`. Every factor carries its
impact (+ raises risk / − lowers) and a plain-English detail:

| Signal | Inputs | Impact |
|---|---|---|
| **Health** (Phase 7) | `accountHealth` score | Low health → +risk |
| **Usage trend** | feature count change, last-active days, inactivity | Adoption drop / inactivity → +risk |
| **Support burden** | open ticket age, SLA breaches, escalated tickets | Old/breached tickets → +risk |
| **Billing health** | past-due subs, dunning state (Phase 10) | Past-due → +risk |
| **Voice of customer** | survey sentiment (NPS/CSAT/CES) | Negative → +risk |

The factor list *is* the playbook: a `high` tier driven by
`usage_decline` → re-engagement campaign; by `support_burden` → escalate the
ticket; by `billing` → finance touches the account. **Refresh** (`POST
/api/success/churn/refresh`, or the ticker) snapshots every account under one
`refreshId` — the Churn tab's history + deltas come from snapshots, and only
tier *escalations* emit `churn.risk_scored` (no noise on steady state).

## Surveys + roadmap

- **Scoring** — NPS = %promoters (9–10) − %detractors (0–6), range −100..+100;
  CSAT = mean satisfaction 1–5; CES = mean effort 1–7 (lower is better). All
  computed at read with the formula attached (Phase 6 lineage discipline).
- **Sentiment** is keyword-derived at read (positive / neutral / negative) —
  transparent, not an opaque model.
- **Feedback → roadmap** — promote a survey comment with
  `{ source: "survey", surveyResponseId, title }`; the roadmap item inherits
  the response's sentiment context. Status flow `new → triaged → planned →
  in_progress → shipped | declined`; **votes** (`POST
  /api/success/roadmap/:id/vote`) rank the backlog.

## Loyalty rules

- **Tier** is derived at read: highest `tier.minPoints` ≤ member points wins
  (seeded demo: `silver 0`, `gold 1500`, `platinum 5000` → 1600 pts = gold).
- **Points** — `pointsRules` on the program: referrals award
  `pointsRules.referral` on conversion; surveys/reviews award their rules.
  Awards are immutable-ish: `POST /api/loyalty/members/:id/award` takes
  positive points + a reason; non-positive → 400 (no accidental point-bleed).
- **Referral lifecycle** — `pending → contacted → converted | expired`.
  `converted` awards the referrer + emits `referral.converted`; the engine
  ticker can detect conversion automatically (the referred email becomes a
  customer). Invalid transitions (e.g. `converted → expired`) are rejected.

## Operationally

- **Flags** — every area is independently gateable: `cs.plans`, `cs.usage`,
  `cs.churn`, `cs.surveys`, `cs.loyalty` (`PUT /api/features/<flag>`).
- **RBAC** — reads open (the page is a monitoring surface); plan/survey/
  program writes, churn refresh, and the tick are admin/manager.
- **Environments** — everything is scoped by `X-Environment` (ADR-008):
  run playbooks in sandbox before touching production accounts.
- **Events** — the full catalog in `docs/03-event-catalog.md`; the Success
  page, the event log, and the notification bell all read the same stream.
