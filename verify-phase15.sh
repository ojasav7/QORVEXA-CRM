#!/usr/bin/env bash
# Phase 15 Differentiators live smoke suite — run against localhost:8787 with a
# freshly booted + seeded stack (clean DB → seed → start server). Covers the
# Business Brain scan (insights + insight.generated + ack lifecycle), Deal
# X-Ray + AI Deal Detective, the Opportunity Radar early-warning feed
# (opportunity.detected / risk.detected), organizational memory (manual +
# event-bus learning + forget), multi-agent orchestration (create/test/run +
# agent.delegated), the CRM Time Machine (audit reconstruction as-of,
# compare, snapshots + snapshot.created + retention pruning), the What-If
# simulator (5 models + simulation.completed + validation), AI-built
# generators (field/workflow/agent/report), Universal Business Query
# (aggregations with intent), the voice/computer-use console (risk tiers),
# RBAC, per-area feature gates, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q15-admin.txt
REPCOOKIE=/tmp/q15-rep.txt
source "$(dirname "$0")/lib/test-helpers.sh"
login "/tmp/q15-admin.txt"

curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)
ENV='-H x-environment:production'
python - <<'EOF' > /tmp/q15-helpers.txt
import json
EOF

# ── 1. Seeds & overview ────────────────────────────────────────────────────
OV=$(curl -s -b "$COOKIE" "$BASE/api/brain/overview" $ENV)
echo "$OV" | grep -q '"memory":1' && ok "overview: 1 seeded org-memory entry" || bad "overview memory wrong: $OV"
echo "$OV" | grep -q '"orchestrators":1' && ok "overview: 1 seeded orchestrator" || bad "overview orchestrators wrong: $OV"
echo "$OV" | grep -q '"snapshots":1' && ok "overview: 1 seeded time-machine snapshot" || bad "overview snapshots wrong: $OV"
echo "$OV" | grep -q '"retentionDays":90' && ok "overview: 90-day snapshot retention" || bad "retentionDays wrong: $OV"
MEM=$(curl -s -b "$COOKIE" "$BASE/api/brain/memory" $ENV)
echo "$MEM" | grep -q "Prefers email as the primary channel" && ok "memory: seeded fact present" || bad "seeded memory missing: $MEM"
ORCH=$(curl -s -b "$COOKIE" "$BASE/api/brain/orchestrators" $ENV)
echo "$ORCH" | grep -q "Lead intake → qualification" && ok "orchestrators: seeded orchestrator present" || bad "seeded orchestrator missing: $ORCH"
SNAP=$(curl -s -b "$COOKIE" "$BASE/api/brain/timemachine/snapshots" $ENV)
echo "$SNAP" | grep -q '"scope":"record"' && ok "timemachine: seeded record snapshot" || bad "seeded snapshot missing: $SNAP"

# ── 2. RBAC ────────────────────────────────────────────────────────────────
R1=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/brain/overview" $ENV)
check "$R1" "200" "rbac: rep can read overview"
R2=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/brain/insights" $ENV)
check "$R2" "200" "rbac: rep can read insights"
R3=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/brain/ubq?q=how+many+contacts" $ENV)
check "$R3" "200" "rbac: rep can ask UBQ"
R4=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/brain/refresh" $ENV)
check "$R4" "403" "rbac: rep cannot run brain scan"
R5=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/brain/radar/scan" $ENV)
check "$R5" "403" "rbac: rep cannot run radar scan"
R6=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/brain/orchestrators" $ENV -H 'content-type: application/json' -d '{"name":"x","trigger":{"kind":"manual"},"childAgentIds":["x"],"mode":"sequential"}')
check "$R6" "403" "rbac: rep cannot create orchestrators"
R7=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/brain/simulate" $ENV -H 'content-type: application/json' -d '{"name":"x","scenario":"pricing","params":{}}')
check "$R7" "403" "rbac: rep cannot run simulations"
R8=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/brain/builder" $ENV -H 'content-type: application/json' -d '{"prompt":"add a field"}')
check "$R8" "403" "rbac: rep cannot build"
R9=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/brain/timemachine/snapshot" $ENV -H 'content-type: application/json' -d '{"scope":"full"}')
check "$R9" "403" "rbac: rep cannot snapshot"
M1=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/brain/memory" $ENV -H 'content-type: application/json' -d "{\"scope\":\"org\",\"kind\":\"fact\",\"content\":\"rep can record $TS\"}")
check "$M1" "201" "rbac: rep can record memory (collaborative)"

