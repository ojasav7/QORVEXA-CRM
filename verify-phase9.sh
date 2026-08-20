#!/usr/bin/env bash
# Phase 9 AI Agent Platform live smoke suite — run against localhost:8787 with
# a freshly booted + seeded stack (npm run db:push && npm run seed, then start
# the server). Covers the pre-built agents (Lead/Sales/Service/Renewal), the
# risk-tiered action system (🟢 auto executes / 🟡 approval / 🔴 human), the
# human-in-the-loop approval queue (manager yellow / admin red), the AI audit
# trail (AgentRun + AgentAction + agent.* events), the kill switches (org-wide
# + per-agent), the testing/simulation lab (passed vs blocked), cost metering
# + analytics, agent memory, RBAC, feature gating, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q9-admin.txt
REPCOOKIE=/tmp/q9-rep.txt
MGRCOOKIE=/tmp/q9-mgr.txt
source "$(dirname "$0")/lib/test-helpers.sh"
login "/tmp/q9-admin.txt"
login_rep "/tmp/q9-rep.txt"

  -d '{"email":"priya@qorvexa.dev","password":"password123"}' > /dev/null
curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"
curl -s -b "$MGRCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"manager"' && ok "manager login (priya)" || bad "manager login failed"

TS=$(date +%s)
ENV='-H x-environment:production'
SBENV='-H x-environment:sandbox'

# ── 1. Seeded agents + templates ────────────────────────────────────────────
AG=$(curl -s -b "$COOKIE" "$BASE/api/agents" $ENV)
[ "$(echo "$AG" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" -ge 4 ] && ok "4 pre-built agents seeded (Lead/Sales/Service/Renewal)" || bad "agents not seeded: $AG"
[ "$(echo "$AG" | python -c "import json,sys; print(len(json.load(sys.stdin)['templates']))")" = "4" ] && ok "4 agent templates exposed" || bad "templates missing"
echo "$AG" | grep -q '"send_email":"yellow"' && ok "tool tier defaults: send_email → yellow (approval)" || bad "tier defaults wrong"
echo "$AG" | grep -q '"orgKillSwitched":false' && ok "org kill switch initially off" || bad "org kill switch state wrong: $AG"
LEAD_AGENT=$(echo "$AG" | python -c "import json,sys; d=json.load(sys.stdin); print([a['id'] for a in d['items'] if a['kind']=='lead'][0])")
SALES_AGENT=$(echo "$AG" | python -c "import json,sys; d=json.load(sys.stdin); print([a['id'] for a in d['items'] if a['kind']=='sales'][0])")
[ -n "$LEAD_AGENT" ] && ok "Lead Agent id resolved" || bad "Lead Agent missing"
[ -n "$SALES_AGENT" ] && ok "Sales Agent id resolved" || bad "Sales Agent missing"

# ── 2. RBAC — reads open, writes admin-only ─────────────────────────────────
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/agents" $ENV)
check "$RGET" "200" "rep can list agents (reads open)"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/agents" $ENV -H 'content-type: application/json' -d '{"name":"nope"}')
check "$R403" "403" "rep agent create → 403 (admin only)"
R403B=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/agents/kill-switch" $ENV -H 'content-type: application/json' -d '{"on":true}')
check "$R403B" "403" "rep org kill switch → 403 (admin only)"
R403C=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/agents/actions/abc/approve" $ENV)
check "$R403C" "403" "rep action approval → 403 (admin/manager only)"
V400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/agents" $ENV -H 'content-type: application/json' -d '{"name":"bad","tools":["fly_to_moon"]}')
check "$V400" "400" "unknown tool → 400"

# ── 3. Manual run — Lead Agent on a HOT lead (score 80) ─────────────────────
LEAD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" $ENV -H 'content-type: application/json' \
  -d "{\"firstName\":\"Smoke\",\"lastName\":\"Hot$TS\",\"email\":\"smokehot$TS@example.com\",\"score\":80}")
LEAD_ID=$(echo "$LEAD" | jget "['id']")
[ -n "$LEAD_ID" ] && ok "smoke hot lead created (score 80)" || bad "lead create failed: $LEAD"
RUN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$LEAD_AGENT/run" $ENV -H 'content-type: application/json' \
  -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD_ID\"}")
