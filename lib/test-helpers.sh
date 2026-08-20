#!/usr/bin/env bash
# ── QORVEXA CRM · shared test helpers ─────────────────────────────────────
# Source this file from verify-phase*.sh scripts:
#   source "$(dirname "$0")/lib/test-helpers.sh"
#
# Provides: say, ok, bad, check, jget, login, login_rep, summary

# ── Counters ───────────────────────────────────────────────────────────────
PASS=0
FAIL=0

# ── Output helpers ─────────────────────────────────────────────────────────
say() { printf '%-72s' "$1"; }
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# check ACTUAL EXPECTED LABEL — compare and report
check() {
  if [ "$1" = "$2" ]; then
    ok "$3"
  else
    bad "$3 (expected '$2' got '$1')"
  fi
}

# jget EXPR — extract value from JSON via Python
# Usage: echo "$JSON" | jget "['id']"
jget() { python -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

# ── Auth helpers ───────────────────────────────────────────────────────────
BASE="${BASE:-http://localhost:8787}"

# login COOKIE_FILE [EMAIL] [PASSWORD] — authenticate and store session cookie
login() {
  local cookie="${1:?cookie file required}"
  local email="${2:-admin@qorvexa.dev}"
  local pass="${3:-password123}"
  rm -f "$cookie"
  curl -s -c "$cookie" -X POST "$BASE/api/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}" > /dev/null
}

# login_rep COOKIE_FILE — login as the seeded rep (Leo)
login_rep() {
  login "${1:?cookie file required}" "leo@qorvexa.dev" "password123"
}

# ── Summary ────────────────────────────────────────────────────────────────
# summary PHASE_NAME — print final pass/fail report and exit with failure count
summary() {
  local name="${1:-SMOKE SUITE}"
  echo
  echo "════════════════════════════════════════════"
  echo "  PASS: $PASS   FAIL: $FAIL"
  echo "════════════════════════════════════════════"
  if [ "$FAIL" = "0" ]; then
    echo "$name: ALL GREEN ✅"
  else
    echo "$name: $FAIL FAILURE(S) ❌"
  fi
  exit "$FAIL"
}
