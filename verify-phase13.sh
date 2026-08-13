#!/usr/bin/env bash
# Phase 13 Ecosystem live smoke suite — run against localhost:8787 with a
# freshly booted + seeded stack (npm run db:push && npm run seed, then start
# the server). Covers the marketplace (seeded listings + publish/delete +
# validations), app install (webhook payload + agent template → Phase 9
# agent), uninstall, partners (seeded commissions, deal registration,
# status → partner.commission_earned), change sets (env diff, create,
# promote → changeset.promoted, re-promote guard), schema change safety
# (impact analysis on references + record values, safe delete blocked in
# use / allowed when clean, schema.field_deleted), RBAC, feature gates, and
# sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q13-admin.txt
REPCOOKIE=/tmp/q13-rep.txt
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

# ── 1. Seeds ────────────────────────────────────────────────────────────────
OV=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/overview" $ENV)
echo "$OV" | grep -q '"listings":3' && ok "overview: 3 marketplace listings seeded" || bad "listings count wrong: $OV"
echo "$OV" | grep -q '"installed":1' && ok "overview: 1 app installed" || bad "installed count wrong: $OV"
echo "$OV" | grep -q '"partners":2' && ok "overview: 2 partners seeded" || bad "partners count wrong: $OV"
echo "$OV" | grep -q '"commissionEarned":11520' && ok "overview: seeded commission derived (96000 x 12%)" || bad "commission wrong: $OV"
MK=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/marketplace" $ENV)
echo "$MK" | grep -q '"slug":"lead-qualifier"' && echo "$MK" | grep -q '"installed":true' && ok "lead-qualifier agent listing seeded + marked installed" || bad "lead-qualifier listing missing: $MK"
echo "$MK" | grep -q '"slug":"webhook-studio"' && ok "webhook-studio integration listing seeded" || bad "webhook-studio missing"
echo "$MK" | grep -q '"slug":"nps-survey-template"' && ok "nps-survey-template listing seeded" || bad "nps template missing"
APPS=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/apps" $ENV)
echo "$APPS" | grep -q '"slug":"lead-qualifier"' && echo "$APPS" | grep -q '"status":"installed"' && ok "lead-qualifier app row seeded + installed" || bad "app row missing: $APPS"
PARTS=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/partners" $ENV)
echo "$PARTS" | grep -q '"name":"Northwind Channel"' && ok "Northwind Channel partner seeded" || bad "partner missing: $PARTS"
echo "$PARTS" | grep -q '"commissionEarned":11520' && ok "won partner deal derives commission" || bad "commission missing"
echo "$PARTS" | grep -q '"pipelineValue":24000' && ok "open registered deal counts toward pipeline" || bad "pipeline missing"
CSS=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/changesets" $ENV)
echo "$CSS" | grep -q '"name":"Q3 field rollout"' && echo "$CSS" | grep -q '"status":"draft"' && ok "change set seeded as draft" || bad "change set missing: $CSS"

# ── 2. RBAC ─────────────────────────────────────────────────────────────────
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/ecosystem/marketplace" $ENV)
check "$RGET" "200" "rep can read marketplace (reads open)"
RPUB=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/ecosystem/marketplace" $ENV -H 'content-type: application/json' -d '{"slug":"nope","name":"Nope"}')
check "$RPUB" "403" "rep publish listing → 403 (admin only)"
RINST=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/ecosystem/apps/install" $ENV -H 'content-type: application/json' -d '{"listingId":"x"}')
check "$RINST" "403" "rep install app → 403 (admin only)"
RPART=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/ecosystem/partners" $ENV -H 'content-type: application/json' -d '{"name":"X"}')
check "$RPART" "403" "rep create partner → 403 (admin/manager only)"
RDIFF=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/ecosystem/changesets/diff" $ENV -H 'content-type: application/json' -d '{"from":"production","to":"sandbox"}')
check "$RDIFF" "403" "rep env diff → 403 (admin only)"
RIMP=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/ecosystem/schema/impact?objectType=contact&key=linkedin" $ENV)
check "$RIMP" "200" "rep schema impact read (reads open)"
RSDEL=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/ecosystem/schema/safe-delete" $ENV -H 'content-type: application/json' -d '{"id":"x"}')
check "$RSDEL" "403" "rep safe delete → 403 (admin only)"

# ── 3. Marketplace CRUD + validation ────────────────────────────────────────
NEW=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/marketplace" $ENV -H 'content-type: application/json' \
  -d "{\"slug\":\"verify-listing-$TS\",\"name\":\"Verify Listing\",\"kind\":\"app\",\"description\":\"Smoke test listing.\",\"publisher\":\"Verify Co\"}")
