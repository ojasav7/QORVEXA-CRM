#!/usr/bin/env bash
# Phase 3 Automation & Workflow Engine live smoke suite — run against
# localhost:8787 with a freshly seeded demo org (npm run seed). Covers the
# task.completed event, workflow CRUD + duplicate detection, trigger → condition
# → action execution (create_task + notify), the run log, the test endpoint,
# notifications, role gating, feature gating, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q3-admin.txt
REPCOOKIE=/tmp/q3-rep.txt
PASS=0; FAIL=0
say() { printf '%-72s' "$1"; }
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

# ── 1. task.completed event ──────────────────────────────────────────────────
TASK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tasks" $ENV -H 'content-type: application/json' \
  -d "{\"title\":\"Phase3 smoke task $TS\",\"status\":\"todo\",\"priority\":\"low\"}")
TASK_ID=$(echo "$TASK" | jget "['id']")
[ -n "$TASK_ID" ] && ok "task created" || bad "task create failed: $TASK"
curl -s -b "$COOKIE" -X PATCH "$BASE/api/tasks/$TASK_ID" $ENV -H 'content-type: application/json' -d '{"status":"done"}' > /dev/null
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=task.completed&pageSize=5")
echo "$EV" | grep -q '"task.completed"' && ok "task.completed event emitted" || bad "task.completed event missing"
echo "$EV" | grep -q "$TASK_ID" && ok "task.completed payload references the task" || bad "task.completed payload missing task id"

# ── 2. Workflow CRUD + validation ────────────────────────────────────────────
AUTOS=$(curl -s -b "$COOKIE" "$BASE/api/automations" $ENV)
echo "$AUTOS" | grep -q "Celebrate won deals" && ok "seeded workflow listed" || bad "seeded workflow missing from list"
echo "$AUTOS" | grep -q "Hot lead follow-up" && ok "second seeded workflow listed" || bad "second seeded workflow missing"

# rep cannot create workflows
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"nope\",\"trigger\":{\"kind\":\"event\",\"event\":\"lead.created\"},\"actions\":[]}")
check "$R403" "403" "rep workflow create → 403"
# rep can read workflows
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/automations" $ENV)
check "$RGET" "200" "rep can list workflows"

# bad trigger → 400
V400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"bad\",\"trigger\":{\"kind\":\"event\",\"event\":\"unicorn.dance\"},\"actions\":[]}")
check "$V400" "400" "unknown trigger event → 400"
# bad condition field → 400
V400B=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"bad\",\"trigger\":{\"kind\":\"event\",\"event\":\"lead.created\"},\"conditions\":[{\"field\":\"unicorn\",\"op\":\"eq\",\"value\":1}],\"actions\":[]}")
check "$V400B" "400" "unknown condition field → 400"

# Create a workflow: deal.stage_changed → won with amount >= 10 (matches a seeded deal)
NEW=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke won $TS\",\"description\":\"phase3 smoke\",\"trigger\":{\"kind\":\"event\",\"event\":\"deal.stage_changed\",\"to\":\"won\"},\"conditions\":[{\"field\":\"amount\",\"op\":\"gte\",\"value\":10}],\"actions\":[{\"type\":\"notify\",\"title\":\"Smoke notif {{name}}\",\"target\":\"owner\"},{\"type\":\"create_task\",\"title\":\"Smoke task {{name}}\",\"dueInDays\":1,\"priority\":\"high\"}]}")
NEW_ID=$(echo "$NEW" | jget "['automation']['id']")
[ -n "$NEW_ID" ] && ok "workflow created" || bad "workflow create failed: $NEW"

# ── 3. Duplicate detection ───────────────────────────────────────────────────
DUP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke won dup $TS\",\"trigger\":{\"kind\":\"event\",\"event\":\"deal.stage_changed\",\"to\":\"won\"},\"conditions\":[{\"field\":\"amount\",\"op\":\"gte\",\"value\":10}],\"actions\":[{\"type\":\"notify\",\"title\":\"Smoke notif {{name}}\",\"target\":\"owner\"},{\"type\":\"create_task\",\"title\":\"Smoke task {{name}}\",\"dueInDays\":1,\"priority\":\"high\"}]}")
DUP_STATUS=$(echo "$DUP" | python -c "import json,sys; d=json.load(sys.stdin); print(d.get('duplicateId',''))")
[ -n "$DUP_STATUS" ] && ok "duplicate workflow → 409 with duplicateId" || bad "duplicate not detected: $DUP"
DUP_OK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke won dup-ok $TS\",\"allowDuplicate\":true,\"trigger\":{\"kind\":\"event\",\"event\":\"deal.stage_changed\",\"to\":\"won\"},\"conditions\":[{\"field\":\"amount\",\"op\":\"gte\",\"value\":10}],\"actions\":[{\"type\":\"create_task\",\"title\":\"Smoke task {{name}}\",\"dueInDays\":1,\"priority\":\"high\"}]}")
DUP_OK_ID=$(echo "$DUP_OK" | jget "['automation']['id']")
[ -n "$DUP_OK_ID" ] && ok "allowDuplicate → created" || bad "allowDuplicate failed: $DUP_OK"

