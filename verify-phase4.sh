#!/usr/bin/env bash
# Phase 4 Customer Service / Helpdesk live smoke suite — run against
# localhost:8787 with a freshly seeded demo org (npm run seed). Covers ticket
# CRUD + references + SLA deadlines, status transitions (ticket.status_changed),
# replies + first response, assignment, escalation, the SLA breach sweep, legal
# hold, convert-to-lead, email intake, queues, the knowledge base, public portal
# submission/lookup (honeypot + rate limit + no-leak), workflow triggers, role
# gating, feature gating, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q4-admin.txt
REPCOOKIE=/tmp/q4-rep.txt
source "$(dirname "$0")/lib/test-helpers.sh"
login "$COOKIE"
login_rep "$REPCOOKIE"
curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)
ENV='-H x-environment:production'

# ── 1. Ticket CRUD + reference + SLA ─────────────────────────────────────────
TICKET=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets" $ENV -H 'content-type: application/json' \
  -d "{\"subject\":\"Smoke ticket $TS\",\"description\":\"phase4 smoke\",\"priority\":\"high\",\"channel\":\"email\"}")
TICKET_ID=$(echo "$TICKET" | jget "['id']")
REF=$(echo "$TICKET" | jget "['reference']")
[ -n "$TICKET_ID" ] && ok "ticket created" || bad "ticket create failed: $TICKET"
echo "$REF" | grep -qE '^TKT-[0-9]{4}$' && ok "reference auto-assigned ($REF)" || bad "reference malformed: $REF"
[ "$(echo "$TICKET" | jget "['priority']")" = "high" ] && ok "priority set" || bad "priority not set"
[ "$(echo "$TICKET" | jget "['slaDueAt']")" != "None" ] && ok "slaDueAt computed (high=4h)" || bad "slaDueAt missing"
[ "$(echo "$TICKET" | jget "['slaStatus']")" = "on_track" ] && ok "slaStatus on_track" || bad "slaStatus wrong: $TICKET"
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ticket.created&pageSize=5" $ENV)
echo "$EV" | grep -q "$TICKET_ID" && ok "ticket.created event emitted" || bad "ticket.created missing"

# status transition → ticket.status_changed
curl -s -b "$COOKIE" -X PATCH "$BASE/api/tickets/$TICKET_ID" $ENV -H 'content-type: application/json' -d '{"status":"resolved"}' > /dev/null
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ticket.status_changed&pageSize=5" $ENV)
echo "$EV" | grep -q '"to":"resolved"' && ok "ticket.status_changed emitted with from/to" || bad "status_changed missing: $EV"
RESOLVED=$(curl -s -b "$COOKIE" "$BASE/api/tickets/$TICKET_ID" $ENV)
echo "$RESOLVED" | grep -q '"resolvedAt"' && ok "resolvedAt set on resolution" || bad "resolvedAt missing"
[ "$(echo "$RESOLVED" | jget "['slaStatus']")" = "n/a" ] && ok "resolved ticket SLA is n/a" || bad "resolved SLA not n/a"

# reopen + priority change recomputes SLA
curl -s -b "$COOKIE" -X PATCH "$BASE/api/tickets/$TICKET_ID" $ENV -H 'content-type: application/json' -d '{"status":"open","priority":"urgent"}' > /dev/null
REOPENED=$(curl -s -b "$COOKIE" "$BASE/api/tickets/$TICKET_ID" $ENV)
[ "$(echo "$REOPENED" | jget "['priority']")" = "urgent" ] && ok "priority updated" || bad "priority update failed"
[ "$(echo "$REOPENED" | jget "['slaStatus']")" = "on_track" ] && ok "SLA recomputed after priority change" || bad "SLA not recomputed"

# ── 2. Replies + first response ──────────────────────────────────────────────
R1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/$TICKET_ID/reply" $ENV -H 'content-type: application/json' \
  -d '{"body":"Smoke reply — investigating.","internal":true}')
