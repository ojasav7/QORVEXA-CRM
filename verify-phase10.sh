#!/usr/bin/env bash
# Phase 10 Revenue Cloud live smoke suite — run against localhost:8787 with a
# freshly booted + seeded stack (npm run db:push && npm run seed, then start
# the server). Covers the product catalog (incl. bundle expansion), price
# books (entries + discounts), CPQ quotes (template, pricing preview, the
# approval → mock e-signature → won lifecycle), orders (from signed quotes +
# manual, with flow guards), contracts + contract intelligence (deterministic
# clause extraction), subscriptions (renewal ticker + MRR derivation), billing
# (invoices, payments, refunds, dunning on failure), the MRR/ARR metrics
# endpoint, the engine tick, RBAC, feature gating, and the revenue.* event
# audit trail.
set -u
BASE=http://localhost:8787
COOKIE=/tmp/q10-admin.txt
REPCOOKIE=/tmp/q10-rep.txt
source "$(dirname "$0")/lib/test-helpers.sh"

login "$COOKIE"
login_rep "$REPCOOKIE"
curl -s -b "$COOKIE" "$BASE/api/auth/me" | grep -q '"role":"admin"' && ok "admin login" || bad "admin login failed"
curl -s -b "$REPCOOKIE" "$BASE/api/auth/me" | grep -q '"role":"rep"' && ok "rep login (leo)" || bad "rep login failed"

TS=$(date +%s)
ENV='-H x-environment:production'

# ── 1. Seeded catalog ────────────────────────────────────────────────────────
PROD=$(curl -s -b "$COOKIE" "$BASE/api/products" $ENV)
[ "$(echo "$PROD" | jget "['items'].__len__()")" = "7" ] && ok "7 products seeded" || bad "product count wrong: $PROD"
echo "$PROD" | grep -q '"sku":"QX-BUNDLE-STARTER"' && ok "bundle product seeded (Starter + Support)" || bad "bundle missing"
STARTER=$(echo "$PROD" | python -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['sku']=='QX-STARTER'][0])")
GROWTH=$(echo "$PROD" | python -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['sku']=='QX-GROWTH'][0])")
ENT=$(echo "$PROD" | python -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['sku']=='QX-ENT'][0])")
SUPPORT=$(echo "$PROD" | python -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['sku']=='QX-SUPPORT'][0])")
BUNDLE=$(echo "$PROD" | python -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['sku']=='QX-BUNDLE-STARTER'][0])")
[ -n "$STARTER" ] && [ -n "$GROWTH" ] && [ -n "$ENT" ] && ok "core product ids resolved" || bad "product ids missing"

# ── 2. RBAC + product CRUD ───────────────────────────────────────────────────
RGET=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" "$BASE/api/products" $ENV)
check "$RGET" "200" "rep can list products (reads open)"
R403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/products" $ENV -H 'content-type: application/json' -d '{"name":"x","sku":"X-1"}')
check "$R403" "403" "rep product create → 403 (admin only)"
NPC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/products" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify Widget\",\"sku\":\"QX-VERIFY-$TS\",\"category\":\"software\",\"listPrice\":99,\"taxable\":true}")
NPID=$(echo "$NPC" | jget "['product']['id']")
[ -n "$NPID" ] && ok "admin creates product (QX-VERIFY-$TS)" || bad "product create failed: $NPC"
DUP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/products" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Dup\",\"sku\":\"QX-VERIFY-$TS\"}")
check "$DUP" "400" "duplicate SKU → 400"
UP=$(curl -s -b "$COOKIE" -X PATCH "$BASE/api/products/$NPID" $ENV -H 'content-type: application/json' -d '{"listPrice":149}')
[ "$(echo "$UP" | jget "['product']['listPrice']")" = "149" ] && ok "product price patched to 149" || bad "patch failed: $UP"
DELP=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/products/$NPID" $ENV)
check "$DELP" "200" "unreferenced product deleted"
REFD=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/products/$STARTER" $ENV)
check "$REFD" "400" "product referenced by a price book cannot be deleted"