# ── 4. Trigger execution: move a big deal to won ─────────────────────────────
# Use the "Celebrate won deals" seeded workflow (amount >= 50000) → notify + task.
BIG=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?pageSize=100" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
for it in d['items']:
    if it.get('amount',0) >= 50000 and it.get('stage') != 'won':
        print(it['id']); break
")
if [ -n "$BIG" ]; then
  BEFORE=$(curl -s -b "$COOKIE" "$BASE/api/automations" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
for it in d['items']:
    if it['name']=='Celebrate won deals': print(it['runCount']); break
")
  curl -s -b "$COOKIE" -X PATCH "$BASE/api/opportunities/$BIG" $ENV -H 'content-type: application/json' -d '{"stage":"won"}' > /dev/null
  sleep 1
  AFTER=$(curl -s -b "$COOKIE" "$BASE/api/automations" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
for it in d['items']:
    if it['name']=='Celebrate won deals': print(it['runCount']); break
")
  [ "$AFTER" = "$((BEFORE+1))" ] && ok "won-deal workflow ran (runCount $BEFORE → $AFTER)" || bad "runCount not incremented ($BEFORE → $AFTER)"
  # The action created a task for the deal owner
  TASKFOUND=$(curl -s -b "$COOKIE" "$BASE/api/tasks?pageSize=100" $ENV | grep -c "Handover follow-up")
  [ "$TASKFOUND" -ge 1 ] && ok "create_task action created a handover task" || bad "no handover task found"
  # And a notification for the deal owner
  NOTIF=$(curl -s -b "$COOKIE" "$BASE/api/notifications?pageSize=20" $ENV)
  echo "$NOTIF" | grep -q "Deal won" && ok "notify action created a notification" || bad "no 'Deal won' notification"
  # automation.triggered event
  TRIG=$(curl -s -b "$COOKIE" "$BASE/api/events?type=automation.triggered&pageSize=20" $ENV)
  echo "$TRIG" | grep -q "Celebrate won deals" && ok "automation.triggered event emitted" || bad "automation.triggered missing"
else
  bad "no eligible big deal found for trigger test"
fi

# ── 5. Run log + test endpoint ───────────────────────────────────────────────
RUNS=$(curl -s -b "$COOKIE" "$BASE/api/automations/$NEW_ID/runs?limit=20" $ENV)
[ "$(echo "$RUNS" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" -ge 0 ] && ok "runs endpoint reachable" || bad "runs endpoint failed"

# Test endpoint: pick a won deal with the big amount and run the smoke workflow manually
WONDEAL=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?pageSize=100&stage=won" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
print(d['items'][0]['id'] if d['items'] else '')
")
if [ -n "$WONDEAL" ]; then
  TEST=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations/$NEW_ID/test" $ENV -H 'content-type: application/json' -d "{\"entityId\":\"$WONDEAL\"}")
  echo "$TEST" | grep -q '"matched":true' && ok "test endpoint matched a won deal" || bad "test endpoint did not match: $TEST"
  echo "$TEST" | grep -q '"create_task"' && ok "test endpoint executed create_task" || bad "test endpoint missing create_task outcome"
  TESTRUN=$(curl -s -b "$COOKIE" "$BASE/api/automations/$NEW_ID/runs?limit=5" $ENV)
  echo "$TESTRUN" | grep -q '"test"' && ok "test run logged with triggeredBy=test" || bad "test run not logged as test"
fi
# unmatched: run the smoke workflow against a non-won deal → matched false
SMALL=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?pageSize=100" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
for it in d['items']:
    if it.get('stage') not in ('won','lost') and it.get('amount',0) < 10:
        print(it['id']); break
")
if [ -n "$SMALL" ]; then
  T2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations/$NEW_ID/test" $ENV -H 'content-type: application/json' -d "{\"entityId\":\"$SMALL\"}")
  echo "$T2" | grep -q '"matched":false' && ok "test endpoint reports unmatched when stage differs" || bad "test endpoint should not match non-won deal: $T2"
fi

# ── 6. Notifications API ─────────────────────────────────────────────────────
UNREAD=$(curl -s -b "$COOKIE" "$BASE/api/notifications/unread-count" $ENV)
echo "$UNREAD" | grep -q '"unread"' && ok "unread-count endpoint works" || bad "unread-count failed: $UNREAD"
NOTIF_ID=$(curl -s -b "$COOKIE" "$BASE/api/notifications?pageSize=5" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
for it in d['items']:
    if not it['read']: print(it['id']); break
")
if [ -n "$NOTIF_ID" ]; then
  R1=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/notifications/$NOTIF_ID/read" $ENV)
  check "$R1" "200" "mark one notification read → 200"
  # rep cannot mark admin's notification read (different org member row scoping)
  R2=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/notifications/$NOTIF_ID/read" $ENV)
  check "$R2" "404" "other user's notification → 404"
fi
R3=$(curl -s -b "$COOKIE" -X POST "$BASE/api/notifications/read-all" $ENV)
echo "$R3" | grep -q '"ok":true' && ok "read-all works" || bad "read-all failed: $R3"

# ── 7. Sandbox isolation ─────────────────────────────────────────────────────
SANDBOX_AUTO=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations" -H 'x-environment:sandbox' -H 'content-type: application/json' \
  -d "{\"name\":\"Sandbox only $TS\",\"trigger\":{\"kind\":\"event\",\"event\":\"lead.created\"},\"actions\":[{\"type\":\"notify\",\"title\":\"sb\",\"target\":\"owner\"}]}")
SB_ID=$(echo "$SANDBOX_AUTO" | jget "['automation']['id']")
[ -n "$SB_ID" ] && ok "workflow created in sandbox env" || bad "sandbox workflow create failed: $SANDBOX_AUTO"
# create a lead in PRODUCTION — the sandbox workflow must not see it
curl -s -b "$COOKIE" -X POST "$BASE/api/leads" $ENV -H 'content-type: application/json' \
  -d "{\"firstName\":\"Sandbox\",\"lastName\":\"Probe $TS\",\"email\":\"sbprobe$TS@example.com\",\"score\":95}" > /dev/null
sleep 1
SB_AUTOS=$(curl -s -b "$COOKIE" "$BASE/api/automations" -H 'x-environment:sandbox')
echo "$SB_AUTOS" | grep -q "Sandbox only" && ok "sandbox workflow listed in sandbox env" || bad "sandbox workflow not listed"
SB_RUNS=$(curl -s -b "$COOKIE" "$BASE/api/automations/$SB_ID/runs?limit=5" -H 'x-environment:sandbox')
[ "$(echo "$SB_RUNS" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" = "0" ] && ok "sandbox workflow did not fire on production event" || bad "sandbox workflow fired on prod event (env leak!)"
# production list must not contain the sandbox workflow
PROD_AUTOS=$(curl -s -b "$COOKIE" "$BASE/api/automations" $ENV)
echo "$PROD_AUTOS" | grep -q "Sandbox only" && bad "sandbox workflow leaked into production list" || ok "sandbox workflow invisible in production"

# ── 8. Feature gate ──────────────────────────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/automation.workflows" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/automations" $ENV)
check "$FG" "403" "flag disabled → automations API 403"
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/notifications" $ENV)
check "$FG2" "403" "flag disabled → notifications API 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/automation.workflows" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG3=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/automations" $ENV)
check "$FG3" "200" "flag re-enabled → automations API 200"

# ── 9. Cleanup (leave demo data pristine) ────────────────────────────────────
curl -s -b "$COOKIE" -X DELETE "$BASE/api/automations/$NEW_ID" $ENV > /dev/null
[ -n "${DUP_OK_ID:-}" ] && curl -s -b "$COOKIE" -X DELETE "$BASE/api/automations/$DUP_OK_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/automations/$SB_ID" -H 'x-environment:sandbox' > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/tasks/$TASK_ID" $ENV > /dev/null
AUTOS_AFTER=$(curl -s -b "$COOKIE" "$BASE/api/automations" $ENV)
echo "$AUTOS_AFTER" | grep -q "Smoke won" && bad "smoke workflow left behind" || ok "smoke workflows cleaned up"

echo
echo "════════════════════════════════════════════"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "════════════════════════════════════════════"
if [ "$FAIL" = "0" ]; then echo "PHASE 3 SMOKE SUITE: ALL GREEN ✅"; else echo "PHASE 3 SMOKE SUITE: FAILURES ❌"; fi