echo "$R1" | grep -q '"internal":true' && ok "internal reply created" || bad "reply failed: $R1"
REPLIES=$(curl -s -b "$COOKIE" "$BASE/api/tickets/$TICKET_ID/replies" $ENV)
echo "$REPLIES" | grep -q "Smoke reply" && ok "reply thread lists the reply" || bad "reply not listed"
T2=$(curl -s -b "$COOKIE" "$BASE/api/tickets/$TICKET_ID" $ENV)
echo "$T2" | grep -q '"firstResponseAt"' && ok "firstResponseAt set" || bad "firstResponseAt missing"

# ── 3. Assignment + notification ─────────────────────────────────────────────
REP_ID=$(curl -s -b "$COOKIE" "$BASE/api/users" $ENV | python -c "
import json,sys
for u in json.load(sys.stdin)['items']:
    if u['email']=='leo@qorvexa.dev': print(u['id']); break
")
ASSIGN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/$TICKET_ID/assign" $ENV -H 'content-type: application/json' -d "{\"assigneeId\":\"$REP_ID\"}")
[ "$(echo "$ASSIGN" | jget "['assigneeName']")" != "None" ] && ok "ticket assigned" || bad "assign failed: $ASSIGN"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ticket.assigned&pageSize=5" $ENV)
echo "$EV" | grep -q "$TICKET_ID" && ok "ticket.assigned event emitted" || bad "ticket.assigned missing"
NOTIF=$(curl -s -b "$REPCOOKIE" "$BASE/api/notifications?pageSize=5" $ENV)
echo "$NOTIF" | grep -q "assigned to you" && ok "assignee notified" || bad "assignee notification missing"

# ── 4. Escalation ────────────────────────────────────────────────────────────
ESC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/$TICKET_ID/escalate" $ENV -H 'content-type: application/json' -d '{"reason":"Smoke escalation"}')
[ "$(echo "$ESC" | jget "['escalated']")" = "True" ] && ok "ticket escalated" || bad "escalate failed: $ESC"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ticket.escalated&pageSize=5" $ENV)
echo "$EV" | grep -q "Smoke escalation" && ok "ticket.escalated emitted with reason" || bad "ticket.escalated missing"

# ── 5. SLA breach sweep (admin) ──────────────────────────────────────────────
# Create an urgent ticket, backdate its SLA deadline (a test seam — slaDueAt is
# a registry date field, so PATCH can set it), then sweep: it must be marked
# breached AND auto-escalated (urgent breach), emitting both events.
OLD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets" $ENV -H 'content-type: application/json' \
  -d "{\"subject\":\"Sweep target $TS\",\"priority\":\"urgent\",\"channel\":\"web\"}")
OLD_ID=$(echo "$OLD" | jget "['id']")
OLD_REF=$(echo "$OLD" | jget "['reference']")
PAST=$(python -c "import datetime; print((datetime.datetime.utcnow()-datetime.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
curl -s -b "$COOKIE" -X PATCH "$BASE/api/tickets/$OLD_ID" $ENV -H 'content-type: application/json' -d "{\"slaDueAt\":\"$PAST\"}" > /dev/null
SWEEP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/sla/check" $ENV)
[ "$(echo "$SWEEP" | jget "['breached']")" -ge 1 ] && ok "SLA sweep marked a breach" || bad "sweep found no breach: $SWEEP"
SLAV=$(curl -s -b "$COOKIE" "$BASE/api/tickets/$OLD_ID" $ENV)
[ "$(echo "$SLAV" | jget "['breachedAt']")" != "None" ] && ok "sweep persisted breachedAt" || bad "breachedAt not persisted"
[ "$(echo "$SLAV" | jget "['escalated']")" = "True" ] && ok "urgent breach auto-escalated" || bad "breach not auto-escalated"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ticket.sla_breached&pageSize=5" $ENV)
echo "$EV" | grep -q "$OLD_REF" && ok "ticket.sla_breached event emitted" || bad "sla_breached missing: $EV"

# rep cannot run the sweep
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/tickets/sla/check" $ENV)
check "$R403" "403" "rep SLA sweep → 403"

# ── 6. Legal hold ────────────────────────────────────────────────────────────
LH=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/$OLD_ID/legal-hold" $ENV -H 'content-type: application/json' -d '{"legalHold":true}')
[ "$(echo "$LH" | jget "['legalHold']")" = "True" ] && ok "legal hold enabled (admin)" || bad "legal hold toggle failed: $LH"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X PATCH "$BASE/api/tickets/$OLD_ID" $ENV -H 'content-type: application/json' -d '{"subject":"nope"}')
check "$R403" "403" "held ticket PATCH by rep → 403"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/tickets/$OLD_ID" $ENV)
check "$R403" "403" "held ticket DELETE (even admin) → 403"
# admin can lift the hold
LH2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/$OLD_ID/legal-hold" $ENV -H 'content-type: application/json' -d '{"legalHold":false}')
[ "$(echo "$LH2" | jget "['legalHold']")" = "False" ] && ok "legal hold lifted (admin)" || bad "hold lift failed: $LH2"

# ── 7. Convert to lead ───────────────────────────────────────────────────────
LEAD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/$TICKET_ID/convert-to-lead" $ENV)
LEAD_ID=$(echo "$LEAD" | jget "['lead']['id']")
[ -n "$LEAD_ID" ] && ok "ticket converted to lead" || bad "convert failed: $LEAD"

# ── 8. Email intake ──────────────────────────────────────────────────────────
INTAKE=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets/intake/email" $ENV -H 'content-type: application/json' \
  -d "{\"from\":\"smoke$TS@example.com\",\"subject\":\"Inbound smoke $TS\",\"body\":\"Please help with billing.\"}")
INTAKE_ID=$(echo "$INTAKE" | jget "['id']")
[ -n "$INTAKE_ID" ] && ok "email intake created ticket" || bad "intake failed: $INTAKE"
[ "$(echo "$INTAKE" | jget "['channel']")" = "email" ] && ok "intake channel=email" || bad "intake channel wrong"
[ "$(echo "$INTAKE" | jget "['contactId']")" != "None" ] && ok "intake auto-created/linked contact" || bad "intake contact missing"
sleep 1
EV=$(curl -s -b "$COOKIE" "$BASE/api/events?type=ticket.captured&pageSize=5" $ENV)
echo "$EV" | grep -q "Inbound smoke" && ok "ticket.captured event emitted" || bad "ticket.captured missing"

# ── 9. Queues endpoint ───────────────────────────────────────────────────────
QUEUES=$(curl -s -b "$COOKIE" "$BASE/api/tickets/queues" $ENV)
echo "$QUEUES" | grep -q '"key":"breached"' && ok "queues endpoint lists breached" || bad "queues missing breached: $QUEUES"
echo "$QUEUES" | grep -q '"key":"escalated"' && ok "queues endpoint lists escalated" || bad "queues missing escalated"

# ── 10. Knowledge base ───────────────────────────────────────────────────────
KB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/knowledge" $ENV -H 'content-type: application/json' \
  -d "{\"title\":\"Smoke KB $TS\",\"body\":\"How to smoke test.\",\"category\":\"technical\",\"published\":false}")
KB_ID=$(echo "$KB" | jget "['article']['id']")
[ -n "$KB_ID" ] && ok "KB article created (draft)" || bad "KB create failed: $KB"
KBL=$(curl -s -b "$COOKIE" "$BASE/api/knowledge?q=smoke%20test" $ENV)
echo "$KBL" | grep -q "Smoke KB" && ok "KB search finds article" || bad "KB search failed"
KC=$(curl -s -b "$COOKIE" "$BASE/api/knowledge/categories" $ENV)
echo "$KC" | grep -q '"technical"' && ok "KB categories endpoint works" || bad "categories failed: $KC"
# publish → view count increments on read
curl -s -b "$COOKIE" -X PATCH "$BASE/api/knowledge/$KB_ID" $ENV -H 'content-type: application/json' -d '{"published":true}' > /dev/null
curl -s -b "$COOKIE" "$BASE/api/knowledge/$KB_ID" $ENV > /dev/null
VIEWS=$(curl -s -b "$COOKIE" "$BASE/api/knowledge/$KB_ID" $ENV | jget "['article']['viewCount']")
[ "$VIEWS" -ge 1 ] && ok "published article read increments viewCount" || bad "viewCount not incremented"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/knowledge" $ENV -H 'content-type: application/json' \
  -d '{"title":"nope","body":"x"}')
check "$R403" "403" "rep KB create → 403"
R200=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/knowledge" $ENV)
check "$R200" "200" "rep KB read → 200"

# ── 11. Public portal ────────────────────────────────────────────────────────
PCONF=$(curl -s "$BASE/api/public/portal/support")
echo "$PCONF" | grep -q "Qorvexa Support" && ok "portal config endpoint works" || bad "portal config failed"
# honeypot → fake success, no write
HP=$(curl -s -X POST "$BASE/api/public/portal/support/tickets" -H 'content-type: application/json' \
  -d "{\"name\":\"Bot\",\"email\":\"bot$TS@example.com\",\"subject\":\"spam\",\"favorite_color\":\"blue\"}")
echo "$HP" | grep -q '"ok":true' && ok "honeypot submission → fake success" || bad "honeypot not blocked"
# real submission → ticket with reference
SUB=$(curl -s -X POST "$BASE/api/public/portal/support/tickets" -H 'content-type: application/json' \
  -d "{\"name\":\"Portal Tester\",\"email\":\"portal$TS@example.com\",\"subject\":\"Portal smoke $TS\",\"body\":\"Help!\"}")
PREF=$(echo "$SUB" | jget "['reference']")
[ -n "$PREF" ] && ok "portal submission created ticket ($PREF)" || bad "portal submit failed: $SUB"
# lookup with correct email → found
LK=$(curl -s -X POST "$BASE/api/public/portal/support/lookup" -H 'content-type: application/json' \
  -d "{\"email\":\"portal$TS@example.com\",\"reference\":\"$PREF\"}")
echo "$LK" | grep -q '"found":true' && ok "portal lookup finds ticket" || bad "lookup failed: $LK"
# lookup with wrong email → not found (no-leak)
LKBAD=$(curl -s -X POST "$BASE/api/public/portal/support/lookup" -H 'content-type: application/json' \
  -d "{\"email\":\"someone-else@example.com\",\"reference\":\"$PREF\"}")
echo "$LKBAD" | grep -q '"found":false' && ok "portal lookup no-leak (wrong email)" || bad "no-leak violated: $LKBAD"
# unknown portal → 400
R400=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/public/portal/does-not-exist")
check "$R400" "400" "unknown portal → 400"
# rate limit: a 25-request burst must trip the per-IP guard (at least one 400)
RL=0
for i in $(seq 1 25); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/public/portal/support/tickets" -H 'content-type: application/json' \
    -d "{\"name\":\"Burst $i\",\"email\":\"burst$TS-$i@example.com\",\"subject\":\"burst $i\"}")
  if [ "$CODE" != "201" ]; then RL=$((RL+1)); fi
done
[ "$RL" -ge 1 ] && ok "portal rate limit trips on burst ($RL rejected)" || bad "portal rate limit did not trip"

# ── 12. Workflow triggers on ticket events ───────────────────────────────────
WF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/automations" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke ticket wf $TS\",\"trigger\":{\"kind\":\"event\",\"event\":\"ticket.status_changed\",\"to\":\"resolved\"},\"conditions\":[{\"field\":\"priority\",\"op\":\"eq\",\"value\":\"high\"}],\"actions\":[{\"type\":\"notify\",\"title\":\"Smoke wf fired\",\"target\":\"owner\"}]}")
WF_ID=$(echo "$WF" | jget "['automation']['id']")
[ -n "$WF_ID" ] && ok "workflow on ticket.status_changed created" || bad "ticket workflow create failed: $WF"
# trigger it with a FRESH high-priority ticket (the earlier smoke ticket is
# now urgent — conditions are priority=high, so it must not match that one).
WFT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets" $ENV -H 'content-type: application/json' \
  -d "{\"subject\":\"Workflow target $TS\",\"priority\":\"high\",\"channel\":\"web\"}")
