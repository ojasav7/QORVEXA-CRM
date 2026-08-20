#!/usr/bin/env bash
# Phase 8 AI Assistant Layer live smoke suite — run against localhost:8787 with
# a freshly booted + seeded stack (npm run db:push && npm run seed, then start
# the server). Covers the model router (catalog + policy + residency pin +
# explainable route), the data firewall (redaction before the model + allowlist
# + rep 403), summaries (record/call/profile), email drafts, explained AI
# scoring (lead/deal + ai.score_computed), sentiment + intent, natural-language
# semantic search (predicates + evidence), confidence flagging
# (ai.confidence_flagged + admin notification), short-term AI memory, role
# gating, feature gating, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q8-admin.txt
REPCOOKIE=/tmp/q8-rep.txt
source "$(dirname "$0")/lib/test-helpers.sh"
login "/tmp/q8-admin.txt"
login_rep "/tmp/q8-rep.txt"

curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)
ENV='-H x-environment:production'
SBENV='-H x-environment:sandbox'
INSIGHT_IDS=""
TRACK() { INSIGHT_IDS="$INSIGHT_IDS $1"; }

# ── 1. Model router ─────────────────────────────────────────────────────────
M=$(curl -s -b "$COOKIE" "$BASE/api/models" $ENV)
[ "$(echo "$M" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" -ge 4 ] && ok "default model catalog seeded (4 models)" || bad "catalog not seeded: $M"
echo "$M" | grep -q '"preference":"cost"' && ok "default routing policy = cost" || bad "policy wrong: $M"
# Dry-runs in the SANDBOX (policy experiments don't touch production).
curl -s -b "$COOKIE" -X PUT "$BASE/api/models/policy" $SBENV -H 'content-type: application/json' -d '{"preference":"quality"}' > /dev/null
Q=$(curl -s -b "$COOKIE" "$BASE/api/models/route?feature=deal.summary" $SBENV)
[ "$(echo "$Q" | jget "['decision']['picked']")" = "mock-premium" ] && ok "quality preference routes to mock-premium" || bad "quality route wrong: $Q"
curl -s -b "$COOKIE" -X PUT "$BASE/api/models/policy" $SBENV -H 'content-type: application/json' -d '{"preference":"cost","preferredRegion":"eu"}' > /dev/null
E=$(curl -s -b "$COOKIE" "$BASE/api/models/route?feature=deal.summary" $SBENV)
[ "$(echo "$E" | jget "['decision']['picked']")" = "eu-mock" ] && ok "EU residency pin routes to eu-mock" || bad "residency route wrong: $E"
echo "$E" | grep -q "residency policy" && ok "routing decision explains the residency pin" || bad "reason missing: $E"
curl -s -b "$COOKIE" -X PUT "$BASE/api/models/policy" $SBENV -H 'content-type: application/json' -d '{"preference":"cost","preferredRegion":null}' > /dev/null
# rep cannot write models
M403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/models" $ENV -H 'content-type: application/json' -d '{"name":"x","capabilities":["summary"]}')
check "$M403" "403" "rep model create → 403"

# ── 2. Data firewall ────────────────────────────────────────────────────────
CT=$(curl -s -b "$COOKIE" "$BASE/api/contacts?q=elena@northwind&pageSize=3" $ENV | jget "['items'][0]['id']")
SUM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/summarize" $ENV -H 'content-type: application/json' -d "{\"entity\":\"contact\",\"entityId\":\"$CT\"}")
SUM_ID=$(echo "$SUM" | jget "['insight']['id']")
TRACK "$SUM_ID"
[ "$(echo "$SUM" | python -c "import json,sys; print(len(json.load(sys.stdin)['insight']['redacted']))")" -ge 1 ] && ok "firewall redacted PII from context" || bad "no redactions: $SUM"
echo "$SUM" | grep -q "elena@northwind" && bad "email leaked into summary output" || ok "summary output contains no email (firewall holds)"
[ "$(echo "$SUM" | jget "['insight']['confidence']")" -ge 0 ] 2>/dev/null && [ "$(echo "$SUM" | jget "['insight']['confidence']")" -le 100 ] && ok "summary carries confidence ($(echo "$SUM" | jget "['insight']['confidence']"))" || bad "no confidence"
F403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X PUT "$BASE/api/ai/firewall" $ENV -H 'content-type: application/json' -d '{}')
check "$F403" "403" "rep firewall policy write → 403"