[ "$(echo "$RUN" | jget "['status']")" = "waiting_approval" ] && ok "run on hot lead → waiting_approval (yellow update_record)" || bad "run status wrong: $RUN"
G=$(echo "$RUN" | jget "['run']['riskSummary']['green']")
Y=$(echo "$RUN" | jget "['run']['riskSummary']['yellow']")
R=$(echo "$RUN" | jget "['run']['riskSummary']['red']")
[ "$G" = "2" ] && [ "$Y" = "1" ] && [ "$R" = "0" ] && ok "risk summary green:2 yellow:1 red:0" || bad "risk summary wrong ($G/$Y/$R)"
TASKFOUND=$(curl -s -b "$COOKIE" "$BASE/api/tasks?pageSize=100" $ENV | grep -c "Follow up with hot lead Smoke")
[ "$TASKFOUND" -ge 1 ] && ok "🟢 create_task executed (follow-up task created)" || bad "green task not created"
NOTIF=$(curl -s -b "$COOKIE" "$BASE/api/notifications?pageSize=20" $ENV)
echo "$NOTIF" | grep -q "Hot lead inbound" && ok "🟢 notify executed (owner pinged)" || bad "green notify missing"
echo "$RUN" | grep -q '"tool":"update_record"' && ok "🟡 update_record proposed (waits for approval)" || bad "update_record not proposed"
RUN_ID=$(echo "$RUN" | jget "['run']['id']")
[ -n "$RUN_ID" ] && ok "AgentRun persisted (audit trail row)" || bad "no run row"
YEL_ID=$(echo "$RUN" | python -c "import json,sys; d=json.load(sys.stdin); print([a['id'] for a in d['actions'] if a['tool']=='update_record'][0])")
[ -n "$YEL_ID" ] && ok "AgentAction persisted for the yellow action" || bad "no action row"
echo "$RUN" | grep -q '"cost"' && ok "run carries metered cost" || bad "cost missing"
APPR=$(curl -s -b "$COOKIE" "$BASE/api/agents/approvals" $ENV)
echo "$APPR" | grep -q "$YEL_ID" && ok "yellow action queued in the human-in-the-loop approval list" || bad "approval queue missing action"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=agent.action_proposed&pageSize=10" $ENV)
echo "$EV" | grep -q "agent.action_proposed" && ok "agent.action_proposed event emitted" || bad "proposed event missing"
EV2=$(curl -s -b "$COOKIE" "$BASE/api/events?type=agent.action_executed&pageSize=10" $ENV)
echo "$EV2" | grep -q "agent.action_executed" && ok "agent.action_executed event emitted (green actions)" || bad "executed event missing"

# ── 4. Approval flow — manager approves the 🟡 action ───────────────────────
APPROVE=$(curl -s -b "$MGRCOOKIE" -X POST "$BASE/api/agents/actions/$YEL_ID/approve" $ENV)
[ "$(echo "$APPROVE" | jget "['action']['status']")" = "executed" ] && ok "manager approved 🟡 update_record → executed" || bad "approve failed: $APPROVE"
LEAD_NOW=$(curl -s -b "$COOKIE" "$BASE/api/leads/$LEAD_ID" $ENV)
echo "$LEAD_NOW" | grep -q '"status":"qualified"' && ok "approved action took effect (lead → qualified)" || bad "lead status not updated: $LEAD_NOW"
RUN_NOW=$(curl -s -b "$COOKIE" "$BASE/api/agents/runs?limit=50" $ENV)
echo "$RUN_NOW" | grep -q "$RUN_ID" && ok "run visible in the run audit trail" || bad "run not in trail"
sleep 1
EV3=$(curl -s -b "$COOKIE" "$BASE/api/events?type=agent.action_approved&pageSize=10" $ENV)
echo "$EV3" | grep -q "agent.action_approved" && ok "agent.action_approved event emitted" || bad "approved event missing"

# ── 5. Rejection flow — reject the next 🟡 proposal ─────────────────────────
RUN2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$LEAD_AGENT/run" $ENV -H 'content-type: application/json' \
  -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD_ID\"}")
YEL2_ID=$(echo "$RUN2" | python -c "import json,sys; d=json.load(sys.stdin); print([a['id'] for a in d['actions'] if a['tool']=='update_record'][0])")
RUN2_ID=$(echo "$RUN2" | jget "['run']['id']")
REJ=$(curl -s -b "$MGRCOOKIE" -X POST "$BASE/api/agents/actions/$YEL2_ID/reject" $ENV)
echo "$REJ" | grep -q '"ok":true' && ok "manager rejected the 🟡 action" || bad "reject failed: $REJ"
DET=$(curl -s -b "$COOKIE" "$BASE/api/agents/$LEAD_AGENT" $ENV)
echo "$DET" | grep -q "\"id\":\"$RUN2_ID\"" && echo "$DET" | python -c "
import json,sys
d=json.load(sys.stdin)
run=[r for r in d['runs'] if r['id']=='$RUN2_ID'][0]
print('run2 status:', run['status'])
" | grep -q "rejected" && ok "run closed as rejected after reject" || bad "run2 not rejected: $(echo "$DET" | jget "['runs'][0]['status']")"
sleep 1
EV4=$(curl -s -b "$COOKIE" "$BASE/api/events?type=agent.action_rejected&pageSize=10" $ENV)
echo "$EV4" | grep -q "agent.action_rejected" && ok "agent.action_rejected event emitted" || bad "rejected event missing"