# ── 3. Price books ───────────────────────────────────────────────────────────
BOOKS=$(curl -s -b "$COOKIE" "$BASE/api/price-books" $ENV)
[ "$(echo "$BOOKS" | jget "['items'].__len__()")" = "2" ] && ok "2 price books seeded (Standard + Enterprise 2026)" || bad "book count wrong: $BOOKS"
[ "$(echo "$BOOKS" | python -c "import json,sys; print(len([b for b in json.load(sys.stdin)['items'] if b['isDefault']]))")" = "1" ] && ok "exactly one default book" || bad "default book count wrong"
STDBOOK=$(echo "$BOOKS" | python -c "import json,sys; print([b['id'] for b in json.load(sys.stdin)['items'] if b['isDefault']][0])")
[ "$(echo "$BOOKS" | python -c "import json,sys; d=json.load(sys.stdin); b=[b for b in d['items'] if b['isDefault']][0]; print(len(b['entries']))")" = "3" ] && ok "Standard book has 3 price entries" || bad "entries wrong"
[ "$(echo "$BOOKS" | python -c "import json,sys; d=json.load(sys.stdin); b=[b for b in d['items'] if b['isDefault']][0]; print(len(b['discounts']))")" = "1" ] && ok "Standard book has 1 discount (Growth 10%)" || bad "discounts wrong"
echo "$BOOKS" | grep -q '"price":3800' && ok "Enterprise 2026 book prices QX-ENT at 3800" || bad "enterprise book entry missing"
NB=$(curl -s -b "$COOKIE" -X POST "$BASE/api/price-books" $ENV -H 'content-type: application/json' -d "{\"name\":\"Verify Book $TS\"}")
NBID=$(echo "$NB" | jget "['book']['id']")
[ -n "$NBID" ] && ok "admin creates price book" || bad "book create failed: $NB"
BADE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PUT "$BASE/api/price-books/$NBID/entries" $ENV -H 'content-type: application/json' -d '[{"productId":"000000000000000000000000","price":10}]')
check "$BADE" "400" "price book entry with unknown product → 400"
GOODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PUT "$BASE/api/price-books/$NBID/entries" $ENV -H 'content-type: application/json' -d "[{\"productId\":\"$GROWTH\",\"price\":1800}]")
check "$GOODE" "200" "price book entries replaced"
DELD=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/price-books/$STDBOOK" $ENV)
check "$DELD" "400" "default price book cannot be deleted"
DELB=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/price-books/$NBID" $ENV)
check "$DELB" "200" "secondary price book deleted"

# ── 3b. MRR/ARR baseline (derived on read, BEFORE any creates) ──────────────
MET=$(curl -s -b "$COOKIE" "$BASE/api/revenue/metrics" $ENV)
[ "$(echo "$MET" | jget "['totals']['mrr']")" = "6000" ] && ok "MRR baseline = 6000 (4000 monthly + 2000 annual)" || bad "mrr baseline wrong: $MET"
[ "$(echo "$MET" | jget "['totals']['arr']")" = "72000" ] && ok "ARR baseline = 72000 (MRR × 12)" || bad "arr baseline wrong"
[ "$(echo "$MET" | jget "['totals']['activeSubs']")" = "2" ] && ok "activeSubs baseline = 2" || bad "activeSubs baseline wrong"
[ "$(echo "$MET" | jget "['totals']['outstanding']")" = "25920" ] && ok "outstanding baseline = 25920 (INV-0002)" || bad "outstanding baseline wrong"
[ "$(echo "$MET" | jget "['totals']['activeContracts']")" = "1" ] && ok "activeContracts baseline = 1" || bad "activeContracts baseline wrong"
echo "$MET" | grep -q '"key":"mrr"' && echo "$MET" | grep -q '"sources"' && ok "metrics carry data lineage (sources)" || bad "lineage missing"
[ "$(echo "$MET" | jget "['byAccount'].__len__()")" = "2" ] && ok "MRR broken down by account (Northwind + Globex)" || bad "byAccount baseline wrong: $MET"

