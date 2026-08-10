# 04 · Permissions & Governance

Implemented from Day 1 (blueprint principle #3) — not bolted on.

## Roles

| Role | Capabilities |
|---|---|
| `admin` | Everything: manage team, custom fields, webhooks, org settings |
| `manager` | Read/write all org records; no platform administration |
| `rep` | Read/write records they own **plus** org-visible records |

Roles are enforced two ways:
- **Route-level:** `requireRole("admin")` middleware (users, fields, webhooks, org settings).
- **Service-level:** every single-record operation runs `assertAccess(user, record)`; every list runs `listWhere(user)`.

## Record-level visibility

Every record has `visibility`:

| Value | Who can see/edit |
|---|---|
| `org` | All org members (default) |
| `owner` | Only the record's `ownerId` (admins/managers still see everything) |

Enforcement lives in `server/lib/access.ts`:

```
assertAccess(user, record):
  record.orgId ≠ user.orgId        → 404 (don't leak existence)
  user.role ∈ {admin, manager}     → allow
  record.visibility == "org"       → allow
  record.ownerId == user.id        → allow
  else                             → 403

listWhere(user):                   → admin/manager: { orgId }
                                     rep: { orgId, visibility: "org" }
```

## Field-level permissions

Not yet enforced (Phase 14 scope), but the shape is ready:
- `FieldDef` rows already carry per-org metadata, so per-field read/write policies can attach there.
- Core columns are explicit, so per-column masks are straightforward to add.

## Tenant isolation

Every model carries `orgId`. All queries must scope by it — the service layer enforces this centrally, so a route can't accidentally cross tenants. The `User.email` global uniqueness (Phases 0–1) will become per-org when invites/SSO arrive in Phase 14.

## AI action risk tiers (blueprint §3.4)

Not yet implemented (Phase 8–9) but codified for future use:

- 🟢 **Automatic** — read-only summaries, internal tasks.
- 🟡 **Approval required** — customer-facing sends, stage/status changes, quote creation.
- 🔴 **Human required** — refunds, deletions, contract changes, large discounts.

The tier table will live in the AI action layer and be enforced by the permission engine above, so governance composes with RBAC rather than replacing it.

## Audit & compliance hooks

- Every mutation → `AuditLog` row with `action`, `before`, `after`, and `changed` diff (who/what/when/from-IP).
- Every state change → persisted `Event` (replayable history).
- Together these satisfy the audit-trail requirement and are the substrate for legal hold (Phase 4), GDPR deletion (Phase 14), and the Time Machine (Phase 15).