# ── 5b. Autonomous event-triggered run (engine subscriber) ───────────────────
# The seeded Lead Agent watches lead.created — creating a cold lead (score 5)
# must auto-run with just the green create_task (no notify, no yellow).
AUTO=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" $ENV -H 'content-type: application/json' \
  -d "{\"firstName\":\"Auto\",\"lastName\":\"Smoke$TS\",\"email\":\"autosmoke$TS@example.com\",\"score\":5}")
AUTO_ID=$(echo "$AUTO" | jget "['id']")
[ -n "$AUTO_ID" ] && ok "lead created to fire the agent engine" || bad "auto lead create failed: $AUTO"
sleep 2
TRIG=$(curl -s -b "$COOKIE" "$BASE/api/agents/runs?limit=30" $ENV)
echo "$TRIG" | grep -q "$AUTO_ID" && ok "agent engine auto-ran on lead.created (event-triggered run exists)" || bad "no event-triggered run for $AUTO_ID"
TSTATUS=$(echo "$TRIG" | python -c "
import json,sys
d=json.load(sys.stdin)
for r in d['items']:
    if r['entityId']=='$AUTO_ID' and r['trigger']=='event':
        print(r['status'], r['eventType'], r['riskSummary'].get('green')); break
")
echo "$TSTATUS" | grep -q "^executed lead.created 1$" && ok "auto-run executed with green:1 (cold lead → follow-up task only)" || bad "auto-run state wrong: $TSTATUS"
TASKFOUND2=$(curl -s -b "$COOKIE" "$BASE/api/tasks?pageSize=200" $ENV | grep -c "Follow up with lead Auto")
[ "$TASKFOUND2" -ge 1 ] && ok "auto-run created the follow-up task (green tool executed)" || bad "auto-run task missing"

# ── 6. Red-tier 🔴 — human required, admin-only approval ────────────────────
RED=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke Red $TS\",\"kind\":\"lead\",\"description\":\"phase9 smoke\",\"trigger\":{\"kind\":\"manual\"},\"rules\":[{\"field\":\"score\",\"op\":\"gte\",\"value\":70}],\"tools\":[\"create_task\",\"notify\",\"update_record\"],\"tierPolicy\":{\"update_record\":\"red\"},\"active\":true}")
RED_ID=$(echo "$RED" | jget "['agent']['id']")
[ -n "$RED_ID" ] && ok "custom agent created with 🔴 tierPolicy override" || bad "red agent create failed: $RED"
TEST=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$RED_ID/test" $ENV -H 'content-type: application/json' \
  -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD_ID\",\"name\":\"smoke red $TS\"}")
[ "$(echo "$TEST" | jget "['status']")" = "blocked" ] && ok "testing lab: red action → BLOCKED (not go-live safe)" || bad "test should be blocked: $TEST"
[ "$(echo "$TEST" | python -c "import json,sys; print(json.load(sys.stdin)['riskSummary']['red'])")" = "1" ] && ok "test riskSummary reports red:1" || bad "test risk summary wrong"
echo "$TEST" | grep -q '"predictedCost"' && ok "test predicts cost (no execution)" || bad "predictedCost missing"
RUNR=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$RED_ID/run" $ENV -H 'content-type: application/json' \
  -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD_ID\"}")
RED_ACT_ID=$(echo "$RUNR" | python -c "import json,sys; d=json.load(sys.stdin); print([a['id'] for a in d['actions'] if a['tool']=='update_record'][0])")
[ -n "$RED_ACT_ID" ] && ok "🔴 update_record proposed on live run" || bad "red action not proposed"
R400=$(curl -s -o /dev/null -w '%{http_code}' -b "$MGRCOOKIE" -X POST "$BASE/api/agents/actions/$RED_ACT_ID/approve" $ENV)
check "$R400" "400" "manager approving 🔴 red action → 400 (admin only)"
RADMIN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents/actions/$RED_ACT_ID/approve" $ENV)
[ "$(echo "$RADMIN" | jget "['action']['status']")" = "executed" ] && ok "admin approved 🔴 action → executed" || bad "admin approve failed: $RADMIN"
# Rules diagnostic
RULE_OK=$(curl -s -b "$COOKIE" "$BASE/api/agents/$RED_ID/rules?entity=lead&entityId=$LEAD_ID" $ENV)
echo "$RULE_OK" | grep -q '"matched":true' && ok "rules diagnostic: hot lead matches score>=70 rule" || bad "rules should match: $RULE_OK"
COLD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" $ENV -H 'content-type: application/json' \
  -d "{\"firstName\":\"Smoke\",\"lastName\":\"Cold$TS\",\"email\":\"smokecold$TS@example.com\",\"score\":30}")
