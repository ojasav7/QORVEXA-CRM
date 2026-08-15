#!/usr/bin/env bash
# Phase 14 Enterprise Security live smoke suite — run against localhost:8787
# with a freshly booted + seeded stack (npm run db:push --force-reset && npm run
# seed, then start the server). Covers the seeded security posture, the full MFA
# (TOTP + recovery codes) login handshake, DB-backed session/device management,
# the org security policy + IP-allowlist enforcement (with threat alerts), the
# consent/privacy center + DSR fulfillment, retention policies (delete +
# anonymize over backdated rows → retention.policy_applied), the status/uptime
# page + incidents, sub-processor transparency, i18n config + localization QA,
# SCIM 2.0 provisioning (Users + Groups with a scim-scoped token), RBAC,
# per-area feature gates, and sandbox isolation.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q14-admin.txt
REPCOOKIE=/tmp/q14-rep.txt
MIACOOKIE=/tmp/q14-mia.txt
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (expected '$2' got '$1')"; fi; }
jget() { python -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

# RFC 6238 TOTP in pure python (HMAC-SHA1, 6 digits, 30s window).
totp() {
  python - "$1" <<'EOF'
import hmac, hashlib, struct, base64, sys, time
secret = sys.argv[1]
pad = secret + "=" * ((8 - len(secret) % 8) % 8)
key = base64.b32decode(pad.upper())
counter = struct.pack(">Q", int(time.time()) // 30)
h = hmac.new(key, counter, hashlib.sha1).digest()
o = h[19] & 15
code = (struct.unpack(">I", h[o:o+4])[0] & 0x7fffffff) % 1000000
print(f"{code:06d}")
EOF
}

rm -f "$COOKIE" "$REPCOOKIE" "$MIACOOKIE"
curl -s -c "$COOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"admin@qorvexa.dev","password":"password123"}' > /dev/null
curl -s -c "$REPCOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"leo@qorvexa.dev","password":"password123"}' > /dev/null
curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)
ENV='-H x-environment:production'

# ── 1. Seeds & overview ────────────────────────────────────────────────────
OV=$(curl -s -b "$COOKIE" "$BASE/api/security/overview" $ENV)
echo "$OV" | grep -q '"consents":4' && ok "overview: 4 seeded consent records" || bad "consents wrong: $OV"
echo "$OV" | grep -q '"policies":1' && ok "overview: 1 seeded retention policy" || bad "policies wrong: $OV"
echo "$OV" | grep -q '"subProcessors":3' && ok "overview: 3 seeded sub-processors" || bad "subprocessors wrong: $OV"
echo "$OV" | grep -q '"openIncidents":1' && ok "overview: 1 open status incident" || bad "incidents wrong: $OV"
python -c "import json,sys; d=json.loads('''$OV'''); exit(0 if d['sessions'] >= 1 else 1)" && ok "overview: DB-backed sessions counted" || bad "sessions wrong: $OV"
echo "$OV" | grep -q '"mfaEnabledUsers":0' && ok "overview: MFA adoption report (0/total seeded)" || bad "mfa report wrong: $OV"
# i18n config rides on the overview too.
echo "$OV" | grep -q '"locale":"en"' && echo "$OV" | grep -q '"currency":"USD"' && ok "overview: i18n config (en/USD/UTC)" || bad "i18n on overview wrong"

# Record a degraded email tick first so the derived report is deterministic
# (the engine records api ticks every minute; a boot-time 'down' tick may exist).
curl -s -b "$COOKIE" -X POST "$BASE/api/security/status/tick" $ENV -H 'content-type: application/json' -d '{"component":"email","status":"degraded","latencyMs":800,"message":"verify"}' > /dev/null
STS=$(curl -s -b "$COOKIE" "$BASE/api/security/status?days=30" $ENV)
python -c "import json,sys; d=json.loads('''$STS'''); c=d['components']; exit(0 if c['api']['total']>=1 and c['api']['up']>=1 else 1)" && ok "status: api component has up ticks" || bad "api ticks wrong: $STS"
python -c "import json,sys; d=json.loads('''$STS'''); c=d['components']; exit(0 if c['email']['degraded']>=1 else 1)" && ok "status: email degraded ticks recorded" || bad "email ticks missing: $STS"
python -c "import json,sys; d=json.loads('''$STS'''); exit(0 if len(d['incidents'])>=1 and d['incidents'][0]['status']=='investigating' else 1)" && ok "status: seeded open incident" || bad "incident missing: $STS"

I18N=$(curl -s -b "$COOKIE" "$BASE/api/security/i18n" $ENV)
echo "$I18N" | grep -q '"locale":"en"' && echo "$I18N" | grep -q '"timezone":"UTC"' && ok "i18n: default en/UTC/USD" || bad "i18n defaults wrong: $I18N"
python -c "import json,sys; d=json.loads('''$I18N'''); exit(0 if d['catalogSize']==44 and len(d['qa']['locales'])==6 else 1)" && ok "i18n: 44-key catalog + 6 locales seeded" || bad "catalog wrong: $I18N"
python -c "import json,sys; d=json.loads('''$I18N'''); en=[l for l in d['qa']['locales'] if l['locale']=='en'][0]; exit(0 if en['completenessPct']==100 else 1)" && ok "i18n: en baseline 100% complete" || bad "en completeness wrong"

SCI=$(curl -s -b "$COOKIE" "$BASE/api/security/scim" $ENV)
echo "$SCI" | grep -q '"users":3' && echo "$SCI" | grep -q '"groups":1' && ok "scim: 3 users + 1 group seeded" || bad "scim seed wrong: $SCI"

# ── 2. RBAC ────────────────────────────────────────────────────────────────
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/security/overview" $ENV)
check "$RGET" "200" "rep can read security overview (monitoring surface)"
RPOL=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X PUT "$BASE/api/security/policy" $ENV -H 'content-type: application/json' -d '{"requireMfa":true}')
check "$RPOL" "403" "rep policy write → 403 (admin only)"
RRET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/security/retention" $ENV -H 'content-type: application/json' -d '{"name":"x","entity":"lead","olderThanDays":30,"action":"delete"}')
check "$RRET" "403" "rep create retention policy → 403 (admin only)"
RSUB=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/security/subprocessors" $ENV -H 'content-type: application/json' -d '{"name":"X","purpose":"Y","region":"Z"}')
check "$RSUB" "403" "rep add sub-processor → 403 (admin only)"
RTICK=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/security/status/tick" $ENV -H 'content-type: application/json' -d '{"component":"api","status":"up"}')
check "$RTICK" "403" "rep status tick → 403 (admin only)"
RINC=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/security/status/incidents" $ENV -H 'content-type: application/json' -d '{"title":"x","message":"y"}')
check "$RINC" "403" "rep declare incident → 403 (admin only)"
RI18N=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X PUT "$BASE/api/security/i18n" $ENV -H 'content-type: application/json' -d '{"locale":"es"}')
check "$RI18N" "403" "rep i18n config → 403 (admin only)"
RSCIM=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/security/scim" $ENV)
check "$RSCIM" "403" "rep SCIM admin view → 403 (admin only)"
RACK=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/security/alerts/000000000000000000000000/acknowledge" $ENV)
check "$RACK" "403" "rep acknowledge alert → 403 (manager+ only)"

