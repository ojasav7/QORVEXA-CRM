#!/usr/bin/env bash
# Phase 6 Analytics, Forecasting & BI live smoke suite — run against
# localhost:8787 with a freshly seeded demo org (npm run seed). Covers the
# metrics library (every dashboard kind with data lineage), the live weighted
# forecast + snapshot refresh (forecast.updated) + history, predictive v1
# (conversion / churn / LTV), saved reports CRUD + live report data, threshold
# breaches (metric.threshold_breached + admin notification), role gating,
# feature gating, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q6-admin.txt
REPCOOKIE=/tmp/q6-rep.txt
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (expected '$2' got '$1')"; fi; }
jget() { python -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

rm -f "$COOKIE" "$REPCOOKIE"
curl -s -c "$COOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"admin@qorvexa.dev","password":"password123"}' > /dev/null
curl -s -c "$REPCOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"leo@qorvexa.dev","password":"password123"}' > /dev/null
curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)
ENV='-H x-environment:production'

# ── 1. Metrics library: every dashboard kind + data lineage ──────────────────
for KIND in sales marketing service revenue executive; do
  D=$(curl -s -b "$COOKIE" "$BASE/api/analytics/dashboard?kind=$KIND" $ENV)
  [ "$(echo "$D" | jget "['group']['kind']")" = "$KIND" ] && ok "$KIND dashboard renders" || bad "$KIND dashboard failed: $D"
  N=$(echo "$D" | python -c "import json,sys; print(len(json.load(sys.stdin)['group']['metrics']))")
  [ "$N" -ge 5 ] && ok "$KIND has $N metrics" || bad "$KIND only has $N metrics"