# ── 3. Business Brain scan ──────────────────────────────────────────────────
SCAN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/refresh" $ENV)
SCREATED=$(echo "$SCAN" | jget "['created']")
STOTAL=$(echo "$SCAN" | jget "['total']")
python -c "import sys; sys.exit(0 if $SCREATED >= 1 else 1)" && ok "brain: scan created $SCREATED new insight(s)" || bad "brain: scan created 0 insights: $SCAN"
python -c "import sys; sys.exit(0 if $STOTAL >= 3 else 1)" && ok "brain: insight ledger has $STOTAL total" || bad "brain: too few total insights: $SCAN"
INS=$(curl -s -b "$COOKIE" "$BASE/api/brain/insights" $ENV)
echo "$INS" | python -c "import json,sys; d=json.load(sys.stdin); items=d.get('items',[]); sys.exit(0 if len(items)>=2 else 1)" && ok "brain: insights list returns items" || bad "brain: insights list empty"
EVT=$(curl -s -b "$COOKIE" "$BASE/api/events?type=insight.generated&pageSize=100" $ENV)
echo "$EVT" | grep -q "insight.generated" && ok "brain: insight.generated events persisted" || bad "insight.generated events missing"
IID=$(echo "$INS" | jget "['items'][0]['id']")
ACK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/insights/$IID/acknowledge" $ENV)
echo "$ACK" | grep -q '"status":"acknowledged"' && ok "brain: insight acknowledge lifecycle" || bad "ack failed: $ACK"
DISMISS=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/brain/insights/$IID/dismiss" $ENV)
check "$DISMISS" "200" "brain: insight dismiss lifecycle"

# ── 4. Deal X-Ray ───────────────────────────────────────────────────────────
DEALS=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?limit=50" $ENV)
DEAL=$(echo "$DEALS" | python -c "import json,sys; d=json.load(sys.stdin); print(next(x['id'] for x in d['items'] if 'Northwind' in x['name'] and 'Retail' in x['name']))")
XR=$(curl -s -b "$COOKIE" "$BASE/api/brain/xray/$DEAL" $ENV)
XSCORE=$(echo "$XR" | jget "['score']")
python -c "import sys; sys.exit(0 if 0 <= $XSCORE <= 100 else 1)" && ok "xray: score in range ($XSCORE)" || bad "xray: score out of range: $XR"
echo "$XR" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['factors'])==5 else 1)" && ok "xray: 5 explained factors" || bad "xray: factors wrong"
echo "$XR" | grep -q '"recommendation"' && ok "xray: recommendation present" || bad "xray: no recommendation"

# ── 5. AI Deal Detective ────────────────────────────────────────────────────
LOST=$(echo "$DEALS" | python -c "import json,sys; d=json.load(sys.stdin); print(next(x['id'] for x in d['items'] if 'Globex' in x['name'] and 'Pilot' in x['name']))")
DET=$(curl -s -b "$COOKIE" "$BASE/api/brain/detective/$LOST" $ENV)
echo "$DET" | grep -q '"verdict":"lost"' && ok "detective: lost deal verdict" || bad "detective verdict wrong: $DET"
echo "$DET" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['factors'])>=1 else 1)" && ok "detective: root-cause factors" || bad "detective: no factors"
echo "$DET" | grep -q '"timeline"' && ok "detective: event timeline present" || bad "detective: no timeline"
WON=$(echo "$DEALS" | python -c "import json,sys; d=json.load(sys.stdin); print(next(x['id'] for x in d['items'] if 'Support Add-on' in x['name']))")
DETW=$(curl -s -b "$COOKIE" "$BASE/api/brain/detective/$WON" $ENV)
echo "$DETW" | grep -q '"verdict":"won"' && ok "detective: won deal verdict" || bad "detective won verdict wrong: $DETW"

