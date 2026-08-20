#!/usr/bin/env bash
# Phase 11 Customer Success live smoke suite — run against localhost:8787 with
# a freshly booted + seeded stack (npm run db:push && npm run seed, then start
# the server). Covers success plans (milestones + QBRs + health-to-playbook
# at-risk flagging), usage intelligence (ingest + overview + adoption-drop
# detection + event-bus mirror), churn prediction v2 (explained refresh +
# escalation → churn.risk_scored) + the expansion radar
# (expansion.opportunity_detected), surveys (NPS/CSAT/CES results + negative
# feedback → roadmap pipeline + votes), loyalty (programs, members, points,
# tiers, referral lifecycle → points award), the engine tick, RBAC, feature
# gating, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q11-admin.txt
REPCOOKIE=/tmp/q11-rep.txt
source "$(dirname "$0")/lib/test-helpers.sh"
login "/tmp/q11-admin.txt"
login_rep "/tmp/q11-rep.txt"

curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)
ENV='-H x-environment:production'

# ── 1. Seeds ────────────────────────────────────────────────────────────────
PLANS=$(curl -s -b "$COOKIE" "$BASE/api/success/plans" $ENV)
[ "$(echo "$PLANS" | jget "['items'].__len__()")" -ge 2 ] && ok "success plans seeded (Northwind + Globex)" || bad "plans missing: $PLANS"
echo "$PLANS" | grep -q '"kind":"onboarding"' && echo "$PLANS" | grep -q '"kind":"success"' && ok "plan kinds seeded" || bad "plan kinds missing"
echo "$PLANS" | grep -q '"milestones"' && echo "$PLANS" | grep -q '"qbrs"' && ok "milestones + qbrs arrays present" || bad "plan structure wrong"
USAGE=$(curl -s -b "$COOKIE" "$BASE/api/success/usage" $ENV)
[ "$(echo "$USAGE" | jget "['totals']['accountsTracked']")" -ge 4 ] && ok "usage telemetry seeded (4 accounts tracked)" || bad "usage missing: $USAGE"
[ "$(echo "$USAGE" | jget "['totals']['inactiveAccounts']")" -ge 1 ] && ok "inactive account detected (Umbrella)" || bad "inactive not flagged"
echo "$USAGE" | grep -q '"adoptionPct":' && ok "adoption % computed" || bad "adoption missing"
SURVEYS=$(curl -s -b "$COOKIE" "$BASE/api/success/surveys" $ENV)
echo "$SURVEYS" | grep -q '"kind":"nps"' && echo "$SURVEYS" | grep -q '"kind":"csat"' && ok "NPS + CSAT surveys seeded" || bad "surveys missing: $SURVEYS"
LOY=$(curl -s -b "$COOKIE" "$BASE/api/success/loyalty" $ENV)
echo "$LOY" | grep -q '"name":"Qorvexa Advocates"' && ok "loyalty program seeded" || bad "program missing"
[ "$(echo "$LOY" | jget "['members'].__len__()")" -ge 1 ] && ok "loyalty member seeded with points" || bad "members missing"
[ "$(echo "$LOY" | python -c "import json,sys; d=json.load(sys.stdin); print([m['tier']['name'] for m in d['members'] if m['points']>=1500][0])")" = "Gold" ] && ok "member tier derived at read (Gold ≥ 1500)" || bad "tier derivation wrong"

# ── 2. RBAC ──────────────────────────────────────────────────────────────────
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/success/plans" $ENV)
check "$RGET" "200" "rep can read plans (reads open)"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/success/plans" $ENV -H 'content-type: application/json' -d "{\"name\":\"No\",\"accountId\":null}")
check "$R403" "403" "rep plan create → 403 (admin/manager only)"
RROAD=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/success/roadmap" $ENV -H 'content-type: application/json' -d '{"title":"No"}')
check "$RROAD" "403" "rep roadmap create → 403"
RPROG=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/success/loyalty/programs" $ENV -H 'content-type: application/json' -d '{"name":"No"}')
check "$RPROG" "403" "rep program create → 403 (admin only)"
RTICK=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/success/tick" $ENV)
check "$RTICK" "403" "rep engine tick → 403 (admin only)"

