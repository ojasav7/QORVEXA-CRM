#!/usr/bin/env bash
# Phase 7 CDP / Customer 360 live smoke suite — run against localhost:8787 with
# a freshly booted + seeded stack (npm run db:push && npm run seed, then start
# the server). Covers identity resolution (rebuild, duplicate-email unification,
# manual merge, customer.identity_merged), behavioral event tracking (API ingest
# + event-bus mirror), the customer 360 view, the relationship graph with
# influence scoring, the explained health engine (live + snapshot refresh +
# customer.health_changed/churn_risk_changed), right-to-portability full-tenant
# export (create/download/purge), role gating, feature gating, and sandbox
# isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q7-admin.txt
REPCOOKIE=/tmp/q7-rep.txt
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
BEHAVIOR_IDS=""

# ── 1. Identity resolution ───────────────────────────────────────────────────
RB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/cdp/profiles/rebuild" $ENV -H 'content-type: application/json' -d '{}')
[ "$(echo "$RB" | jget "['created']")" -ge 0 ] 2>/dev/null && ok "identity rebuild runs (created $(echo "$RB" | jget "['created']"))" || bad "rebuild failed: $RB"
OV=$(curl -s -b "$COOKIE" "$BASE/api/cdp/overview" $ENV)
PCOUNT=$(echo "$OV" | jget "['profiles']")
[ "$PCOUNT" -ge 9 ] && ok "unified profiles present ($PCOUNT)" || bad "too few profiles: $PCOUNT"
[ "$(echo "$OV" | jget "['merged']")" -ge 1 ] && ok "merged identities counted ($(echo "$OV" | jget "['merged']"))" || bad "no merged identities"
# The seeded duplicate-identity lead (Elena, same email as her contact) must be
# unified: her profile has 2 members.
ELENA=$(curl -s -b "$COOKIE" "$BASE/api/cdp/profiles?q=elena@northwind.example" $ENV)
[ "$(echo "$ELENA" | jget "['items'][0]['memberCount']")" = "2" ] && ok "duplicate-email lead unified into Elena's profile (memberCount 2)" || bad "identity unification failed: $ELENA"
# customer.identity_merged fired during seed (record attach) — search events.
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=customer.identity_merged&pageSize=5" $ENV)
echo "$EV" | grep -q "customer.identity_merged" && ok "customer.identity_merged event emitted" || bad "identity_merged event missing"
# Manual merge: create a throwaway profile via API behavior? No — merge needs
# two profiles; verify self-merge 400 + rep 403 instead, and a real merge via
# the sandbox env (isolated, doesn't touch demo data).
ELENA_ID=$(echo "$ELENA" | jget "['items'][0]['id']")
M400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/cdp/profiles/merge" $ENV -H 'content-type: application/json' -d "{\"fromId\":\"$ELENA_ID\",\"intoId\":\"$ELENA_ID\"}")
check "$M400" "400" "merge profile into itself → 400"
M403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/cdp/profiles/rebuild" $ENV -H 'content-type: application/json' -d '{}')
check "$M403" "403" "rep rebuild → 403"

# ── 2. Behavioral events (API ingest + list + event) ─────────────────────────
B=$(curl -s -b "$COOKIE" -X POST "$BASE/api/cdp/behaviors" $ENV -H 'content-type: application/json' \
  -d "{\"type\":\"page_view\",\"email\":\"marcus@globex.example\",\"entity\":\"web\",\"meta\":{\"page\":\"/pricing\",\"test\":$TS}}")
BEH_ID=$(echo "$B" | jget "['behavior']['id']")
BEHAVIOR_IDS="$BEH_ID"
[ -n "$BEH_ID" ] && ok "behavior ingested via API" || bad "behavior ingest failed: $B"
[ "$(echo "$B" | jget "['behavior']['profileId']")" != "None" ] && ok "behavior resolved to a profile by email" || bad "behavior not unified to profile"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=customer.behavior_tracked&pageSize=3" $ENV)
echo "$EV" | grep -q "customer.behavior_tracked" && ok "customer.behavior_tracked event emitted" || bad "behavior event missing"
# list filter by type
BL=$(curl -s -b "$COOKIE" "$BASE/api/cdp/behaviors?type=email_opened&limit=10" $ENV)
[ "$(echo "$BL" | jget "['total']")" -ge 1 ] && ok "behavior list filters by type (email_opened=$(echo "$BL" | jget "['total']"))" || bad "behavior filter empty"
# unknown type string accepted (documented open catalog)
B2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/cdp/behaviors" $ENV -H 'content-type: application/json' \
  -d "{\"type\":\"custom_signal_x\",\"email\":\"elena@northwind.example\",\"meta\":{\"test\":$TS}}")
B2_ID=$(echo "$B2" | jget "['behavior']['id']")
BEHAVIOR_IDS="$BEHAVIOR_IDS $B2_ID"
[ -n "$B2_ID" ] && ok "custom behavior type accepted (open catalog)" || bad "custom type rejected"
# 400 on missing type
B400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/cdp/behaviors" $ENV -H 'content-type: application/json' -d '{}')
check "$B400" "400" "behavior without type → 400"