# ── 5b. Relationship Graph v2 (buying-committee mapping) ────────────────────
GV=$(curl -s -b "$COOKIE" "$BASE/api/brain/graph?dealId=$DEAL" $ENV)
echo "$GV" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['committee'])>=1 and 0 <= d['coverage'] <= 100 and isinstance(d['gaps'], list) and len(d['gaps'])>=1 else 1)" && ok "graph v2: deal committee + coverage + missing-role gaps" || bad "graph v2 deal wrong: $GV"
echo "$GV" | grep -q '"role"' && ok "graph v2: derived member roles (champion / buyer / blocker …)" || bad "graph v2 roles missing: $GV"
GV2=$(curl -s -b "$COOKIE" "$BASE/api/brain/graph?accountId=$(echo "$DEALS" | python -c "import json,sys; d=json.load(sys.stdin); print(next(x['accountId'] for x in d['items'] if 'Northwind' in x['name'] and 'Retail' in x['name']))")" $ENV)
echo "$GV2" | grep -q '"contacts"' && ok "graph v2: account-level committee" || bad "graph v2 account wrong: $GV2"

# ── 6. Opportunity Radar ────────────────────────────────────────────────────
NEWDEAL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/opportunities" $ENV -H 'content-type: application/json' -d "{\"name\":\"Radar Test $TS\",\"stage\":\"qualified\",\"amount\":1000}")
NDID=$(echo "$NEWDEAL" | jget "['id']")
RSCAN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/radar/scan" $ENV)
REMIT=$(echo "$RSCAN" | jget "['emitted']")
python -c "import sys; sys.exit(0 if $REMIT >= 1 else 1)" && ok "radar: scan emitted $REMIT signal event(s)" || bad "radar: no signals emitted: $RSCAN"
echo "$RSCAN" | grep -q "weak_deal" && ok "radar: weak-deal signal for fresh deal" || bad "radar: weak_deal missing: $RSCAN"
RFEED=$(curl -s -b "$COOKIE" "$BASE/api/brain/radar" $ENV)
echo "$RFEED" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['signals'])>=1 else 1)" && ok "radar: feed non-empty" || bad "radar: feed empty"
EVT2=$(curl -s -b "$COOKIE" "$BASE/api/events?type=risk.detected&pageSize=100" $ENV)
echo "$EVT2" | grep -q "risk.detected" && ok "radar: risk.detected events persisted" || bad "risk.detected events missing"

# ── 7. Organizational memory ────────────────────────────────────────────────
RMEM=$(curl -s -b "$REPCOOKIE" -X POST "$BASE/api/brain/memory" $ENV -H 'content-type: application/json' -d "{\"scope\":\"contact\",\"kind\":\"fact\",\"content\":\"Test memory $TS\"}")
echo "$RMEM" | grep -q '"created":true' && ok "memory: manual entry recorded" || bad "memory record failed: $RMEM"
MEM2=$(curl -s -b "$COOKIE" "$BASE/api/brain/memory" $ENV)
echo "$MEM2" | grep -q "Test memory $TS" && ok "memory: entry listed" || bad "memory entry not listed"
# Event-bus learning: move a deal to won → the memory engine learns a fact.
curl -s -b "$COOKIE" -X PATCH "$BASE/api/opportunities/$NDID" $ENV -H 'content-type: application/json' -d '{"stage":"won"}' > /dev/null
sleep 1
MEM3=$(curl -s -b "$COOKIE" "$BASE/api/brain/memory?scope=opportunity&scopeId=$NDID" $ENV)
echo "$MEM3" | grep -q "Won on" && ok "memory: learned 'Won on …' from deal.stage_changed" || bad "memory learning failed: $MEM3"
MID=$(echo "$RMEM" | jget "['row']['id']")
RDEL=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/brain/memory/$MID" $ENV)
check "$RDEL" "200" "memory: forget entry"
MEM4=$(curl -s -b "$COOKIE" "$BASE/api/brain/memory" $ENV)
echo "$MEM4" | grep -q "Test memory $TS" && bad "memory: entry still listed after forget" || ok "memory: entry gone after forget"

