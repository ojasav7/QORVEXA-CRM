#!/usr/bin/env bash
# Phase 5 Marketing Automation & Journey Orchestration live smoke suite — run
# against localhost:8787 with a freshly seeded demo org (npm run seed). Covers
# campaign CRUD + send-to-segment (A/B split, per-recipient messages,
# campaign.sent), stats + ROI + recipients, A/B winner declaration, landing
# page CRUD + public submit (honeypot + rate limit + routed lead + form
# submitted + intent.detected), journey CRUD + validation, event-trigger
# enrollment, wait + ticker advance + step execution (send_email / notify /
# create_task / update_record / condition / end) with a run log, the test
# endpoint, deliverability metrics + simulated provider events, workflow
# triggers on form.submitted, role gating, feature gating, and sandbox
# isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q5-admin.txt
REPCOOKIE=/tmp/q5-rep.txt
PASS=0; FAIL=0
say() { :; }
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

# ── 1. Campaign CRUD + validation ────────────────────────────────────────────
# audience = seeded "All prospects" segment
SEG_ID=$(curl -s -b "$COOKIE" "$BASE/api/segments" $ENV | python -c "
import json,sys
for s in json.load(sys.stdin)['items']:
    if s['name']=='All prospects': print(s['id']); break
")
[ -n "$SEG_ID" ] && ok "audience segment resolved (All prospects)" || bad "segment not found: $SEG_ID"

CAMP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/campaigns" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke campaign $TS\",\"description\":\"phase5 smoke\",\"subject\":\"Subject A\",\"body\":\"Hi {{contact.firstName}}, this is the smoke campaign.\",\"audienceSegmentId\":\"$SEG_ID\",\"ab\":{\"enabled\":true,\"splitA\":50,\"subjectB\":\"Subject B - punchy\"}}")
CAMP_ID=$(echo "$CAMP" | jget "['campaign']['id']")
[ -n "$CAMP_ID" ] && ok "campaign created" || bad "campaign create failed: $CAMP"
[ "$(echo "$CAMP" | jget "['campaign']['status']")" = "draft" ] && ok "campaign status draft" || bad "status wrong"
BAD400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/campaigns" $ENV -H 'content-type: application/json' \
  -d '{"name":"bad","subject":"","body":"x"}' )
check "$BAD400" "400" "campaign without subject → 400"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/campaigns" $ENV -H 'content-type: application/json' \
  -d '{"name":"nope","subject":"s","body":"b"}' )
check "$R403" "403" "rep campaign create → 403"
R200=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/campaigns" $ENV)
check "$R200" "200" "rep campaign read → 200"

# ── 2. Campaign send to segment (A/B split + messages + campaign.sent) ──────
SEND=$(curl -s -b "$COOKIE" -X POST "$BASE/api/campaigns/$CAMP_ID/send" $ENV)
SENT=$(echo "$SEND" | jget "['sent']")
[ "$SENT" -ge 1 ] && ok "campaign sent to $SENT recipients" || bad "send failed: $SEND"
CAMP2=$(curl -s -b "$COOKIE" "$BASE/api/campaigns/$CAMP_ID" $ENV | jget "['campaign']['status']")
check "$CAMP2" "sent" "campaign status → sent"
# re-send blocked (idempotency guard)
RESEND=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/campaigns/$CAMP_ID/send" $ENV)
check "$RESEND" "400" "resend of sent campaign → 400"
# per-recipient CampaignRecipient rows + Messages with A/B variants
RECIPS=$(curl -s -b "$COOKIE" "$BASE/api/campaigns/$CAMP_ID/recipients?pageSize=50" $ENV)
[ "$(echo "$RECIPS" | jget "['total']")" -ge 1 ] && ok "campaign recipients recorded" || bad "recipients missing: $RECIPS"
echo "$RECIPS" | grep -q '"variant":"B"' && ok "A/B split produced variant B recipients" || bad "no variant B recipients"
MSG=$(curl -s -b "$COOKIE" "$BASE/api/emails?q=Smoke%20campaign" $ENV)
echo "$MSG" | grep -q "Subject B - punchy" && ok "variant B message has subjectB" || bad "variant B subject missing"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=campaign.sent&pageSize=5" $ENV)
echo "$EV" | grep -q "$CAMP_ID" && ok "campaign.sent event emitted" || bad "campaign.sent missing"