WFT_ID=$(echo "$WFT" | jget "['id']")
curl -s -b "$COOKIE" -X PATCH "$BASE/api/tickets/$WFT_ID" $ENV -H 'content-type: application/json' -d '{"status":"resolved"}' > /dev/null
sleep 1
WFCOUNT=$(curl -s -b "$COOKIE" "$BASE/api/automations/$WF_ID" $ENV | jget "['automation']['runCount']")
[ "$WFCOUNT" -ge 1 ] && ok "ticket.status_changed workflow fired (runCount=$WFCOUNT)" || bad "ticket workflow did not fire (runCount=$WFCOUNT)"

# ── 13. Feature gates ────────────────────────────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/service.tickets" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/tickets" $ENV)
check "$FG" "403" "flag disabled → tickets API 403"
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/portals" $ENV)
check "$FG2" "403" "flag disabled → portals API 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/service.tickets" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG3=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/tickets" $ENV)
check "$FG3" "200" "flag re-enabled → tickets API 200"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/service.knowledge" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG4=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/knowledge" $ENV)
check "$FG4" "403" "knowledge flag disabled → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/service.knowledge" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
# portal public intake still works when ticket flag disabled (public surface unaffected)
FG5=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/public/portal/support")
check "$FG5" "200" "public portal unaffected by admin flag"