COLD_ID=$(echo "$COLD" | jget "['id']")
RULE_NO=$(curl -s -b "$COOKIE" "$BASE/api/agents/$RED_ID/rules?entity=lead&entityId=$COLD_ID" $ENV)
echo "$RULE_NO" | grep -q '"matched":false' && ok "rules diagnostic: cold lead (score 30) does NOT match" || bad "rules should not match: $RULE_NO"

# ── 7. Testing / simulation lab — passed scenario ───────────────────────────
WON_DEAL=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?pageSize=100&stage=won" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
print(d['items'][0]['id'] if d['items'] else '')
")
if [ -n "$WON_DEAL" ]; then
  T2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$SALES_AGENT/test" $ENV -H 'content-type: application/json' \
    -d "{\"entity\":\"opportunity\",\"entityId\":\"$WON_DEAL\",\"name\":\"smoke sales $TS\"}")
  [ "$(echo "$T2" | jget "['status']")" = "passed" ] && ok "Sales Agent test on won deal → PASSED (all green)" || bad "sales test not passed: $T2"
  echo "$T2" | grep -q "executable under governance" && ok "test explains the passed verdict" || bad "test note missing: $T2"
  HIST=$(curl -s -b "$COOKIE" "$BASE/api/agents/$SALES_AGENT/tests" $ENV)
  [ "$(echo "$HIST" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" -ge 1 ] && ok "test history persisted (AgentTest rows)" || bad "test history missing"
else
  bad "no won deal for sales test"
fi

# ── 8. Analytics + cost metering ────────────────────────────────────────────
AN=$(curl -s -b "$COOKIE" "$BASE/api/agents/analytics" $ENV)
[ "$(echo "$AN" | python -c "import json,sys; print(json.load(sys.stdin)['totals']['runs'])")" -ge 3 ] && ok "analytics: total runs ≥ 3 (seed demo + smoke runs)" || bad "analytics runs wrong: $AN"
echo "$AN" | grep -q '"escalationRate"' && ok "analytics: per-agent escalation rate present" || bad "escalation rate missing"
MET=$(curl -s -b "$COOKIE" "$BASE/api/agents/metering" $ENV)
echo "$MET" | grep -q '"total"' && echo "$MET" | grep -q '"byEntity"' && ok "cost metering: totals + per-entity breakdown" || bad "metering wrong: $MET"
[ "$(echo "$MET" | python -c "import json,sys; print(len(json.load(sys.stdin)['agents']))")" -ge 4 ] && ok "metering: all agents metered" || bad "metering agents missing"