# ── 3. Success plans lifecycle (milestones + QBRs + at-risk flag) ───────────
NPC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/plans" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify Plan $TS\",\"kind\":\"custom\"}")
NPID=$(echo "$NPC" | jget "['plan']['id']")
[ -n "$NPID" ] && ok "admin/manager creates a plan" || bad "plan create failed: $NPC"
[ "$(echo "$NPC" | jget "['plan']['status']")" = "draft" ] && ok "plan starts draft" || bad "status wrong"
MC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/plans/$NPID/milestones" $ENV -H 'content-type: application/json' -d '{"title":"Verify milestone"}')
[ "$(echo "$MC" | jget "['plan']['milestones'].__len__()")" = "1" ] && ok "milestone added" || bad "milestone add failed"
MID=$(echo "$MC" | jget "['plan']['milestones'][0]['id']")
DONE=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/plans/$NPID/milestones/$MID" $ENV -H 'content-type: application/json' -d '{"done":true}')
[ "$(echo "$DONE" | jget "['plan']['milestones'][0]['status']")" = "done" ] && ok "milestone completed" || bad "milestone complete failed"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=milestone.completed&pageSize=5" $ENV | grep -c "Verify milestone")" -ge 1 ] && ok "milestone.completed event emitted" || bad "milestone event missing"
QB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/plans/$NPID/qbrs" $ENV -H 'content-type: application/json' -d '{"title":"Verify QBR","notes":"on track"}')
[ "$(echo "$QB" | jget "['plan']['qbrs'].__len__()")" = "1" ] && ok "QBR logged" || bad "QBR failed"
STATUS=$(curl -s -b "$COOKIE" -X PUT "$BASE/api/success/plans/$NPID" $ENV -H 'content-type: application/json' -d '{"status":"active"}')
[ "$(echo "$STATUS" | jget "['plan']['status']")" = "active" ] && ok "plan activated" || bad "status update failed"
# Health-score-to-playbook: the seeded Globex plan (health < 55) must be at_risk.
echo "$PLANS" | python -c "import json,sys; d=json.load(sys.stdin); g=[p for p in d['items'] if 'Globex' in p['name']][0]; print('atRisk' if g['atRisk'] and g['healthScore'] is not None and g['healthScore']<55 else 'notAtRisk')" | grep -q atRisk && ok "health-score-to-playbook at-risk flag on low-health account" || bad "at-risk mapping wrong"
DELP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/success/plans/$NPID" $ENV)
check "$DELP" "200" "plan deleted"

# ── 4. Usage: ingest + overview + adoption-drop detection ───────────────────
ING=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/usage" $ENV -H 'content-type: application/json' \
  -d "{\"feature\":\"workflows\",\"value\":5,\"meta\":{\"test\":$TS}}")
