#!/usr/bin/env bash
# Phase 12 Field Operations live smoke suite — run against localhost:8787 with
# a freshly booted + seeded stack (npm run db:push && npm run seed, then start
# the server). Covers territories (assignment + RBAC), visits (schedule,
# GPS check-in → visit.checked_in, complete/cancel), route optimization,
# work orders (create, dispatch, start, complete with parts → inventory
# consumption, SLA breach → workorder.sla_breached), assets + maintenance
# (due detection → asset.maintenance_due, maintenance_done), inventory
# (receive/consume, low stock → inventory.reorder_triggered), offline sync
# (push/pull + last-write-wins conflicts), the engine tick, RBAC, feature
# gating, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q12-admin.txt
REPCOOKIE=/tmp/q12-rep.txt
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
TERR=$(curl -s -b "$COOKIE" "$BASE/api/field/territories" $ENV)
[ "$(echo "$TERR" | jget "['items'].__len__()" )" -ge 2 ] && ok "territories seeded (Northeast + West)" || bad "territories missing: $TERR"
echo "$TERR" | grep -q '"name":"Northeast"' && echo "$TERR" | grep -q '"name":"West"' && ok "territory names seeded" || bad "territory names wrong"
echo "$TERR" | grep -q '"accountNames":\["Northwind Traders"' && ok "territory account assignment seeded" || bad "account assignment missing"
TECH=$(curl -s -b "$COOKIE" "$BASE/api/field/technicians" $ENV)
[ "$(echo "$TECH" | jget "['items'].__len__()")" -ge 2 ] && ok "technicians seeded" || bad "technicians missing: $TECH"
echo "$TECH" | grep -q '"skills":\["install"' && ok "technician skills seeded" || bad "skills missing"
VIS=$(curl -s -b "$COOKIE" "$BASE/api/field/visits" $ENV)
echo "$VIS" | grep -q '"status":"checked_in"' && echo "$VIS" | grep -q '"status":"planned"' && ok "visits seeded (checked_in + planned)" || bad "visits missing: $VIS"
echo "$VIS" | grep -q '"checkInLat":' && ok "seeded visit has GPS check-in" || bad "check-in coords missing"
WO=$(curl -s -b "$COOKIE" "$BASE/api/field/workorders" $ENV)
echo "$WO" | grep -q '"status":"dispatched"' && echo "$WO" | grep -q '"status":"completed"' && ok "work orders seeded (dispatched + completed)" || bad "work orders missing: $WO"
AST=$(curl -s -b "$COOKIE" "$BASE/api/field/assets" $ENV)
[ "$(echo "$AST" | python -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for a in d['items'] if a['maintenanceDue']))")" -ge 1 ] && ok "maintenance-due asset seeded" || bad "maintenance due not detected"
INV=$(curl -s -b "$COOKIE" "$BASE/api/field/inventory" $ENV)
[ "$(echo "$INV" | python -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for i in d['items'] if i['lowStock']))")" -ge 1 ] && ok "low-stock inventory seeded" || bad "low stock not detected"

# ── 2. RBAC ─────────────────────────────────────────────────────────────────
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/field/territories" $ENV)
check "$RGET" "200" "rep can read territories (reads open)"
RT=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/field/territories" $ENV -H 'content-type: application/json' -d '{"name":"No"}')
check "$RT" "403" "rep territory create → 403 (admin/manager only)"
RWO=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/field/workorders" $ENV -H 'content-type: application/json' -d '{"title":"No"}')
check "$RWO" "403" "rep work-order create → 403"
RTK=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/field/tick" $ENV)
check "$RTK" "403" "rep engine tick → 403 (admin only)"
RDISP=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/field/workorders/000000000000000000000000/dispatch" $ENV -H 'content-type: application/json' -d '{"technicianId":"x"}')
check "$RDISP" "403" "rep dispatch → 403"
RCON=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/field/inventory/$(echo "$INV" | jget "['items'][0]['id']")/consume" $ENV -H 'content-type: application/json' -d '{"qty":1}')
check "$RCON" "200" "rep can consume stock (field-worker op)"

# ── 3. Territories CRUD ─────────────────────────────────────────────────────
NEWT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/territories" $ENV -H 'content-type: application/json' -d "{\"name\":\"Verify TERR $TS\",\"region\":\"QA\"}")
TID=$(echo "$NEWT" | jget "['territory']['id']")
[ -n "$TID" ] && ok "admin creates territory" || bad "territory create failed: $NEWT"
check "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/field/territories/$TID" $ENV)" "200" "admin deletes territory"
BADT=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/territories" $ENV -H 'content-type: application/json' -d '{"name":""}')
check "$BADT" "400" "empty territory name → 400"