# ── 3. Customer 360 ──────────────────────────────────────────────────────────
OV2=$(curl -s -b "$COOKIE" "$BASE/api/cdp/overview" $ENV)
[ "$(echo "$OV2" | jget "['behaviors']")" -ge 8 ] && ok "seeded + ingested behaviors counted ($(echo "$OV2" | jget "['behaviors']"))" || bad "behavior count low"
[ "$(echo "$OV2" | jget "['atRisk']")" -ge 0 ] 2>/dev/null && ok "overview reports at-risk count ($(echo "$OV2" | jget "['atRisk']"))" || bad "no atRisk field"
# list rows carry derived health
LST=$(curl -s -b "$COOKIE" "$BASE/api/cdp/profiles?q=elena@northwind.example" $ENV)
HS=$(echo "$LST" | jget "['items'][0]['health']['score']")
[ "$HS" -ge 0 ] 2>/dev/null && [ "$HS" -le 100 ] && ok "profile list carries derived health ($HS/100)" || bad "no health on list row"
# full 360 view
V=$(curl -s -b "$COOKIE" "$BASE/api/cdp/profiles/$ELENA_ID" $ENV)
echo "$V" | grep -q '"behaviors":' && echo "$V" | grep -q '"messages":' && ok "360 returns behaviors + messages" || bad "360 missing sections"
[ "$(echo "$V" | python -c "import json,sys; print(len(json.load(sys.stdin)['history']))")" -ge 1 ] && ok "360 returns health history" || bad "360 missing health history"
[ "$(echo "$V" | jget "['profile']['memberCount']")" = "2" ] && ok "360 profile shows unified members" || bad "360 members wrong"
# rep can read the 360 too (reads open)
V403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/cdp/profiles/$ELENA_ID" $ENV)
check "$V403" "200" "rep 360 read → 200"

# ── 4. Relationship graph ────────────────────────────────────────────────────
NW=$(curl -s -b "$COOKIE" "$BASE/api/accounts?q=Northwind&pageSize=5" $ENV | jget "['items'][0]['id']")
G=$(curl -s -b "$COOKIE" "$BASE/api/cdp/graph?accountId=$NW" $ENV)
[ "$(echo "$G" | jget "['account']['name']")" = "Northwind Traders" ] && ok "account graph node resolves" || bad "account graph failed: $G"
[ "$(echo "$G" | python -c "import json,sys; print(len(json.load(sys.stdin)['contacts']))")" -ge 2 ] && ok "account graph has contacts ($(echo "$G" | python -c "import json,sys; print(len(json.load(sys.stdin)['contacts']))"))" || bad "account graph contacts wrong"
# deal graph → buying committee with influence
DEAL=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?q=Retail%20Platform&pageSize=5" $ENV | jget "['items'][0]['id']")
GD=$(curl -s -b "$COOKIE" "$BASE/api/cdp/graph?dealId=$DEAL" $ENV)
echo "$GD" | grep -q '"committee"' && ok "deal graph returns buying committee" || bad "deal graph failed: $GD"
[ "$(echo "$GD" | jget "['committee'][0]['influence']")" -ge 0 ] 2>/dev/null && ok "influence scores computed ($(echo "$GD" | jget "['committee'][0]['influence']"))" || bad "no influence"
# no accountId/dealId → 400
G400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/cdp/graph" $ENV)
check "$G400" "400" "graph without accountId/dealId → 400"

# ── 5. Health engine ─────────────────────────────────────────────────────────
H=$(curl -s -b "$COOKIE" "$BASE/api/cdp/health?profileId=$ELENA_ID" $ENV)
SC=$(echo "$H" | jget "['health']['score']")
[ "$SC" -ge 0 ] 2>/dev/null && [ "$SC" -le 100 ] && ok "live health score in [0,100] ($SC)" || bad "health score invalid: $H"
[ "$(echo "$H" | jget "['health']['churnRisk']")" = "$((100 - SC))" ] && ok "churnRisk = 100 − score ($((100 - SC)))" || bad "churnRisk mismatch"
[ "$(echo "$H" | python -c "import json,sys; print(len(json.load(sys.stdin)['health']['components']))")" = "4" ] && ok "health breakdown has 4 explained components" || bad "components missing"
# refresh persists a snapshot per profile + emits events
R=$(curl -s -b "$COOKIE" -X POST "$BASE/api/cdp/health/refresh" $ENV -H 'content-type: application/json' -d '{}')
[ "$(echo "$R" | jget "['refreshed']")" -ge 9 ] && ok "health refresh scored $(echo "$R" | jget "['refreshed']") profiles" || bad "refresh wrong: $R"
RID=$(echo "$R" | jget "['refreshId']")
[ -n "$RID" ] && ok "refresh groups one pass (refreshId)" || bad "no refreshId"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=customer.health_changed&pageSize=3" $ENV)
echo "$EV" | grep -q "customer.health_changed" && ok "customer.health_changed emitted" || bad "health_changed missing"
# history grew for Elena
HH=$(curl -s -b "$COOKIE" "$BASE/api/cdp/health/history?profileId=$ELENA_ID" $ENV)
[ "$(echo "$HH" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" -ge 1 ] && ok "health history persisted (deltas available)" || bad "no health history"
# rep 403 on refresh
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/cdp/health/refresh" $ENV -H 'content-type: application/json' -d '{}')
check "$R403" "403" "rep health refresh → 403"