# ── 3. MFA end-to-end (setup → login challenge → TOTP → recovery code) ─────
MIA=$(curl -s -b "$COOKIE" -X POST "$BASE/api/users" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Mia Test\",\"email\":\"mia-$TS@qorvexa.dev\",\"password\":\"password123\",\"role\":\"rep\"}")
echo "$MIA" | grep -q '"role":"rep"' && ok "created MFA test user" || bad "user create failed: $MIA"
curl -s -c "$MIACOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"mia-$TS@qorvexa.dev\",\"password\":\"password123\"}" > /dev/null
SETUP=$(curl -s -b "$MIACOOKIE" -X POST "$BASE/api/security/mfa/setup" $ENV -H 'content-type: application/json' -d '{}')
SECRET=$(echo "$SETUP" | jget "['secret']")
echo "$SETUP" | grep -q '"otpauth://totp/' && echo "$SETUP" | grep -q '"previewCode"' && ok "mfa: setup returns secret + otpauth + preview code" || bad "mfa setup failed: $SETUP"
PREVIEW=$(echo "$SETUP" | jget "['previewCode']")
VERIFY=$(curl -s -b "$MIACOOKIE" -X POST "$BASE/api/security/mfa/verify" $ENV -H 'content-type: application/json' -d "{\"code\":\"$PREVIEW\"}")
python -c "import json,sys; d=json.loads('''$VERIFY'''); exit(0 if len(d['recoveryCodes'])==10 else 1)" && ok "mfa: verify enables + returns 10 recovery codes" || bad "mfa verify failed: $VERIFY"
RECOVERY=$(echo "$VERIFY" | jget "['recoveryCodes'][0]")
curl -s -b "$COOKIE" "$BASE/api/events?type=mfa.enabled&pageSize=3" $ENV | grep -q '"type":"mfa.enabled"' && ok "mfa.enabled event emitted" || bad "mfa.enabled event missing"
# Logout → login now requires the second factor.
curl -s -b "$MIACOOKIE" -X POST "$BASE/api/auth/logout" > /dev/null
CHALLENGE=$(curl -s -c "$MIACOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"mia-$TS@qorvexa.dev\",\"password\":\"password123\"}")
echo "$CHALLENGE" | grep -q '"mfaRequired":true' && echo "$CHALLENGE" | grep -q '"mfaToken"' && ok "login issues MFA challenge (no session cookie)" || bad "mfa challenge missing: $CHALLENGE"
MFATOKEN=$(echo "$CHALLENGE" | jget "['mfaToken']")
TOTPCODE=$(totp "$SECRET")
MFAOK=$(curl -s -c "$MIACOOKIE" -X POST "$BASE/api/auth/mfa-verify" -H 'content-type: application/json' -d "{\"mfaToken\":\"$MFATOKEN\",\"code\":\"$TOTPCODE\"}")
echo "$MFAOK" | grep -q '"role":"rep"' && ok "TOTP code completes the login handshake" || bad "totp verify failed: $MFAOK"
curl -s -b "$MIACOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "session valid after MFA handshake" || bad "session invalid after MFA"
# Recovery code path.
curl -s -b "$MIACOOKIE" -X POST "$BASE/api/auth/logout" > /dev/null
CH2=$(curl -s -c "$MIACOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"mia-$TS@qorvexa.dev\",\"password\":\"password123\"}")
MT2=$(echo "$CH2" | jget "['mfaToken']")
RC=$(curl -s -X POST "$BASE/api/auth/mfa-verify" -H 'content-type: application/json' -d "{\"mfaToken\":\"$MT2\",\"code\":\"$RECOVERY\"}" | jget "['user']['role']")
check "$RC" "rep" "one-time recovery code completes login"
# Failed attempt → security alert + security.threat_detected.
curl -s -b "$MIACOOKIE" -X POST "$BASE/api/auth/logout" > /dev/null
CH3=$(curl -s -c "$MIACOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"mia-$TS@qorvexa.dev\",\"password\":\"password123\"}")
MT3=$(echo "$CH3" | jget "['mfaToken']")
BADCODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/mfa-verify" -H 'content-type: application/json' -d "{\"mfaToken\":\"$MT3\",\"code\":\"000000\"}")
check "$BADCODE" "400" "wrong TOTP rejected"
curl -s -b "$COOKIE" "$BASE/api/events?type=security.threat_detected&pageSize=10" $ENV | grep -q '"category":"mfa"' && ok "failed MFA raises security.threat_detected" || bad "threat event missing"
# Disable with a valid TOTP (restores the user to password-only). Complete a
# fresh MFA login first so the disable request runs with a valid session.
CH4=$(curl -s -c "$MIACOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"mia-$TS@qorvexa.dev\",\"password\":\"password123\"}")
MT4=$(echo "$CH4" | jget "['mfaToken']")
DCODE=$(totp "$SECRET")
curl -s -b "$MIACOOKIE" -c "$MIACOOKIE" -X POST "$BASE/api/auth/mfa-verify" -H 'content-type: application/json' -d "{\"mfaToken\":\"$MT4\",\"code\":\"$DCODE\"}" > /dev/null
DIS=$(curl -s -b "$MIACOOKIE" -X POST "$BASE/api/security/mfa/disable" $ENV -H 'content-type: application/json' -d "{\"code\":\"$DCODE\"}")
echo "$DIS" | grep -q '"ok":true' && ok "mfa disable with valid TOTP" || bad "mfa disable failed: $DIS"
curl -s -b "$COOKIE" "$BASE/api/events?type=mfa.disabled&pageSize=3" $ENV | grep -q '"type":"mfa.disabled"' && ok "mfa.disabled event emitted" || bad "mfa.disabled event missing"
# Feature gate: sec.mfa off → setup 403.
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/sec.mfa" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
MFAGATE=$(curl -s -o /dev/null -w '%{http_code}' -b "$MIACOOKIE" -X POST "$BASE/api/security/mfa/setup" $ENV -H 'content-type: application/json' -d '{}')
check "$MFAGATE" "403" "sec.mfa gate: setup blocked when flag off"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/sec.mfa" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null