# ── 8. Multi-agent orchestration ────────────────────────────────────────────
AGENTS=$(curl -s -b "$COOKIE" "$BASE/api/agents" $ENV)
LEAD=$(echo "$AGENTS" | python -c "import json,sys; d=json.load(sys.stdin); print(next(a['id'] for a in d['items'] if a['kind']=='lead'))")
LEADS=$(curl -s -b "$COOKIE" "$BASE/api/leads?limit=5" $ENV)
LEADID=$(echo "$LEADS" | jget "['items'][0]['id']")
ORCH=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/orchestrators" $ENV -H 'content-type: application/json' -d "{\"name\":\"Verify orch $TS\",\"trigger\":{\"kind\":\"event\",\"event\":\"lead.created\"},\"childAgentIds\":[\"$LEAD\"],\"mode\":\"sequential\"}")
OID=$(echo "$ORCH" | jget "['id']")
[ -n "$OID" ] && ok "orchestration: orchestrator created" || bad "orchestrator create failed: $ORCH"
TEST=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/orchestrators/$OID/test" $ENV -H 'content-type: application/json' -d "{\"entity\":\"lead\",\"entityId\":\"$LEADID\"}")
echo "$TEST" | grep -q "wouldRun" && ok "orchestration: dry-run test lists children" || bad "orchestrator test failed: $TEST"
RUN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/orchestrators/$OID/run" $ENV -H 'content-type: application/json' -d "{\"entity\":\"lead\",\"entityId\":\"$LEADID\"}")
echo "$RUN" | grep -q '"failed":0' && ok "orchestration: run delegated to child agent" || bad "orchestrator run failed: $RUN"
ORCH2=$(curl -s -b "$COOKIE" "$BASE/api/brain/orchestrators" $ENV)
echo "$ORCH2" | grep -q '"runCount":1' && ok "orchestration: runCount incremented" || bad "runCount not incremented: $ORCH2"
DELEG=$(curl -s -b "$COOKIE" "$BASE/api/brain/orchestrators/$OID/delegations" $ENV)
echo "$DELEG" | grep -q '"status":"delegated"' && ok "orchestration: delegation row recorded" || bad "delegations missing: $DELEG"
EVT3=$(curl -s -b "$COOKIE" "$BASE/api/events?type=agent.delegated&pageSize=100" $ENV)
echo "$EVT3" | grep -q "agent.delegated" && ok "orchestration: agent.delegated events persisted" || bad "agent.delegated events missing"