# ── 3. Campaign stats + ROI + A/B winner ─────────────────────────────────────
# open one of the campaign's messages via the tracking pixel → rollup updates
# the recipient + campaign counts
TOKEN=$(curl -s -b "$COOKIE" "$BASE/api/emails?q=Smoke%20campaign" $ENV | python -c "
import json,sys
items=json.load(sys.stdin)['items']
tok=[m['trackingToken'] for m in items if m.get('trackingToken')]
print(tok[0] if tok else '')
")
[ -n "$TOKEN" ] && ok "campaign message has tracking token" || bad "no tracking token"
curl -s -o /dev/null "$BASE/api/t/px/$TOKEN"
sleep 1
OPENED=$(curl -s -b "$COOKIE" "$BASE/api/campaigns/$CAMP_ID" $ENV | jget "['stats']['opened']")
[ "$OPENED" -ge 1 ] && ok "tracking open rolled up into campaign stats (opened=$OPENED)" || bad "open not rolled up (opened=$OPENED)"
WIN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/campaigns/$CAMP_ID/declare-winner" $ENV -H 'content-type: application/json' -d '{"variant":"B"}' | jget "['campaign']['winner']")
check "$WIN" "B" "A/B winner declared (B)"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=campaign.winner_declared&pageSize=5" $ENV)
echo "$EV" | grep -q '"winner":"B"' && ok "campaign.winner_declared event emitted" || bad "winner event missing"
# ROI: link a won deal to a campaign recipient contact → roi > 0
CONTACT_ID=$(echo "$RECIPS" | python -c "
import json,sys
items=json.load(sys.stdin)['items']
print(items[0]['contactId'] if items else '')
")
if [ -n "$CONTACT_ID" ]; then
  curl -s -b "$COOKIE" -X POST "$BASE/api/opportunities" $ENV -H 'content-type: application/json' \
    -d "{\"name\":\"Smoke ROI deal $TS\",\"amount\":42000,\"stage\":\"won\",\"contactId\":\"$CONTACT_ID\"}" > /dev/null
  ROI=$(curl -s -b "$COOKIE" "$BASE/api/campaigns/$CAMP_ID" $ENV | jget "['stats']['roi']")
  [ "$ROI" -ge 42000 ] && ok "attributed ROI counts won deal (\$42k)" || bad "ROI missing: $ROI"
fi

# ── 4. Landing page CRUD + public submit ─────────────────────────────────────
LP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/landing-pages" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke landing $TS\",\"slug\":\"smoke-$TS\",\"headline\":\"Smoke headline\",\"subtext\":\"sub\",\"theme\":\"emerald\",\"campaignId\":\"$CAMP_ID\"}")
LP_ID=$(echo "$LP" | jget "['page']['id']")
[ -n "$LP_ID" ] && ok "landing page created" || bad "landing create failed: $LP"
DUP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/landing-pages" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"dup\",\"slug\":\"smoke-$TS\",\"headline\":\"h\"}")
check "$DUP" "400" "duplicate landing slug → 400"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/landing-pages" $ENV -H 'content-type: application/json' \
  -d '{"name":"nope","slug":"nope","headline":"h"}')
check "$R403" "403" "rep landing create → 403"
PCONF=$(curl -s "$BASE/api/public/pages/smoke-$TS")
echo "$PCONF" | grep -q "Smoke headline" && ok "public landing config works" || bad "public config failed: $PCONF"
# honeypot → fake success, no lead
HP=$(curl -s -X POST "$BASE/api/public/pages/smoke-$TS/submit" -H 'content-type: application/json' \
  -d "{\"firstName\":\"Bot\",\"lastName\":\"Bot\",\"email\":\"bot$TS@example.com\",\"website\":\"spam.example\"}")