# ── 14. Sandbox isolation ────────────────────────────────────────────────────
SB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tickets" -H 'x-environment:sandbox' -H 'content-type: application/json' \
  -d "{\"subject\":\"Sandbox ticket $TS\",\"priority\":\"high\"}")
SB_ID=$(echo "$SB" | jget "['id']")
[ -n "$SB_ID" ] && ok "ticket created in sandbox env" || bad "sandbox ticket failed: $SB"
SB_LIST=$(curl -s -b "$COOKIE" "$BASE/api/tickets?q=Sandbox" -H 'x-environment:sandbox')
echo "$SB_LIST" | grep -q "Sandbox ticket" && ok "sandbox ticket visible in sandbox" || bad "sandbox ticket missing"
PROD_LIST=$(curl -s -b "$COOKIE" "$BASE/api/tickets?q=Sandbox" $ENV)
echo "$PROD_LIST" | grep -q "Sandbox ticket" && bad "sandbox ticket leaked into production" || ok "sandbox ticket invisible in production"

# ── 15. Cleanup (leave demo data pristine) ───────────────────────────────────
curl -s -b "$COOKIE" -X DELETE "$BASE/api/tickets/$TICKET_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/tickets/$OLD_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/tickets/$INTAKE_ID" $ENV > /dev/null
[ -n "${WFT_ID:-}" ] && curl -s -b "$COOKIE" -X DELETE "$BASE/api/tickets/$WFT_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/tickets/$SB_ID" -H 'x-environment:sandbox' > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/knowledge/$KB_ID" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/automations/$WF_ID" $ENV > /dev/null
# portal submissions created contacts — clean the smoke ones
for email in "smoke$TS@example.com" "portal$TS@example.com"; do
  CID=$(curl -s -b "$COOKIE" "$BASE/api/contacts?q=$email" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
print(d['items'][0]['id'] if d['items'] else '')
")
  [ -n "$CID" ] && curl -s -b "$COOKIE" -X DELETE "$BASE/api/contacts/$CID" $ENV > /dev/null
done
LEADCLEAN=$(curl -s -b "$COOKIE" "$BASE/api/leads" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
for it in d['items']:
    if it.get('firstName')=='Support' and it.get('lastName')=='Lead': print(it['id']); break
")
[ -n "$LEADCLEAN" ] && curl -s -b "$COOKIE" -X DELETE "$BASE/api/leads/$LEADCLEAN" $ENV > /dev/null
PROBE=$(curl -s -b "$COOKIE" "$BASE/api/tickets?q=Smoke%20ticket" $ENV)
echo "$PROBE" | grep -q "Smoke ticket" && bad "smoke ticket left behind" || ok "smoke tickets cleaned up"
summary "PHASE 4 SMOKE SUITE"