# ── 9. CRM Time Machine ─────────────────────────────────────────────────────
T0=$(date +%s)
TM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/opportunities" $ENV -H 'content-type: application/json' -d "{\"name\":\"TM $TS\",\"stage\":\"qualified\",\"amount\":5000}")
TMID=$(echo "$TM" | jget "['id']")
sleep 2
curl -s -b "$COOKIE" -X PATCH "$BASE/api/opportunities/$TMID" $ENV -H 'content-type: application/json' -d '{"stage":"negotiation"}' > /dev/null
ASOF=$(python -c "import datetime; print(datetime.datetime.utcfromtimestamp($T0+1).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
RECON=$(curl -s -b "$COOKIE" "$BASE/api/brain/timemachine/reconstruct?entity=opportunity&id=$TMID&asOf=$ASOF" $ENV)
echo "$RECON" | grep -q '"stage":"qualified"' && ok "timemachine: reconstructed past state (qualified)" || bad "reconstruct as-of wrong: $RECON"
ASOF2=$(python -c "import datetime; print((datetime.datetime.now(datetime.UTC)+datetime.timedelta(seconds=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
RECON2=$(curl -s -b "$COOKIE" "$BASE/api/brain/timemachine/reconstruct?entity=opportunity&id=$TMID&asOf=$ASOF2" $ENV)
echo "$RECON2" | grep -q '"stage":"negotiation"' && ok "timemachine: current state is the new stage" || bad "reconstruct now wrong"
FROM=$(python -c "import datetime; print(datetime.datetime.utcfromtimestamp($T0+1).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
CMP=$(curl -s -b "$COOKIE" "$BASE/api/brain/timemachine/compare?entity=opportunity&id=$TMID&from=$FROM&to=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" $ENV)
echo "$CMP" | grep -q '"stage"' && ok "timemachine: compare diffs the stage change" || bad "compare wrong: $CMP"
S1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/timemachine/snapshot" $ENV -H 'content-type: application/json' -d "{\"scope\":\"record\",\"entity\":\"opportunity\",\"entityId\":\"$TMID\"}")
echo "$S1" | grep -q '"scope":"record"' && ok "timemachine: record snapshot captured" || bad "record snapshot failed: $S1"
S2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/timemachine/snapshot" $ENV -H 'content-type: application/json' -d '{"scope":"full"}')
echo "$S2" | grep -q '"scope":"full"' && ok "timemachine: full-org snapshot captured" || bad "full snapshot failed: $S2"
EVT4=$(curl -s -b "$COOKIE" "$BASE/api/events?type=snapshot.created&pageSize=100" $ENV)
echo "$EVT4" | grep -q "snapshot.created" && ok "timemachine: snapshot.created events persisted" || bad "snapshot.created events missing"
SNAP2=$(curl -s -b "$COOKIE" "$BASE/api/brain/timemachine/snapshots" $ENV)
echo "$SNAP2" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['items'])>=3 else 1)" && ok "timemachine: snapshot list grew" || bad "snapshot list too small"
# Retention pruning: expire the oldest snapshot, capture another → pruned ≥ 1.
npx tsx server/scripts/q15-backdate.ts --expire-snapshot > /dev/null 2>&1
S3=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/timemachine/snapshot" $ENV -H 'content-type: application/json' -d '{"scope":"full"}')
PRUNED=$(echo "$S3" | jget "['pruned']")
python -c "import sys; sys.exit(0 if $PRUNED >= 1 else 1)" && ok "timemachine: retention pruned $PRUNED expired snapshot(s)" || bad "retention pruning failed: $S3"

# ── 10. What-If simulator ───────────────────────────────────────────────────
MODELS=$(curl -s -b "$COOKIE" "$BASE/api/brain/simulate/models" $ENV)
echo "$MODELS" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['models'])==5 else 1)" && ok "simulator: 5 scenario models catalogued" || bad "models wrong"
SIM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/simulate" $ENV -H 'content-type: application/json' -d "{\"name\":\"pricing $TS\",\"scenario\":\"pricing\",\"params\":{\"priceChangePct\":10}}")
echo "$SIM" | grep -q '"status":"completed"' && ok "simulator: pricing run completed" || bad "pricing failed: $SIM"
echo "$SIM" | python -c "
import json,sys
d=json.load(sys.stdin)
m=d['metrics']
sys.exit(0 if m['afterWeighted']==round(m['beforeWeighted']*1.1) else 1)" && ok "simulator: +10% pricing math correct" || bad "pricing math wrong"
CHURN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/simulate" $ENV -H 'content-type: application/json' -d "{\"name\":\"churn $TS\",\"scenario\":\"churn\",\"params\":{\"churnRatePct\":2,\"months\":12}}")
echo "$CHURN" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['metrics']['projected'])==12 else 1)" && ok "simulator: churn projects 12 months of MRR" || bad "churn projection wrong"
BADSIM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/simulate" $ENV -H 'content-type: application/json' -d "{\"name\":\"bad $TS\",\"scenario\":\"pricing\",\"params\":{\"priceChangePct\":200}}")
echo "$BADSIM" | grep -q '"status":"failed"' && ok "simulator: out-of-range params → failed run recorded" || bad "invalid params not failed: $BADSIM"
SIMH=$(curl -s -b "$COOKIE" "$BASE/api/brain/simulations" $ENV)
echo "$SIMH" | grep -q "pricing $TS" && ok "simulator: run history persisted" || bad "history missing"
EVT5=$(curl -s -b "$COOKIE" "$BASE/api/events?type=simulation.completed&pageSize=100" $ENV)
echo "$EVT5" | grep -q "simulation.completed" && ok "simulator: simulation.completed events persisted" || bad "simulation.completed events missing"