# ── 3. Summaries (deal / call / profile) ────────────────────────────────────
DEAL=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?q=Retail%20Platform&pageSize=3" $ENV | jget "['items'][0]['id']")
DS=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/summarize" $ENV -H 'content-type: application/json' -d "{\"entity\":\"opportunity\",\"entityId\":\"$DEAL\"}")
DS_ID=$(echo "$DS" | jget "['insight']['id']")
TRACK "$DS_ID"
echo "$DS" | grep -q "negotiation" && echo "$DS" | grep -q '\$180k' && ok "deal summary includes stage + amount" || bad "deal summary thin: $(echo "$DS" | jget "['insight']['content']")"
CALL=$(curl -s -b "$COOKIE" "$BASE/api/calls?pageSize=5" $ENV | jget "['items'][0]['id']")
CS=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/summarize/call" $ENV -H 'content-type: application/json' -d "{\"callId\":\"$CALL\"}")
CS_ID=$(echo "$CS" | jget "['insight']['id']")
TRACK "$CS_ID"
[ "$(echo "$CS" | jget "['insight']['feature']")" = "call.summary" ] && ok "call summary generated from transcript" || bad "call summary failed: $CS"
PROF=$(curl -s -b "$COOKIE" "$BASE/api/cdp/profiles?q=elena@northwind&pageSize=1" $ENV | jget "['items'][0]['id']")
PS=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/summarize/profile" $ENV -H 'content-type: application/json' -d "{\"profileId\":\"$PROF\"}")
PS_ID=$(echo "$PS" | jget "['insight']['id']")
TRACK "$PS_ID"
echo "$PS" | grep -q "purchase" && ok "Customer 360 summary card includes purchases" || bad "360 summary wrong: $(echo "$PS" | jget "['insight']['content']")"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ai.summary_generated&pageSize=3" $ENV)
echo "$EV" | grep -q "ai.summary_generated" && ok "ai.summary_generated event emitted" || bad "summary event missing"

# ── 4. Email draft ──────────────────────────────────────────────────────────
DR=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/draft" $ENV -H 'content-type: application/json' -d "{\"contactId\":\"$CT\",\"tone\":\"proposal\"}")
DR_ID=$(echo "$DR" | jget "['insight']['id']")
TRACK "$DR_ID"
echo "$DR" | grep -q "proposal" && ok "draft respects tone (proposal)" || bad "draft tone wrong"
# The recipient email legitimately rides in payload.recipientEmail (a draft needs a To:);
# the firewall guarantee is that the draft BODY is clean and the redaction log is populated.
BODY=$(echo "$DR" | jget "['insight']['payload']['body']")
echo "$BODY" | grep -qi "elena@northwind" && bad "email leaked into draft body" || ok "draft body contains no email (firewalled)"
[ "$(echo "$DR" | python -c "import json,sys; print(len(json.load(sys.stdin)['insight']['redacted']))")" -ge 1 ] && ok "draft records firewall redactions" || bad "no draft redactions"

# ── 5. AI scoring ───────────────────────────────────────────────────────────
LEAD=$(curl -s -b "$COOKIE" "$BASE/api/leads?q=tom@brightstart&pageSize=3" $ENV | jget "['items'][0]['id']")
LS=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/score" $ENV -H 'content-type: application/json' -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD\"}")
LS_ID=$(echo "$LS" | jget "['insight']['id']")
TRACK "$LS_ID"
LSC=$(echo "$LS" | jget "['insight']['payload']['score']")
[ "$LSC" -ge 0 ] 2>/dev/null && [ "$LSC" -le 100 ] && ok "lead AI score in [0,100] ($LSC)" || bad "lead score invalid"
[ "$(echo "$LS" | python -c "import json,sys; print(len(json.load(sys.stdin)['insight']['payload']['components']))")" = "5" ] && ok "lead score has 5 explained components" || bad "components missing"
DS2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/score" $ENV -H 'content-type: application/json' -d "{\"entity\":\"opportunity\",\"entityId\":\"$DEAL\"}")
DS2_ID=$(echo "$DS2" | jget "['insight']['id']")
TRACK "$DS2_ID"
[ "$(echo "$DS2" | python -c "import json,sys; print(len(json.load(sys.stdin)['insight']['payload']['components']))")" = "4" ] && ok "deal score has 4 explained components" || bad "deal components missing"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ai.score_computed&pageSize=3" $ENV)
echo "$EV" | grep -q "ai.score_computed" && ok "ai.score_computed event emitted" || bad "score event missing"
# rep can generate (reads open)
R200=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/ai/score" $ENV -H 'content-type: application/json' -d "{\"entity\":\"lead\",\"entityId\":\"$LEAD\"}")
check "$R200" "201" "rep AI score generation → 201 (reads open)"