# ── 4. Sessions & devices ──────────────────────────────────────────────────
SESS=$(curl -s -b "$COOKIE" "$BASE/api/security/sessions" $ENV)
python -c "import json,sys; d=json.loads('''$SESS'''); exit(0 if len(d['items'])>=2 else 1)" && ok "sessions: admin + rep sessions listed with device labels" || bad "sessions missing: $SESS"
REPSID=$(curl -s -b "$COOKIE" "$BASE/api/security/sessions" $ENV | python -c "
import json,sys
d=json.load(sys.stdin)
items=[s for s in d['items'] if not s['revokedAt'] and s['user'] and s['user']['email']=='leo@qorvexa.dev']
print(items[0]['id'] if items else '')")
REV=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/sessions/$REPSID/revoke" $ENV -H 'content-type: application/json' -d '{}')
echo "$REV" | grep -q '"ok":true' && ok "revoke a specific session" || bad "revoke failed: $REV"
curl -s -b "$COOKIE" "$BASE/api/events?type=session.revoked&pageSize=3" $ENV | grep -q '"type":"session.revoked"' && ok "session.revoked event emitted" || bad "session.revoked missing"
# The revoked rep session is now signed out.
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"user":null' && ok "revoked session invalidated (rep signed out)" || bad "revoked session still valid"
RA=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/sessions/revoke-all" $ENV -H 'content-type: application/json' -d '{}')
python -c "import json,sys; d=json.loads('''$RA'''); exit(0 if d['revoked']>=1 else 1)" && ok "revoke-all signs out other devices (current kept)" || bad "revoke-all failed: $RA"
# Re-login the rep AFTER the revoke-all sweep (it revokes every non-current
# session) so the rest of the suite runs with a live rep cookie.
curl -s -c "$REPCOOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"leo@qorvexa.dev","password":"password123"}' > /dev/null
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep re-login after revoke-all" || bad "rep re-login failed"

# ── 5. Policy + IP-allowlist enforcement ───────────────────────────────────
POL=$(curl -s -b "$COOKIE" "$BASE/api/security/policy" $ENV)
echo "$POL" | grep -q '"sessionTtlDays":30' && echo "$POL" | grep -q '"clientIp":"127.0.0.1"' && ok "policy: defaults + client IP" || bad "policy wrong: $POL"
# Enable restriction with the loopback IP allowed → requests keep working.
P1=$(curl -s -b "$COOKIE" -X PUT "$BASE/api/security/policy" $ENV -H 'content-type: application/json' -d '{"ipRestrictionEnabled":true,"ipAllowlist":["127.0.0.1"]}')
echo "$P1" | grep -q '"ipRestrictionEnabled":true' && ok "policy: IP restriction enabled with allowlist" || bad "policy save failed: $P1"
DI=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/debug/ip-allowed" $ENV -H 'content-type: application/json' -d '{"ip":"1.2.3.4"}')
echo "$DI" | grep -q '"allowed":false' && ok "policy: foreign IP rejected by allowlist" || bad "foreign IP allowed: $DI"
DI2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/debug/ip-allowed" $ENV -H 'content-type: application/json' -d '{"ip":"127.0.0.1"}')
echo "$DI2" | grep -q '"allowed":true' && ok "policy: allowlisted IP passes" || bad "allowlisted IP rejected: $DI2"
# Now lock the org out (allowlist excludes 127.0.0.1) → the NEXT request is 403 + alert.
curl -s -b "$COOKIE" -X PUT "$BASE/api/security/policy" $ENV -H 'content-type: application/json' -d '{"ipAllowlist":["10.99.99.99"]}' > /dev/null
LOCKED=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/security/alerts" $ENV)
check "$LOCKED" "403" "IP restriction enforcement blocks excluded IPs"
npx tsx server/scripts/q14-backdate.ts --recover-ip 2>&1 | tail -1
AL=$(curl -s -b "$COOKIE" "$BASE/api/security/alerts" $ENV)
echo "$AL" | grep -q '"category":"ip"' && ok "blocked request raised an ip-category security alert" || bad "ip alert missing: $AL"
curl -s -b "$COOKIE" "$BASE/api/events?type=security.threat_detected&pageSize=10" $ENV | grep -q '"category":"ip"' && ok "security.threat_detected emitted for blocked request" || bad "threat event missing"
curl -s -b "$COOKIE" -X PUT "$BASE/api/security/policy" $ENV -H 'content-type: application/json' -d '{"ipRestrictionEnabled":false,"ipAllowlist":[]}' > /dev/null
UNLOCKED=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/security/alerts" $ENV)
check "$UNLOCKED" "200" "policy restored → requests allowed again"

# ── 6. Alerts ──────────────────────────────────────────────────────────────
IPALERT=$(echo "$AL" | python -c "import json,sys; d=json.load(sys.stdin); print([a['id'] for a in d['items'] if a['category']=='ip'][0])")
ACK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/alerts/$IPALERT/acknowledge" $ENV -H 'content-type: application/json' -d '{}')
echo "$ACK" | grep -q '"ok":true' && ok "acknowledge security alert" || bad "ack failed: $ACK"
AL2=$(curl -s -b "$COOKIE" "$BASE/api/security/alerts" $ENV)
echo "$AL2" | python -c "import json,sys; d=json.load(sys.stdin); a=[x for x in d['items'] if x['id']=='$IPALERT'][0]; exit(0 if a['acknowledgedAt'] else 1)" && ok "alert persisted as acknowledged" || bad "ack not persisted"

# ── 7. Consent & privacy center ────────────────────────────────────────────
CON=$(curl -s -b "$COOKIE" "$BASE/api/security/consent" $ENV)
echo "$CON" | grep -q '"total":4' && echo "$CON" | grep -q '"granted":3' && echo "$CON" | grep -q '"withdrawn":1' && ok "consent: seeded records (3 granted / 1 withdrawn)" || bad "consent seeds wrong: $CON"
C1=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/consent" $ENV -H 'content-type: application/json' \
  -d "{\"contactEmail\":\"verify-$TS@example.com\",\"purpose\":\"marketing\",\"status\":\"granted\",\"source\":\"verify\"}")
echo "$C1" | grep -q '"status":"granted"' && ok "record consent (admin/manager)" || bad "consent create failed: $C1"
curl -s -b "$COOKIE" "$BASE/api/events?type=consent.updated&pageSize=5" $ENV | grep -q '"type":"consent.updated"' && ok "consent.updated event emitted" || bad "consent event missing"
BADP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/security/consent" $ENV -H 'content-type: application/json' -d '{"contactEmail":"a@b.co","purpose":"nope","status":"granted"}')
check "$BADP" "400" "unknown consent purpose → 400"
# DSR lifecycle: submit → fulfill (export writes the subject's bundle).
DSR=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/dsrs" $ENV -H 'content-type: application/json' \
  -d '{"type":"export","requesterEmail":"elena@northwind.example","notes":"verify"}')
echo "$DSR" | grep -q '"type":"export"' && echo "$DSR" | grep -q '"status":"open"' && ok "submit data-subject request (export)" || bad "dsr create failed: $DSR"
DSRID=$(echo "$DSR" | jget "['dsr']['id']")
curl -s -b "$COOKIE" "$BASE/api/events?type=dsr.submitted&pageSize=3" $ENV | grep -q '"type":"dsr.submitted"' && ok "dsr.submitted event emitted" || bad "dsr.submitted missing"
FUL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/dsrs/$DSRID/fulfill" $ENV -H 'content-type: application/json' -d '{}')
echo "$FUL" | grep -q '"status":"completed"' && echo "$FUL" | grep -q '"bundlePath"' && ok "fulfill export DSR → contact bundle written" || bad "dsr fulfill failed: $FUL"
curl -s -b "$COOKIE" "$BASE/api/events?type=dsr.completed&pageSize=3" $ENV | grep -q '"type":"dsr.completed"' && ok "dsr.completed event emitted" || bad "dsr.completed missing"
# delete DSR on a throwaway email → consent rows purged.
curl -s -b "$COOKIE" -X POST "$BASE/api/security/consent" $ENV -H 'content-type: application/json' -d "{\"contactEmail\":\"forget-$TS@example.com\",\"purpose\":\"marketing\",\"status\":\"granted\"}" > /dev/null
DELDSR=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/dsrs" $ENV -H 'content-type: application/json' -d "{\"type\":\"delete\",\"requesterEmail\":\"forget-$TS@example.com\"}")
DELID=$(echo "$DELDSR" | jget "['dsr']['id']")
curl -s -b "$COOKIE" -X POST "$BASE/api/security/dsrs/$DELID/fulfill" $ENV -H 'content-type: application/json' -d '{}' > /dev/null
CONA=$(curl -s -b "$COOKIE" "$BASE/api/security/consent" $ENV)
echo "$CONA" | python -c "import json,sys; d=json.load(sys.stdin); exit(0 if not [r for r in d['items'] if r['contactEmail']=='forget-$TS@example.com'] else 1)" && ok "delete DSR purges the subject's consent records" || bad "delete DSR did not purge"
RFUL=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/security/dsrs/$DELID/fulfill" $ENV -H 'content-type: application/json' -d '{}')
check "$RFUL" "403" "rep fulfill DSR → 403 (admin only)"

# ── 8. Retention (delete + anonymize over backdated rows) ──────────────────
RET=$(curl -s -b "$COOKIE" "$BASE/api/security/retention" $ENV)
echo "$RET" | grep -q '"entity":"lead"' && echo "$RET" | grep -q '"action":"anonymize"' && ok "retention: seeded policy listed" || bad "retention seeds wrong: $RET"
echo "$RET" | grep -q '"entities":\["contact","lead","account","opportunity","ticket"\]' && ok "retention: supported entities catalog" || bad "entities wrong: $RET"
npx tsx server/scripts/q14-backdate.ts --del 2>&1 | tail -1
curl -s -b "$COOKIE" "$BASE/api/leads?q=retention-del" $ENV | grep -q '"email":"retention-del@qorvexa.dev"' && ok "backdated delete-target lead created" || bad "backdate --del failed"
RDEL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/retention" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify delete $TS\",\"entity\":\"lead\",\"olderThanDays\":365,\"action\":\"delete\"}")
echo "$RDEL" | grep -q '"action":"delete"' && ok "create delete policy" || bad "policy create failed: $RDEL"
RDID=$(echo "$RDEL" | jget "['policy']['id']")
RDRUN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/retention/$RDID/run" $ENV -H 'content-type: application/json' -d '{}')
echo "$RDRUN" | grep -q '"deleted":1' && ok "retention run deletes the backdated lead" || bad "delete run wrong: $RDRUN"
curl -s -b "$COOKIE" "$BASE/api/leads?q=retention-del" $ENV | grep -q '"total":0' && ok "deleted lead gone from list" || bad "lead still present"
# Pause the delete policy so the engine tick can't consume the anonymize target.
curl -s -b "$COOKIE" -X POST "$BASE/api/security/retention/$RDID/toggle" $ENV -H 'content-type: application/json' -d '{}' > /dev/null
npx tsx server/scripts/q14-backdate.ts --anon 2>&1 | tail -1
RANON=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/retention" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify anon $TS\",\"entity\":\"lead\",\"olderThanDays\":365,\"action\":\"anonymize\"}")
RAID=$(echo "$RANON" | jget "['policy']['id']")
RARUN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/retention/$RAID/run" $ENV -H 'content-type: application/json' -d '{}')
echo "$RARUN" | grep -q '"anonymized":1' && ok "retention run anonymizes the backdated lead" || bad "anonymize run wrong: $RARUN"
curl -s -b "$COOKIE" "$BASE/api/leads?q=redacted-" $ENV | grep -q '"email":"redacted-' && ok "anonymized lead's PII redacted in place" || bad "anonymize not applied"
curl -s -b "$COOKIE" "$BASE/api/events?type=retention.policy_applied&pageSize=5" $ENV | grep -q '"type":"retention.policy_applied"' && ok "retention.policy_applied event emitted" || bad "policy_applied event missing"
TOG=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/retention/$RAID/toggle" $ENV -H 'content-type: application/json' -d '{}')
echo "$TOG" | grep -q '"status":"paused"' && ok "toggle policy → paused" || bad "toggle failed: $TOG"

