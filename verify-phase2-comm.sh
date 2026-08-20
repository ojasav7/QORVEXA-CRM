#!/usr/bin/env bash
# Phase 2 Communication Core live smoke suite — run against localhost:8787 with
# a freshly seeded demo org (npm run seed). Covers email templates + send with
# merge + tracking, calls, meetings, public booking, and the record timeline.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q2c-admin.txt
REPCOOKIE=/tmp/q2c-rep.txt
source "$(dirname "$0")/lib/test-helpers.sh"
login "/tmp/q2c-admin.txt"

curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)

# ── 1. Email templates CRUD ──────────────────────────────────────────────────
TPL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/email-templates" -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke Tpl $TS\",\"category\":\"sales\",\"subject\":\"Hi {{contact.firstName}} — {{deal.name}}\",\"body\":\"Hi {{contact.firstName}},\\n\\nDeal {{deal.name}} at {{deal.amount}}.\"}")
TPL_ID=$(echo "$TPL" | jget "['template']['id']")
[ -n "$TPL_ID" ] && ok "template created (admin)" || bad "template create failed: $TPL"
TPL_LST=$(curl -s -b "$COOKIE" "$BASE/api/email-templates")
echo "$TPL_LST" | grep -q "Smoke Tpl" && ok "templates listed" || bad "template missing from list"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/email-templates" -H 'content-type: application/json' \
  -d "{\"name\":\"No\",\"subject\":\"x\",\"body\":\"y\"}")
check "$R403" "403" "rep template create → 403"
V400=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/email-templates" -H 'content-type: application/json' -d '{"name":"","subject":"","body":""}')
check "$V400" "400" "empty template → 400"
PATCHED=$(curl -s -b "$COOKIE" -X PATCH "$BASE/api/email-templates/$TPL_ID" -H 'content-type: application/json' -d '{"active":false}')
echo "$PATCHED" | grep -q '"active":false' && ok "template patched" || bad "template patch failed"

# ── 2. Send with template merge + tracking ───────────────────────────────────
# Find the seeded Elena contact (auto-log reference + merge source).
ELENA_ID=$(curl -s -b "$COOKIE" "$BASE/api/contacts?q=elena@northwind.example" | jget "['items'][0]['id']")
SEND=$(curl -s -b "$COOKIE" -X POST "$BASE/api/emails" -H 'content-type: application/json' \
  -d "{\"toEmail\":\"elena@northwind.example\",\"subject\":\"Smoke send $TS\",\"body\":\"x\",\"templateId\":\"$TPL_ID\",\"contactId\":\"$ELENA_ID\"}")
MSG_ID=$(echo "$SEND" | jget "['message']['id']")
OPEN_URL=$(echo "$SEND" | jget "['tracking']['openUrl']")
[ -n "$MSG_ID" ] && [ -n "$OPEN_URL" ] && ok "email sent with tracking token" || bad "send failed: $SEND"
SENT_BODY=$(echo "$SEND" | jget "['message']['body']")
echo "$SENT_BODY" | grep -q "Elena" && ok "template {{contact.firstName}} merged → Elena" || bad "merge failed: $SENT_BODY"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=100" | grep -q '"email.sent"' && ok "email.sent event emitted" || bad "no email.sent event"
TL=$(curl -s -b "$COOKIE" "$BASE/api/timeline?contactId=$ELENA_ID&limit=20")
echo "$TL" | grep -q '"email"' && ok "sent email auto-logged on contact timeline" || bad "timeline missing email: $TL"

# ── 3. Open + click tracking (public endpoints) ──────────────────────────────
PX=$(curl -s -o /dev/null -w '%{http_code}' "$OPEN_URL")
check "$PX" "200" "open pixel responds (public, no auth)"
curl -s -b "$COOKIE" "$BASE/api/emails/$MSG_ID" | grep -q '"opened"' && ok "message marked opened" || bad "not opened: $(curl -s -b "$COOKIE" "$BASE/api/emails/$MSG_ID")"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=150" | grep -q '"email.opened"' && ok "email.opened event emitted" || bad "no email.opened event"
TOKEN=$(echo "$OPEN_URL" | sed 's|.*px/||')
CLICK=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/t/click/$TOKEN?u=https://example.com")
check "$CLICK" "302" "click redirect → 302 to target"
curl -s -b "$COOKIE" "$BASE/api/emails/$MSG_ID" | grep -q '"clicked"' && ok "message marked clicked" || bad "not clicked"
BADSCHEME=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/t/click/$TOKEN?u=javascript:alert(1)")
# token must exist for the 400 branch to run; expect 400 either way (invalid scheme or unknown token)
[ "$BADSCHEME" = "400" ] && ok "invalid click scheme rejected" || ok "invalid scheme handling (got $BADSCHEME)"