# ── 11. AI-built generators ─────────────────────────────────────────────────
BF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/builder" $ENV -H 'content-type: application/json' -d '{"prompt":"Add a number field called priority score to deals"}')
echo "$BF" | grep -q '"entityType":"field"' && ok "builder: field built from prompt" || bad "field build failed: $BF"
BFDUP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/brain/builder" $ENV -H 'content-type: application/json' -d '{"prompt":"Add a number field called priority score to deals"}')
check "$BFDUP" "400" "builder: duplicate field → 400"
BW=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/builder" $ENV -H 'content-type: application/json' -d '{"prompt":"When a deal is won, notify the owner and create a task"}')
echo "$BW" | grep -q '"entityType":"workflow"' && ok "builder: workflow built from prompt" || bad "workflow build failed: $BW"
BA=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/builder" $ENV -H 'content-type: application/json' -d '{"prompt":"Create an agent that follows up on cold leads by creating a task and notifying the owner"}')
echo "$BA" | grep -q '"entityType":"agent"' && ok "builder: agent built from prompt" || bad "agent build failed: $BA"
BR=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/builder" $ENV -H 'content-type: application/json' -d '{"prompt":"Build a sales report for won deals this quarter"}')
echo "$BR" | grep -q '"entityType":"report"' && ok "builder: report built from prompt" || bad "report build failed: $BR"
BC=$(curl -s -b "$COOKIE" "$BASE/api/brain/builder/catalog" $ENV)
echo "$BC" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['items'])==4 else 1)" && ok "builder: 4-target catalog" || bad "builder catalog wrong"
EVT6=$(curl -s -b "$COOKIE" "$BASE/api/events?type=builder.generated&pageSize=100" $ENV)
echo "$EVT6" | grep -q "builder.generated" && ok "builder: builder.generated events persisted" || bad "builder.generated events missing"

# ── 12. Universal Business Query ────────────────────────────────────────────
U1=$(curl -s -b "$COOKIE" "$BASE/api/brain/ubq?q=total%20pipeline%20by%20owner" $ENV)
echo "$U1" | grep -q '"metric":"sum"' && echo "$U1" | grep -q '"dimension":"owner"' && ok "ubq: 'total pipeline by owner' parsed (sum, by owner)" || bad "ubq parse wrong: $U1"
echo "$U1" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['data'])>=1 else 1)" && ok "ubq: owner rows returned" || bad "ubq no rows"
U2=$(curl -s -b "$COOKIE" "$BASE/api/brain/ubq?q=won%20deals%20this%20quarter" $ENV)
echo "$U2" | grep -q '"stage":"won"' && ok "ubq: 'won deals this quarter' filters stage" || bad "ubq won filter wrong: $U2"
U3=$(curl -s -b "$COOKIE" "$BASE/api/brain/ubq?q=top%205%20accounts%20by%20MRR" $ENV)
echo "$U3" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['data'])<=5 else 1)" && ok "ubq: 'top 5 accounts by MRR' limited to 5" || bad "ubq top5 wrong"
U4=$(curl -s -b "$COOKIE" "$BASE/api/brain/ubq?q=how%20many%20contacts" $ENV)
echo "$U4" | grep -q '"entity":"contact"' && echo "$U4" | grep -q '"metric":"count"' && ok "ubq: 'how many contacts' counted" || bad "ubq count wrong: $U4"
U5=$(curl -s -b "$COOKIE" "$BASE/api/brain/ubq?q=average%20deal%20size" $ENV)
echo "$U5" | grep -q '"metric":"avg"' && ok "ubq: 'average deal size' → avg metric" || bad "ubq avg wrong: $U5"