# ── 9. Status page: manual tick + incidents ────────────────────────────────
TICK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/status/tick" $ENV -H 'content-type: application/json' -d '{"component":"webhooks","status":"down","latencyMs":2000}')
echo "$TICK" | grep -q '"ok":true' && ok "record manual uptime tick" || bad "tick failed: $TICK"
INC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/status/incidents" $ENV -H 'content-type: application/json' \
  -d "{\"component\":\"api\",\"title\":\"Verify incident $TS\",\"severity\":\"major\",\"message\":\"Smoke-test incident.\"}")
echo "$INC" | grep -q '"severity":"major"' && ok "declare status incident" || bad "incident create failed: $INC"
IID=$(echo "$INC" | jget "['incident']['id']")
curl -s -b "$COOKIE" "$BASE/api/events?type=status.incident_created&pageSize=3" $ENV | grep -q '"type":"status.incident_created"' && ok "status.incident_created event emitted" || bad "incident event missing"
RES=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/status/incidents/$IID/resolve" $ENV -H 'content-type: application/json' -d '{}')
echo "$RES" | grep -q '"ok":true' && ok "resolve incident" || bad "resolve failed: $RES"
curl -s -b "$COOKIE" "$BASE/api/events?type=status.incident_resolved&pageSize=3" $ENV | grep -q '"type":"status.incident_resolved"' && ok "status.incident_resolved event emitted" || bad "resolve event missing"