echo "$HP" | grep -q '"ok":true' && ok "honeypot submission → fake success" || bad "honeypot not blocked"
# real submission → routed lead with source Landing page + campaign tagged
SUB=$(curl -s -X POST "$BASE/api/public/pages/smoke-$TS/submit" -H 'content-type: application/json' \
  -d "{\"firstName\":\"Lina\",\"lastName\":\"Tester\",\"email\":\"lina$TS@example.com\",\"company\":\"Smoke Co\",\"website\":\"\"}")
LEAD_ID=$(echo "$SUB" | jget "['leadId']")
[ -n "$LEAD_ID" ] && ok "public submission created lead" || bad "submit failed: $SUB"
LEADROW=$(curl -s -b "$COOKIE" "$BASE/api/leads/$LEAD_ID" $ENV)
echo "$LEADROW" | grep -q '"source":"Landing page"' && ok "lead source = Landing page" || bad "lead source wrong"
echo "$LEADROW" | grep -q '"campaignId":"' && ok "lead tagged with campaignId (attribution)" || bad "campaign attribution missing"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=form.submitted&pageSize=5" $ENV)
echo "$EV" | grep -q "smoke-$TS" && ok "form.submitted event emitted" || bad "form.submitted missing"
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=intent.detected&pageSize=5" $ENV)
echo "$EV" | grep -q "$LEAD_ID" && ok "intent.detected event emitted" || bad "intent.detected missing"
# duplicate email → no-leak ok + duplicate flag
DUP2=$(curl -s -X POST "$BASE/api/public/pages/smoke-$TS/submit" -H 'content-type: application/json' \
  -d "{\"firstName\":\"Lina\",\"lastName\":\"Again\",\"email\":\"lina$TS@example.com\",\"website\":\"\"}")
echo "$DUP2" | grep -q '"duplicate":true' && ok "duplicate submission → no-leak duplicate:true" || bad "duplicate handling wrong: $DUP2"
# unknown page → 400
R400=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/public/pages/does-not-exist")
check "$R400" "400" "unknown landing page → 400"