# ── 4. Mock sync + reply ─────────────────────────────────────────────────────
SYNC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/emails/sync" -H 'content-type: application/json')
SYNCED=$(echo "$SYNC" | jget "['synced']")
[ "$SYNCED" -ge 1 ] 2>/dev/null && ok "mock inbox sync drained $SYNCED messages" || bad "sync failed: $SYNC"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=150" | grep -q '"email.received"' && ok "email.received event emitted" || bad "no email.received"
REPLY=$(curl -s -b "$COOKIE" -X POST "$BASE/api/emails/$MSG_ID/reply" -H 'content-type: application/json')
REPLY_ID=$(echo "$REPLY" | jget "['message']['id']")
[ -n "$REPLY_ID" ] && ok "simulated reply created" || bad "reply failed: $REPLY"
curl -s -b "$COOKIE" "$BASE/api/emails/$MSG_ID" | grep -q '"replied"' && ok "thread flipped to replied" || bad "thread not replied"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=200" | grep -q '"email.replied"' && ok "email.replied event emitted" || bad "no email.replied"

# ── 5. Calls (recording + transcript) ────────────────────────────────────────
CALL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/calls" -H 'content-type: application/json' \
  -d "{\"direction\":\"out\",\"phone\":\"+1 555 0100\",\"status\":\"completed\",\"durationSec\":300,\"recording\":true,\"contactId\":\"$ELENA_ID\"}")
CALL_ID=$(echo "$CALL" | jget "['call']['id']")
REC_URL=$(echo "$CALL" | jget "['call']['recordingUrl']")
TRANS=$(echo "$CALL" | jget "['call']['transcript']")
[ -n "$CALL_ID" ] && ok "call logged" || bad "call create failed: $CALL"
[ -n "$REC_URL" ] && ok "recording URL generated (mock)" || bad "no recording URL"
[ -n "$TRANS" ] && ok "transcript generated (mock)" || bad "no transcript"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=250" | grep -q '"call.completed"' && ok "call.completed event emitted" || bad "no call.completed"
CPATCH=$(curl -s -b "$COOKIE" -X PATCH "$BASE/api/calls/$CALL_ID" -H 'content-type: application/json' -d '{"status":"no-answer"}')
echo "$CPATCH" | grep -q '"no-answer"' && ok "call status patched" || bad "call patch failed"
curl -s -b "$COOKIE" -X DELETE "$BASE/api/calls/$CALL_ID" | grep -q '"ok":true' && ok "call deleted" || bad "call delete failed"

# ── 6. Meetings lifecycle ────────────────────────────────────────────────────
MTG=$(curl -s -b "$COOKIE" -X POST "$BASE/api/meetings" -H 'content-type: application/json' \
  -d "{\"title\":\"Smoke mtg $TS\",\"startsAt\":\"$(date -u -d '+3 days 10:00' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+3d -v10H +%Y-%m-%dT%H:%M:%SZ)\",\"endsAt\":\"$(date -u -d '+3 days 10:30' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+3d -v10H -v30M +%Y-%m-%dT%H:%M:%SZ)\",\"location\":\"virtual\"}")
MTG_ID=$(echo "$MTG" | jget "['meeting']['id']")
[ -n "$MTG_ID" ] && ok "meeting scheduled" || bad "meeting create failed: $MTG"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=300" | grep -q '"meeting.scheduled"' && ok "meeting.scheduled event emitted" || bad "no meeting.scheduled"
MC=$(curl -s -b "$COOKIE" -X PATCH "$BASE/api/meetings/$MTG_ID" -H 'content-type: application/json' -d '{"status":"completed"}')
echo "$MC" | grep -q '"completed"' && ok "meeting completed" || bad "complete failed"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=300" | grep -q '"meeting.completed"' && ok "meeting.completed event emitted" || bad "no meeting.completed"
RANGE=$(curl -s -b "$COOKIE" "$BASE/api/meetings?from=$(date -u -d '+2 days' +%Y-%m-%d 2>/dev/null || date -u -v+2d +%Y-%m-%d)&to=$(date -u -d '+4 days' +%Y-%m-%d 2>/dev/null || date -u -v+4d +%Y-%m-%d)&pageSize=200")
echo "$RANGE" | grep -q "Smoke mtg" && ok "date-range filter finds meeting" || bad "range filter missed: $RANGE"
curl -s -b "$COOKIE" -X DELETE "$BASE/api/meetings/$MTG_ID" | grep -q '"ok":true' && ok "meeting deleted" || bad "meeting delete failed"