# ── 10. Sub-processors (vendor transparency) ───────────────────────────────
SP=$(curl -s -b "$COOKIE" "$BASE/api/security/subprocessors" $ENV)
echo "$SP" | grep -q '"name":"Stripe"' && echo "$SP" | grep -q '"name":"OpenAI"' && ok "sub-processors: seeded vendors listed" || bad "subprocessors missing: $SP"
SPN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/security/subprocessors" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify Data Co\",\"purpose\":\"Test\",\"region\":\"EU\",\"dataCategories\":[\"emails\"]}")
echo "$SPN" | grep -q '"status":"active"' && ok "add sub-processor (admin)" || bad "subprocessor create failed: $SPN"
SPID=$(echo "$SPN" | jget "['sub']['id']")
curl -s -b "$COOKIE" -X PATCH "$BASE/api/security/subprocessors/$SPID" $ENV -H 'content-type: application/json' -d '{"status":"retired"}' | grep -q '"status":"retired"' && ok "retire sub-processor (PATCH)" || bad "patch failed"
curl -s -b "$COOKIE" "$BASE/api/events?type=subprocessor.updated&pageSize=5" $ENV | grep -q '"type":"subprocessor.updated"' && ok "subprocessor.updated event emitted" || bad "subprocessor event missing"

