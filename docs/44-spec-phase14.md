# 44 · Phase 14 Spec — Enterprise Security, Compliance & Governance

> The spec that drives Phase 14 of QORVEXA CRM. Goal (from the blueprint):
> **pass enterprise security review and global compliance requirements** —
> SSO/MFA/SCIM, IP restriction, session/device management, retention/deletion
> policies, consent management + a privacy center, vendor/sub-processor
> transparency, a status page / uptime SLA dashboard, and internationalization
> with localization QA. Same stack (Express 5 + Mongo via Prisma + React 19
> SPA), same ADR discipline (row-as-config, derived-on-read, every state
> change evented), and the same rule of thumb: **security controls are
> central and server-enforced, reads are monitoring surfaces, and writes are
> RBAC-gated** (ADR-026).

## §0 · Current substrate (verified in repo)

- **Signed-cookie sessions (Phases 0–8)** — the Phase 14 upgrade is
  **DB-backed sessions**: every login issues a `SecuritySession` row; the
  cookie embeds the session id and `resolveSession` checks the row
  (revoked/expired) on **every** request. Device management = these rows.
- **OAuth SSO + API tokens (Phase 0)** — provider SSO (Google/GitHub) and
  bearer `ApiToken`s already exist; SCIM rides the same token machinery with
  a dedicated `scim` scope.
- **Field-level permissions + data residency (Phase 0)** — masking and
  residency config already ship; Phase 14 adds the org security *policy*
  (IP restriction, MFA requirement, session TTL, encryption posture) that the
  enforcement middleware reads.
- **Event bus + notifications (Phases 0/3)** — every Phase 14 action
  (`consent.updated`, `security.threat_detected`, `retention.policy_applied`,
  `mfa.enabled`, `session.revoked`, `scim.user_provisioned`, …) is a
  persisted `Event` + optional admin notification.
- **Environments (ADR-008)** — all Phase 14 entities are environment-scoped;
  feature gates (`sec.*`, `i18n.localization`) are per-org × environment.
- **RBAC** — `requireRole` gates every write; monitoring reads stay open to
  authenticated users.

## §1 · Scope (what this phase ships)

### 1.1 MFA — TOTP + recovery codes (flag `sec.mfa`)

- `POST /api/security/mfa/setup` — issues a TOTP secret (RFC 6238,
  HMAC-SHA1/30s/6-digit, implemented with `node:crypto` — zero
  dependencies), returns the `otpauth://` URI + QR + the **current window's
  code** as `previewCode` so the UI can pre-fill the confirm step.
- `POST /api/security/mfa/verify { code }` — verifies ±1 window, enables the
  user, stores **10 one-time recovery codes** (sha256 at rest, single-use).
  Emits `mfa.enabled`.
- `POST /api/security/mfa/disable { code }` — requires a valid TOTP or an
  unconsumed recovery code. Emits `mfa.disabled`.
- **Login handshake** — when `user.mfaEnabled`, `/api/auth/login` returns
  `{ mfaRequired: true, mfaToken }` and **no session cookie**; the client
  calls `/api/auth/mfa-verify` with a TOTP or recovery code to complete the
  handshake (10-minute signed challenge token). A failed second factor raises
  a high-severity `SecurityAlert` → `security.threat_detected`.
- **Policy** — `settings.security.requireMfa` (admin) can require MFA org-wide.

### 1.2 DB-backed sessions + device management + IP restriction (flag `sec.sessions`)

- `SecuritySession` rows carry `device` (UA label), `ip`, `lastSeenAt`
  (refreshed opportunistically), `expiresAt`, `revokedAt`. Legacy
  pre-Phase-14 cookies still verify via the old HMAC payload.
- `GET /api/security/sessions` (manager+), `POST /:id/revoke` (manager+),
  `POST /api/security/sessions/revoke-all` (admin) — all emit
  `session.revoked`. The engine hygiene tick revokes expired sessions.
- **IP restriction** — `settings.security.ipRestrictionEnabled` +
  `ipAllowlist` (CIDR). The `enforceSecurityPolicy` middleware runs after
  `loadSession`/`loadTokenAuth` on **every** `/api/*` request: a blocked IP
  gets 403 **and** raises a high-severity `SecurityAlert` (category `ip`) →
  `security.threat_detected`. `POST /api/security/debug/ip-allowed` tests an
  IP against the current allowlist (no lockout risk).
