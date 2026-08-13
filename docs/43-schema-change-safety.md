# 43 · Schema Change Safety — Impact Analysis & Safe Delete

> The Phase 13 guardrail that makes the no-code field builder (Phase 0,
> ADR-003) safe to **undo**. Deleting a custom field is a schema change that
> can silently break configuration and drop customer data; this spec defines
> how the platform surfaces the impact and refuses unsafe deletions — by
> construction, not by discipline (same spirit as the Phase 9 kill switch and
> the change-set promotion guard).

## The problem

A custom `FieldDef` can be referenced in many places a deletion never sees:

- a **Segment** filter (`criteria.filters[].field`)
- a **Workflow** condition or action (`automation.conditions[].field`, action JSON)
- an **Agent** rule (`agent.rules[].field`)
- a **Lead form** exposed field (`leadForm.fields[].key`)
- a **Report** metric key (`report.keys[]`)
- a **FieldPermission** row (`fieldPermission.fieldKey`)
- real **record values** — contacts/accounts/leads/… storing data in `custom[key]`

A naive delete leaves broken filters, workflows that error at runtime, and
silently dropped data.

## The analysis

`GET /api/ecosystem/schema/impact?objectType=<type>&key=<key>` (any
authenticated user — the page is a monitoring surface) returns:

```json
{
  "field": { "objectType": "contact", "key": "linkedin", "label": "LinkedIn", … },
  "references": [
    { "surface": "segment",    "name": "Enterprise contacts", "id": "…", "detail": "used as a segment filter" },
    { "surface": "automation", "name": "Warm the lead",        "id": "…", "detail": "used in a condition" },
    { "surface": "fieldPermission", "name": "contact.linkedin", "id": "…", "detail": "1 permission row(s)" }
  ],
  "total": 3,
  "recordValues": 12
}
```

### Surfaces scanned

| Surface | Scan rule |
|---|---|
| `segment` | `criteria.filters[].field === key` |
| `automation` | `conditions[].field === key` **or** the action JSON string contains `"<key>"` |
| `agent` | `rules[].field === key` |
| `leadForm` | `fields[].key === key` |
| `report` | `keys[]` includes the key, or the JSON contains a dotted `.key` reference |
| `fieldPermission` | a permission row exists for `(objectType, fieldKey)` |
| record values | rows of `objectType` whose `custom[key]` is set and non-empty (`undefined/null/""` don't count) |

`recordValues` is scanned with a `try/catch` — an object type without a
`custom` field (or a model that isn't a Prisma model) counts as 0 rather
than erroring the analysis.

## Safe delete

`POST /api/ecosystem/schema/safe-delete { id }` (admin) implements the rule:

```
if (references.length > 0 || recordValues > 0)
    → 400 "Field is in use: N config reference(s), M record value(s). Remove references first."
else
    → delete the FieldDef, emit schema.field_deleted { objectType, key, via: "safe-delete" }
```

The refusal message names **both** counts so the operator knows whether the
block is config (go fix the referencing rows) or data (go export/backfill
the values).

## Change-set interplay

Change sets (Phase 13 §1.3) replay `{ entity: "fieldDef", op: "delete" }`
items directly in the target environment and emit `schema.field_deleted`
with `via: "changeset"` — the promotion path is exempt from the safe-delete
refusal because a change set is an explicit, audited, batch operation
(you built the bundle and chose to include the delete). The impact analysis
is still available on the source environment **before** you bundle, which is
the intended workflow:

1. `GET /api/ecosystem/schema/impact` — see who uses the field.
2. Decide: remove references (and re-check), or keep the field.
3. Only then build/promote the change set (or safe-delete in place).

## Operational guidance

- **Never delete a field with record values** without exporting them first —
  `custom[key]` data has no cascade or archive. The portability export
  (Phase 7) or a plain object export covers this.
- **FieldPermission rows** are config references: deleting the field under a
  permission row leaves an orphan that silently governs nothing. Remove the
  permission first (Settings → Fields → permissions).
- **Workflow/agent rules** that reference a deleted field error at runtime —
  the refusal is your early warning. If you must force a change set delete,
  disable or edit the referencing workflows/agents first.
- The analysis is **live** — it scans current rows on every call, so after
  you remove the last reference, the same field flips to "safe to delete"
  immediately.
