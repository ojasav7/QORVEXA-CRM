# 46 · QORVEXA Security Whitepaper

> Companion to Phase 14 (spec `docs/44-spec-phase14.md`, build report
> `docs/45-phase14-build-report.md`). Written from the controls actually
> implemented and verified in this repository — every claim below maps to a
> route, a middleware, or a test in `verify-phase14.sh`.

## 1. Scope

QORVEXA CRM is a multi-tenant business operating system (Express 5 API +
MongoDB + React SPA). This whitepaper covers the **security, compliance, and
governance controls** that ship in Phase 14: authentication & session
management, MFA, IP restriction, access control, data protection (consent,
retention, masking, portability), vendor transparency, and platform
availability (status/uptime).

## 2. Authentication

- **Passwords** — bcrypt (cost 10) at rest; never logged or returned.
- **Sessions** — every login issues a **DB-backed `SecuritySession`** row
  (device label from user-agent, IP, `lastSeenAt`, `expiresAt`). The
  `httpOnly`, `SameSite=Lax` cookie embeds the session id; **every request**
  re-validates the row (revoked/expired) and refreshes `lastSeenAt`.
  Revocation is immediate — a revoked session is rejected on its next use
  (verified: revoking a session signs that device out instantly).
- **SSO (Phase 0)** — Google/GitHub authorization-code flows sign into
  existing accounts by verified email; no automatic cross-tenant sign-up.
- **API tokens (Phase 0)** — bearer `ApiToken`s (sha256 at rest) act as a
  role with explicit scopes. Phase 14 adds the **`scim` scope**, which is
  *confined*: a scim-scoped token authenticates the SCIM 2.0 endpoints only
  and never becomes a session user on the rest of the API.

## 3. Multi-factor authentication (MFA)

- **TOTP (RFC 6238)** — HMAC-SHA1, 30-second windows, 6 digits, verified
  with ±1-window skew tolerance; implemented with `node:crypto` (no
  third-party dependency).
- **Enrollment** — self-service; the secret is shown once with an
  `otpauth://` URI + QR; confirmation requires a valid code before the user
  is marked `mfaEnabled`.
- **Login handshake** — MFA-enabled accounts never receive a session at the
  password step; the client must complete a second factor via a short-lived
  (10-minute) signed challenge token. Both TOTP and **one-time recovery
  codes** (10 per user, sha256 at rest, single-use) are accepted.
- **Failure handling** — every invalid second factor raises a high-severity
  `SecurityAlert` and emits `security.threat_detected` (verified).
- **Org policy** — admins can require MFA for every user
  (`settings.security.requireMfa`).

## 4. Session & device management

- Devices are first-class: admins/managers can list every active session
  (device, user, IP, last seen), revoke an individual session, or sign out
  all other devices in one action.
- The engine revokes expired sessions automatically (TTL defaults to 30 days,
  org-configurable via `settings.security.sessionTtlDays`).
- Legacy pre-Phase-14 cookies verify via the original HMAC payload; cookies
  whose DB row is missing are treated as logged out.

## 5. Network restriction

- **IP allowlist (CIDR)** — when enabled, the `enforceSecurityPolicy`
  middleware evaluates **every** API request against the org's allowlist.
  Blocked requests return 403 and raise a high-severity `SecurityAlert`
  (category `ip`) → `security.threat_detected` (verified end-to-end).
- A `POST /api/security/debug/ip-allowed` endpoint lets admins test an IP
  against the policy *before* it bites.

## 6. Access control

- **RBAC** — admin / manager / rep enforced in the service layer
  (`requireRole`) and on every Phase 14 write (policy, retention,
  sub-processors, incidents, DSR fulfillment → admin; consent, sessions →
  admin/manager).
- **Monitoring is open, mutating is gated** — the security posture surfaces
  (overview, alerts, status, consent list) are readable by any authenticated
  user; every write requires the appropriate role (verified: 9 rep write
  attempts → 403).
- **Field-level permissions + data masking (Phase 0)** — read-masking in
  lists/detail/export, write rejection on create/update; the security policy
  surfaces the configured `fieldLevel` mask list.
- **Multi-tenancy** — every Phase 14 entity carries `orgId` and is scoped
  centrally; nothing in the security surface is queryable cross-tenant.

## 7. Data protection

- **Consent management** — purpose-based `ConsentRecord`s (marketing,
  analytics, processing, communications) with granted/withdrawn/pending
  states and source attribution; every change emits `consent.updated`.
- **Privacy center / DSRs** — data-subject requests for **access, export,
  delete, and rectify**:
  - export/access → a contact-scoped JSON bundle (record, deals, notes,
    tasks, consent) delivered as a file;
  - delete → the subject's consent records and contact row are removed
    (right to be forgotten — verified);
  - rectify → PII anonymized in place.
- **Retention** — org-defined policies delete or **anonymize** stale records
  (contact/lead/account/opportunity/ticket) past a cutoff. Anonymization
  replaces PII (name/email/phone → `Anonymous` / `redacted-<id>@…`), keeping
  the row for referential integrity. Every applied policy emits
  `retention.policy_applied` (verified: a 400-day-old lead is deleted by one
  policy and anonymized by another on demand).
- **Portability (Phase 7)** — the full-tenant export bundle remains the
  right-to-portability answer for an entire environment.

## 8. Encryption & masking

| Control | Status |
|---|---|
| In transit | TLS 1.2+ on every endpoint in production (config flag `encryption.inTransit`, reported on the overview) |
| At rest | Documented posture flag `encryption.atRest`; DB volumes encrypted per hosting region (multi-region hosting is the Phase 0 residency hook) |
| Secrets at rest | Passwords bcrypt; recovery-code hashes sha256; API tokens sha256 |
| Field masking | Phase 0 `FieldPermission` machinery + `encryption.fieldLevel` list surfaced in the policy |

## 9. Vendor / sub-processor transparency

The sub-processor register is editable by admins (`SubProcessor` rows) and
surfaces on the Security page. The **default seeded register** (the list
QORVEXA itself publishes):

| Sub-processor | Purpose | Region | Data categories |
|---|---|---|---|
| Amazon Web Services | Cloud infrastructure (hosting) | EU (Ireland) | All hosted data |
| Stripe | Billing & payment processing | US + EU | Payment metadata, invoices |
| OpenAI | AI summaries & drafts (firewalled context only) | US | Redacted prompt context, generated text |

Every sub-processor change emits `subprocessor.updated` (verified).

## 10. Availability & incident management

- The security engine records an **uptime tick** every minute (API health
  probe with latency); the Status tab derives per-component uptime % and
  30/90-day totals **on read** (never stored stale).
- Admins declare incidents (minor/major/critical) and resolve them; both
  transitions are evented (`status.incident_created` / `status.incident_resolved`).
- The **SecurityAlerts** ledger is the security incident queue: MFA failures,
  blocked IPs, DSR activity, and engine-detected issues all land there with
  severity + category, and can be acknowledged by managers/admins.

## 11. Compliance posture

See `docs/47-compliance-matrix.md` for the per-certification mapping
(GDPR, CCPA, SOC 2, ISO 27001, HIPAA), and
`docs/48-accessibility-conformance.md` for the WCAG 2.2 AA report.

## 12. Verified-by

`verify-phase14.sh` — 106/106 live checks covering MFA end-to-end, session
revocation, IP enforcement + threat alerts, consent/DSR/retention flows,
status + incidents, sub-processors, SCIM provisioning, i18n QA, RBAC,
feature gates, and sandbox isolation — plus Phase 13 (53/53) and Phase 12
(69/69) regressions green on the same stack.