- **Encryption posture** — `settings.security.encryption` (`atRest`,
  `inTransit`, `fieldLevel`) is the documented posture surfaced on the
  overview; `atRest`/`inTransit` are config flags, `fieldLevel` lists custom
  fields masked in exports (Phase 0 machinery).

### 1.3 Security alerts (blueprint entity)

- `SecurityAlert` rows (org × environment, severity, category, title,
  message, details, `acknowledgedAt`). Raised by MFA failures, blocked IPs,
  DSR activity, and the status engine. Severity ≥ medium also emits
  `security.threat_detected`. `POST /alerts/:id/acknowledge` (manager+).

### 1.4 Consent + privacy center (flag `sec.consent`)

- **Consent records** — `ConsentRecord` (purpose ∈ marketing | analytics |
  processing | communications, status ∈ granted | withdrawn | pending),
  upserted by contact email; `POST /api/security/consent` (admin/manager)
  emits `consent.updated`.
- **Data-subject requests** — `DataSubjectRequest` (access | export | delete
  | rectify). Submission emits `dsr.submitted`; admin `fulfill`:
  - export/access → a contact-scoped JSON bundle (record + deals + notes +
    tasks + consent) written under `portability/`;
  - delete → consent records + the contact row removed (right to be
    forgotten);
  - rectify → PII anonymized in place.
  Emits `dsr.completed`. The privacy center UI manages both.

### 1.5 Retention & deletion policies (flag `sec.retention`)

- `RetentionPolicy` rows: `entity` (contact | lead | account | opportunity |
  ticket), `olderThanDays`, `action` (delete | anonymize), `status`. PII
  field maps drive the anonymize action (emails → `redacted-<id>@…`).
- `POST /:id/run` (admin) executes the scan; the security engine also runs
  active policies every minute. Processing > 0 rows emits
  `retention.policy_applied`. `POST /:id/toggle` pauses/resumes.

### 1.6 Status page / uptime SLA dashboard (flag `sec.status`)

- `UptimeEvent` ticks (component ∈ api | webhooks | email | app) recorded by
  the engine every minute (pings `/api/health`) + manual admin ticks.
- `GET /api/security/status?days=` derives per-component uptime % + 30/90-day
  totals on read (ADR-018 discipline — never stored).
- `StatusIncident` rows (minor | major | critical, investigating →
  resolved); create/resolve emit `status.incident_created` /
  `status.incident_resolved`.

### 1.7 Vendor / sub-processor transparency

- `SubProcessor` rows (name, purpose, region, dataCategories, link, status)
  — the list a vendor publishes in its security documentation. Reads open;
  writes admin-only; `subprocessor.updated` on changes.

### 1.8 SCIM 2.0 provisioning (flag `sec.scim`)

- `GET/POST/PATCH/DELETE /api/scim/v2/Users` and `/Groups` (RFC 7643/7644
  shapes) + `ServiceProviderConfig` + `Schemas` discovery. Bearer auth via an
  **`ApiToken` with the `scim` scope** (added to the token scopes enum;
  scim-scoped tokens authenticate **only** the SCIM routes — they never
  become session users on the rest of the API).
- Groups map `displayName` → role (admin | manager | rep); membership applies
  the role to members. Deactivation (`active: false`) disables the account.
  Events: `scim.user_provisioned/updated`, `scim.group_provisioned/updated`.
- `GET /api/security/scim` (admin) is the in-app provisioning overview.

### 1.9 i18n + localization QA (flag `i18n.localization`)

- `Organization.settings.i18n` — `locale` (en, es, fr, de, ja, pt-BR),
  `timezone`, `currency`; validated + evented (`i18n.config_updated`).
- A 44-key **translation catalog** (`TranslationEntry` rows, en baseline
  seeded) + per-locale sample translations; `GET /api/security/i18n` returns
  per-locale completeness (translated/missing/%); admin can upsert custom
  translations and re-seed the catalog.

## §2 · Data model