# ── 4. Quote templates ───────────────────────────────────────────────────────
TPL=$(curl -s -b "$COOKIE" "$BASE/api/quotes/templates" $ENV)
[ "$(echo "$TPL" | jget "['items'].__len__()")" = "1" ] && ok "Standard Proposal template seeded" || bad "templates wrong: $TPL"
NT=$(curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/templates" $ENV -H 'content-type: application/json' -d "{\"name\":\"Verify Tpl $TS\",\"layout\":\"compact\"}")
NTID=$(echo "$NT" | jget "['template']['id']")
[ -n "$NTID" ] && ok "admin creates quote template" || bad "template create failed: $NT"
DELT=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/quotes/templates/$NTID" $ENV)
check "$DELT" "200" "quote template deleted"

# ── 5. Pricing preview (CPQ): price book + discounts + bundle expansion ──────
PV=$(curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/preview" $ENV -H 'content-type: application/json' \
  -d "{\"lines\":[{\"productId\":\"$GROWTH\",\"quantity\":1}]}")
[ "$(echo "$PV" | jget "['subtotal']")" = "2000" ] && [ "$(echo "$PV" | jget "['discountTotal']")" = "200" ] && \
  [ "$(echo "$PV" | jget "['taxTotal']")" = "144" ] && [ "$(echo "$PV" | jget "['total']")" = "1944" ] && \
  ok "Growth ×1 → subtotal 2000, discount 200 (10%), tax 144, total 1944" || bad "preview math wrong: $PV"
[ "$(echo "$PV" | jget "['lines'][0]['lineTotal']")" = "1800" ] && ok "Growth line total 1800 after 10% book discount" || bad "line total wrong"
BVP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/preview" $ENV -H 'content-type: application/json' \
  -d "{\"lines\":[{\"productId\":\"$BUNDLE\",\"quantity\":2}]}")
[ "$(echo "$BVP" | jget "['lines'].__len__()")" = "2" ] && ok "bundle expands to 2 component lines (Starter + Support)" || bad "bundle not expanded: $BVP"
[ "$(echo "$BVP" | jget "['subtotal']")" = "3600" ] && [ "$(echo "$BVP" | jget "['total']")" = "3888" ] && \
  ok "bundle ×2 → subtotal 3600 (600+1200)×2, total 3888" || bad "bundle math wrong: $BVP"
BADPV=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/quotes/preview" $ENV -H 'content-type: application/json' \
  -d '{"lines":[{"productId":"000000000000000000000000","quantity":1}]}')
check "$BADPV" "400" "preview with unknown product → 400"

# ── 6. Quote lifecycle (approval → e-signature → won) ────────────────────────
Q403=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/quotes" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"No\",\"lines\":[{\"productId\":\"$GROWTH\",\"quantity\":1}]}")
check "$Q403" "403" "rep quote create → 403 (admin only)"
QC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/quotes" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify Deal $TS\",\"lines\":[{\"productId\":\"$GROWTH\",\"quantity\":1}]}")
QID=$(echo "$QC" | jget "['quote']['id']")
QNUM=$(echo "$QC" | jget "['quote']['quoteNumber']")
[ "$(echo "$QC" | jget "['quote']['status']")" = "draft" ] && ok "quote created (draft, $QNUM)" || bad "quote create failed: $QC"
[ "$(echo "$QC" | jget "['quote']['total']")" = "1944" ] && ok "quote totals computed server-side (total 1944)" || bad "quote total wrong"
BADTR=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/quotes/$QID/approve" $ENV)
check "$BADTR" "400" "draft → approved is an invalid transition (400)"
curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/$QID/submit" $ENV > /dev/null
SUBM=$(curl -s -b "$COOKIE" "$BASE/api/quotes/$QID" $ENV | jget "['quote']['status']")
check "$SUBM" "needs_approval" "submit → needs_approval"
curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/$QID/approve" $ENV > /dev/null
APPR=$(curl -s -b "$COOKIE" "$BASE/api/quotes/$QID" $ENV)
[ "$(echo "$APPR" | jget "['quote']['status']")" = "approved" ] && [ "$(echo "$APPR" | jget "['quote']['approvals'].__len__()")" = "1" ] && \
  ok "approve → approved with 1 approval record" || bad "approve failed: $APPR"
curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/$QID/send" $ENV > /dev/null
SENT=$(curl -s -b "$COOKIE" "$BASE/api/quotes/$QID" $ENV | jget "['quote']['status']")
check "$SENT" "sent" "send → sent"
SIGN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/$QID/sign" $ENV -H 'content-type: application/json' -d '{"name":"Elena Northwind","email":"elena@northwind.dev"}')
[ "$(echo "$SIGN" | jget "['quote']['status']")" = "signed" ] && [ "$(echo "$SIGN" | jget "['quote']['signature']['name']")" = "Elena Northwind" ] && \
  ok "mock e-signature → signed (signature stored)" || bad "sign failed: $SIGN"
WON=$(curl -s -b "$COOKIE" -X POST "$BASE/api/quotes/$QID/outcome" $ENV -H 'content-type: application/json' -d '{"outcome":"won"}')
[ "$(echo "$WON" | jget "['quote']['status']")" = "won" ] && ok "outcome → won" || bad "outcome failed: $WON"
EVQ=$(curl -s -b "$COOKIE" "$BASE/api/events?type=quote.signed&pageSize=5" $ENV | grep -c "Elena Northwind")
[ "$EVQ" -ge 1 ] && ok "quote.signed event in the audit trail" || bad "quote.signed event missing"

# ── 7. Orders (from signed quote + manual, flow guards) ──────────────────────
OC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/orders" $ENV -H 'content-type: application/json' -d "{\"quoteId\":\"$QID\"}")
OID=$(echo "$OC" | jget "['order']['id']")
[ "$(echo "$OC" | jget "['order']['status']")" = "confirmed" ] && ok "order created from won quote (confirmed)" || bad "order-from-quote failed: $OC"
[ "$(echo "$OC" | jget "['order']['total']")" = "1944" ] && ok "order inherits quote totals (1944)" || bad "order total wrong"
Q2=$(curl -s -b "$COOKIE" -X POST "$BASE/api/quotes" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Not Ready $TS\",\"lines\":[{\"productId\":\"$GROWTH\",\"quantity\":1}]}")
Q2ID=$(echo "$Q2" | jget "['quote']['id']")
ORDRAFT=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/orders" $ENV -H 'content-type: application/json' -d "{\"quoteId\":\"$Q2ID\"}")
check "$ORDRAFT" "400" "order from draft quote → 400"
MO=$(curl -s -b "$COOKIE" -X POST "$BASE/api/orders" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Manual Order $TS\",\"lines\":[{\"productId\":\"$SUPPORT\",\"quantity\":2}]}")
MOID=$(echo "$MO" | jget "['order']['id']")
[ "$(echo "$MO" | jget "['order']['status']")" = "draft" ] && ok "manual order created (draft)" || bad "manual order failed: $MO"
[ "$(echo "$MO" | jget "['order']['total']")" = "2592" ] && ok "manual order totals (1200×2 + 8% tax = 2592)" || bad "manual order total wrong: $MO"
BADTR2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PATCH "$BASE/api/orders/$MOID" $ENV -H 'content-type: application/json' -d '{"status":"fulfilled"}')
check "$BADTR2" "400" "draft → fulfilled invalid transition (400)"
curl -s -b "$COOKIE" -X PATCH "$BASE/api/orders/$MOID" $ENV -H 'content-type: application/json' -d '{"status":"confirmed"}' > /dev/null
CONF=$(curl -s -b "$COOKIE" "$BASE/api/orders/$MOID" $ENV | jget "['order']['status']")
check "$CONF" "confirmed" "order confirmed"
FUL=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X PATCH "$BASE/api/orders/$MOID" $ENV -H 'content-type: application/json' -d '{"status":"fulfilled"}')
check "$FUL" "200" "confirmed → fulfilled"
DELO=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/orders/$OID" $ENV)
check "$DELO" "400" "non-draft order cannot be deleted"
EVO=$(curl -s -b "$COOKIE" "$BASE/api/events?type=order.created&pageSize=5" $ENV | grep -c "quoteId")
[ "$EVO" -ge 1 ] && ok "order.created event links the quote" || bad "order.created event missing"