echo "$NEW" | grep -q '"slug":"verify-listing-' && ok "publish listing works" || bad "publish failed: $NEW"
NLID=$(echo "$NEW" | jget "['listing']['id']")
DUP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/ecosystem/marketplace" $ENV -H 'content-type: application/json' -d '{"slug":"lead-qualifier","name":"Dup"}')
check "$DUP" "400" "duplicate listing slug → 400"
BADK=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/ecosystem/marketplace" $ENV -H 'content-type: application/json' -d '{"slug":"bad-kind","name":"Bad","kind":"widget"}')
check "$BADK" "400" "invalid listing kind → 400"
DEL=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/ecosystem/marketplace/$NLID" $ENV)
check "$DEL" "200" "delete listing works"

# ── 4. App install (webhook payload + agent template) + uninstall ──────────
WS=$(echo "$MK" | python -c "import json,sys; d=json.load(sys.stdin); print([l['id'] for l in d['items'] if l['slug']=='webhook-studio'][0])")
INST=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/apps/install" $ENV -H 'content-type: application/json' -d "{\"listingId\":\"$WS\"}")
echo "$INST" | grep -q '"status":"installed"' && ok "install webhook-studio" || bad "install failed: $INST"
echo "$INST" | grep -q '"webhookId"' && ok "webhook payload applied on install (webhook row created)" || bad "webhook not applied: $INST"
REINST=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/ecosystem/apps/install" $ENV -H 'content-type: application/json' -d "{\"listingId\":\"$WS\"}")
check "$REINST" "400" "double-install → 400 (already installed)"
APPID=$(echo "$INST" | jget "['app']['id']")
UNINST=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/apps/$APPID/uninstall" $ENV -H 'content-type: application/json' -d '{}')
echo "$UNINST" | grep -q '"status":"uninstalled"' && ok "uninstall works" || bad "uninstall failed: $UNINST"
# Agent-template install → Phase 9 agent row created (marketplace → agent engine).
SLID=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/marketplace" $ENV -H 'content-type: application/json' \
  -d "{\"slug\":\"agent-test-$TS\",\"name\":\"Agent Test\",\"kind\":\"agent\",\"config\":{\"agentTemplate\":\"sales\"}}" | jget "['listing']['id']")
AINST=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/apps/install" $ENV -H 'content-type: application/json' -d "{\"listingId\":\"$SLID\"}")
echo "$AINST" | grep -q '"agentId"' && ok "agent-template install creates a Phase 9 agent" || bad "agent not created: $AINST"
AGENTS=$(curl -s -b "$COOKIE" "$BASE/api/agents" $ENV)
echo "$AGENTS" | grep -q '"kind":"sales"' && ok "sales agent exists after install" || bad "sales agent missing"
curl -s -b "$COOKIE" -X DELETE "$BASE/api/ecosystem/marketplace/$SLID" $ENV > /dev/null

# ── 5. Partners: register deal + status → commission ───────────────────────
PID=$(echo "$PARTS" | python -c "import json,sys; d=json.load(sys.stdin); print([p['id'] for p in d['items'] if p['name']=='Globex Referrals'][0])")
REG=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/partners/$PID/deals" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify deal $TS\",\"amount\":5000}")
echo "$REG" | grep -q '"name":"Verify deal' && echo "$REG" | grep -q '"status":"registered"' && ok "partner deal registration works" || bad "registration failed: $REG"
DEALID=$(echo "$REG" | python -c "import json,sys; d=json.load(sys.stdin); print([x['id'] for x in d['partner']['deals'] if x['name'].startswith('Verify deal')][0])")
WON=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/partners/deals/$DEALID/status" $ENV -H 'content-type: application/json' -d '{"status":"won"}')
echo "$WON" | grep -q '"status":"won"' && ok "mark deal won" || bad "mark won failed: $WON"
P2=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/partners" $ENV)
NEWEARN=$(echo "$P2" | python -c "import json,sys; d=json.load(sys.stdin); print([p['commissionEarned'] for p in d['items'] if p['id']=='$PID'][0])")
python -c "exit(0 if abs(float('$NEWEARN') - 400.0) < 0.01 else 1)" && ok "won deal derives 8% commission (400 on 5000)" || bad "commission wrong: $NEWEARN"
BADST=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/ecosystem/partners/deals/$DEALID/status" $ENV -H 'content-type: application/json' -d '{"status":"bogus"}')
check "$BADST" "400" "invalid deal status → 400"
BIGRATE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/ecosystem/partners" $ENV -H 'content-type: application/json' -d '{"name":"Bad Rate","commissionRate":1.5}')
check "$BIGRATE" "400" "commission rate > 1 → 400"