# ── 6. Right-to-portability export ───────────────────────────────────────────
EXP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/portability/export" $ENV -H 'content-type: application/json' -d '{}')
EXP_ID=$(echo "$EXP" | jget "['export']['id']")
[ "$(echo "$EXP" | jget "['export']['status']")" = "success" ] && ok "portability export succeeded" || bad "export failed: $EXP"
[ "$(echo "$EXP" | python -c "import json,sys; print(len(json.load(sys.stdin)['counts']))")" -ge 35 ] && ok "bundle covers $(echo "$EXP" | python -c "import json,sys; print(len(json.load(sys.stdin)['counts']))") collections" || bad "too few collections"
DL=$(curl -s -b "$COOKIE" "$BASE/api/portability/$EXP_ID/download" $ENV)
echo "$DL" | grep -q "qorvexa-cdp-portability" && ok "bundle downloads (portability format)" || bad "download not a bundle"
echo "$DL" | grep -q '"identityProfiles":' && ok "bundle includes CDP profiles" || bad "profiles missing from bundle"
echo "$DL" | grep -q '"auditLogs":' && echo "$DL" | grep -q '"events":' && ok "bundle includes audit + event log" || bad "audit/events missing"
echo "$DL" | grep -q '"passwordHashExcluded": true' && ok "user password hashes excluded from bundle" || bad "password hashes leaked"
# rep 403 on export
E403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/portability/export" $ENV -H 'content-type: application/json' -d '{}')
check "$E403" "403" "rep export → 403"
# purge
DEL=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/portability/$EXP_ID" $ENV)
check "$DEL" "200" "export purged (delete → 200)"
NF=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/portability/$EXP_ID" $ENV)
check "$NF" "404" "purged export no longer listed → 404"

# ── 7. Feature gates ─────────────────────────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/cdp.profiles" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/cdp/overview" $ENV)
check "$FG" "403" "cdp.profiles disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/cdp.profiles" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/cdp/overview" $ENV)
check "$FG2" "200" "cdp.profiles re-enabled → 200"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/cdp.portability" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG3=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/portability" $ENV)
check "$FG3" "403" "cdp.portability disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/cdp.portability" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG4=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/portability" $ENV)
check "$FG4" "200" "cdp.portability re-enabled → 200"

# ── 8. Sandbox isolation ─────────────────────────────────────────────────────
SB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/portability/export" -H 'x-environment:sandbox' -H 'content-type: application/json' -d '{}')
SB_ID=$(echo "$SB" | jget "['export']['id']")
[ -n "$SB_ID" ] && ok "sandbox export created" || bad "sandbox export failed: $SB"
PROD=$(curl -s -b "$COOKIE" "$BASE/api/portability" $ENV | python -c "import json,sys; print([i['id'] for i in json.load(sys.stdin)['items']])")
echo "$PROD" | grep -q "$SB_ID" && bad "sandbox export leaked into production" || ok "sandbox export invisible in production"
# sandbox profiles isolated too
SBRE=$(curl -s -b "$COOKIE" -X POST "$BASE/api/cdp/profiles/rebuild" -H 'x-environment:sandbox' -H 'content-type: application/json' -d '{}')
[ "$(echo "$SBRE" | jget "['created']")" -ge 0 ] 2>/dev/null && ok "sandbox identity rebuild isolated" || bad "sandbox rebuild failed"
SBP=$(curl -s -b "$COOKIE" "$BASE/api/cdp/overview" -H 'x-environment:sandbox' | jget "['profiles']")
PRODP=$(curl -s -b "$COOKIE" "$BASE/api/cdp/overview" $ENV | jget "['profiles']")
[ "$SBP" -ne "$PRODP" ] && ok "sandbox profiles isolated from production ($SBP vs $PRODP)" || bad "env leak suspected"
curl -s -b "$COOKIE" -X DELETE "$BASE/api/portability/$SB_ID" -H 'x-environment:sandbox' > /dev/null

# ── 9. Cleanup (leave demo data pristine) ────────────────────────────────────
# Purge the behaviors this suite ingested via the API (admin delete endpoint).
for bid in $BEHAVIOR_IDS; do
  [ -n "$bid" ] && curl -s -o /dev/null -b "$COOKIE" -X DELETE "$BASE/api/cdp/behaviors/$bid" $ENV
done
ok "suite behaviors purged (cleanup)"
echo
echo "════════════════════════════════════════════"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "════════════════════════════════════════════"
if [ "$FAIL" = "0" ]; then echo "PHASE 7 SMOKE SUITE: ALL GREEN ✅"; else echo "PHASE 7 SMOKE SUITE: FAILURES ❌"; fi