# ── 8. Contracts + contract intelligence ─────────────────────────────────────
CONTR=$(curl -s -b "$COOKIE" "$BASE/api/contracts" $ENV)
[ "$(echo "$CONTR" | jget "['items'].__len__()")" = "1" ] && ok "seeded contract (Northwind — Platform Agreement)" || bad "contracts wrong: $CONTR"
echo "$CONTR" | grep -q '"contractNumber":"CTR-0001"' && echo "$CONTR" | grep -q '"autoRenew":true' && \
  ok "seeded contract active with auto-renew" || bad "seeded contract missing fields"
CTR1=$(echo "$CONTR" | jget "['items'][0]['id']")
[ "$(echo "$CONTR" | jget "['items'][0]['clauses'].__len__()")" -ge 6 ] && ok "seeded contract carries extracted clauses (≥6)" || bad "clauses wrong"
CC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/contracts" $ENV -H 'content-type: application/json' -d "{\"name\":\"Verify Contract $TS\"}")
CID=$(echo "$CC" | jget "['contract']['id']")
CNUM=$(echo "$CC" | jget "['contract']['contractNumber']")
[ "$(echo "$CC" | jget "['contract']['status']")" = "draft" ] && ok "contract created ($CNUM, draft)" || bad "contract create failed: $CC"
AN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/contracts/$CID/analyze" $ENV -H 'content-type: application/json' -d "{\"text\":\"This agreement between Qorvexa Demo Inc and Verify Corp is effective from 2026-01-01 and expires on 2027-12-31. It auto-renews with 60 day written notice. Payment terms are Net-30 and it is governed by the laws of Delaware.\"}")
[ "$(echo "$AN" | jget "['clauses'].__len__()")" -ge 6 ] && ok "intelligence extracted ≥6 clauses" || bad "clause extraction failed: $AN"
[ "$(echo "$AN" | python -c "import json,sys; d=json.load(sys.stdin); print(any(c['key']=='party_1' for c in d['clauses']))")" = "True" ] && ok "party_1 extracted (Qorvexa Demo Inc)" || bad "party missing"
echo "$AN" | grep -q '"key":"payment_terms"' && ok "Net-30 payment terms extracted" || bad "payment terms missing"
echo "$AN" | grep -q '"key":"auto_renew"' && ok "auto-renew clause detected" || bad "auto-renew missing"
[ "$(curl -s -b "$COOKIE" "$BASE/api/contracts/$CID" $ENV | jget "['contract']['endDate']")" != "null" ] && ok "endDate filled from extracted clause" || bad "endDate not filled"
AN2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/contracts/$CID/analyze" $ENV -H 'content-type: application/json' -d '{"text":"hello world nothing here at all"}')
check "$AN2" "400" "unparseable contract text → 400 (no clauses)"
EVA=$(curl -s -b "$COOKIE" "$BASE/api/events?type=contract.analyzed&pageSize=5" $ENV | grep -c "clause")
[ "$EVA" -ge 1 ] && ok "contract.analyzed event emitted" || bad "contract.analyzed missing"
CSIGN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/contracts/$CID/sign" $ENV -H 'content-type: application/json' -d '{"name":"Ava Morgan"}')
[ "$(echo "$CSIGN" | jget "['contract']['status']")" = "active" ] && ok "contract signed → active" || bad "contract sign failed"
echo "$CSIGN" | grep -q '"key":"signature"' && ok "signature recorded as a clause" || bad "signature clause missing"
CTERM=$(curl -s -b "$COOKIE" -X POST "$BASE/api/contracts/$CID/terminate" $ENV -H 'content-type: application/json' -d '{"reason":"churned"}')
[ "$(echo "$CTERM" | jget "['contract']['status']")" = "terminated" ] && ok "contract terminated" || bad "terminate failed"