done
# lineage is a first-class output on every metric
D=$(curl -s -b "$COOKIE" "$BASE/api/analytics/dashboard?kind=sales" $ENV)
echo "$D" | grep -Fq '"sources":[{"entity":"Opportunity"' && ok "metrics carry data lineage (sources)" || bad "lineage missing"
# spot-check sales metric arithmetic against live data
WON=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?stage=won&pageSize=100" $ENV | python -c "import json,sys; print(json.load(sys.stdin)['total'])")
LOST=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?stage=lost&pageSize=100" $ENV | python -c "import json,sys; print(json.load(sys.stdin)['total'])")
WR=$(curl -s -b "$COOKIE" "$BASE/api/analytics/dashboard?kind=sales" $ENV | python -c "
import json,sys
m=[x for x in json.load(sys.stdin)['group']['metrics'] if x['key']=='winRate'][0]
print(m['value'])
")
EXPECT=$(python -c "print(round(($WON/($WON+$LOST))*1000)/10)")
MATCH=$(python -c "print(abs(float('$WR') - float('$EXPECT')) < 0.11)")
[ "$MATCH" = "True" ] && ok "winRate matches live data ($WON won / $LOST lost → $WR)" || bad "winRate mismatch (got $WR, expected $EXPECT)"
# all-kinds endpoint
G=$(curl -s -b "$COOKIE" "$BASE/api/analytics/metrics" $ENV)
[ "$(echo "$G" | python -c "import json,sys; print(len(json.load(sys.stdin)['groups']))")" = "4" ] && ok "metrics endpoint returns all 4 groups" || bad "metrics groups wrong"

# ── 2. Forecast: live buckets + snapshot refresh + history ───────────────────
F=$(curl -s -b "$COOKIE" "$BASE/api/analytics/forecast" $ENV)
PIPE=$(echo "$F" | jget "['live']['buckets']['pipeline']")
[ "$PIPE" -ge 0 ] 2>/dev/null && ok "live forecast pipeline bucket present ($PIPE)" || bad "no pipeline bucket"
WEIGHTED=$(echo "$F" | jget "['live']['buckets']['weighted']")
[ "$WEIGHTED" -le "$PIPE" ] && ok "weighted ($WEIGHTED) ≤ pipeline ($PIPE)" || bad "weighted exceeds pipeline"
BO=$(echo "$F" | python -c "import json,sys; print(len(json.load(sys.stdin)['live']['byOwner']))")
[ "$BO" -ge 1 ] && ok "per-owner forecast rows present ($BO)" || bad "no per-owner rows"
# snapshot history (seeded one + this run)
SNAP=$(echo "$F" | python -c "import json,sys; print(len(json.load(sys.stdin)['snapshots']))")
[ "$SNAP" -ge 1 ] && ok "forecast history has $SNAP snapshot(s)" || bad "no snapshots"
# refresh persists + emits forecast.updated
REFRESH=$(curl -s -b "$COOKIE" -X POST "$BASE/api/analytics/forecast/refresh" $ENV -H 'content-type: application/json' -d '{}')
SAVED_ID=$(echo "$REFRESH" | jget "['saved']['id']")
[ -n "$SAVED_ID" ] && ok "forecast refresh persisted a snapshot" || bad "refresh failed: $REFRESH"
# The freshly-saved snapshot must be the newest in history (id compare — robust
# to history already being at the 10-snapshot GET cap from repeated runs).
NEWEST=$(curl -s -b "$COOKIE" "$BASE/api/analytics/forecast" $ENV | jget "['snapshots'][0]['id']")
[ "$NEWEST" = "$SAVED_ID" ] && ok "snapshot history grew (newest = the fresh snapshot)" || bad "history did not grow (newest=$NEWEST saved=$SAVED_ID)"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=forecast.updated&pageSize=5" $ENV)
echo "$EV" | grep -q "forecast.updated" && ok "forecast.updated event emitted" || bad "forecast.updated missing"
# rep 403 on refresh
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/analytics/forecast/refresh" $ENV -H 'content-type: application/json' -d '{}')
check "$R403" "403" "rep forecast refresh → 403"

# ── 3. Predictive v1 ─────────────────────────────────────────────────────────
P=$(curl -s -b "$COOKIE" "$BASE/api/analytics/predictions?limit=5" $ENV)
CV=$(echo "$P" | python -c "
import json,sys
d=json.load(sys.stdin)['conversions']
print(len(d), '|', all(0<=c['score']<=100 for c in d), '|', all(c.get('inputs') for c in d))
")
echo "$CV" | grep -q "True" && ok "conversion likelihood scored 0–100 with inputs" || bad "conversions wrong: $CV"
CH=$(echo "$P" | python -c "
import json,sys
d=json.load(sys.stdin)['churn']
print(len(d), '|', all(0<=c['score']<=100 for c in d))
")
echo "$CH" | grep -q "True" && ok "churn risk scored 0–100" || bad "churn wrong: $CH"
LV=$(echo "$P" | python -c "import json,sys; print(len(json.load(sys.stdin)['ltvs']))")
[ "$LV" -ge 1 ] && ok "LTV estimates present ($LV)" || bad "no LTV estimates"

# ── 4. Reports CRUD + live data + gating ─────────────────────────────────────
RPT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/reports" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke report $TS\",\"kind\":\"sales\",\"keys\":[\"openDeals\",\"winRate\",\"weightedPipeline\"]}")
RPT_ID=$(echo "$RPT" | jget "['report']['id']")
[ -n "$RPT_ID" ] && ok "report created" || bad "report create failed: $RPT"
R200=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/reports" $ENV)
check "$R200" "200" "rep report read → 200"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/reports" $ENV -H 'content-type: application/json' -d '{"name":"nope"}')
check "$R403" "403" "rep report create → 403"
DATA=$(curl -s -b "$COOKIE" "$BASE/api/reports/$RPT_ID/data" $ENV)
[ "$(echo "$DATA" | python -c "import json,sys; print(len(json.load(sys.stdin)['metrics']))")" = "3" ] && ok "report data returns exactly its keys (3)" || bad "report data keys wrong: $DATA"
BAD400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/reports" $ENV -H 'content-type: application/json' -d '{"name":"","kind":"sales"}')
check "$BAD400" "400" "report without name → 400"
curl -s -b "$COOKIE" -X PATCH "$BASE/api/reports/$RPT_ID" $ENV -H 'content-type: application/json' -d '{"name":"Smoke report renamed"}' > /dev/null
RN=$(curl -s -b "$COOKIE" "$BASE/api/reports/$RPT_ID" $ENV | jget "['report']['name']")
check "$RN" "Smoke report renamed" "report PATCH works"
NF=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/reports/does-not-exist" $ENV)
check "$NF" "404" "unknown/malformed report id → 404"

# ── 5. Thresholds → metric.threshold_breached + admin notification ───────────
# Force a breach: set winRate threshold to a value above the current one via
# org settings, refresh, and expect a breach + notification + event.
WR2=$(curl -s -b "$COOKIE" "$BASE/api/analytics/dashboard?kind=sales" $ENV | python -c "
import json,sys
m=[x for x in json.load(sys.stdin)['group']['metrics'] if x['key']=='winRate'][0]
print(m['value'])
")
echo "  · current winRate=$WR2% — forcing threshold above it"
TH=$(python -c "print(min(99.9, $WR2 + 1))")
curl -s -b "$COOKIE" -X PATCH "$BASE/api/org" $ENV -H 'content-type: application/json' \
  -d "{\"settings\":{\"analytics\":{\"thresholds\":{\"winRate\":$TH,\"pipelineCoverage\":0,\"campaignsOpenRate\":0,\"slaHealth\":0}}}}" > /dev/null
REFRESH2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/analytics/forecast/refresh" $ENV -H 'content-type: application/json' -d '{}')
[ "$(echo "$REFRESH2" | python -c "import json,sys; print(len(json.load(sys.stdin)['breaches']))")" -ge 1 ] && ok "forced threshold tripped a breach" || bad "no breach on forced threshold"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=metric.threshold_breached&pageSize=5" $ENV)
echo "$EV" | grep -q '"key":"winRate"' && ok "metric.threshold_breached event emitted" || bad "threshold event missing"
NT=$(curl -s -b "$COOKIE" "$BASE/api/notifications" $ENV | python -c "import json,sys; print(len([n for n in json.load(sys.stdin)['items'] if n.get('kind')=='metric']))")
[ "$NT" -ge 1 ] && ok "admin notified of the breach (kind=metric)" || bad "no metric notification"
# restore thresholds
curl -s -b "$COOKIE" -X PATCH "$BASE/api/org" $ENV -H 'content-type: application/json' \
  -d '{"settings":{"analytics":{"thresholds":{"winRate":30,"pipelineCoverage":1,"campaignsOpenRate":20,"slaHealth":70}}}}' > /dev/null

# ── 6. Feature gates ──────────────────────────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/analytics.metrics" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/analytics/dashboard?kind=sales" $ENV)
check "$FG" "403" "analytics.metrics flag disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/analytics.metrics" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/analytics/dashboard?kind=sales" $ENV)
check "$FG2" "200" "analytics.metrics re-enabled → 200"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/analytics.reports" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG3=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/reports" $ENV)
check "$FG3" "403" "analytics.reports flag disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/analytics.reports" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG4=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/reports" $ENV)
check "$FG4" "200" "analytics.reports re-enabled → 200"

# ── 7. Sandbox isolation ─────────────────────────────────────────────────────
SB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/reports" -H 'x-environment:sandbox' -H 'content-type: application/json' \
  -d "{\"name\":\"Sandbox report $TS\",\"kind\":\"revenue\"}")
SB_ID=$(echo "$SB" | jget "['report']['id']")
[ -n "$SB_ID" ] && ok "report created in sandbox env" || bad "sandbox report failed: $SB"
PROD=$(curl -s -b "$COOKIE" "$BASE/api/reports?name=Sandbox" $ENV)
echo "$PROD" | grep -q "Sandbox report" && bad "sandbox report leaked into production" || ok "sandbox report invisible in production"
SBL=$(curl -s -b "$COOKIE" "$BASE/api/reports?name=Sandbox" -H 'x-environment:sandbox')
echo "$SBL" | grep -q "Sandbox report" && ok "sandbox report visible in sandbox" || bad "sandbox report missing"
# sandbox forecast isolation
FBS=$(curl -s -b "$COOKIE" -X POST "$BASE/api/analytics/forecast/refresh" -H 'x-environment:sandbox' -H 'content-type: application/json' -d '{}')
[ "$(echo "$FBS" | jget "['saved']['environment']")" = "sandbox" ] && ok "forecast snapshot sandbox-scoped" || bad "sandbox forecast wrong: $FBS"

# ── 8. Cleanup (leave demo data pristine) ────────────────────────────────────
curl -s -b "$COOKIE" -X DELETE "$BASE/api/reports/$RPT_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/reports/$SB_ID" -H 'x-environment:sandbox' > /dev/null
echo
echo "════════════════════════════════════════════"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "════════════════════════════════════════════"
if [ "$FAIL" = "0" ]; then echo "PHASE 6 SMOKE SUITE: ALL GREEN ✅"; else echo "PHASE 6 SMOKE SUITE: FAILURES ❌"; fi