# ── 11. i18n config + localization QA ──────────────────────────────────────
I1=$(curl -s -b "$COOKIE" -X PUT "$BASE/api/security/i18n" $ENV -H 'content-type: application/json' -d '{"locale":"es","timezone":"Europe/Berlin","currency":"EUR"}')
echo "$I1" | grep -q '"locale":"es"' && echo "$I1" | grep -q '"currency":"EUR"' && ok "i18n: update locale/timezone/currency" || bad "i18n update failed: $I1"
curl -s -b "$COOKIE" "$BASE/api/events?type=i18n.config_updated&pageSize=3" $ENV | grep -q '"type":"i18n.config_updated"' && ok "i18n.config_updated event emitted" || bad "i18n event missing"
BADL=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PUT "$BASE/api/security/i18n" $ENV -H 'content-type: application/json' -d '{"locale":"xx"}')
check "$BADL" "400" "unknown locale → 400"
# Custom translation upsert updates QA.
TR=$(curl -s -b "$COOKIE" -X PUT "$BASE/api/security/i18n/translations" $ENV -H 'content-type: application/json' -d '{"locale":"es","key":"nav.dashboard","value":"Panel (custom)"}')
echo "$TR" | grep -q '"ok":true' && ok "upsert a custom translation" || bad "translation upsert failed: $TR"
QA2=$(curl -s -b "$COOKIE" "$BASE/api/security/i18n" $ENV)
python -c "import json,sys; d=json.loads('''$QA2'''); es=[l for l in d['qa']['locales'] if l['locale']=='es'][0]; exit(0 if es['completenessPct']>0 else 1)" && ok "localization QA reflects the custom translation" || bad "qa not updated"
curl -s -b "$COOKIE" -X PUT "$BASE/api/security/i18n" $ENV -H 'content-type: application/json' -d '{"locale":"en","timezone":"UTC","currency":"USD"}' > /dev/null