# ── 4. Visits + GPS check-in (visit.checked_in) ─────────────────────────────
VNEW=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/visits" $ENV -H 'content-type: application/json' \
  -d "{\"title\":\"Verify visit $TS\",\"scheduledAt\":\"$(date -d 'tomorrow' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v+1d +%Y-%m-%dT%H:%M:%SZ)\"}")
VID=$(echo "$VNEW" | jget "['visit']['id']")
[ -n "$VID" ] && ok "admin schedules visit" || bad "visit create failed: $VNEW"
check "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/visits/$VID/start" $ENV)" "200" "visit start → in_transit"
CI=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/visits/$VID/check-in" $ENV -H 'content-type: application/json' -d '{"lat":40.758,"lng":-73.985}')
[ "$(echo "$CI" | jget "['visit']['status']")" = "checked_in" ] && ok "GPS check-in → checked_in" || bad "check-in failed: $CI"
[ "$(echo "$CI" | jget "['visit']['checkInLat']")" = "40.758" ] && ok "check-in lat persisted" || bad "lat wrong"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=visit.checked_in&pageSize=5" $ENV | grep -c '"type":"visit.checked_in"')" -ge 1 ] && ok "visit.checked_in event emitted" || bad "event missing"
check "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/visits/$VID/complete" $ENV)" "200" "visit complete → completed"
check "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/visits/$VID/cancel" $ENV)" "400" "cancel a completed visit → 400"
# cancel path on a fresh visit:
VNEW2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/visits" $ENV -H 'content-type: application/json' -d "{\"title\":\"Verify cancel $TS\",\"scheduledAt\":\"$(date -d 'tomorrow' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v+1d +%Y-%m-%dT%H:%M:%SZ)\"}")
VID2=$(echo "$VNEW2" | jget "['visit']['id']")
check "$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/visits/$VID2/cancel" $ENV | jget "['visit']['status']")" "cancelled" "visit cancel → cancelled"
BADCI=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/visits/$VID2/check-in" $ENV -H 'content-type: application/json' -d '{"lat":1,"lng":2}')
check "$BADCI" "400" "check-in on cancelled visit → 400"

# ── 5. Route optimization ───────────────────────────────────────────────────
ROUTE=$(curl -s -b "$COOKIE" "$BASE/api/field/routes/optimize" $ENV)
[ "$(echo "$ROUTE" | jget "['route']['ordered'].__len__()")" -ge 1 ] && ok "route optimization returns ordered visits" || bad "route empty: $ROUTE"
echo "$ROUTE" | grep -q '"totalKm":' && ok "route totals computed" || bad "totalKm missing"
echo "$ROUTE" | grep -q '"legKm":' && ok "per-leg distances computed" || bad "legKm missing"

# ── 6. Work orders: dispatch → start → complete with parts ─────────────────
WNEW=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/workorders" $ENV -H 'content-type: application/json' \
  -d "{\"title\":\"Verify WO $TS\",\"priority\":\"high\",\"slaDueAt\":\"$(date -d 'tomorrow' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v+1d +%Y-%m-%dT%H:%M:%SZ)\"}")
