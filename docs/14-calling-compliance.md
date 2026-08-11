# 14 · Calling & Recording — Compliance Notes (Phase 2)

> The blueprint requires *"calling/recording compliance notes"* as a Phase 2
> deliverable. This is the operations/legal runbook for the calling feature:
> what the app enforces today, what the human operator must enforce, and where
> the enforcement hooks live. Companion to `docs/14-communication-guide.md`.

## What the app enforces today (code-level)

| Concern | Status | Where |
|---|---|---|
| Who may log / edit / delete calls | Role + visibility enforced (same central access layer as every record) | `lib/access.ts` via the service layer |
| Recording only when the org opts in | `Organization.settings.calling.recording` gate; per-call override request still resolves against it | `routes/calls.ts` |
| Full audit of call + recording lifecycle | Every create/update/delete writes an `AuditLog` row with before/after diffs | `lib/audit.ts` |
| Event trail | `call.completed` / `call.logged` / `call.deleted` feed the activity feed + webhooks | `docs/03-event-catalog.md` |
| No real media stored | Recordings are **mock placeholder assets** in dev (`EMAIL_MOCK`-style, ADR-014) — no PII media is persisted today | `lib/comm.ts` |

## What the human operator must enforce (not yet automated)

The product simulates telephony (ADR-014). Before a real provider is connected,
the operator is responsible for:

1. **Consent to record.**
   - **Two-party consent jurisdictions** (e.g. California, Connecticut,
     Florida, Illinois, Maryland, Massachusetts, Michigan, Montana, Nevada,
     New Hampshire, Pennsylvania, Washington; and most countries with strong
     data-protection regimes) require **every participant** to consent before
     recording.
   - Best practice regardless of jurisdiction: an **announcement prompt at
     call start** ("This call may be recorded for quality and training
     purposes") and an explicit opt-out path.
   - **Where it lands in code:** the org setting `settings.calling.recording`
     is the single toggle; a provider SDK integration should surface the
     announcement + consent capture as a required step before recording
     starts (the swap point is `lib/comm.ts`).
2. **Retention limits.**
   - Recording and transcripts contain personal data. Define a retention
     window (e.g. 90 days) and delete after it — align with
     `settings.backupRetentionDays` semantics already used for snapshots.
   - A `Call.recordingUrl` pointing at a deleted file is a broken link; prune
     media and rows together.
3. **Access control.**
   - Transcripts are plain text stored on the `Call` row — they inherit the
     org/visibility access rules, but treat them as sensitive: prefer
     `visibility: "owner"` for calls with customer data, and use the
     field-level permission mechanism (`FieldPermission` on
     `objectType: "call"`) if you add fields that should be masked in lists
     and exports.
4. **Data-protection obligations (GDPR / CCPA-CPRA).**
   - Right to access/erasure: a person can request their call recordings and
     transcripts. The audit + event trail tells you which calls involve them;
     delete media + rows on request (the merge/delete service is the pattern).
   - Cross-border transfer: transcripts may contain personal data — respect
     the org's `dataResidency` region configuration when a multi-region
     hosting tier exists (Phase 14 enforcement).
5. **Disclosure in the UI.**
   - Reps should see a "recording on" indicator while on a recorded call —
     the mock UI shows a `recorded` badge on the call log row; keep that when
     the real provider lands.

## When a real telephony provider is connected

- Only `lib/comm.ts` changes: the mock `mockRecordingUrl()` /
  `mockTranscript()` helpers are replaced by provider API calls
  (recordings → object storage, transcription → provider or ASR).
- Re-check compliance per provider: regional hosting, encryption at rest,
  transcript retention options, and whether the provider itself performs the
  consent announcement.
- Add a **kill switch** (`settings.calling.recording = false` must stop any
  new recordings immediately — it already gates creation today) and surface
  the provider's data-processing terms in your privacy policy.

## References

- `docs/14-communication-guide.md` — how calling works end-to-end.
- `docs/04-permissions.md` — roles/visibility model recordings inherit.
- `docs/08-decision-log.md` ADR-014 — why providers are mocked and where the
  real integration plugs in.
- `docs/03-event-catalog.md` — `call.*` events for compliance reporting.