# ── 12. SCIM 2.0 provisioning ──────────────────────────────────────────────
TOK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/tokens" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify SCIM $TS\",\"scopes\":[\"scim\"]}")
echo "$TOK" | grep -q '"scopes":\["scim"\]' && ok "create scim-scoped API token" || bad "token create failed: $TOK"
SCTOK=$(echo "$TOK" | jget "['token']")
SCUAUTH="Authorization: Bearer $SCTOK"
SCU=$(curl -s -H "$SCUAUTH" "$BASE/api/scim/v2/Users")
python -c "import json,sys; d=json.loads('''$SCU'''); exit(0 if d['totalResults']>=3 else 1)" && echo "$SCU" | grep -q '"userName":"admin@qorvexa.dev"' && ok "SCIM GET /Users lists provisioned users" || bad "scim users wrong: $SCU"
SCNEW=$(curl -s -X POST "$BASE/api/scim/v2/Users" -H "$SCUAUTH" -H 'content-type: application/json' \
  -d "{\"schemas\":[\"urn:ietf:params:scim:schemas:core:2.0:User\"],\"userName\":\"scim-$TS@qorvexa.dev\",\"name\":{\"givenName\":\"Scim\",\"familyName\":\"User\"},\"active\":true}")
echo "$SCNEW" | grep -q '"userName":"scim-' && echo "$SCNEW" | grep -q '"active":true' && ok "SCIM POST /Users provisions a user" || bad "scim create failed: $SCNEW"
SCUID=$(echo "$SCNEW" | jget "['id']")
curl -s -b "$COOKIE" "$BASE/api/events?type=scim.user_provisioned&pageSize=3" $ENV | grep -q '"type":"scim.user_provisioned"' && ok "scim.user_provisioned event emitted" || bad "scim event missing"
SCGET1=$(curl -s -H "$SCUAUTH" "$BASE/api/scim/v2/Users/$SCUID")
echo "$SCGET1" | grep -q '"userName":"scim-' && ok "SCIM GET /Users/:id" || bad "scim get one failed"
SCG=$(curl -s -X POST "$BASE/api/scim/v2/Groups" -H "$SCUAUTH" -H 'content-type: application/json' \
  -d "{\"schemas\":[\"urn:ietf:params:scim:schemas:core:2.0:Group\"],\"displayName\":\"manager\",\"members\":[{\"value\":\"$SCUID\",\"type\":\"User\"}]}")