[ "$(echo "$ING" | jget "['event']['feature']")" = "workflows" ] && ok "usage event ingested via API" || bad "ingest failed: $ING"
BADEV=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/success/usage" $ENV -H 'content-type: application/json' -d '{"feature":""}')
check "$BADEV" "400" "empty feature → 400"
# Adoption drop: an account with 3 features in the prior window and 1 now.
DROPACCT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/accounts" $ENV -H 'content-type: application/json' -d "{\"name\":\"DropCo $TS\"}" | jget "['id']")
PAST=$(date -d '45 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v-45d +%Y-%m-%dT%H:%M:%SZ)
RECENT=$(date -d '2 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v-2d +%Y-%m-%dT%H:%M:%SZ)
for f in pipelines email workflows; do
  curl -s -b "$COOKIE" -X POST "$BASE/api/success/usage" $ENV -H 'content-type: application/json' \
    -d "{\"feature\":\"$f\",\"accountId\":\"$DROPACCT\",\"occurredAt\":\"$PAST\"}" > /dev/null
done
curl -s -b "$COOKIE" -X POST "$BASE/api/success/usage" $ENV -H 'content-type: application/json' \
  -d "{\"feature\":\"email\",\"accountId\":\"$DROPACCT\",\"occurredAt\":\"$RECENT\"}" > /dev/null
TICK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/tick" $ENV)
[ "$(echo "$TICK" | jget "['tick']['adoption']['dropped']")" -ge 1 ] && ok "adoption drop detected by the engine tick" || bad "adoption drop not detected: $TICK"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=usage.adoption_dropped&pageSize=10" $ENV | grep -c "DropCo")" -ge 1 ] && ok "usage.adoption_dropped event emitted" || bad "adoption_dropped event missing"
# Idempotent: the same tick does NOT re-announce a still-flagged drop.
TICK2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/tick" $ENV)
[ "$(echo "$TICK2" | jget "['tick']['adoption']['dropped']")" = "0" ] && ok "adoption drop announced once (flag until recovery)" || bad "re-emission: $TICK2"

# ── 5. Churn prediction v2 (explained) + escalation → churn.risk_scored ─────
CHURN=$(curl -s -b "$COOKIE" "$BASE/api/success/churn" $ENV)
echo "$CHURN" | grep -q '"factors"' && ok "churn predictions carry explained factors" || bad "factors missing"
[ "$(echo "$CHURN" | jget "['overview']['items'][0]['score']")" -ge 0 ] && ok "churn score 0-100 computed" || bad "score missing"
[ "$(echo "$CHURN" | jget "['overview']['counts']['critical']")" -ge 1 ] && ok "critical-risk accounts present (Umbrella inactive)" || bad "critical missing"
echo "$CHURN" | grep -q '"recommendation"' && ok "playbook recommendation attached" || bad "recommendation missing"
[ "$(echo "$CHURN" | jget "['history'].__len__()")" -ge 1 ] && ok "churn snapshot history persisted (seed refresh)" || bad "history missing"
# Escalation: refresh a healthy account (medium), then drive it past-due via
# the Phase 10 revenue flow (past_due sub = +12 in the model) → high → event.
ESCID=$(curl -s -b "$COOKIE" -X POST "$BASE/api/accounts" $ENV -H 'content-type: application/json' -d "{\"name\":\"EscCo $TS\"}" | jget "['id']")
curl -s -b "$COOKIE" -X POST "$BASE/api/success/usage" $ENV -H 'content-type: application/json' -d "{\"feature\":\"pipelines\",\"accountId\":\"$ESCID\",\"occurredAt\":\"$RECENT\"}" > /dev/null
R1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/churn/refresh" $ENV)
[ "$(echo "$R1" | jget "['refresh']['refreshed']")" -ge 1 ] && ok "churn refresh persists snapshots" || bad "refresh failed"
TIER1=$(curl -s -b "$COOKIE" "$BASE/api/success/churn" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print([i['riskTier'] for i in d['overview']['items'] if i['accountId']=='$ESCID'][0])")
# Break it: past-due subscription (Phase 10 revenue flow) + an open high ticket.
SUPPORT=$(curl -s -b "$COOKIE" "$BASE/api/products" $ENV | python -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['sku']=='QX-SUPPORT'][0])")
SUBD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"EscCo sub $TS\",\"productId\":\"$SUPPORT\",\"billingPeriod\":\"monthly\",\"unitPrice\":1200,\"accountId\":\"$ESCID\"}")
SUBDID=$(echo "$SUBD" | jget "['subscription']['id']")
REND=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions/$SUBDID/renew" $ENV)
INVDID=$(echo "$REND" | jget "['invoice']['id']")
curl -s -b "$COOKIE" -X POST "$BASE/api/invoices/$INVDID/pay" $ENV -H 'content-type: application/json' -d '{"amount":1296,"fail":true,"failureReason":"Card declined (verify)"}' > /dev/null
TKT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets" $ENV -H 'content-type: application/json' -d "{\"subject\":\"Escalation test $TS\",\"priority\":\"high\",\"accountId\":\"$ESCID\"}")
[ -n "$(echo "$TKT" | jget "['id']")" ] && ok "open high ticket created on the account" || bad "ticket create failed"
R2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/churn/refresh" $ENV)
[ "$(echo "$R2" | jget "['refresh']['escalated'].__len__()")" -ge 1 ] && ok "risk escalation detected (tier rose)" || bad "no escalation: $R2"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=churn.risk_scored&pageSize=10" $ENV | grep -c "EscCo")" -ge 1 ] && ok "churn.risk_scored event emitted on escalation" || bad "churn.risk_scored missing"
[ "$(curl -s -b "$COOKIE" "$BASE/api/notifications?pageSize=10" $ENV | grep -c "Churn risk escalated")" -ge 1 ] && ok "admin notified on escalation (kind cs)" || bad "notification missing"

# ── 6. Expansion radar ───────────────────────────────────────────────────────
RAD=$(curl -s -b "$COOKIE" "$BASE/api/success/churn/expansion" $ENV)
[ "$(echo "$RAD" | jget "['items'].__len__()")" -ge 1 ] && ok "expansion radar returns opportunities" || bad "radar empty: $RAD"
echo "$RAD" | grep -q '"type":"upsell"' && ok "seat-utilization upsell detected (Northwind 100% of 1 seat)" || bad "upsell missing"
echo "$RAD" | grep -q '"type":"cross_sell"' && ok "cross-sell detected from unadopted catalog features" || bad "cross_sell missing"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=expansion.opportunity_detected&pageSize=10" $ENV | grep -c "opportunity")" -ge 1 ] && ok "expansion.opportunity_detected events emitted" || bad "expansion events missing"