| Entity | Purpose |
|---|---|
| `SecuritySession` | DB-backed login session (device/IP/lastSeen/revoked) |
| `SecurityAlert` | security events needing attention (blueprint entity) |
| `ConsentRecord` | purpose-based consent per contact email |
| `DataSubjectRequest` | access/export/delete/rectify DSRs |
| `RetentionPolicy` | delete/anonymize schedules |
| `UptimeEvent` | status ticks (up/degraded/down + latency) |
| `StatusIncident` | declared incidents until resolved |
| `SubProcessor` | vendor transparency rows |
| `ScimGroup` | provisioning groups → roles |
| `TranslationEntry` | i18n catalog + QA |

User additions: `mfaSecret`, `mfaEnabled`, `mfaVerifiedAt`,
`mfaRecoveryHashes`, `scimExternalId`.

## §3 · Events emitted

`consent.updated` · `security.threat_detected` · `retention.policy_applied`
· `retention.policy_created` · `dsr.submitted` · `dsr.completed` ·
`mfa.enabled` · `mfa.disabled` · `session.revoked` · `security.policy_updated`
· `status.incident_created` · `status.incident_resolved` ·
`subprocessor.updated` · `i18n.config_updated` · `scim.user_provisioned` ·
`scim.user_updated` · `scim.group_provisioned` · `scim.group_updated`.

## §4 · Permissions & risk tier

| Surface | Read | Write |
|---|---|---|
| MFA | — | self-service (any user, own account) |
| Sessions/devices | manager+ | revoke manager+; revoke-all admin |
| Policy (IP/MFA/TTL/encryption) | any authenticated | **admin** |
| Alerts | any authenticated | acknowledge manager+ |
| Consent + DSRs | any authenticated | consent admin/manager; fulfill **admin** |
| Retention | any authenticated | **admin** |
| Status | any authenticated | ticks/incidents **admin** |
| Sub-processors | any authenticated | **admin** |
| SCIM admin view | — | **admin** (API provisioning = scim-scoped token) |
| i18n config | any authenticated | **admin** |

No AI/automation risk tiers apply (this phase is governance, not generation).

## §5 · API endpoints

`/api/security/overview` · `/sessions*` · `/mfa/setup|verify|disable` ·
`/policy` · `/alerts*` · `/consent*` · `/dsrs*` · `/retention*` ·
`/subprocessors*` · `/status*` · `/i18n*` · `/scim` · `/debug/ip-allowed` —
plus `/api/scim/v2/Users|Groups|ServiceProviderConfig|Schemas` (bearer) and
the MFA login handshake on `/api/auth/login` + `/api/auth/mfa-verify`.

## §6 · UI surfaces

**Security & governance** page (`/security`, nav section "Security"):
Overview (posture + alerts), MFA (self-service setup/verify/disable with QR +
recovery codes), Sessions & devices, Policy (IP allowlist editor + test-IP),
Alerts, Privacy (consent + DSRs), Retention, Status (uptime + incidents),
Sub-processors, i18n (locale/currency/timezone + localization QA), SCIM
(provisioning overview + tokens). The **Login** page gains the two-factor
challenge step.

## §7 · Configuration

All flags default **on**: `sec.mfa` (pro/enterprise), `sec.sessions`
(enterprise), `sec.scim` (enterprise), `sec.consent` (enterprise),
`sec.retention` (enterprise), `sec.status` (pro/enterprise),
`i18n.localization` (pro/enterprise) — per-org × environment overrides via
`PUT /api/features/:key`. Org security policy + i18n config live in
`Organization.settings`.

## §8 · Known limitations / deferred

- SSO *identity-provider* MFA (Okta/Entra conditional access) is out of scope
  — the org-level MFA here is native TOTP; SCIM supports deactivation, not
  hard deletion (rows retained for audit).
- IP restriction is IPv4 CIDR (v6-lite: exact + `/0` only).
- Encryption `atRest`/`inTransit` are documented posture flags; real
  per-field encryption and regional key management land with multi-region
  hosting (Phase 0 note).
- i18n ships the config + catalog + QA scaffold; full UI string translation
  for every page is a continued localization effort.
- Accessibility (WCAG 2.2 AA) is a shipped workstream — see the conformance
  report (`docs/48-accessibility-conformance.md`).

## §9 · Verification

`verify-phase14.sh` — 106 live checks on a fresh seeded stack (see
`docs/45-phase14-build-report.md`), plus Phase 13 (53/53) and Phase 12
(69/69) regressions green on the same stack.