# ── 6. Change sets: diff → create → promote ─────────────────────────────────
DIFF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/changesets/diff" $ENV -H 'content-type: application/json' -d '{"from":"production","to":"sandbox"}')
echo "$DIFF" | grep -q '"entity":"fieldDef"' && ok "env diff surfaces custom-field creates" || bad "diff missing fields: $DIFF"
CS=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/changesets" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print([c['id'] for c in d['items'] if c['status']=='draft'][0])")
PROM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/changesets/$CS/promote" $ENV -H 'content-type: application/json' -d '{"to":"sandbox"}')
echo "$PROM" | grep -q '"status":"promoted"' && ok "change set promotes to sandbox" || bad "promote failed: $PROM"
REPROM=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/ecosystem/changesets/$CS/promote" $ENV -H 'content-type: application/json' -d '{"to":"sandbox"}')
check "$REPROM" "400" "re-promoting a promoted change set → 400"
SB=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/fields/contact")
echo "$SB" | grep -q '"key":"employeeCount"' && ok "promoted fieldDef replayed into sandbox" || bad "field not in sandbox: $SB"
SBA=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/agents")
echo "$SBA" | grep -q '"kind":"lead"' && ok "promoted agent replayed into sandbox" || bad "agent not in sandbox"
EMPTY=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/changesets" $ENV -H 'content-type: application/json' -d '{"name":"Empty","items":[]}')
echo "$EMPTY" | grep -q '"error"' && ok "change set with zero items → 400" || bad "empty change set not rejected: $EMPTY"

# ── 7. Schema change safety ─────────────────────────────────────────────────
IMP=$(curl -s -b "$COOKIE" "$BASE/api/ecosystem/schema/impact?objectType=contact&key=linkedin" $ENV)
echo "$IMP" | grep -q '"recordValues":5' && ok "impact: linkedin has 5 record values" || bad "linkedin impact wrong: $IMP"
LINKID=$(curl -s -b "$COOKIE" "$BASE/api/fields/contact" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print([f['id'] for f in d['custom'] if f['key']=='linkedin'][0])")
BLOCKED=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/schema/safe-delete" $ENV -H 'content-type: application/json' -d "{\"id\":\"$LINKID\"}")
echo "$BLOCKED" | grep -q '"error"' && ok "safe delete blocked for a field with record values" || bad "delete not blocked: $BLOCKED"
NEWF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/fields/contact" $ENV -H 'content-type: application/json' -d "{\"key\":\"deleteMe$TS\",\"label\":\"Delete me\",\"type\":\"text\"}")
NFID=$(echo "$NEWF" | jget "['field']['id']")
SDEL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ecosystem/schema/safe-delete" $ENV -H 'content-type: application/json' -d "{\"id\":\"$NFID\"}")
echo "$SDEL" | grep -q '"deleted":true' && ok "safe delete allowed for an unused field" || bad "clean delete failed: $SDEL"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=40" $ENV > /tmp/q13-events.txt
grep -q '"type":"schema.field_deleted"' /tmp/q13-events.txt && ok "schema.field_deleted emitted" || bad "field_deleted event missing"
grep -q '"type":"changeset.promoted"' /tmp/q13-events.txt && ok "changeset.promoted emitted" || bad "changeset.promoted event missing"
grep -q '"type":"app.installed"' /tmp/q13-events.txt && ok "app.installed emitted" || bad "app.installed event missing"
grep -q '"type":"partner.commission_earned"' /tmp/q13-events.txt && ok "partner.commission_earned emitted" || bad "commission event missing"

# ── 8. Feature gates + sandbox isolation ────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ecosystem.partners" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/ecosystem/partners" $ENV)
check "$FG" "403" "ecosystem.partners feature gate (off → 403)"
FOK=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/ecosystem/marketplace" $ENV)
check "$FOK" "200" "marketplace unaffected by partners gate"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ecosystem.partners" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
SB_MK=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/ecosystem/marketplace")
echo "$SB_MK" | grep -q '"items":\[\]' && ok "sandbox has no marketplace listings (isolated)" || bad "sandbox not isolated: $SB_MK"
SB_PART=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/ecosystem/partners")
echo "$SB_PART" | grep -q '"items":\[\]' && ok "sandbox has no partners (isolated)" || bad "sandbox partners not isolated"

echo
echo "──────────────────────────────────────────────"
echo "Phase 13: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