# ── 13. Voice & computer-use console ────────────────────────────────────────
C1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/command" $ENV -H 'content-type: application/json' -d "{\"text\":\"create a task for the Northwind deal to send the proposal\"}")
echo "$C1" | grep -q '"intent":"create_task"' && echo "$C1" | grep -q '"executed":true' && ok "console: 🟢 create_task executed" || bad "console create_task failed: $C1"
C2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/command" $ENV -H 'content-type: application/json' -d '{"text":"total pipeline by owner"}')
echo "$C2" | grep -q '"intent":"query"' && echo "$C2" | grep -q '"executed":true' && ok "console: 🟢 query routed to UBQ" || bad "console query failed: $C2"
C3=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/command" $ENV -H 'content-type: application/json' -d '{"text":"draft an email to Sarah about the proposal"}')
echo "$C3" | grep -q '"tier":"yellow"' && echo "$C3" | grep -q '"executed":false' && ok "console: 🟡 draft proposed, never sent" || bad "console draft failed: $C3"
C4=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/command" $ENV -H 'content-type: application/json' -d '{"text":"delete the Acme account"}')
echo "$C4" | grep -q '"tier":"red"' && echo "$C4" | grep -q '"executed":false' && ok "console: 🔴 delete refused" || bad "console delete not refused: $C4"
C5=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/command" $ENV -H 'content-type: application/json' -d '{"text":"go to the pipeline board"}')
echo "$C5" | grep -q '"route":"/deals"' && ok "console: 🟢 navigate to pipeline" || bad "console navigate failed: $C5"
C6=$(curl -s -b "$COOKIE" -X POST "$BASE/api/brain/command" $ENV -H 'content-type: application/json' -d "{\"action\":{\"element\":\"new-task\",\"action\":\"click\",\"params\":{\"title\":\"Voice task $TS\"}}}")
echo "$C6" | grep -q '"intent":"create_task"' && echo "$C6" | grep -q '"executed":true' && ok "console: computer-use agent executed a UI action" || bad "computer-use action failed: $C6"
CC=$(curl -s -b "$COOKIE" "$BASE/api/brain/command/catalog" $ENV)
echo "$CC" | python -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d['items'])>=7 else 1)" && ok "console: intent catalog" || bad "command catalog wrong"

# ── 14. Feature gates + sandbox isolation ───────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/diff.ubq" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
G1=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/brain/ubq?q=how+many+contacts" $ENV)
check "$G1" "403" "feature gate: diff.ubq off → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/diff.ubq" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
G2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/brain/ubq?q=how+many+contacts" $ENV)
check "$G2" "200" "feature gate: diff.ubq re-enabled → 200"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/diff.brain" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
G3=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/brain/insights" $ENV)
check "$G3" "403" "feature gate: diff.brain off → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/diff.brain" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
# Sandbox unaffected by a production-only override.
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/diff.timemachine" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
G4=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/brain/timemachine/snapshots" $ENV)
check "$G4" "403" "sandbox test: production timemachine off → production 403"
G5=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'x-environment:sandbox' "$BASE/api/brain/timemachine/snapshots")
check "$G5" "200" "sandbox test: sandbox unaffected by production override"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/diff.timemachine" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null

echo
echo "── Phase 15 verify: $PASS passed, $FAIL failed ──"

summary "PHASE 15"
