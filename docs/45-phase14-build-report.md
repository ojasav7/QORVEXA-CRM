# 45 · Phase 14 Build Report — Enterprise Security, Compliance & Governance

> How Phase 14 (spec `docs/44-spec-phase14.md`, ADR-026) was built and
> verified. Everything below was verified live against a freshly booted +
> seeded stack (`db:push --force-reset` → `npm run seed` → server on :8787)
> with **`verify-phase14.sh` — 106/106 checks green**, plus regressions
> `verify-phase13.sh` (53/53) and `verify-phase12.sh` (69/69) green on the
> same stack.

## What shipped

**Backend (`server/lib/security.ts`, `server/routes/security.ts`,
`server/routes/scim.ts`, auth + tokens wiring)**

- **MFA (TOTP RFC 6238 + recovery codes)** — self-service
  setup/verify/disable, the two-step login handshake
  (`mfaRequired` → `/api/auth/mfa-verify` with a 10-min signed challenge
  token), single-use sha256-at-rest recovery codes, failed-attempt alerts.
- **DB-backed sessions + device management** — `SecuritySession` rows with
  device/IP/lastSeen/expiry/revocation; per-session revoke, revoke-all, the
  engine hygiene tick; legacy-cookie fallback.
- **IP restriction** — CIDR allowlist enforced by a global middleware on
  every `/api/*` request; blocked requests raise `security.threat_detected`
  alerts; the test-IP endpoint makes policy changes safe to try.
- **Security alerts** — the blueprint entity, with acknowledge flow.
- **Consent + privacy center** — `ConsentRecord` (+`consent.updated`) and
  `DataSubjectRequest` fulfillment (export bundle to `portability/`, delete =
  right to be forgotten, rectify = anonymize).
- **Retention policies** — delete/anonymize over `olderThanDays` cutoffs,
  engine + manual run, `retention.policy_applied`.
- **Status page** — engine uptime ticks + derived per-component % +
  incidents with create/resolve events.
- **Sub-processors** — vendor transparency rows.
- **SCIM 2.0** — `/Users` + `/Groups` + discovery endpoints behind a
  **scim-scoped** bearer token; groups map to roles; deactivation = disable.
- **i18n** — locale/timezone/currency config + a 44-key translation catalog
  with per-locale completeness QA.
- **Feature gates** — `sec.mfa/sessions/scim/consent/retention/status` +
  `i18n.localization` (all default-on), per-org × environment.
- **Seed** — demo security posture: sub-processors, an active retention
  policy, consent records, a security alert, an open status incident, uptime
  ticks, a SCIM group, the translation catalog.

**Frontend (`src/pages/SecurityPage.tsx`, `src/pages/Login.tsx`,
`src/App.tsx`, `src/components/Layout.tsx`)**

- The **Security & governance** page with 11 tabs (Overview / MFA / Sessions
  / Policy / Alerts / Privacy / Retention / Status / Sub-processors / i18n /
  SCIM), role-aware (admins get the writes, everyone gets the monitoring
  surface), and the **MFA challenge step on the Login page**.

## Verification highlights (from `verify-phase14.sh`)

- Seeds: overview counts, MFA adoption report, status components + open
  incident, i18n catalog + en baseline, SCIM users/groups.
- RBAC: 9 write surfaces → 403 for reps; monitoring reads → 200.
- **MFA end-to-end**: create user → setup (secret + otpauth + preview) →
  verify → recovery codes → logout → login challenge → TOTP completes login →
  recovery code completes login → wrong code rejected + `security.threat_detected`
  → disable with valid TOTP → `sec.mfa` gate 403.
- **Sessions**: device list, revoke invalidates the session immediately,
  revoke-all, `session.revoked` events.
- **IP restriction**: allowlist logic via test-IP, real enforcement 403,
  ip-category alert + threat event, recovery.
- Consent (records + events + validation), DSR lifecycle (export bundle +
  delete purge + RBAC), retention (delete + anonymize over backdated rows +
  `retention.policy_applied`), status (ticks + incidents + events),
  sub-processors, i18n (config + validation + custom translation + QA), SCIM
  (provision user/group, role application, deactivate, invalid-token 401,
  gate), feature gates ×5, sandbox isolation.

## Bugs found & fixed during verification

1. **Prisma+Mongo null filter quirk** — `where: { revokedAt: null }` on a
   nullable `DateTime?` silently matches **nothing** (active-session counts
   returned 0, expired sessions never revoked). Replaced with the
   Mongo-correct `{ revokedAt: { isSet: false } }` in the overview count,
   revoke-all, and the engine hygiene tick.
2. **Status endpoint clobbered its own report** — the route spread
   `uptimeReport()` and then overwrote `components` with the component-name
   array, breaking the frontend's per-component stats. Now `componentNames`
   rides alongside the real `components` record.
3. **SCIM + revoke-all events failed to persist** — `emitEvent` swallows
   errors, so `actorId: "scim"` and `entityId: "all"` (not valid ObjectIds on
   `@db.ObjectId` fields) silently dropped events. Introduced
   `SCIM_ACTOR_ID`/`SYSTEM_ACTOR_ID` (zero ObjectId) and a real entity id for
   revoke-all; `scim.user_provisioned` etc. now land in the event log.
4. **No way to mint a SCIM token** — the token scope enum only allowed
   `all|read|write`, but SCIM auth requires a `scim` scope. Extended the enum
   **and** made `loadTokenAuth` treat a scim-only token as *non-session* (it
   authenticates the SCIM routes only — it can never act on the rest of the
   API).

## Stack left pristine?

The suite creates its own throwaway artifacts (MFA user `mia-<ts>@…`, SCIM
user/group, retention policies, incidents, sub-processor, consent records,
DSRs, a scim token) and restores the org policy + feature flags at the end —
so a re-run against the same stack keeps passing.

## Docs shipped with this phase

- `docs/44-spec-phase14.md` — the spec (this phase's contract).
- `docs/46-security-whitepaper.md` — the security whitepaper (incl. the
  sub-processor list).
- `docs/47-compliance-matrix.md` — GDPR/CCPA/SOC 2/ISO 27001/HIPAA posture.
- `docs/48-accessibility-conformance.md` — WCAG 2.2 AA conformance report.
- ADR-026 in `docs/08-decision-log.md`.
