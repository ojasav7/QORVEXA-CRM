# 52 · What-If Simulator — Model Assumptions

> The What-If simulator (Phase 15, spec `docs/49-spec-phase15.md`) is a
> Business Digital Twin: it recomputes **derived metrics against real org
> data** under a parameter change. It never mutates data — a run only
> persists the `SimulationRun` row (inputs, results, summary) and emits
> `simulation.completed`. Because the models are deterministic arithmetic,
> every number is reproducible and every assumption is stated here.

## Shared inputs

- **Weighted open pipeline** = Σ over open deals (stage ∉ {won, lost}) of
  `amount × probability/100`. Amounts and probabilities are read live from
  the `Opportunity` rows.
- **Current MRR** = Σ over active/past-due subscriptions of
  `unitPrice × quantity`, normalized: annual → ÷12, quarterly → ÷3, monthly
  → as-is.
- **Selling seats** = active non-admin users in the org (floor of 1).

## 1. Pricing (`priceChangePct` ∈ [−50, 100])

**Assumption:** every open deal's amount scales by the same percentage;
probabilities and the stage mix are unchanged.

```
afterWeighted  = round(beforeWeighted × (1 + pct/100))
totalAmountAfter = round(totalAmountBefore × (1 + pct/100))
```

**What it answers:** what is the weighted pipeline worth if list prices move
±N%? (The discount view is `discount`.)

## 2. Discount / negotiation impact (`discountPct` ∈ [0, 60])

**Assumptions:** the discount applies to the amount, not the probability; no
volume uplift from the discount is modeled (conservative — a real discount
often buys win-rate, which this model deliberately ignores).

```
afterWeighted = round(beforeWeighted × (1 − pct/100))
```

## 3. Churn projection (`churnRatePct` ∈ [0, 30], `months` ∈ [1, 36])

**Assumptions:** current MRR is derived as above; churn applies **monthly to
the remaining base** with no growth and no win-back (a worst-case-ish view);
ARR = MRR × 12.

```
projected[i] = round(projected[i−1] × (1 − rate/100)), projected[0] = MRR
arrAfter = projected[last] × 12
cumulativeMrrLost = MRR × months − Σ projected
```

## 4. Hiring / capacity (`newReps` ∈ [1, 50])

**Assumptions:** every active non-admin user is one selling seat; the open
pipeline is unchanged — new reps share the existing book until they source
new deals.

```
perRepBefore = round(weighted / seats)
perRepAfter  = round(weighted / (seats + newReps))
loadReductionPct = round((1 − perRepAfter / perRepBefore) × 100)
```

## 5. Stage mix shift (`shiftStage` ∈ [10, 100] probability, `shiftPct` ∈ [0, 100])

**Assumptions:** `shiftPct%` of open deals **by count, smallest-amount
first** adopt the target stage's probability; amounts unchanged; uplift
capped at 100.

```
shiftCount = round(openCount × shiftPct / 100)
afterWeighted = Σ over deals: amount × (i < shiftCount ? min(100, shiftStage) : probability)/100
```

## 6. Validation & limits

- Every parameter is range-checked before the model runs; an out-of-range run
  is persisted with `status: "failed"` and the reason — never partially
  applied.
- The models are **single-point arithmetic** (no Monte Carlo / confidence
  intervals). Sensitivity analysis is done by running a model at several
  parameter values and comparing rows in the run history
  (`GET /api/brain/simulations`).
- Verified live by `verify-phase15.sh`: the +10% pricing run produces exactly
  `round(beforeWeighted × 1.1)`, and the 2%/12-month churn run projects 12
  months of declining MRR.