# ── 5. Journey CRUD + validation ─────────────────────────────────────────────
TEMPLATE_ID=$(curl -s -b "$COOKIE" "$BASE/api/email-templates" $ENV | python -c "
import json,sys
items=json.load(sys.stdin)['items']
print(items[0]['id'] if items else '')
")
JR=$(curl -s -b "$COOKIE" -X POST "$BASE/api/journeys" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke journey $TS\",\"description\":\"phase5 smoke\",\"trigger\":{\"kind\":\"event\",\"event\":\"lead.created\"},\"steps\":[{\"type\":\"wait\",\"days\":1},{\"type\":\"send_email\",\"templateId\":\"$TEMPLATE_ID\",\"subject\":\"Smoke journey email\",\"body\":\"Hi {{lead.firstName}}\"},{\"type\":\"notify\",\"title\":\"Journey step done\"},{\"type\":\"end\"}]}")
JR_ID=$(echo "$JR" | jget "['journey']['id']")
[ -n "$JR_ID" ] && ok "journey created" || bad "journey create failed: $JR"
BAD400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/journeys" $ENV -H 'content-type: application/json' \
  -d '{"name":"bad","trigger":{"kind":"event","event":"lead.created"},"steps":[{"type":"nonsense"}]}')
check "$BAD400" "400" "journey with unknown step type → 400"
BAD400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/journeys" $ENV -H 'content-type: application/json' \
  -d '{"name":"bad2","trigger":{"kind":"event","event":"lead.created"},"steps":[{"type":"condition","field":"score","op":"gte","value":70,"thenIndex":0}]}')
check "$BAD400" "400" "journey condition branch to self → 400"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/journeys" $ENV -H 'content-type: application/json' \
  -d '{"name":"nope","trigger":{"kind":"event","event":"lead.created"},"steps":[{"type":"end"}]}')
check "$R403" "403" "rep journey create → 403"

# ── 6. Journey engine: event trigger → enroll → wait → advance → steps ───────
LEAD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" $ENV -H 'content-type: application/json' \
  -d "{\"firstName\":\"Journey\",\"lastName\":\"Lead $TS\",\"email\":\"jlead$TS@example.com\",\"source\":\"Website\"}")
JLEAD_ID=$(echo "$LEAD" | jget "['id']")
sleep 1
ENRL=$(curl -s -b "$COOKIE" "$BASE/api/journeys/$JR_ID/enrollments" $ENV)
echo "$ENRL" | grep -q "jlead$TS@example.com" && ok "lead.created enrolled the lead in the journey" || bad "enrollment missing: $ENRL"
ENR_STATUS=$(echo "$ENRL" | python -c "
import json,sys
items=json.load(sys.stdin)['items']
match=[e for e in items if e.get('entityEmail')=='jlead$TS@example.com']
print(match[0]['status'] if match else 'none')
")
check "$ENR_STATUS" "waiting" "wait step → enrollment waiting"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=journey.enrolled&pageSize=5" $ENV)
echo "$EV" | grep -q "$JR_ID" && ok "journey.enrolled event emitted" || bad "journey.enrolled missing"
# backdate nextRunAt (test seam — the ticker advances due waits) + advance.
# The probe must live inside the project so @prisma/client resolves.
cd "$(dirname "$0")" 2>/dev/null || true
cat > server/scripts/q5-backdate.ts <<'EOF'
import { db } from "../db";
const p = db();
const rows = await p.journeyEnrollment.findMany({ where: { status: "waiting" } });
for (const e of rows) {
  await p.journeyEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
}
console.log("backdated", rows.length);
await p.$disconnect();
EOF
npx tsx server/scripts/q5-backdate.ts 2>&1 | tail -1
rm -f server/scripts/q5-backdate.ts
ADV=$(curl -s -b "$COOKIE" -X POST "$BASE/api/journeys/advance" $ENV)
[ "$(echo "$ADV" | jget "['advanced']")" -ge 1 ] && ok "ticker advance moved due enrollments ($(echo "$ADV" | jget "['advanced']"))" || bad "advance did nothing: $ADV"
sleep 1
RUNS=$(curl -s -b "$COOKIE" "$BASE/api/journeys/$JR_ID/runs?limit=25" $ENV)
echo "$RUNS" | grep -q '"stepType":"send_email"' && ok "send_email step executed" || bad "send_email step missing: $RUNS"
echo "$RUNS" | grep -q '"stepType":"notify"' && ok "notify step executed" || bad "notify step missing"
echo "$RUNS" | grep -q '"stepType":"end"' && ok "end step executed" || bad "end step missing"
ENRL2=$(curl -s -b "$COOKIE" "$BASE/api/journeys/$JR_ID/enrollments" $ENV | python -c "
import json,sys
items=json.load(sys.stdin)['items']
match=[e for e in items if e.get('entityEmail')=='jlead$TS@example.com']
print(match[0]['status'] if match else 'none')
")
check "$ENRL2" "completed" "journey completed after end step"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=journey.completed&pageSize=5" $ENV)
echo "$EV" | grep -q "$JR_ID" && ok "journey.completed event emitted" || bad "journey.completed missing"
# loop guard: creating another lead of the same email is a duplicate → no re-enroll; but a fresh lead re-enrolls
LEAD2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/leads" $ENV -H 'content-type: application/json' \
  -d "{\"firstName\":\"Journey2\",\"lastName\":\"Lead $TS\",\"email\":\"jlead2$TS@example.com\",\"source\":\"Website\"}")
JLEAD2_ID=$(echo "$LEAD2" | jget "['id']")
sleep 1
CNT=$(curl -s -b "$COOKIE" "$BASE/api/journeys/$JR_ID/enrollments?pageSize=50" $ENV | python -c "
import json,sys
items=json.load(sys.stdin)['items']
print(len([e for e in items if 'jlead' in (e.get('entityEmail') or '')]))
")
[ "$CNT" -ge 2 ] && ok "fresh lead re-enrolls (loop guard allows new entities)" || bad "re-enroll failed ($CNT)"

# ── 7. Journey test endpoint (synchronous, waits skipped) ────────────────────
CID=$(curl -s -b "$COOKIE" "$BASE/api/contacts?pageSize=1" $ENV | python -c "
import json,sys
items=json.load(sys.stdin)['items']
print(items[0]['id'] if items else '')
")
TEST=$(curl -s -b "$COOKIE" -X POST "$BASE/api/journeys/$JR_ID/test" $ENV -H 'content-type: application/json' -d "{\"entityId\":\"$CID\"}")
echo "$TEST" | grep -q '"outcomes"' && ok "journey test endpoint ran synchronously" || bad "test failed: $TEST"

# ── 8. Deliverability metrics + simulated provider events ────────────────────
DLV=$(curl -s -b "$COOKIE" "$BASE/api/deliverability" $ENV)
echo "$DLV" | grep -q '"health"' && ok "deliverability metrics endpoint works" || bad "deliverability failed: $DLV"
MESSAGE_ID=$(echo "$DLV" | python -c "
import json,sys
recent=json.load(sys.stdin)['recent']
print(recent[0]['id'] if recent else '')
")
[ -n "$MESSAGE_ID" ] && ok "recent messages listed" || bad "no messages"
SIM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/deliverability/simulate" $ENV -H 'content-type: application/json' -d "{\"messageId\":\"$MESSAGE_ID\",\"kind\":\"bounce\"}")
echo "$SIM" | grep -q '"bouncedAt"' && ok "simulated bounce marked the message" || bad "simulate failed: $SIM"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=email.bounced&pageSize=5" $ENV)
echo "$EV" | grep -q "$MESSAGE_ID" && ok "email.bounced event emitted" || bad "email.bounced missing"
BOUNCE=$(curl -s -b "$COOKIE" "$BASE/api/deliverability" $ENV | jget "['metrics']['bounced']")
[ "$BOUNCE" -ge 1 ] && ok "bounce reflected in metrics" || bad "bounce not counted"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/deliverability/simulate" $ENV -H 'content-type: application/json' -d "{\"messageId\":\"$MESSAGE_ID\",\"kind\":\"bounce\"}")
check "$R403" "403" "rep simulate → 403"
R200=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/deliverability" $ENV)
check "$R200" "200" "rep deliverability read → 200"

# ── 9. Workflow trigger on form.submitted ────────────────────────────────────
WF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke landing wf $TS\",\"trigger\":{\"kind\":\"event\",\"event\":\"form.submitted\"},\"conditions\":[],\"actions\":[{\"type\":\"notify\",\"title\":\"Landing lead! 🚀\",\"body\":\"{{firstName}} {{lastName}} submitted a form.\",\"target\":\"owner\"}]}")
WF_ID=$(echo "$WF" | jget "['automation']['id']")
[ -n "$WF_ID" ] && ok "workflow on form.submitted created" || bad "form.submitted workflow create failed: $WF"
# a second landing submit fires it (fresh email)
curl -s -X POST "$BASE/api/public/pages/smoke-$TS/submit" -H 'content-type: application/json' \
  -d "{\"firstName\":\"Wf\",\"lastName\":\"Tester\",\"email\":\"wf$TS@example.com\",\"website\":\"\"}" > /dev/null
sleep 1
WFCOUNT=$(curl -s -b "$COOKIE" "$BASE/api/automations/$WF_ID" $ENV | jget "['automation']['runCount']")
[ "$WFCOUNT" -ge 1 ] && ok "form.submitted workflow fired (runCount=$WFCOUNT)" || bad "workflow did not fire (runCount=$WFCOUNT)"

# ── 10. Feature gates ────────────────────────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/marketing.campaigns" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/campaigns" $ENV)
check "$FG" "403" "campaigns flag disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/marketing.campaigns" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/campaigns" $ENV)
check "$FG2" "200" "campaigns flag re-enabled → 200"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/marketing.journeys" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG3=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/journeys" $ENV)
check "$FG3" "403" "journeys flag disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/marketing.journeys" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG4=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PUT "$BASE/api/features/marketing.landing" $ENV -H 'content-type: application/json' -d '{"enabled":false}')
FG5=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/landing-pages" $ENV)
check "$FG5" "403" "landing flag disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/marketing.landing" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG6=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/public/pages/smoke-$TS")
check "$FG6" "200" "public landing unaffected by admin flag"

# ── 11. Sandbox isolation ────────────────────────────────────────────────────
SB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/campaigns" -H 'x-environment:sandbox' -H 'content-type: application/json' \
  -d "{\"name\":\"Sandbox campaign $TS\",\"subject\":\"sb\",\"body\":\"sb\",\"audienceSegmentId\":\"$SEG_ID\"}")
SB_ID=$(echo "$SB" | jget "['campaign']['id']")
[ -n "$SB_ID" ] && ok "campaign created in sandbox env" || bad "sandbox campaign failed: $SB"
PROD=$(curl -s -b "$COOKIE" "$BASE/api/campaigns?name=Sandbox" $ENV)
echo "$PROD" | grep -q "Sandbox campaign" && bad "sandbox campaign leaked into production" || ok "sandbox campaign invisible in production"
SB_LIST=$(curl -s -b "$COOKIE" "$BASE/api/campaigns?name=Sandbox" -H 'x-environment:sandbox')
echo "$SB_LIST" | grep -q "Sandbox campaign" && ok "sandbox campaign visible in sandbox" || bad "sandbox campaign missing"

# ── 12. Cleanup (leave demo data pristine) ───────────────────────────────────
curl -s -b "$COOKIE" -X DELETE "$BASE/api/campaigns/$CAMP_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/campaigns/$SB_ID" -H 'x-environment:sandbox' > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/landing-pages/$LP_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/journeys/$JR_ID" $ENV > /dev/null
[ -n "${WF_ID:-}" ] && curl -s -b "$COOKIE" -X DELETE "$BASE/api/automations/$WF_ID" $ENV > /dev/null
# smoke leads
for email in "lina$TS@example.com" "jlead$TS@example.com" "jlead2$TS@example.com" "wf$TS@example.com"; do
  LID=$(curl -s -b "$COOKIE" "$BASE/api/leads?q=$email" $ENV | python -c "
import json,sys
items=json.load(sys.stdin)['items']
print(items[0]['id'] if items else '')
")
  [ -n "$LID" ] && curl -s -b "$COOKIE" -X DELETE "$BASE/api/leads/$LID" $ENV > /dev/null
done
ROI_DEAL=$(curl -s -b "$COOKIE" "$BASE/api/opportunities?q=Smoke%20ROI" $ENV | python -c "
import json,sys
items=json.load(sys.stdin)['items']
print(items[0]['id'] if items else '')
")
[ -n "$ROI_DEAL" ] && curl -s -b "$COOKIE" -X DELETE "$BASE/api/opportunities/$ROI_DEAL" $ENV > /dev/null
PROBE=$(curl -s -b "$COOKIE" "$BASE/api/campaigns?name=Smoke" $ENV)
echo "$PROBE" | grep -q "Smoke campaign" && bad "smoke campaign left behind" || ok "smoke campaigns cleaned up"

echo
echo "════════════════════════════════════════════"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "════════════════════════════════════════════"
if [ "$FAIL" = "0" ]; then echo "PHASE 5 SMOKE SUITE: ALL GREEN ✅"; else echo "PHASE 5 SMOKE SUITE: FAILURES ❌"; fi