# ── 9. Agent memory ─────────────────────────────────────────────────────────
echo "$DET" | grep -q "last.decision" && ok "agent memory written (last.decision per entity)" || bad "agent memory missing"
MEMV=$(echo "$DET" | python -c "
import json,sys
d=json.load(sys.stdin)
m=[x for x in d['memory'] if x['key']=='last.decision']
print(m[0]['value'].get('reasoning','') if m else '')
")
[ -n "$MEMV" ] && ok "memory holds the decision reasoning" || bad "memory value empty"

# ── 10. Kill switches — per-agent then org-wide ─────────────────────────────
curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$RED_ID/kill" $ENV -H 'content-type: application/json' -d '{"on":true}' > /dev/null
SKIP=$(curl -s -o /tmp/q9-skip.json -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/agents/$RED_ID/run" $ENV -H 'content-type: application/json' -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD_ID\"}")
check "$SKIP" "400" "per-agent kill switch: run rejected 400 (nothing executes)"
grep -q "kill-switched" /tmp/q9-skip.json && ok "per-agent kill error explains the freeze" || bad "per-agent kill error unclear: $(cat /tmp/q9-skip.json)"
curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$RED_ID/kill" $ENV -H 'content-type: application/json' -d '{"on":false}' > /dev/null
ok "per-agent kill switch released"
curl -s -b "$COOKIE" -X POST "$BASE/api/agents/kill-switch" $ENV -H 'content-type: application/json' -d '{"on":true}' > /dev/null
AG2=$(curl -s -b "$COOKIE" "$BASE/api/agents" $ENV)
echo "$AG2" | grep -q '"orgKillSwitched":true' && ok "org-wide kill switch engaged (reported by list)" || bad "org kill not reported"
SKIP2=$(curl -s -o /tmp/q9-skip2.json -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/agents/$LEAD_AGENT/run" $ENV -H 'content-type: application/json' -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD_ID\"}")
check "$SKIP2" "400" "org kill switch freezes every agent run (400)"
grep -q "kill-switched" /tmp/q9-skip2.json && ok "org kill error explains the freeze" || bad "org kill error unclear: $(cat /tmp/q9-skip2.json)"
sleep 1
EVK=$(curl -s -b "$COOKIE" "$BASE/api/events?type=agent.killed&pageSize=10" $ENV)
echo "$EVK" | grep -q "agent.killed" && ok "agent.killed event emitted (scope org)" || bad "agent.killed event missing"
curl -s -b "$COOKIE" -X POST "$BASE/api/agents/kill-switch" $ENV -H 'content-type: application/json' -d '{"on":false}' > /dev/null
AG3=$(curl -s -b "$COOKIE" "$BASE/api/agents" $ENV)
echo "$AG3" | grep -q '"orgKillSwitched":false' && ok "org kill switch released (agents live again)" || bad "org kill not released"

# ── 11. Feature gate ────────────────────────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ai.agents" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/agents" $ENV)
check "$FG" "403" "ai.agents disabled → agents API 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ai.agents" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/agents" $ENV)
check "$FG2" "200" "ai.agents re-enabled → agents API 200"

# ── 12. Sandbox isolation ───────────────────────────────────────────────────
SB0=$(curl -s -b "$COOKIE" "$BASE/api/agents" $SBENV)
[ "$(echo "$SB0" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" = "0" ] && ok "sandbox starts with no agents (fresh env)" || bad "sandbox not clean"
SBA=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents" $SBENV -H 'content-type: application/json' \
  -d "{\"name\":\"Sandbox Agent $TS\",\"kind\":\"lead\",\"trigger\":{\"kind\":\"manual\"},\"tools\":[\"create_task\",\"notify\"],\"active\":true}")
SBA_ID=$(echo "$SBA" | jget "['agent']['id']")
[ -n "$SBA_ID" ] && ok "agent created in sandbox env" || bad "sandbox agent create failed: $SBA"
SBL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" $SBENV -H 'content-type: application/json' \
  -d "{\"firstName\":\"Sandbox\",\"lastName\":\"Smoke$TS\",\"email\":\"sbsmoke$TS@example.com\",\"score\":95}")
SBL_ID=$(echo "$SBL" | jget "['id']")
SB_RUN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/agents/$SBA_ID/run" $SBENV -H 'content-type: application/json' \
  -d "{\"entity\":\"lead\",\"entityId\":\"$SBL_ID\"}")
[ "$(echo "$SB_RUN" | jget "['status']")" = "executed" ] && ok "sandbox agent run executed (green-only tools)" || bad "sandbox run failed: $SB_RUN"
PROD_AG=$(curl -s -b "$COOKIE" "$BASE/api/agents" $ENV)
echo "$PROD_AG" | grep -q "Sandbox Agent" && bad "sandbox agent leaked into production list" || ok "sandbox agent invisible in production"
SB_TASKS=$(curl -s -b "$COOKIE" "$BASE/api/tasks?pageSize=100" $SBENV)
echo "$SB_TASKS" | grep -q "Follow up with hot lead Sandbox" && ok "sandbox run created a sandbox-scoped task" || bad "sandbox task missing"
PROD_TASKS=$(curl -s -b "$COOKIE" "$BASE/api/tasks?pageSize=100" $ENV)
echo "$PROD_TASKS" | grep -q "Follow up with hot lead Sandbox" && bad "sandbox task leaked into production" || ok "sandbox side-effects isolated from production"

# ── 13. Cleanup (leave demo data pristine) ──────────────────────────────────
curl -s -b "$COOKIE" -X DELETE "$BASE/api/agents/$RED_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/agents/$SBA_ID" $SBENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/leads/$LEAD_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/leads/$COLD_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/leads/$AUTO_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/leads/$SBL_ID" $SBENV > /dev/null
PROD_AG2=$(curl -s -b "$COOKIE" "$BASE/api/agents" $ENV)
echo "$PROD_AG2" | grep -q "Smoke Red" && bad "smoke agent left behind" || ok "smoke agents cleaned up"

summary "PHASE 9"