# ── 7. Surveys: results + feedback → roadmap + votes ────────────────────────
NPS=$(curl -s -b "$COOKIE" "$BASE/api/success/surveys" $ENV | python -c "import json,sys; print([s['id'] for s in json.load(sys.stdin)['items'] if s['kind']=='nps'][0])")
NPSR=$(curl -s -b "$COOKIE" "$BASE/api/success/surveys/$NPS/results" $ENV)
[ "$(echo "$NPSR" | jget "['total']")" -ge 3 ] && ok "NPS survey has responses" || bad "no responses: $NPSR"
echo "$NPSR" | grep -q '"score":' && ok "NPS score computed" || bad "NPS score missing"
echo "$NPSR" | grep -q '"formula"' && ok "NPS formula lineage attached" || bad "formula missing"
BADRESP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/success/surveys/$NPS/responses" $ENV -H 'content-type: application/json' -d '{"score":42}')
check "$BADRESP" "400" "out-of-range NPS score → 400 (validated 0-10)"
RESP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/surveys/$NPS/responses" $ENV -H 'content-type: application/json' -d '{"score":2,"comment":"this is a terrible unusable bug"}')
[ "$(echo "$RESP" | jget "['response']['sentiment']")" = "negative" ] && ok "negative sentiment derived from comment" || bad "sentiment wrong: $RESP"
[ "$(echo "$RESP" | jget "['roadmapItem']['id']")" != "null" ] && ok "negative feedback auto-promoted to the roadmap" || bad "roadmap promotion missing"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=survey.response_submitted&pageSize=5" $ENV | grep -c "response")" -ge 1 ] && ok "survey.response_submitted event emitted" || bad "response event missing"
ROAD=$(curl -s -b "$COOKIE" "$BASE/api/success/roadmap" $ENV)
echo "$ROAD" | grep -q '"source":"survey"' && ok "roadmap item sourced from survey feedback" || bad "roadmap source wrong"
RID=$(echo "$ROAD" | jget "['items'][0]['id']")
VOTED=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/roadmap/$RID/vote" $ENV)
[ "$(echo "$VOTED" | jget "['item']['votes']")" -ge 1 ] && ok "roadmap item voted" || bad "vote failed"
RTRI=$(curl -s -b "$COOKIE" -X PUT "$BASE/api/success/roadmap/$RID" $ENV -H 'content-type: application/json' -d '{"status":"planned"}')
[ "$(echo "$RTRI" | jget "['item']['status']")" = "planned" ] && ok "roadmap item triaged → planned" || bad "roadmap update failed"
REP_RESP=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/success/surveys/$NPS/responses" $ENV -H 'content-type: application/json' -d '{"score":8}')
check "$REP_RESP" "201" "rep can submit a survey response (any auth)"

# ── 8. Loyalty: referrals → points, tiers, rewards config ───────────────────
PROG=$(echo "$LOY" | jget "['programs'][0]['id']")
REF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/loyalty/referrals" $ENV -H 'content-type: application/json' \
  -d "{\"programId\":\"$PROG\",\"referredEmail\":\"ref-$TS@example.dev\",\"referredName\":\"Ref Person\",\"referrerContactId\":null}")