WID=$(echo "$WNEW" | jget "['workOrder']['id']")
[ -n "$WID" ] && ok "admin creates work order" || bad "work order create failed: $WNEW"
check "$(echo "$WNEW" | jget "['workOrder']['priority']")" "high" "priority persisted"
TECHID=$(echo "$TECH" | jget "['items'][0]['id']")
check "$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/workorders/$WID/dispatch" $ENV -H 'content-type: application/json' -d "{\"technicianId\":\"$TECHID\"}" | jget "['workOrder']['status']")" "dispatched" "dispatch → dispatched"
BADT2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/workorders/$WID/dispatch" $ENV -H 'content-type: application/json' -d '{"technicianId":"000000000000000000000000"}')
check "$BADT2" "400" "dispatch to unknown technician → 400"
check "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/workorders/$WID/start" $ENV)" "200" "work order start → in_progress"
SKU=$(echo "$INV" | jget "['items'][0]['sku']")
SKUID=$(echo "$INV" | jget "['items'][0]['id']")
BEFORE=$(curl -s -b "$COOKIE" "$BASE/api/field/inventory" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print([i['quantityOnHand'] for i in d['items'] if i['id']=='$SKUID'][0])")
COMP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/workorders/$WID/complete" $ENV -H 'content-type: application/json' -d "{\"partsUsed\":[{\"sku\":\"$SKU\",\"qty\":2}]}")
check "$(echo "$COMP" | jget "['workOrder']['status']")" "completed" "work order complete → completed"
[ "$(echo "$COMP" | jget "['workOrder']['partsUsed'][0]['qty']")" = "2" ] && ok "partsUsed persisted on the work order" || bad "partsUsed missing"
AFTER=$(curl -s -b "$COOKIE" "$BASE/api/field/inventory" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print([i['quantityOnHand'] for i in d['items'] if i['id']=='$SKUID'][0])")
[ "$AFTER" = "$((BEFORE - 2))" ] && ok "inventory consumed by completion ($BEFORE → $AFTER)" || bad "consumption wrong: before=$BEFORE after=$AFTER"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=inventory.consumed&pageSize=5" $ENV | grep -c '"type":"inventory.consumed"')" -ge 1 ] && ok "inventory.consumed event emitted" || bad "consumed event missing"
OVER=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/workorders" $ENV -H 'content-type: application/json' -d "{\"title\":\"Over $TS\"}")
WOID2=$(echo "$OVER" | jget "['workOrder']['id']")
curl -s -b "$COOKIE" -X POST "$BASE/api/field/workorders/$WOID2/start" $ENV > /dev/null
OVERCODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/workorders/$WOID2/complete" $ENV -H 'content-type: application/json' -d "{\"partsUsed\":[{\"sku\":\"$SKU\",\"qty\":9999}]}")
check "$OVERCODE" "400" "over-consuming stock → 400"

# ── 7. SLA breach (workorder.sla_breached) ─────────────────────────────────
WSLABAD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/workorders" $ENV -H 'content-type: application/json' \
  -d "{\"title\":\"SLA past $TS\",\"slaDueAt\":\"$(date -d 'yesterday' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v-1d +%Y-%m-%dT%H:%M:%SZ)\"}")
WSLABADID=$(echo "$WSLABAD" | jget "['workOrder']['id']")
[ "$(curl -s -b "$COOKIE" "$BASE/api/field/workorders?status=open" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for w in d['items'] if w['slaBreached']))")" -ge 1 ] && ok "past-SLA work order flagged slaBreached at read" || bad "slaBreached not derived"
TICK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/tick" $ENV)
[ "$(echo "$TICK" | jget "['tick']['slaBreached']")" -ge 1 ] && ok "tick detects SLA breaches" || bad "tick slaBreached=0: $TICK"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=workorder.sla_breached&pageSize=5" $ENV | grep -c '"type":"workorder.sla_breached"')" -ge 1 ] && ok "workorder.sla_breached event emitted" || bad "sla event missing"
[ "$(curl -s -b "$COOKIE" "$BASE/api/notifications?pageSize=20" $ENV 2>/dev/null | grep -c '"kind":"field"')" -ge 1 ] && ok "field notifications written (kind field)" || bad "notifications missing"

# ── 8. Assets + maintenance (asset.maintenance_due / maintenance_done) ──────
DUETOTAL=$(curl -s -b "$COOKIE" "$BASE/api/field/assets" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for a in d['items'] if a['maintenanceDue']))")
[ "$DUETOTAL" -ge 1 ] && ok "maintenance-due assets derived at read" || bad "no due asset: $AST"
[ "$(echo "$TICK" | jget "['tick']['maintenanceDue']")" -ge 1 ] && ok "tick fires maintenance-due scan" || bad "tick maintenanceDue=0"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=asset.maintenance_due&pageSize=5" $ENV | grep -c '"type":"asset.maintenance_due"')" -ge 1 ] && ok "asset.maintenance_due event emitted" || bad "due event missing"
DUEDID=$(curl -s -b "$COOKIE" "$BASE/api/field/assets" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print([a['id'] for a in d['items'] if a['maintenanceDue']][0])")
DONE=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/assets/$DUEDID/maintenance" $ENV)
check "$(echo "$DONE" | jget "['asset']['maintenanceDue']")" "False" "log maintenance clears maintenanceDue"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=asset.maintenance_done&pageSize=5" $ENV | grep -c '"type":"asset.maintenance_done"')" -ge 1 ] && ok "asset.maintenance_done event emitted" || bad "done event missing"

# ── 9. Inventory receive/consume + reorder (inventory.reorder_triggered) ────
INVID=$(echo "$INV" | jget "['items'][0]['id']")
RECBEFORE=$(curl -s -b "$COOKIE" "$BASE/api/field/inventory" $ENV | python -c "import json,sys; d=json.load(sys.stdin); print([i['quantityOnHand'] for i in d['items'] if i['id']=='$INVID'][0])")
REC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/inventory/$INVID/receive" $ENV -H 'content-type: application/json' -d '{"qty":5}')
check "$(echo "$REC" | jget "['item']['quantityOnHand']")" "$((RECBEFORE + 5))" "receive stock increments on-hand"
check "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/field/inventory/$INVID/receive" $ENV -H 'content-type: application/json' -d '{"qty":0}')" "400" "non-positive receive → 400"
[ "$(echo "$TICK" | jget "['tick']['reorders']")" -ge 1 ] && ok "tick fires reorder scan" || bad "tick reorders=0"
[ "$(curl -s -b "$COOKIE" "$BASE/api/events?type=inventory.reorder_triggered&pageSize=5" $ENV | grep -c '"type":"inventory.reorder_triggered"')" -ge 1 ] && ok "inventory.reorder_triggered event emitted" || bad "reorder event missing"

