#!/usr/bin/env bash
# Phase 2-lite multi-pipeline live smoke suite — run against localhost:8787.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q2-cookie.txt
source "$(dirname "$0")/lib/test-helpers.sh"

login "$COOKIE"

# ── 1. Pipeline listing (seeded Sales + Renewals) ────────────────────────────
PIPES=$(curl -s -b "$COOKIE" "$BASE/api/pipelines")
SALES_ID=$(echo "$PIPES" | python -c "
import json,sys
d=json.load(sys.stdin)
s=[i for i in d['items'] if i['isDefault']]
print(s[0]['id'] if s else '')
")
RENEW_ID=$(echo "$PIPES" | python -c "
import json,sys
d=json.load(sys.stdin)
r=[i for i in d['items'] if i['name']=='Renewals']
print(r[0]['id'] if r else '')
")
echo "$PIPES" | grep -q '"dealCount"' && ok "pipelines listed with dealCount" || bad "no dealCount: $PIPES"
[ -n "$SALES_ID" ] && ok "default Sales pipeline exists" || bad "no default pipeline"
[ -n "$RENEW_ID" ] && ok "Renewals pipeline exists" || bad "no Renewals pipeline"

# ── 2. Deal creation: no pipeline → default Sales; explicit → Renewals ───────
TS=$(date +%s)
D1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/opportunities" -H 'content-type: application/json' \
  -d "{\"name\":\"Pipe Smoke $TS\",\"amount\":50000,\"stage\":\"proposal\"}")
D1PIPE=$(echo "$D1" | python -c "import json,sys; print(json.load(sys.stdin).get('pipelineId',''))")
check "$D1PIPE" "$SALES_ID" "no pipelineId → routed to default Sales"
D1PROB=$(echo "$D1" | python -c "import json,sys; print(json.load(sys.stdin).get('probability',''))")
check "$D1PROB" "50" "probability derived from Sales proposal (50)"
D1STAGE=$(echo "$D1" | python -c "import json,sys; print(json.load(sys.stdin).get('stage',''))")
check "$D1STAGE" "proposal" "explicit stage kept"

D2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/opportunities" -H 'content-type: application/json' \
  -d "{\"name\":\"Renew Smoke $TS\",\"amount\":30000,\"pipelineId\":\"$RENEW_ID\",\"stage\":\"negotiation\"}")
D2PIPE=$(echo "$D2" | python -c "import json,sys; print(json.load(sys.stdin).get('pipelineId',''))")
check "$D2PIPE" "$RENEW_ID" "explicit pipelineId honored"
D2PROB=$(echo "$D2" | python -c "import json,sys; print(json.load(sys.stdin).get('probability',''))")
check "$D2PROB" "75" "probability from Renewals negotiation (75)"

# create with no stage on a pipeline without 'qualified' → first stage
D3=$(curl -s -b "$COOKIE" -X POST "$BASE/api/opportunities" -H 'content-type: application/json' \
  -d "{\"name\":\"Renew NoStage $TS\",\"amount\":10000,\"pipelineId\":\"$RENEW_ID\"}")
D3STAGE=$(echo "$D3" | python -c "import json,sys; print(json.load(sys.stdin).get('stage',''))")
check "$D3STAGE" "renewal_due" "no stage → first Renewals stage (renewal_due)"

# ── 3. Validation: unknown stage → 400 ──────────────────────────────────────
S400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/opportunities" -H 'content-type: application/json' \
  -d "{\"name\":\"Bad $TS\",\"pipelineId\":\"$SALES_ID\",\"stage\":\"not_a_stage\"}")
check "$S400" "400" "unknown stage for pipeline → 400"
P400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/opportunities" -H 'content-type: application/json' \
  -d "{\"name\":\"BadPipe $TS\",\"pipelineId\":\"000000000000000000000000\"}")
check "$P400" "400" "nonexistent pipelineId → 400"

# ── 4. Stage change derives probability from the pipeline ────────────────────
MOVED=$(curl -s -b "$COOKIE" -X PATCH "$BASE/api/opportunities/$(echo "$D2" | python -c "import json,sys;print(json.load(sys.stdin)['id'])")" -H 'content-type: application/json' -d '{"stage":"proposal"}')
MPROB=$(echo "$MOVED" | python -c "import json,sys; print(json.load(sys.stdin).get('probability',''))")
check "$MPROB" "55" "stage change → Renewals proposal probability (55)"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=50" | grep -q '"deal.stage_changed"' && ok "deal.stage_changed event emitted" || bad "no stage_changed event"

# ── 5. Pipeline change emits deal.pipeline_changed ───────────────────────────
CHANGED=$(curl -s -b "$COOKIE" -X PATCH "$BASE/api/opportunities/$(echo "$D1" | python -c "import json,sys;print(json.load(sys.stdin)['id'])")" -H 'content-type: application/json' \
  -d "{\"pipelineId\":\"$RENEW_ID\"}")
CPIPE=$(echo "$CHANGED" | python -c "import json,sys; print(json.load(sys.stdin).get('pipelineId',''))")
check "$CPIPE" "$RENEW_ID" "deal moved to Renewals"
# D1 kept stage "proposal" (it exists in Renewals too) → probability 55
CPROB=$(echo "$CHANGED" | python -c "import json,sys; print(json.load(sys.stdin).get('probability',''))")
check "$CPROB" "55" "probability re-derived on pipeline change (proposal=55 in Renewals)"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=100" | grep -q '"deal.pipeline_changed"' && ok "deal.pipeline_changed event emitted" || bad "no pipeline_changed event"

# ── 6. List filtering by pipelineId ──────────────────────────────────────────
DEFCOUNT=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?pipelineId=$SALES_ID&pageSize=200" | python -c "import json,sys; print(json.load(sys.stdin)['total'])")
RENCOUNT=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?pipelineId=$RENEW_ID&pageSize=200" | python -c "import json,sys; print(json.load(sys.stdin)['total'])")
echo "  (sales=$DEFCOUNT renewals=$RENCOUNT)"
[ "$DEFCOUNT" -ge 6 ] && ok "Sales pipeline lists its deals (incl. legacy null-pipelineId)" || bad "Sales count low: $DEFCOUNT"
[ "$RENCOUNT" -ge 3 ] && ok "Renewals pipeline lists its deals" || bad "Renewals count low: $RENCOUNT"
ALL=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?pageSize=200" | python -c "import json,sys; print(json.load(sys.stdin)['total'])")
[ "$ALL" = "$((DEFCOUNT + RENCOUNT))" ] && ok "no double counting across pipelines ($ALL)" || bad "total mismatch: all=$ALL sales=$DEFCOUNT renewals=$RENCOUNT"

# ── 7. Pipeline CRUD guards ──────────────────────────────────────────────────
NEWP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/pipelines" -H 'content-type: application/json' \
  -d "{\"name\":\"Temp Pipeline $TS\",\"stages\":[{\"label\":\"New\",\"probability\":10},{\"label\":\"Won\",\"probability\":100}]}")
NEWP_ID=$(echo "$NEWP" | python -c "import json,sys; print(json.load(sys.stdin).get('pipeline',{}).get('id',''))")
[ -n "$NEWP_ID" ] && ok "pipeline created (admin)" || bad "pipeline create failed: $NEWP"

DELEG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/pipelines/$SALES_ID")
check "$DELEG" "400" "delete default pipeline → 400"
DELEG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/pipelines/$RENEW_ID")
check "$DELEG2" "400" "delete pipeline with deals → 400"
curl -s -b "$COOKIE" -X DELETE "$BASE/api/pipelines/$NEWP_ID" | grep -q '"ok":true' && ok "delete empty non-default pipeline → ok" || bad "delete empty pipeline failed"

# dup stage keys → 400
DUP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/pipelines" -H 'content-type: application/json' \
  -d "{\"name\":\"Dup\",\"stages\":[{\"label\":\"Same\"},{\"label\":\"Same\"}]}")
check "$DUP" "400" "duplicate stage keys → 400"

# non-admin write → 403
REPCOOKIE=/tmp/q2-rep.txt
rm -f "$REPCOOKIE"
curl -s -c "$REPCOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"leo@qorvexa.dev","password":"password123"}' > /dev/null
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/pipelines" -H 'content-type: application/json' -d '{"name":"No","stages":[{"label":"X"}]}')
check "$R403" "403" "rep pipeline create → 403"
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/pipelines")
check "$RGET" "200" "rep can read pipelines"

# ── 7b. Set-default via PATCH { isDefault: true } (regression: ADR-013) ─────
# The PATCH schema must accept a name-less body — this 400'd before the fix.
DEF_BEFORE=$(curl -s -b "$COOKIE" "$BASE/api/pipelines" | python -c "import json,sys; print([i['id'] for i in json.load(sys.stdin)['items'] if i['isDefault']][0])")
NEWP2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/pipelines" -H 'content-type: application/json' \
  -d "{\"name\":\"Temp SetDefault $TS\",\"stages\":[{\"label\":\"Open\",\"probability\":10},{\"label\":\"Won\",\"probability\":100}]}")
NEWP2_ID=$(echo "$NEWP2" | python -c "import json,sys; print(json.load(sys.stdin).get('pipeline',{}).get('id',''))")
SD=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PATCH "$BASE/api/pipelines/$NEWP2_ID" -H 'content-type: application/json' -d '{"isDefault":true}')
check "$SD" "200" "PATCH { isDefault: true } (name-less) → 200"
AFTER=$(curl -s -b "$COOKIE" "$BASE/api/pipelines" | python -c "import json,sys; print([i['id'] for i in json.load(sys.stdin)['items'] if i['isDefault']][0])")
check "$AFTER" "$NEWP2_ID" "new pipeline is now default (old demoted)"
# restore Sales as default, then delete the temp pipeline
curl -s -b "$COOKIE" -X PATCH "$BASE/api/pipelines/$DEF_BEFORE" -H 'content-type: application/json' -d '{"isDefault":true}' > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/pipelines/$NEWP2_ID" > /dev/null

# ── 8. Dashboard uses default pipeline stages ────────────────────────────────
DASH=$(curl -s -b "$COOKIE" "$BASE/api/dashboard")
echo "$DASH" | grep -q '"stage":"negotiation"' && ok "dashboard snapshot uses default pipeline stages" || bad "dashboard snapshot missing stages: ${DASH:0:200}"

summary "PHASE 2-lite SMOKE SUITE"