# ── 9. Subscriptions (create → renew → cancel) ───────────────────────────────
SUB=$(curl -s -b "$COOKIE" "$BASE/api/subscriptions" $ENV)
[ "$(echo "$SUB" | jget "['items'].__len__()")" = "2" ] && ok "2 subscriptions seeded (Northwind monthly, Globex annual)" || bad "subs wrong: $SUB"
[ "$(echo "$SUB" | python -c "import json,sys; d=json.load(sys.stdin); print(sum(s['mrr'] for s in d['items']))")" = "6000" ] && \
  ok "seeded MRR 6000 (4000 monthly + 2000 annual)" || bad "seeded mrr wrong"
SC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Verify Sub $TS\",\"productId\":\"$SUPPORT\",\"billingPeriod\":\"monthly\",\"unitPrice\":1200,\"quantity\":1}")
SID=$(echo "$SC" | jget "['subscription']['id']")
[ "$(echo "$SC" | jget "['subscription']['status']")" = "active" ] && ok "subscription created (active)" || bad "sub create failed: $SC"
[ "$(echo "$SC" | jget "['subscription']['mrr']")" = "1200" ] && ok "mrr derived on read (1200/month)" || bad "mrr wrong"
REN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions/$SID/renew" $ENV)
[ "$(echo "$REN" | jget "['invoice']['status']")" = "issued" ] && ok "renew raised the next invoice (issued)" || bad "renew failed: $REN"
[ "$(echo "$REN" | jget "['invoice']['total']")" = "1296" ] && ok "renewal invoice total 1296 (1200 + 8% tax)" || bad "renewal total wrong"
[ "$(echo "$REN" | jget "['subscription']['currentPeriodEnd']")" != "null" ] && ok "currentPeriodEnd advanced after renew" || bad "period end not advanced"
EVR=$(curl -s -b "$COOKIE" "$BASE/api/events?type=subscription.renewal_due&pageSize=5" $ENV | grep -c "Verify Sub")
[ "$EVR" -ge 1 ] && ok "subscription.renewal_due event emitted" || bad "renewal event missing"
CAN=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions/$SID/cancel" $ENV)
[ "$(echo "$CAN" | jget "['subscription']['status']")" = "cancelled" ] && ok "subscription cancelled" || bad "cancel failed: $CAN"
DELS=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE "$BASE/api/subscriptions/$SID" $ENV)
check "$DELS" "200" "cancelled subscription deleted"

# ── 10. Invoices, payments, dunning, refunds ─────────────────────────────────
INV=$(curl -s -b "$COOKIE" "$BASE/api/invoices" $ENV)
[ "$(echo "$INV" | jget "['items'].__len__()")" -ge 2 ] && ok "seeded invoices present (INV-0001 paid, INV-0002 issued)" || bad "invoices wrong: $INV"
[ "$(echo "$INV" | python -c "import json,sys; print(len([i for i in json.load(sys.stdin)['items'] if i['status']=='paid']))")" -ge 1 ] && ok "INV-0001 settled (paid)" || bad "paid invoice missing"
[ "$(echo "$INV" | python -c "import json,sys; print(len([i for i in json.load(sys.stdin)['items'] if i['status']=='issued']))")" -ge 1 ] && ok "issued invoice outstanding (INV-0002 + renewal invoices)" || bad "issued invoice missing"
PAY=$(curl -s -b "$COOKIE" "$BASE/api/payments" $ENV)
[ "$(echo "$PAY" | jget "['items'].__len__()")" = "1" ] && ok "seeded succeeded payment present" || bad "payments wrong: $PAY"
# dunning: create a sub + invoice, then fail the payment → past_due
SD=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Dunning Sub $TS\",\"productId\":\"$SUPPORT\",\"billingPeriod\":\"monthly\",\"unitPrice\":1200}")
SDID=$(echo "$SD" | jget "['subscription']['id']")
REND=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions/$SDID/renew" $ENV)
INVDID=$(echo "$REND" | jget "['invoice']['id']")
PAYFAIL=$(curl -s -b "$COOKIE" -X POST "$BASE/api/invoices/$INVDID/pay" $ENV -H 'content-type: application/json' -d '{"amount":1296,"fail":true,"failureReason":"Card declined (test)"}')
[ "$(echo "$PAYFAIL" | jget "['payment']['status']")" = "failed" ] && ok "failed payment recorded (dunning fed)" || bad "fail payment wrong: $PAYFAIL"
[ "$(echo "$PAYFAIL" | jget "['invoice']['status']")" = "issued" ] && [ "$(echo "$PAYFAIL" | jget "['invoice']['dunningAttempts']")" = "1" ] && \
  ok "invoice stays issued, dunningAttempts → 1" || bad "dunning state wrong"
