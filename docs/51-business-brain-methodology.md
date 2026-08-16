# 51 · Business Brain Methodology

> The explainability contract for the Business Brain (Phase 15, spec
> `docs/49-spec-phase15.md`, ADR-027). Every insight the Brain produces is
> derived deterministically from live rows + the event log with explicit
> evidence — nothing is a black box, and no insight can go stale (the scan
> re-derives and prunes).

## 1. How a scan works

`scanBrain(orgId, environment, actorId)` runs every rule below across the
org × environment and **upserts by fingerprint**: re-scanning an existing
fingerprint updates the row in place (fresh evidence, fresh severity), and a
brand-new fingerprint creates the row and emits `insight.generated`. At the
end of the scan, open insights whose fingerprint was **not** touched are
deleted — a stalled deal that closed, or a breached ticket that resolved,
disappears from the ledger by itself.

**Severity mapping** — `sevOf(n)`: `≥ 80 critical`, `≥ 60 high`, `≥ 40
medium`, `≥ 20 low`, else `info`. The severity is always derived from the
underlying inputs, never hand-picked.

## 2. The rules (inputs → output)

| Rule | Category | Trigger condition | Evidence recorded | Fingerprint |
|---|---|---|---|---|
| Stalled deal | risk | open deal, no event on the deal in ≥ 30 days (`idle ≥ 30`, ≥ 60 → high) | last-activity age in days | `risk:deals:opportunity:<id>:stalled-30d` |
| Stale pipeline | risk | open deal aged ≥ 60 days at probability < 40% | age days, probability | `risk:pipeline:opportunity:<id>:stale-60d` |
| Outlier deal | anomaly | amount > 3× the org's average open deal | amount vs org avg | `anomaly:deals:opportunity:<id>:outlier` |
| Unreasoned win | recommendation | stage = won and no `winReason` | missing winReason | `recommendation:deals:opportunity:<id>:win-reason` |
| Unreasoned loss | recommendation | stage = lost and no `lostReason` | missing lostReason | `recommendation:deals:opportunity:<id>:lost-reason` |
| At-risk account | risk | Phase 11 churn score ≥ 70 | every churn factor (label + detail) | `risk:churn:account:<id>:score-<crit\|high>` |
| Expansion opportunity | opportunity | every Phase 11 expansion-radar item | the radar reason + confidence | `opportunity:radar:account:<id>:<type>-<title>` |
| Expected close | opportunity | closeDate ≤ now+30d and probability ≥ 70% | close date, probability | `opportunity:pipeline:opportunity:<id>:close-30d` |
| Breached SLA | risk | open ticket with `breachedAt` set | breach date | `risk:service:ticket:<id>:breached` |

**Inputs** — the deal set (stage, amount, probability, close date, reasons,
competitors), the ticket set (reference, subject, breach flag), the account
set (Phase 11 churn factor lists), the expansion radar, and per-deal event
counts. All reads are live; nothing is cached.

## 3. What the Brain is NOT

- **Not generative** — no free-form model output; each insight is one of the
  rules above with its evidence attached.
- **Not autonomous** — the scan only *writes the ledger + emits events*; it
  never changes records, sends emails, or proposes actions. (Actions live in
  the Phase 9 agent platform under 🟢🟡🔴 governance.)
- **Not stale** — insights are re-derived every scan and pruned when their
  fingerprint stops matching reality.

## 4. Consuming the Brain

- **Ledger** — `GET /api/brain/insights` (optionally `?status=open`) and the
  per-insight status lifecycle
  (`open → acknowledged | actioned | dismissed`).
- **Overview** — `GET /api/brain/overview` rolls up total/open/severity and
  category counts plus the radar feed by kind.
- **Events** — new insights emit `insight.generated` (org × environment
  scoped), so workflows (Phase 3) and notifications can subscribe like any
  other domain event.

## 5. Validation

The scan's arithmetic is verified live by `verify-phase15.sh`: a forced scan
creates ≥ 1 new insight, the ledger grows, `insight.generated` persists, and
acknowledge/dismiss transitions work. The radar + churn rules share their
inputs with the Phase 11 engine, which is itself regression-verified
(`verify-phase11.sh`).