# ── 10. Offline sync (docs/38-offline-sync-spec.md) ─────────────────────────
SYNC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/sync" $ENV -H 'content-type: application/json' \
  -d "{\"since\":\"2026-01-01T00:00:00Z\",\"changes\":[{\"entity\":\"inventoryItem\",\"op\":\"update\",\"id\":\"$INVID\",\"data\":{\"notes\":\"offline sync $TS\"},\"clientTs\":$(date +%s%3N)}]}")
check "$(echo "$SYNC" | jget "['pushed']")" "1" "sync pushes a client change (pushed=1)"
[ "$(echo "$SYNC" | jget "['pulled'].__len__()")" -ge 1 ] && ok "sync pulls server changes since lastSync" || bad "pulled empty"
CONF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/sync" $ENV -H 'content-type: application/json' \
  -d "{\"changes\":[{\"entity\":\"inventoryItem\",\"op\":\"update\",\"id\":\"$INVID\",\"data\":{\"notes\":\"stale\"},\"clientTs\":1}]}")
check "$(echo "$CONF" | jget "['pushed']")" "0" "stale clientTs is not applied (pushed=0)"
[ "$(echo "$CONF" | jget "['conflicts'].__len__()")" -ge 1 ] && ok "conflict reported with reason (server wins)" || bad "conflict missing"
CREATESYNC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/field/sync" $ENV -H 'content-type: application/json' \
  -d "{\"changes\":[{\"entity\":\"territory\",\"op\":\"create\",\"data\":{\"name\":\"Synced TERR $TS\"},\"clientTs\":$(date +%s%3N)}]}")
check "$(echo "$CREATESYNC" | jget "['pushed']")" "1" "sync creates an entity offline (pushed=1)"
[ "$(curl -s -b "$COOKIE" "$BASE/api/field/territories" $ENV | grep -c "Synced TERR $TS")" -ge 1 ] && ok "offline-created territory visible after pull" || bad "created territory missing"

# ── 11. Feature gates + sandbox isolation ───────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/field.visits" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/field/visits" $ENV)
check "$FG" "403" "field.visits disabled → visits 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/field.visits" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/field/visits" $ENV)
check "$FG2" "200" "flag re-enabled → visits 200"
# sandbox: clean env, create, no leak
for SBDEL in $(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/field/territories" | grep -o '"id":"[a-f0-9]*"' | cut -d'"' -f4); do
  curl -s -b "$COOKIE" -X DELETE "$BASE/api/field/territories/$SBDEL" -H 'x-environment:sandbox' > /dev/null
done
SB0=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/field/territories")
[ "$(echo "$SB0" | jget "['items'].__len__()")" = "0" ] && ok "sandbox starts with no territories (fresh env)" || bad "sandbox not clean"
SBT=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' -X POST "$BASE/api/field/territories" -H 'content-type: application/json' -d '{"name":"Sandbox Territory"}')
SBID=$(echo "$SBT" | jget "['territory']['id']")
[ -n "$SBID" ] && ok "territory created in sandbox env" || bad "sandbox create failed"
PLANS2=$(curl -s -b "$COOKIE" "$BASE/api/field/territories" $ENV)
echo "$PLANS2" | grep -q "Sandbox Territory" && bad "sandbox territory leaked into production" || ok "sandbox territory invisible in production"
SBV=$(curl -s -b "$COOKIE" -H 'x-environment:sandbox' -X POST "$BASE/api/field/visits" -H 'content-type: application/json' \
  -d "{\"title\":\"Sandbox visit\",\"scheduledAt\":\"$(date -d 'tomorrow' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -v+1d +%Y-%m-%dT%H:%M:%SZ)\"}")
[ -n "$(echo "$SBV" | jget "['visit']['id']")" ] && ok "visit created in sandbox env" || bad "sandbox visit failed"
PRODVIS=$(curl -s -b "$COOKIE" "$BASE/api/field/visits" $ENV)
echo "$PRODVIS" | grep -q "Sandbox visit" && bad "sandbox visit leaked into production" || ok "sandbox visit invisible in production"

echo
echo "──────────────────────────────────────────────"
echo "Phase 12 · Field Operations: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] && echo "✅ ALL GREEN" || echo "❌ $FAIL FAILURE(S)"
exit 0