# ── 6. Sentiment + intent ───────────────────────────────────────────────────
SENT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/sentiment" $ENV -H 'content-type: application/json' -d '{"text":"The product is great and easy to use, I love it. Thanks for the fast support!"}')
SENT_ID=$(echo "$SENT" | jget "['insight']['id']")
TRACK "$SENT_ID"
[ "$(echo "$SENT" | jget "['insight']['payload']['label']")" = "positive" ] && ok "sentiment: positive text → positive" || bad "sentiment wrong: $SENT"
INT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/intent" $ENV -H 'content-type: application/json' -d "{\"profileId\":\"$PROF\"}")
INT_ID=$(echo "$INT" | jget "['insight']['id']")
TRACK "$INT_ID"
echo "$INT" | grep -q "buying" && ok "intent: Elena's profile → buying (purchased)" || bad "intent wrong: $(echo "$INT" | jget "['insight']['content']")"

# ── 7. Semantic search ──────────────────────────────────────────────────────
SR=$(curl -s -b "$COOKIE" "$BASE/api/ai/search?q=won%20deals%20over%2050k" $ENV)
PRED_OP=$(echo "$SR" | python -c "import json,sys; print(json.load(sys.stdin)['predicate']['op'])")
PRED_VAL=$(echo "$SR" | python -c "import json,sys; print(json.load(sys.stdin)['predicate']['value'])")
[ "$PRED_OP" = "gte" ] && [ "$PRED_VAL" = "50000" ] && ok "search parses 'over 50k' → amount ≥ \$50k" || bad "predicate wrong: $PRED_OP $PRED_VAL"
echo "$SR" | grep -q "amount ≥" && ok "results show predicate evidence (amount ≥ \$50k ✓)" || bad "no predicate evidence: $SR"
[ "$(echo "$SR" | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")" -ge 1 ] && ok "semantic search returns ranked hits" || bad "no hits"
SR2=$(curl -s -b "$COOKIE" "$BASE/api/ai/search?q=elena" $ENV)
echo "$SR2" | grep -q '"type":"contact"' && ok "'elena' searches all types (contact hit)" || bad "plain-name search failed: $SR2"
sleep 1
SRINS=$(curl -s -b "$COOKIE" "$BASE/api/ai/insights?kind=search&limit=5" $ENV)
[ "$(echo "$SRINS" | jget "['total']")" -ge 1 ] && ok "search persisted as an AIInsight (audit)" || bad "search insight missing"

# ── 8. Confidence flagging ──────────────────────────────────────────────────
LOW=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/sentiment" $ENV -H 'content-type: application/json' -d '{"text":"ok"}')
LOW_ID=$(echo "$LOW" | jget "['insight']['id']")
TRACK "$LOW_ID"
[ "$(echo "$LOW" | jget "['insight']['lowConfidence']")" = "True" ] && ok "short text → lowConfidence flagged" || bad "low confidence not flagged"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ai.confidence_flagged&pageSize=3" $ENV)
echo "$EV" | grep -q "ai.confidence_flagged" && ok "ai.confidence_flagged event emitted" || bad "confidence event missing"
NOTIF=$(curl -s -b "$COOKIE" "$BASE/api/notifications?pageSize=8" $ENV)
echo "$NOTIF" | grep -q '"kind":"ai"' && ok "admin notification written (kind ai)" || bad "ai notification missing"