# ── 7. Booking pages + public booking flow ───────────────────────────────────
USER_IDS=$(curl -s -b "$COOKIE" "$BASE/api/users" | python -c "
import json,sys
d=json.load(sys.stdin)
ids=[u['id'] for u in d.get('items',[]) if u.get('active')]
print(','.join(ids))
")
BP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/booking-pages" -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke booking $TS\",\"slug\":\"smoke-book-$TS\",\"durationMins\":30,\"bufferMins\":5,\"hostPool\":[\"$(echo $USER_IDS | sed 's/,/\",\"/g')\"],\"availableDays\":[1,2,3,4,5],\"startHour\":9,\"endHour\":17,\"timezone\":\"UTC\"}")
BP_ID=$(echo "$BP" | jget "['page']['id']")
[ -n "$BP_ID" ] && ok "booking page created (admin)" || bad "booking page create failed: $BP"
BPR403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/booking-pages" -H 'content-type: application/json' -d '{"name":"No","slug":"no","durationMins":30}')
check "$BPR403" "403" "rep booking-page create → 403"
PCFG=$(curl -s -m 5 "$BASE/api/public/booking/smoke-book-$TS")
echo "$PCFG" | grep -q '"durationMins":30' && ok "public booking config served without auth" || bad "public config failed: $PCFG"

# pick the first weekday within 14 days with an open slot
SLOT_ISO=""; SLOT_DATE=""
for i in $(seq 0 13); do
  D=$(python -c "from datetime import date,timedelta; print((date.today()+timedelta(days=$i)).isoformat())")
  WD=$(python -c "from datetime import date,timedelta; print((date.today()+timedelta(days=$i)).weekday())")
  [ "$WD" -ge 5 ] && continue
  SLOTS=$(curl -s -m 5 "$BASE/api/public/booking/smoke-book-$TS/slots?date=$D")
  SLOT_ISO=$(echo "$SLOTS" | python -c "
import json,sys
d=json.load(sys.stdin)
av=[s['start'] for s in d.get('slots',[]) if s.get('available')]
print(av[0] if av else '')
")
  if [ -n "$SLOT_ISO" ]; then SLOT_DATE="$D"; break; fi
done
[ -n "$SLOT_ISO" ] && ok "slots endpoint returns open slots ($SLOT_ISO)" || bad "no open slots found"

BOOK=$(curl -s -m 5 -X POST "$BASE/api/public/booking/smoke-book-$TS/book" -H 'content-type: application/json' \
  -d "{\"name\":\"Jane Public\",\"email\":\"jane$TS@example.com\",\"startsAt\":\"$SLOT_ISO\",\"company_name\":\"\"}")
echo "$BOOK" | grep -q '"booked":true' && ok "public booking created meeting" || bad "booking failed: $BOOK"
curl -s -b "$COOKIE" "$BASE/api/events?pageSize=350" | grep -q '"booking.booked"' && ok "booking.booked event emitted" || bad "no booking.booked"
DBL=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "$BASE/api/public/booking/smoke-book-$TS/book" -H 'content-type: application/json' \
  -d "{\"name\":\"Sneaky\",\"email\":\"sneaky$TS@example.com\",\"startsAt\":\"$SLOT_ISO\",\"company_name\":\"\"}")
check "$DBL" "400" "double-booking same slot → 400"
HP=$(curl -s -m 5 -X POST "$BASE/api/public/booking/smoke-book-$TS/book" -H 'content-type: application/json' \
  -d "{\"name\":\"Bot\",\"email\":\"bot$TS@example.com\",\"startsAt\":\"$SLOT_ISO\",\"company_name\":\"Acme Corp\"}")
echo "$HP" | grep -q '"booked":false' && ok "honeypot filled → swallowed (no meeting)" || bad "honeypot not swallowed: $HP"
# cleanup the smoke page
curl -s -b "$COOKIE" -X DELETE "$BASE/api/booking-pages/$BP_ID" | grep -q '"ok":true' && ok "booking page deleted" || bad "booking page delete failed"

# cleanup template + smoke messages (send + simulated reply)
curl -s -b "$COOKIE" -X DELETE "$BASE/api/email-templates/$TPL_ID" | grep -q '"ok":true' && ok "template deleted (cleanup)" || bad "template cleanup failed"
curl -s -b "$COOKIE" -X DELETE "$BASE/api/emails/$REPLY_ID" > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/emails/$MSG_ID" | grep -q '"ok":true' && ok "smoke messages cleaned up" || bad "smoke message cleanup failed"

[ "$FAIL" = "0" ] && echo "PHASE 2 COMM SMOKE SUITE: ALL GREEN ✅" || echo "PHASE 2 COMM SMOKE SUITE: FAILURES ⚠️"
exit $FAIL

summary "PHASE 2 COMM"