REFID=$(echo "$REF" | jget "['referral']['id']")
[ "$(echo "$REF" | jget "['referral']['status']")" = "pending" ] && ok "referral created (pending)" || bad "referral create failed"
CONT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/loyalty/referrals/$REFID/status" $ENV -H 'content-type: application/json' -d '{"status":"contacted"}')
[ "$(echo "$CONT" | jget "['referral']['status']")" = "contacted" ] && ok "referral → contacted" || bad "contacted failed"
CONV=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/loyalty/referrals/$REFID/status" $ENV -H 'content-type: application/json' -d '{"status":"converted"}')
[ "$(echo "$CONV" | jget "['referral']['status']")" = "converted" ] && ok "referral → converted" || bad "converted failed"
BADFLOW=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/success/loyalty/referrals/$REFID/status" $ENV -H 'content-type: application/json' -d '{"status":"expired"}')
check "$BADFLOW" "400" "converted → expired invalid transition (400)"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=referral.converted&pageSize=5" $ENV | grep -c "ref-$TS")" -ge 1 ] && ok "referral.converted event emitted" || bad "referral.converted missing"
# Points award (manual) + tier bump.
MEMBER=$(echo "$LOY" | jget "['members'][0]['id']")
AW=$(curl -s -b "$COOKIE" -X POST "$BASE/api/success/loyalty/members/$MEMBER/award" $ENV -H 'content-type: application/json' -d '{"points":300,"reason":"verify"}')
[ "$(echo "$AW" | jget "['member']['points']")" -ge 1900 ] && ok "points awarded (1600 + 300)" || bad "award failed: $AW"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=loyalty.points_awarded&pageSize=5" $ENV | grep -c "verify")" -ge 1 ] && ok "loyalty.points_awarded event emitted" || bad "points event missing"
BADAW=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/success/loyalty/members/$MEMBER/award" $ENV -H 'content-type: application/json' -d '{"points":-5,"reason":"x"}')
check "$BADAW" "400" "non-positive points award → 400"

# ── 9. Event-bus usage mirror ────────────────────────────────────────────────
# Completing a meeting (meeting.completed) mirrors a "meetings" usage event
# with source "event-bus" — the overview's mirroredEvents count must grow.
BEFORE=$(curl -s -b "$COOKIE" "$BASE/api/success/usage" $ENV | jget "['totals']['mirroredEvents']")
MEET=$(curl -s -b "$COOKIE" -X POST "$BASE/api/meetings" $ENV -H 'content-type: application/json' \
  -d "{\"title\":\"Mirror test $TS\",\"startsAt\":\"$(date -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v-1H +%Y-%m-%dT%H:%M:%SZ)\",\"endsAt\":\"$(date -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v-30M +%Y-%m-%dT%H:%M:%SZ)\"}")
MEETID=$(echo "$MEET" | jget "['meeting']['id']")
curl -s -b "$COOKIE" -X PATCH "$BASE/api/meetings/$MEETID" $ENV -H 'content-type: application/json' -d '{"status":"completed"}' > /dev/null
sleep 1
AFTER=$(curl -s -b "$COOKIE" "$BASE/api/success/usage" $ENV | jget "['totals']['mirroredEvents']")
[ "$AFTER" -gt "$BEFORE" ] && ok "meeting.completed mirrored into usage (event-bus mirror)" || bad "mirror did not fire (before=$BEFORE after=$AFTER)"

# ── 10. Feature gates + sandbox isolation ───────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/cs.surveys" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/success/surveys" $ENV)
check "$FG" "403" "cs.surveys disabled → surveys 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/cs.surveys" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/success/surveys" $ENV)
check "$FG2" "200" "flag re-enabled → 200"
# Idempotent across runs: clear any sandbox plans left by a previous run
SB=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/success/plans")
for SBID_OLD in $(echo "$SB" | jget "['items'].__len__()" > /dev/null; echo "$SB" | grep -o '"id":"[a-f0-9]*"' | head -50 | cut -d'"' -f4); do
  curl -s -b "$COOKIE" -X DELETE "$BASE/api/success/plans/$SBID_OLD" -H 'x-environment:sandbox' > /dev/null
done
SB=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/success/plans")
[ "$(echo "$SB" | jget "['items'].__len__()")" = "0" ] && ok "sandbox starts with no plans (fresh env)" || bad "sandbox not clean"
SBP=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' -X POST "$BASE/api/success/plans" -H 'content-type: application/json' -d "{\"name\":\"Sandbox Plan\"}")
SBID=$(echo "$SBP" | jget "['plan']['id']")
[ -n "$SBID" ] && ok "plan created in sandbox env" || bad "sandbox plan create failed"
PLANS2=$(curl -s -b "$COOKIE" "$BASE/api/success/plans" $ENV)
echo "$PLANS2" | grep -q "Sandbox Plan" && bad "sandbox plan leaked into production" || ok "sandbox plan invisible in production"
SBU=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' -X POST "$BASE/api/success/usage" -H 'content-type: application/json' -d '{"feature":"pipelines"}')
[ "$(echo "$SBU" | jget "['event']['environment']")" = "sandbox" ] && ok "sandbox usage event scoped" || bad "sandbox usage wrong"

echo
echo "──────────────────────────────────────────────"
echo "Phase 11 · Customer Success: $PASS passed, $FAIL failed"

summary "PHASE 11"
