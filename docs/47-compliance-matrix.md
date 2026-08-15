# 47 · Compliance Matrix

> How QORVEXA CRM maps to the certifications the Phase 14 blueprint targets
> (GDPR, CCPA, SOC 2, ISO 27001, HIPAA). "Where" columns point at the
> implemented control (verified in `verify-phase14.sh`); "Status" is
> **shipped** (control exists in code) vs **documented posture** (config /
> process claim surfaced in the UI). This is the engineering map, not a
> certification claim — an actual audit requires the org's own evidence
> collection.

Legend: 🟢 shipped & verified · 🟡 documented posture / config surface ·
⬜ not in scope for Phase 14.

## GDPR (EU)

| Requirement | Status | Where |
|---|---|---|
| Lawful basis & purpose limitation | 🟢 | Purpose-based `ConsentRecord` (marketing/analytics/processing/communications), `consent.updated` events |
| Consent lifecycle (grant/withdraw) | 🟢 | Consent records with `grantedAt`/`withdrawnAt`; admin/manager write via `/api/security/consent` |
| Right of access | 🟢 | DSR `access` → contact-scoped bundle |
| Right to data portability | 🟢 | DSR `export` bundle + Phase 7 full-tenant `PortabilityExport` |
| Right to erasure ("right to be forgotten") | 🟢 | DSR `delete` removes consent rows + contact (verified) |
| Right to rectification | 🟢 | DSR `rectify` anonymizes PII in place |
| Retention limitation | 🟢 | `RetentionPolicy` delete/anonymize schedules + `retention.policy_applied` |
| Records of processing (audit) | 🟢 | Event log + field-level audit trail (Phase 0); every DSR/consent/retention action evented |
| Data-subject request handling | 🟢 | DSR queue + fulfillment in the privacy center |
| Sub-processor transparency | 🟢 | `SubProcessor` register (whitepaper §9) |
| Security of processing | 🟢 | MFA, sessions, RBAC, IP restriction, encryption posture (whitepaper) |
| Breach notification workflow | 🟡 | `SecurityAlert` ledger + `security.threat_detected` events feed the response process |
| Data residency | 🟡 | `Organization.settings.dataResidency` (Phase 0) + EU-hosted sub-processor rows |

## CCPA/CPRA (California)

| Requirement | Status | Where |
|---|---|---|
| Right to know | 🟢 | DSR `access` / `export` bundles |
| Right to delete | 🟢 | DSR `delete` fulfillment |
| Right to correct | 🟢 | DSR `rectify` fulfillment |
| Right to opt-out of sale/sharing | 🟡 | Consent purposes include `marketing`; a "sale" toggle maps to the marketing purpose |
| Do-not-sell handling | 🟡 | Consent record per contact; source attribution |
| Non-discrimination for exercising rights | 🟡 | DSR submission is open to any authenticated user; process documented |

## SOC 2 (Trust Services Criteria)

| Criterion | Status | Where |
|---|---|---|
| CC6.1 Logical access control | 🟢 | RBAC + `requireRole` on every Phase 14 write (rep → 403 verified) |
| CC6.6 MFA | 🟢 | TOTP + recovery codes + org-wide `requireMfa` policy |
| CC6.3 Session management & revocation | 🟢 | DB-backed sessions, immediate revocation, revoke-all (verified) |
| CC6.7 Restrict access by location | 🟢 | IP allowlist enforced on every request (verified 403 + alert) |
| CC7.2 Security incident monitoring | 🟢 | `SecurityAlert` ledger + threat events (MFA failures, blocked IPs, DSRs) |
| CC7.4 Incident response | 🟡 | Alerts + status incidents; runbook is the admin workflow |
| CC7.5 Availability | 🟢 | Status page: uptime ticks, derived %, incidents (verified) |
| CC8.1 Change management | 🟡 | Feature flags + environments (ADR-008); Phase 13 change sets promote config safely |
| CC9.1 Risk mitigation (vendor) | 🟢 | Sub-processor register with purpose + region + data categories |
| A1.2 Availability (SLA dashboard) | 🟢 | Uptime SLA dashboard (30/90-day) |
| Logical & physical protection (encryption) | 🟡 | `encryption.atRest`/`inTransit` posture flags reported on the overview |

## ISO/IEC 27001

| Control family | Status | Where |
|---|---|---|
| A.5.15 Access control | 🟢 | RBAC + session/device management + IP restriction |
| A.5.17 Authentication info | 🟢 | bcrypt passwords, sha256 tokens/recovery codes |
| A.8.2.2/8.2.3 Information classification & labelling | 🟡 | Field-level permissions + masking (Phase 0), `fieldLevel` policy surface |
| A.8.10 Information deletion | 🟢 | Retention policies (delete/anonymize) + DSR delete |
| A.8.11 Data masking | 🟢 | Phase 0 field masking + export masking |
| A.8.12 Data leakage prevention | 🟡 | IP restriction + read/mask discipline |
| A.8.24 Use of cryptography | 🟡 | TLS + at-rest posture flags |
| A.8.30 Outsourced development / A.8.31 Supplier relationships | 🟢 | Sub-processor register |
| A.8.34 Privacy & PII protection | 🟢 | Consent center + DSRs |
| A.5.28 Collection of evidence | 🟡 | Audit log + event log persisted per org × environment |

## HIPAA (if processing PHI)

| Safeguard | Status | Where |
|---|---|---|
| Access control (45 CFR §164.312) | 🟢 | RBAC + MFA + sessions |
| Audit controls | 🟢 | Field-level audit trail + event log |
| Integrity controls | 🟡 | Record timeline + audit diffs |
| Transmission security | 🟡 | TLS posture flag |
| Business associate management | 🟢 | Sub-processor register (BAAs are the org's legal layer) |
| Breach response | 🟡 | SecurityAlert ledger + threat events |

## Where to go next

- Controls are verifiable via `verify-phase14.sh` (106/106) on a fresh
  seeded stack.
- The whitepaper (`docs/46-security-whitepaper.md`) explains each control;
  the spec (`docs/44-spec-phase14.md`) is the engineering contract.
- Certification-level gaps are **documented posture** items (encryption
  flags, residency, breach runbooks) — those become hard controls when the
  deployment target (region, key management, monitoring stack) is chosen.