[ "$(curl -s -b "$COOKIE" "$BASE/api/subscriptions/$SDID" $ENV | jget "['subscription']['status']")" = "past_due" ] && \
  ok "subscription flipped to past_due" || bad "past_due not set"
SUCC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/invoices/$INVDID/pay" $ENV -H 'content-type: application/json' -d '{"amount":1296}')
PID=$(echo "$SUCC" | jget "['payment']['id']")
[ "$(echo "$SUCC" | jget "['payment']['status']")" = "succeeded" ] && [ "$(echo "$SUCC" | jget "['invoice']['status']")" = "paid" ] && \
  ok "successful payment settles the invoice (invoice.paid)" || bad "pay success wrong: $SUCC"
[ "$(curl -s -b "$COOKIE" "$BASE/api/subscriptions/$SDID" $ENV | jget "['subscription']['status']")" = "active" ] && \
  ok "paid invoice reactivates the past-due subscription (dunning recovery)" || bad "sub not reactivated"
# clean up the dunning sub so later metric checks see only the seeded subs
curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions/$SDID/cancel" $ENV > /dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/subscriptions/$SDID" $ENV > /dev/null
AGAIN=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X POST "$BASE/api/invoices/$INVDID/pay" $ENV -H 'content-type: application/json' -d '{"amount":1296}')
check "$AGAIN" "400" "paying an already-paid invoice → 400"
REF=$(curl -s -b "$COOKIE" -X POST "$BASE/api/payments/$PID/refund" $ENV)
[ "$(echo "$REF" | jget "['refund']['status']")" = "refunded" ] && ok "payment refunded (refunded row linked)" || bad "refund failed: $REF"
# manual invoice draft → issue → void
MI=$(curl -s -b "$COOKIE" -X POST "$BASE/api/invoices" $ENV -H 'content-type: application/json' \
  -d "{\"lines\":[{\"productId\":\"$SUPPORT\",\"quantity\":1}]}")
MIID=$(echo "$MI" | jget "['invoice']['id']")
[ "$(echo "$MI" | jget "['invoice']['status']")" = "draft" ] && ok "manual invoice created (draft)" || bad "invoice create failed: $MI"
MISS=$(curl -s -b "$COOKIE" -X POST "$BASE/api/invoices/$MIID/issue" $ENV)
[ "$(echo "$MISS" | jget "['invoice']['status']")" = "issued" ] && ok "draft → issued" || bad "issue failed"
VOID=$(curl -s -b "$COOKIE" -X POST "$BASE/api/invoices/$MIID/void" $ENV)
[ "$(echo "$VOID" | jget "['invoice']['status']")" = "voided" ] && ok "issued invoice voided" || bad "void failed"
EVP=$(curl -s -b "$COOKIE" "$BASE/api/events?type=invoice.issued&pageSize=5" $ENV | grep -c "taxRate")
[ "$EVP" -ge 1 ] && ok "invoice.issued events carry the applied tax rate" || bad "invoice.issued missing"

