#!/usr/bin/env bash
# Phase 1 live smoke suite — run against localhost:8787 with seeded demo data.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/qorvexa-cookie.txt
PASS=0; FAIL=0
say() { printf '%-70s' "$1"; }
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (expected '$2' got '$1')"; fi; }

# ── auth ──────────────────────────────────────────────────────────────
rm -f "$COOKIE"
curl -s -c "$COOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"admin@qorvexa.dev","password":"password123"}' > /dev/null
ME=$(curl -s -b "$COOKIE" "$BASE/api/auth/me")
echo "$ME" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"

# rep login for 403 checks (Leo is the seeded rep)
REPCOOKIE=/tmp/qorvexa-rep-cookie.txt
rm -f "$REPCOOKIE"
curl -s -c "$REPCOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"leo@qorvexa.dev","password":"password123"}' > /dev/null
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login"

# ── 1. Lead routing (round-robin) ─────────────────────────────────────
# fetch org user ids for the routing pool (admin sees /api/users)
USER_IDS=$(curl -s -b "$COOKIE" "$BASE/api/users" | python -c "
import json,sys
d=json.load(sys.stdin)
ids=[i['id'] for i in d.get('items',[]) if i.get('active')]
print(' '.join(ids))
")
POOL=$(echo "$USER_IDS" | tr ' ' ',')
echo "  (pool user ids: $POOL)"

# configure round-robin via org settings
curl -s -b "$COOKIE" -X PATCH "$BASE/api/org" -H 'content-type: application/json' \
  -d "{\"settings\":{\"leadRouting\":{\"mode\":\"round-robin\",\"pool\":[\"$(echo $POOL | sed 's/,/","/g')\"],\"cursor\":0}}}" > /dev/null

TS=$(date +%s)
L1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" -H 'content-type: application/json' \
  -d "{\"firstName\":\"SmokeA\",\"lastName\":\"Lead$TS\",\"email\":\"smokea$TS@example.com\",\"company\":\"TestCo\"}")
L1ID=$(echo "$L1" | python -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
L1OWNER=$(echo "$L1" | python -c "import json,sys; print(json.load(sys.stdin).get('ownerId',''))")
echo "  lead1 owner: $L1OWNER"
[ -n "$L1OWNER" ] && [ "$L1OWNER" != "null" ] && ok "round-robin assigned owner to lead 1" || bad "no owner routed"

L2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" -H 'content-type: application/json' \
  -d "{\"firstName\":\"SmokeB\",\"lastName\":\"Lead$TS\",\"email\":\"smokeb$TS@example.com\",\"company\":\"TestCo\"}")
L2OWNER=$(echo "$L2" | python -c "import json,sys; print(json.load(sys.stdin).get('ownerId',''))")
echo "  lead2 owner: $L2OWNER"
[ -n "$L2OWNER" ] && [ "$L1OWNER" != "$L2OWNER" ] && ok "round-robin rotated to a different owner" || bad "rotation not observed"

# explicit owner wins (use pool[0])
FIRST_POOL=$(echo "$POOL" | cut -d, -f1)
L3=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" -H 'content-type: application/json' \
  -d "{\"firstName\":\"SmokeC\",\"lastName\":\"Lead$TS\",\"email\":\"smokec$TS@example.com\",\"company\":\"TestCo\",\"ownerId\":\"$FIRST_POOL\"}")
L3OWNER=$(echo "$L3" | python -c "import json,sys; print(json.load(sys.stdin).get('ownerId',''))")
check "$L3OWNER" "$FIRST_POOL" "explicit ownerId wins on create"

# rep 403 on owner write
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/leads" -H 'content-type: application/json' \
  -d "{\"firstName\":\"SmokeD\",\"lastName\":\"Lead$TS\",\"email\":\"smoked$TS@example.com\",\"ownerId\":\"$FIRST_POOL\"}")
check "$R403" "403" "rep gets 403 on explicit ownerId"

# PATCH reassign emits lead.routed
PATCHR=$(curl -s -b "$COOKIE" -X PATCH "$BASE/api/leads/$L1ID" -H 'content-type: application/json' -d "{\"ownerId\":\"$FIRST_POOL\"}")
PATCHOWNER=$(echo "$PATCHR" | python -c "import json,sys; print(json.load(sys.stdin).get('ownerId',''))")
check "$PATCHOWNER" "$FIRST_POOL" "PATCH reassign works (admin)"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=50" | grep -q '"lead.routed"' && ok "lead.routed event emitted" || bad "no lead.routed event"

# ── 2. Public lead-capture form ───────────────────────────────────────
FORM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/lead-forms" -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke Form $TS\",\"slug\":\"smokeform$TS\",\"fields\":[{\"key\":\"firstName\",\"label\":\"First name\",\"required\":true,\"type\":\"text\"},{\"key\":\"email\",\"label\":\"Email\",\"required\":true,\"type\":\"email\"}]}")
FID=$(echo "$FORM" | python -c "import json,sys; print(json.load(sys.stdin).get('form',{}).get('id',''))")
[ -n "$FID" ] && ok "lead form created" || bad "form create failed: $FORM"

# public config — no auth
PCFG=$(curl -s -m 5 "$BASE/api/public/forms/smokeform$TS")
echo "$PCFG" | grep -q '"name"' && ok "public form config served without auth" || bad "public config failed: $PCFG"

# submit → lead created, source Website, routed owner (not form id)
SUB=$(curl -s -m 5 -X POST "$BASE/api/public/forms/smokeform$TS/submit" -H 'content-type: application/json' \
  -d "{\"firstName\":\"Pub\",\"lastName\":\"Lead$TS\",\"email\":\"pub$TS@example.com\"}")
echo "$SUB" | grep -q '"ok":true' && ok "public submit ok" || bad "submit failed: $SUB"
PUB_LEAD_ID=$(echo "$SUB" | python -c "import json,sys; print(json.load(sys.stdin).get('leadId',''))")
PL=$(curl -s -b "$COOKIE" "$BASE/api/leads/$PUB_LEAD_ID")
echo "$PL" | grep -q '"Website"' && ok "lead source=Website" || bad "source not Website"
PLOWNER=$(echo "$PL" | python -c "import json,sys; print(json.load(sys.stdin).get('ownerId',''))")
[ -n "$PLOWNER" ] && [ "$PLOWNER" != "$FID" ] && ok "routed owner != form id" || bad "owner is form id (routing missed): $PLOWNER"

# duplicate email → { ok:true, duplicate:true } and only one lead
SUB2=$(curl -s -m 5 -X POST "$BASE/api/public/forms/smokeform$TS/submit" -H 'content-type: application/json' \
  -d "{\"firstName\":\"Pub\",\"lastName\":\"Again$TS\",\"email\":\"pub$TS@example.com\"}")
echo "$SUB2" | grep -q '"duplicate":true' && ok "duplicate email → duplicate:true (no leak)" || bad "dup not flagged: $SUB2"
COUNT=$(curl -s -b "$COOKIE" "$BASE/api/leads?q=pub$TS@example.com" | python -c "import json,sys; print(json.load(sys.stdin).get('total',-1))")
check "$COUNT" "1" "only one lead row for duplicate email"

# honeypot swallowed
SUB3=$(curl -s -m 5 -X POST "$BASE/api/public/forms/smokeform$TS/submit" -H 'content-type: application/json' \
  -d "{\"firstName\":\"Bot\",\"lastName\":\"Bot$TS\",\"email\":\"bot$TS@example.com\",\"company_website\":\"http://spam.example\"}")
echo "$SUB3" | grep -q '"ok":true' && ok "honeypot filled → still ok (swallowed)" || bad "honeypot behavior wrong: $SUB3"
BOTCOUNT=$(curl -s -b "$COOKIE" "$BASE/api/leads?q=bot$TS@example.com" | python -c "import json,sys; print(json.load(sys.stdin).get('total',-1))")
check "$BOTCOUNT" "0" "honeypot lead not created"

# inactive form → 400
curl -s -b "$COOKIE" -X PATCH "$BASE/api/lead-forms/$FID" -H 'content-type: application/json' -d '{"active":false}' > /dev/null
I400=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$BASE/api/public/forms/smokeform$TS")
check "$I400" "400" "inactive form → 400"
curl -s -b "$COOKIE" -X PATCH "$BASE/api/lead-forms/$FID" -H 'content-type: application/json' -d '{"active":true}' > /dev/null

# ── 3. Segments ───────────────────────────────────────────────────────
SEG=$(curl -s -b "$COOKIE" -X POST "$BASE/api/segments" -H 'content-type: application/json' \
  -d "{\"name\":\"Hot leads $TS\",\"objectType\":\"lead\",\"criteria\":{\"filters\":[{\"field\":\"score\",\"op\":\"gte\",\"value\":50}]}}")
SID=$(echo "$SEG" | python -c "import json,sys; print(json.load(sys.stdin).get('segment',{}).get('id',''))")
[ -n "$SID" ] && ok "segment created" || bad "segment create failed: $SEG"
SEGLIST=$(curl -s -b "$COOKIE" "$BASE/api/segments")
SEGCOUNT=$(echo "$SEGLIST" | python -c "
import json,sys
d=json.load(sys.stdin)
s=[i for i in d.get('items',[]) if i.get('id')=='$SID']
print(s[0]['memberCount'] if s else -1)
")
[ "$SEGCOUNT" -ge 0 ] 2>/dev/null && ok "live memberCount computed ($SEGCOUNT)" || bad "no memberCount: $SEGLIST"
MEMBERS=$(curl -s -b "$COOKIE" "$BASE/api/segments/$SID/members")
echo "$MEMBERS" | grep -q '"ownerName"' && ok "members endpoint with ownerName" || bad "members missing ownerName: $MEMBERS"
BAD400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/segments" -H 'content-type: application/json' \
  -d "{\"name\":\"Bad\",\"objectType\":\"lead\",\"criteria\":{\"filters\":[{\"field\":\"nope_unknown\",\"op\":\"eq\",\"value\":1}]}}")
check "$BAD400" "400" "unknown segment field → 400"

# ── 4. Account hierarchy ──────────────────────────────────────────────
A1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/accounts" -H 'content-type: application/json' -d "{\"name\":\"RootCo $TS\"}")
A1ID=$(echo "$A1" | python -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
A2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/accounts" -H 'content-type: application/json' -d "{\"name\":\"ChildCo $TS\",\"parentId\":\"$A1ID\"}")
A2ID=$(echo "$A2" | python -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
A2P=$(echo "$A2" | python -c "import json,sys; print(json.load(sys.stdin).get('parentId',''))")
check "$A2P" "$A1ID" "child parentId set"
A2LABEL=$(echo "$A2" | python -c "import json,sys; print(json.load(sys.stdin).get('parentId_label',''))")
echo "$A2LABEL" | grep -q "RootCo" && ok "parentId_label hydrated" || bad "no parentId_label"
CY400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PATCH "$BASE/api/accounts/$A1ID" -H 'content-type: application/json' -d "{\"parentId\":\"$A2ID\"}")
check "$CY400" "400" "cycle → 400"
SELF400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PATCH "$BASE/api/accounts/$A1ID" -H 'content-type: application/json' -d "{\"parentId\":\"$A1ID\"}")
check "$SELF400" "400" "self-parent → 400"

# ── 5. Duplicate merge ────────────────────────────────────────────────
M1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/contacts" -H 'content-type: application/json' -d "{\"firstName\":\"Merge\",\"lastName\":\"Master$TS\",\"email\":\"merge$TS@example.com\",\"phone\":\"0000000000\",\"title\":\"CEO\"}")
M1ID=$(echo "$M1" | python -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
M2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/contacts" -H 'content-type: application/json' -d "{\"firstName\":\"Merge\",\"lastName\":\"Dup$TS\",\"email\":\"mergedup$TS@example.com\",\"phone\":\"1111111111\",\"title\":\"CTO\"}")
M2ID=$(echo "$M2" | python -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
MR=$(curl -s -b "$COOKIE" -X POST "$BASE/api/merge" -H 'content-type: application/json' \
  -d "{\"objectType\":\"contact\",\"masterId\":\"$M1ID\",\"mergeId\":\"$M2ID\",\"fieldChoices\":{\"title\":\"master\",\"phone\":\"merge\"}}")
MRTITLE=$(echo "$MR" | python -c "import json,sys; print(json.load(sys.stdin).get('merged',{}).get('title',''))")
MRPHONE=$(echo "$MR" | python -c "import json,sys; print(json.load(sys.stdin).get('merged',{}).get('phone',''))")
check "$MRTITLE" "CEO" "merge: master wins title"
check "$MRPHONE" "1111111111" "merge: merge wins phone"
GONE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/contacts/$M2ID")
check "$GONE" "404" "merge record deleted"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=100" | grep -q '"contact.merged"' && ok "contact.merged event emitted" || bad "no contact.merged event"

echo
echo "════════════════════════════════════════════"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "════════════════════════════════════════════"
[ "$FAIL" = "0" ] && echo "PHASE 1 SMOKE SUITE: ALL GREEN ✅" || echo "PHASE 1 SMOKE SUITE: FAILURES ⚠️"
exit $FAIL
