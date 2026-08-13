# 33 · Phase 11 Build Report — Customer Success, Retention & Expansion

> **Status: COMPLETE — 100% of the Phase 11 spec (docs/32-spec-phase11.md)
> shipped and live-verified.** Typecheck + production build green; live smoke
> suite `verify-phase11.sh` **71/71** green on a fresh seeded stack, with the
> Phase 10 Revenue Cloud regression suite **109/109** green on the same stack.
> Built directly on the Phase 7 health engine, the Phase 6 derived-metrics
> discipline, and the Phase 10 Revenue Cloud substrate.

## What shipped

### Success & onboarding plans (`cs.plans`)
- `SuccessPlan` rows (kind onboarding/success/custom, status
  draft/active/at_risk/completed/archived, owner, start/target dates) with
  **milestones** (`POST /plans/:id/milestones`, complete → `milestone.completed`)
  and **QBRs** (`POST /plans/:id/qbrs` → `qbr.logged`), CRUD at
  `/api/success/plans` (reads open, writes admin/manager).
- Hydrated plans join `accountName`, `accountTier`, `ownerName`, and **live**
  Phase 7 `healthScore` + `churnRisk`; **health-to-playbook at-risk
  flagging** (health < 60 or churn tier ≥ high → `atRisk: true`) — verified
  live: a low-health plan hydrates at-risk, a healthy plan does not.

### Product usage intelligence (`cs.usage`)
- `UsageEvent` with **two ingestion paths**: `POST /api/success/usage` (API
  telemetry) and the **event-bus mirror** (`meeting.completed` → `meetings`,
  `email.sent` → `email`, `call.completed` → `calls`, `ticket.created` →
  `tickets`, `form.submitted` → `forms`, `deal.created` → `pipelines` —
  verified live end-to-end).
- `GET /api/success/usage` — derived overview (features used, last-active
  days, activity trend, seat utilization, per-feature adoption with last-used
  days, `bySource` split). **Adoption-drop detection** — a ≥ 50% drop in
  distinct features vs the prior window emits `usage.adoption_dropped` and
  notifies admins (kind `cs`) — verified live with a seeded declining account.

### Churn prediction v2 + expansion radar (`cs.churn`)
- `churnForAccount` — explained deterministic score (0–100) from five signal
  groups (health, usage trend/inactivity, support burden, billing health,
  survey sentiment) with per-factor `{ key, label, impact, detail }`
  explanations (ADR-020 discipline) — verified live (a declined-health account
  scores high with the declining-usage factor explained).
- **Snapshot history** — `POST /api/success/churn/refresh` (or the engine
  ticker) persists `ChurnScore` per account × `refreshId`; tier **escalation
  → `churn.risk_scored` + admin notification** — verified live (creating a
  past-due subscription on a low-health account escalates its tier and fires
  the event + `kind: cs` notification).
- **Expansion radar** — `GET /api/success/churn/expansion` finds **seat
  upsells** (utilization ≥ 90% — verified: a 1-seat account at 100% flags),
  **plan upsells**, and **cross-sells** (unadopted catalog features), each with
  a reason + value, emitting `expansion.opportunity_detected`.

### Surveys + feedback → roadmap (`cs.surveys`)
- NPS/CSAT/CES surveys with per-kind **score validation** (out-of-range → 400
  — verified), responses storing `{ score, comment }` with **derived
  sentiment** (verified: "The bulk edit is broken" → negative), every response
  emitting `survey.response_submitted`.
- **Results computed at read with lineage** (NPS = %promoters − %detractors,
  formula attached — verified), and the **feedback → roadmap pipeline**:
  negative comments auto-promote to `RoadmapItem` (verified: seeded negative
  CSAT/NPS feedback became roadmap items sourced from survey), items carry
  **votes** and triage actions (`new → triaged → planned` verified).

### Loyalty / advocacy (`cs.loyalty`)
- Programs (tiers/rewards/pointsRules JSON config), members with **derived
  tiers** from points (verified: 1600 pts → gold), **points awards**
  (`loyalty.points_awarded`, non-positive → 400 verified), and the
  **referral lifecycle** `pending → contacted → converted | expired` with
  invalid transitions rejected (verified) and `converted` awarding the
  referrer + emitting `referral.converted`.

### Engine, RBAC, gates
- `startSuccessEngine` — event-bus usage mirror + ticker (`runSuccessTicker`:
  adoption-drop scan, churn refresh, referral detection, expansion scan) —
  wired in `server/index.ts`; `POST /api/success/tick` runs one pass on
  demand. Reads open, writes admin/manager via `requireRole`; every area is
  behind its own feature flag (`cs.plans` / `cs.usage` / `cs.churn` /
  `cs.surveys` / `cs.loyalty` — verified: disabling `cs.surveys` → 403,
  re-enable → 200). Environment-scoped end-to-end (sandbox plans invisible in
  production, sandbox usage scoped — verified).

## Delivered files
- **Schema** — `prisma/schema.prisma`: `SuccessPlan`, `UsageEvent`, `Survey`,
  `SurveyResponse`, `RoadmapItem`, `LoyaltyProgram`, `LoyaltyMember`,
  `ReferralRecord`, `ChurnScore` (indexed by org + environment).
- **Server** — `server/lib/success.ts` (all logic, derived-on-read +
  explained, ~1,100 lines), `server/routes/success.ts` (34 endpoints), wired
  in `server/index.ts`; `server/lib/features.ts` (5 flags); `server/seed.ts`
  (plans + milestones + QBRs, usage telemetry incl. a declining account,
  surveys + responses incl. negative → roadmap, loyalty program + members +
  referrals, churn snapshot).
- **UI** — `src/pages/SuccessPage.tsx` (Plans / Usage / Churn / Surveys /
  Loyalty tabs + roadmap + expansion radar), route `/success` in `src/App.tsx`,
  "Customer success" nav section in `src/components/Layout.tsx`.
- **Docs** — this report, spec `docs/32-spec-phase11.md`, guide
  `docs/34-customer-success-guide.md`, plus updated event catalog
  (`docs/03-event-catalog.md`), API reference (`docs/05-api-reference.md`),
  roadmap (`docs/06-roadmap.md`), decision log (ADR-023), and `PROGRESS.md`.
- **Verification** — `verify-phase11.sh` (71 live checks).

## Verification

```
npm run typecheck  → green
npm run build      → green
verify-phase11.sh  → 71 passed, 0 failed  ✅ ALL GREEN  (fresh seeded stack)
verify-phase10.sh  → 109 passed, 0 failed ✅ ALL GREEN  (regression, same stack)
```

**Note on the Phase 10 regression:** the suite surfaced two pre-existing
Phase 10 defects, now fixed — (1) `buildLines`/`unitPriceFor` only consulted
the price book when a `priceBookId` was passed, so the seeded default book's
10% Growth discount never applied (quote/order totals were under-discounted);
they now fall back to the default book like `priceBookFor` already did. (2)
`verify-phase10.sh` had an unquoted `$1200` in an `ok` message that bash
expanded as positional param `$12`, aborting the script under `set -u` on the
passing path. With both fixed, the Revenue Cloud suite is fully green.