# ── 11. MRR delta (derived on read) + engine tick ───────────────────────────
# Post-lifecycle state is back to the 2 seeded subs (all test subs cancelled +
# deleted) — so the seeded baseline still holds. Add a sub → MRR moves by
# exactly its contribution; cancel it → MRR returns, churn is counted.
MET2=$(curl -s -b "$COOKIE" "$BASE/api/revenue/metrics" $ENV)
[ "$(echo "$MET2" | jget "['totals']['mrr']")" = "6000" ] && ok "MRR back to baseline 6000 after lifecycle tests" || bad "mrr post-lifecycle wrong: $MET2"
MC=$(curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions" $ENV -H 'content-type: application/json' \
  -d "{\"name\":\"Metric Sub $TS\",\"productId\":\"$SUPPORT\",\"billingPeriod\":\"monthly\",\"unitPrice\":1200}")
MCID=$(echo "$MC" | jget "['subscription']['id']")
MET3=$(curl -s -b "$COOKIE" "$BASE/api/revenue/metrics" $ENV)
[ "$(echo "$MET3" | jget "['totals']['mrr']")" = "7200" ] && ok "MRR → 7200 after adding a \$1200/mo sub" || bad "mrr delta wrong: $MET3"
[ "$(echo "$MET3" | jget "['totals']['newMrr']")" = "1200" ] && ok "new MRR this month = 1200" || bad "newMrr wrong"
curl -s -b "$COOKIE" -X POST "$BASE/api/subscriptions/$MCID/cancel" $ENV > /dev/null
MET4=$(curl -s -b "$COOKIE" "$BASE/api/revenue/metrics" $ENV)
[ "$(echo "$MET4" | jget "['totals']['mrr']")" = "6000" ] && ok "MRR back to 6000 after cancel" || bad "post-cancel mrr wrong"
[ "$(echo "$MET4" | jget "['totals']['churnedMrr']")" = "1200" ] && ok "churned MRR this month = 1200" || bad "churnedMrr wrong"
TICK=$(curl -s -b "$COOKIE" -X POST "$BASE/api/revenue/tick" $ENV)
[ "$(echo "$TICK" | jget "['tick']['renewed']")" -ge 0 ] && [ "$(echo "$TICK" | jget "['tick']['issued']")" -ge 0 ] && \
  ok "engine tick ran (renewals + dunning pass)" || bad "tick failed: $TICK"
TICKR=$(curl -s -o /dev/null -w '%{http_code}' -b "$REPCOOKIE" -X POST "$BASE/api/revenue/tick" $ENV)
check "$TICKR" "403" "rep engine tick → 403 (admin only)"

# ── 12. Feature gating + sandbox isolation ───────────────────────────────────
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/revenue.products" $ENV -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
FG=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/products" $ENV)
check "$FG" "403" "revenue.products disabled → products 403"
FGB=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/price-books" $ENV)
check "$FGB" "403" "price books gated by the same flag → 403"
curl -s -b "$COOKIE" -X PUT "$BASE/api/features/revenue.products" $ENV -H 'content-type: application/json' -d '{"enabled":true}' > /dev/null
FG2=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "$BASE/api/products" $ENV)
check "$FG2" "200" "flag re-enabled → products 200"
SB0=$(curl -s -b "$COOKIE" "$BASE/api/products" -H 'x-environment:sandbox')
[ "$(echo "$SB0" | jget "['items'].__len__()")" = "0" ] && ok "sandbox starts with an empty catalog (fresh env)" || bad "sandbox not clean"
SBP=$(curl -s -b "$COOKIE" -X POST "$BASE/api/products" -H 'x-environment:sandbox' -H 'content-type: application/json' -d "{\"name\":\"Sandbox Widget\",\"sku\":\"QX-SB-$TS\"}")
SBID=$(echo "$SBP" | jget "['product']['id']")
[ -n "$SBID" ] && ok "product created in sandbox env" || bad "sandbox product create failed"
PROD2=$(curl -s -b "$COOKIE" "$BASE/api/products" $ENV)
echo "$PROD2" | grep -q "Sandbox Widget" && bad "sandbox product leaked into production" || ok "sandbox product invisible in production"

echo
summary "PHASE 10 REVENUE CLOUD"
