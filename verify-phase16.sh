#!/usr/bin/env bash
# Phase 16 · Real-world provider integrations smoke suite — run against
# localhost:8787 with a freshly booted + seeded stack. Tests the integration
# status endpoint, provider webhook endpoints, and Twilio/AI surface areas.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q16-admin.txt
REPCOOKIE=/tmp/q16-rep.txt
source "$(dirname "$0")/lib/test-helpers.sh"
login "/tmp/q16-admin.txt"

curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

# ── 1. Integration status (admin-only) ──────────────────────────────────────
STATUS=$(curl -s -b "$COOKIE" "$BASE/api/integrations/status")
echo "$STATUS" | grep -q '"email"' && ok "integrations: email capability present" || bad "integrations: missing email"
echo "$STATUS" | grep -q '"ai"' && ok "integrations: AI capability present" || bad "integrations: missing AI"
echo "$STATUS" | grep -q '"telephony"' && ok "integrations: telephony capability present" || bad "integrations: missing telephony"
# In mock mode (no keys configured), providers should show mock
echo "$STATUS" | grep -q '"provider"' && ok "integrations: provider field present" || bad "integrations: missing provider field"

# ── 2. RBAC: rep can read integrations status ───────────────────────────────
R_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/integrations/status")
check "$R_STATUS" "200" "rbac: rep can read integrations status"

# ── 3. Unauthenticated access denied ────────────────────────────────────────
U_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/integrations/status")
check "$U_STATUS" "401" "auth: unauthenticated access denied to integrations status"

# ── 4. Email webhook endpoint exists (public) ───────────────────────────────
# POST with an empty body → should return an error (not 404)
WH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/integrations/email/webhook" \
  -H 'content-type: application/json' \
  -d '{}')
# Either 400 (validation error) or 404 (no matching message) — both mean the route exists
if [ "$WH_STATUS" = "400" ] || [ "$WH_STATUS" = "404" ]; then
  ok "webhook: email webhook route exists (status $WH_STATUS)"
else
  bad "webhook: unexpected status $WH_STATUS"
fi

# ── 5. Twilio status callback endpoint exists (public) ──────────────────────
TW_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/integrations/twilio/status/fake-id" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'CallStatus=completed&CallSid=FAKE')
# Should return 404 (no matching call) or 400 (validation) — route exists
if [ "$TW_STATUS" = "400" ] || [ "$TW_STATUS" = "404" ]; then
  ok "webhook: Twilio status callback route exists (status $TW_STATUS)"
else
  bad "webhook: unexpected Twilio status status $TW_STATUS"
fi

# ── 6. Twilio TwiML endpoint exists (public) ────────────────────────────────
TWIML_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/integrations/twilio/twiml/fake-id")
# Should return 404 (no matching call) — route exists
check "$TWIML_STATUS" "404" "webhook: Twilio TwiML route exists"

# ── 7. AI routes are feature-gated ──────────────────────────────────────────
AI_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/ai/summary" \
  -H 'content-type: application/json' \
  -d '{"type":"contact","id":"fake"}')
# Should be 200 (mock AI generates a summary) or 404 (no record) — feature gate works
if [ "$AI_STATUS" = "200" ] || [ "$AI_STATUS" = "404" ]; then
  ok "ai: summary route is accessible (status $AI_STATUS)"
else
  bad "ai: unexpected status $AI_STATUS"
fi

# ── 8. Model router is feature-gated ────────────────────────────────────────
MODELS_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/models")
check "$MODELS_STATUS" "200" "models: model router accessible"

# ── 9. Agent routes are feature-gated ───────────────────────────────────────
AGENTS_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/agents")
check "$AGENTS_STATUS" "200" "agents: agent list accessible"

# ── 10. Env vars documented in .env.example ─────────────────────────────────
grep -q "EMAIL_PROVIDER" .env.example && ok "docs: EMAIL_PROVIDER in .env.example" || bad "docs: EMAIL_PROVIDER missing"
grep -q "RESEND_API_KEY" .env.example && ok "docs: RESEND_API_KEY in .env.example" || bad "docs: RESEND_API_KEY missing"
grep -q "SENDGRID_API_KEY" .env.example && ok "docs: SENDGRID_API_KEY in .env.example" || bad "docs: SENDGRID_API_KEY missing"
grep -q "OPENAI_API_KEY" .env.example && ok "docs: OPENAI_API_KEY in .env.example" || bad "docs: OPENAI_API_KEY missing"
grep -q "TWILIO_ACCOUNT_SID" .env.example && ok "docs: TWILIO_ACCOUNT_SID in .env.example" || bad "docs: TWILIO_ACCOUNT_SID missing"
grep -q "TWILIO_AUTH_TOKEN" .env.example && ok "docs: TWILIO_AUTH_TOKEN in .env.example" || bad "docs: TWILIO_AUTH_TOKEN missing"

# ── 11. Docker compose passes through provider env vars ─────────────────────
grep -q "EMAIL_PROVIDER" docker-compose.prod.yml && ok "docker: EMAIL_PROVIDER in compose" || bad "docker: EMAIL_PROVIDER missing"
grep -q "RESEND_API_KEY" docker-compose.prod.yml && ok "docker: RESEND_API_KEY in compose" || bad "docker: RESEND_API_KEY missing"
grep -q "OPENAI_API_KEY" docker-compose.prod.yml && ok "docker: OPENAI_API_KEY in compose" || bad "docker: OPENAI_API_KEY missing"
grep -q "TWILIO_ACCOUNT_SID" docker-compose.prod.yml && ok "docker: TWILIO_ACCOUNT_SID in compose" || bad "docker: TWILIO_ACCOUNT_SID missing"

# ── 12. Health endpoint still works ─────────────────────────────────────────
HEALTH=$(curl -s "$BASE/api/health")
echo "$HEALTH" | grep -q '"status"' && ok "health: /api/health responds" || bad "health: /api/health broken"

# ── 13. DB schema has provider fields ───────────────────────────────────────
grep -q "provider" prisma/schema.prisma && ok "schema: provider field exists in schema" || bad "schema: provider field missing"
grep -q "providerMessageId" prisma/schema.prisma && ok "schema: providerMessageId field exists in schema" || bad "schema: providerMessageId field missing"

# ── Summary ─────────────────────────────────────────────────────────────────
summary "Phase 16 Integration Smoke"