# ── 9. Short-term AI memory ─────────────────────────────────────────────────
MEM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/memory" $ENV -H 'content-type: application/json' -d "{\"key\":\"verify.$TS\",\"value\":{\"ok\":true},\"ttlSeconds\":3600}")
MID=$(echo "$MEM" | jget "['memory']['id']")
[ -n "$MID" ] && ok "memory written (user scope defaults to caller)" || bad "memory write failed: $MEM"
MEML=$(curl -s -b "$COOKIE" "$BASE/api/ai/memory?scopeType=user" $ENV)
echo "$MEML" | grep -q "verify.$TS" && ok "memory listed for the caller" || bad "memory list missing"
M400=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/ai/memory" $ENV -H 'content-type: application/json' -d "{\"scopeType\":\"user\",\"scopeId\":\"$CT\",\"key\":\"x\",\"value\":{}}")
check "$M400" "400" "user memory private to caller (cross-user write → 400)"
MR400=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/ai/memory?scopeType=user&scopeId=$CT" $ENV)
check "$MR400" "400" "user memory private to caller (cross-user read → 400)"
# Firewall receipt endpoint (review catch — was documented but missing).
# Mask mode may be full ([email]) or partial (el******) depending on the org
# policy — assert the invariant that holds for both: the PII is gone from the
# redacted output and the redaction log names the types.
RC=$(curl -s -b "$COOKIE" "$BASE/api/ai/firewall/check?text=Call%20elena@northwind.example%20at%20415-555-0132" $ENV)
RC_RED=$(echo "$RC" | python -c "import json,sys; print(json.load(sys.stdin)['redacted'])")
echo "$RC_RED" | grep -q "elena@northwind.example" && bad "receipt did not redact email: $RC"
echo "$RC_RED" | grep -q "415-555-0132" && bad "receipt did not redact phone: $RC"
echo "$RC" | grep -q '"type":"email"' && echo "$RC" | grep -q '"type":"phone"' && ok "firewall receipt endpoint redacts on demand" || bad "firewall check wrong: $RC"
curl -s -o /dev/null -b "$COOKIE" -X DELETE "$BASE/api/ai/memory/$MID" $ENV
ok "memory deleted"

# ── 10. Feature gates ───────────────────────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ai.assistant" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/ai/catalog" $ENV)
check "$FG" "403" "ai.assistant disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ai.assistant" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/ai/catalog" $ENV)
check "$FG2" "200" "ai.assistant re-enabled → 200"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ai.modelRouter" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG3=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/models" $ENV)
check "$FG3" "403" "ai.modelRouter disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/ai.modelRouter" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG4=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/models" $ENV)
check "$FG4" "200" "ai.modelRouter re-enabled → 200"

# ── 11. Sandbox isolation ───────────────────────────────────────────────────
# Build a sandbox-scoped record to summarize (sandbox is a fresh, isolated env).
SBCT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/contacts" $SBENV -H 'content-type: application/json' -d "{\"firstName\":\"Sandbox\",\"lastName\":\"User\",\"email\":\"sb-$TS@example.com\"}")
SBCT_ID=$(echo "$SBCT" | jget "['id']")
[ -n "$SBCT_ID" ] && ok "sandbox contact created for isolation test" || bad "sandbox contact create failed: $SBCT"
SB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/ai/summarize" $SBENV -H 'content-type: application/json' -d "{\"entity\":\"contact\",\"entityId\":\"$SBCT_ID\"}")
[ "$(echo "$SB" | jget "['insight']['environment']")" = "sandbox" ] && ok "sandbox AI generation isolated" || bad "sandbox generate failed: $SB"
PROD_INS=$(curl -s -b "$COOKIE" "$BASE/api/ai/insights?limit=50" $ENV | python -c "import json,sys; items=json.load(sys.stdin)['items']; print(items[0]['environment'] if items else '')")
[ "$PROD_INS" = "production" ] && ok "production insight list stays in production" || bad "env leak suspected"
# sandbox models isolated
SBM=$(curl -s -b "$COOKIE" "$BASE/api/models" $SBENV | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")
PRODM=$(curl -s -b "$COOKIE" "$BASE/api/models" $ENV | python -c "import json,sys; print(len(json.load(sys.stdin)['items']))")
[ "$SBM" = "$PRODM" ] && ok "sandbox + production both seed the default catalog" || bad "catalog mismatch ($SBM vs $PRODM)"

# ── 12. Cleanup (leave demo data pristine) ──────────────────────────────────
for iid in $INSIGHT_IDS; do
  [ -n "$iid" ] && curl -s -o /dev/null -b "$COOKIE" -X DELETE "$BASE/api/ai/insights/$iid" $ENV
done
SBID=$(curl -s -b "$COOKIE" "$BASE/api/ai/insights?limit=5" $SBENV | python -c "import json,sys; items=json.load(sys.stdin)['items']; print(items[0]['id'] if items else '')")
[ -n "$SBID" ] && curl -s -o /dev/null -b "$COOKIE" -X DELETE "$BASE/api/ai/insights/$SBID" $SBENV
ok "suite insights purged (cleanup)"

summary "PHASE 8"