echo "$SCG" | grep -q '"displayName":"manager"' && ok "SCIM POST /Groups provisions a role group" || bad "scim group failed: $SCG"
# Group membership applied the manager role to the provisioned user.
python -c "import json,sys; d=json.loads('''$(curl -s -b "$COOKIE" "$BASE/api/users" $ENV)'''); u=[x for x in d['items'] if x['id']=='$SCUID'][0]; exit(0 if u['role']=='manager' else 1)" && ok "SCIM group membership sets the member's role" || bad "role not applied"
SCP=$(curl -s -X PATCH "$BASE/api/scim/v2/Users/$SCUID" -H "$SCUAUTH" -H 'content-type: application/json' \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"replace","value":{"active":false}}]}')
echo "$SCP" | grep -q '"ok":true' && ok "SCIM PATCH deactivates a user" || bad "scim patch failed: $SCP"
SCDEL=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$SCUAUTH" "$BASE/api/scim/v2/Users/$SCUID")
check "$SCDEL" "204" "SCIM DELETE deactivates (204)"
SCBAD=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer bogus" "$BASE/api/scim/v2/Users")
check "$SCBAD" "401" "SCIM with invalid bearer token → 401"
SCGRPS=$(curl -s -H "$SCUAUTH" "$BASE/api/scim/v2/Groups")
echo "$SCGRPS" | grep -q '"displayName":"rep"' && ok "SCIM GET /Groups lists seeded group" || bad "scim groups wrong: $SCGRPS"
# Feature gate: sec.scim off → admin view 403.
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/sec.scim" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
SCIMGATE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/security/scim" $ENV)
check "$SCIMGATE" "403" "sec.scim gate: admin SCIM view blocked when flag off"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/sec.scim" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null

# ── 13. Remaining feature gates + sandbox isolation ────────────────────────
for pair in "sec.sessions /api/security/sessions" "sec.consent /api/security/consent" "sec.retention /api/security/retention" "sec.status /api/security/status?days=30" "i18n.localization /api/security/i18n"; do
  KEY="${pair%% *}"; PATH2="${pair#* }"
  curl -s -b "$COOKIE" -X PUT "$BASE/api/features/$KEY" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE$PATH2" $ENV)
  curl -s -b "$COOKIE" -X PUT "$BASE/api/features/$KEY" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
  check "$CODE" "403" "feature gate: $KEY off → 403"
done
# Sandbox isolation (ADR-008): a production-only feature override does not leak.
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/sec.status" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
SB=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H "x-environment: sandbox" "$BASE/api/security/status?days=30")
check "$SB" "200" "sandbox unaffected by production feature override"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/sec.status" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null

echo
echo "── Phase 14 verify: $PASS passed, $FAIL failed ──"
[ "$FAIL" -eq 0 ] && echo "✅ ALL GREEN" || echo "❌ $FAIL FAILURE(S)"
exit "$FAIL"
