# Personal draft saving and conflict recovery

This guide is for Robert's own workspace and account. Two tabs signed into that same local account can still see different draft versions. Saving must not silently overwrite a newer version. Nothing in this workflow signs into Simbi, approves a message or sends it.

## Normal use

Edit the subject or message in **Review queue**, then press **Save and return to review** explicitly. Subject length is at most200 characters; message length is20–5000 characters. The button is disabled when there are no changes. A genuine saved change returns the draft to `needs_review`, clears its previous approval and requires all four review checks again. A current-version request containing exactly the saved text is a backend no-op: it does not reset approval, timestamps or audit history.

**Unsaved text is temporary, not autosaved.** Conflict/error handling keeps it in the current editor's memory, not durable browser storage. Changing the selected draft, changing the list page, navigating away, closing the tab or reloading can lose it. Save or finish the comparison before leaving. There is no crash recovery, automatic merge, background save or cross-device editor synchronization.

## If the saved draft changed

1. A stale save is rejected before any record or audit mutation. Your unsaved text remains visible in the current editor. Save, Decline, Approve and handoff preparation are paused for that draft.
2. Press **Check saved version**. This reads the current saved record without changing it. If that read fails or its response cannot be verified, your edits remain and the comparison does not open.
3. Compare **Current saved version** and **Your unsaved edits**, including both subjects and message bodies.
4. Choose deliberately:

| Choice | Effect |
|---|---|
| **Keep editing**, Close or Escape | Close the comparison and retain your edits. Saving remains paused; checking again is available. Focus returns to Check saved version. |
| **Discard my edits and use saved version** | Replace the editor with the verified saved text. This is the explicit discard choice; it performs no write. Review checks clear. |
| **Keep my edits for a new review** | Keep your subject/message but use the compared version as the next save's precondition. No write or approval occurs. Press Save separately, then repeat all review checks. |
| **Use verified saved version** | Shown when both subject and body already match the verified saved text. Accept that current record without another save; review checks clear. |

The retain-edits choice is absent when the saved state is no longer editable, or when both text fields already match. Only `needs_review` and `approved` drafts can be edited. If another tab changes the record after your comparison, your separate save is rejected again; comparison does not reserve the record or grant permission to overwrite a later version. Explicit choices return focus to the editor form. The native dialog contains Tab/Shift+Tab and supports Escape.

## Interrupted or unexpected responses

Losing a save response does **not** establish that the save failed. The server might already have committed it. An unexpected record, malformed version, mismatched subject/body/state or unchanged version in a successful response also cannot establish a verified change. The editor keeps its text and pauses further actions instead of automatically retrying or clearing it.

Use Check saved version and the same comparison choices. If the saved text matches exactly, Use verified saved version accepts it without another write. The read is evidence of the **current record**, not a receipt proving who performed a particular past save. If it differs, compare and either explicitly discard or retain/re-save against that version. Do not infer delivery or approval from either result.

A structured backend `422 validation_failed` response is different: it means this request did not satisfy validation and permits correcting the inputs and trying again. Other rejected/uncertain save outcomes require checking the saved version. Native form constraints provide immediate feedback for ordinary length errors; server validation remains authoritative.

## API contract for developers

Deploy matching frontend and backend versions and reload old browser bundles. Older clients that omit the new precondition can no longer save drafts. No schema migration, dependency or stored approval-hash rewrite is required.

- `GET /api/drafts` keeps its paged contract and adds `edit_version` to each draft.
- `GET /api/drafts/{id}` returns the full current joined draft, including `content_hash` and `edit_version`. Authentication and workspace ownership are required; a same-workspace viewer may read, and an unknown/foreign ID returns404. It does not write records or audit events.
- `PATCH /api/drafts/{id}` requires an owner/admin/editor, current session, CSRF and an editable owned draft. JSON fields are `subject`, `body`, and required `expected_edit_version` (64 lowercase hexadecimal characters). Missing/malformed versions fail validation.
- A current record whose version differs returns `409 draft_save_conflict` before mutation. Existing role/ownership/locked-state gates remain authoritative; a token is not authorization.
- Success returns the full authoritative draft from the same serialized transaction, not an empty acknowledgement. A real change recalculates quality signals, removes approval, updates the timestamp and records the existing minimized `draft.updated` event. Exact current-version no-ops return the unchanged record.

Example payload (obtain the actual token from an authenticated read; do not copy this illustrative token):

```json
{
  "subject": "A personally reviewed introduction",
  "body": "A complete message authored and reviewed by the personal operator.",
  "expected_edit_version": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

`draft_edit_version` hashes a compact JSON array of workspace ID, draft ID, updated timestamp, state, subject and body with SHA-256. Separate field encoding avoids ambiguous newline boundaries. The comparison and mutation share the existing serialized SQLite transaction; two concurrent requests using the same version cannot both change that version. A changed approval state invalidates an older editing version even if the text is unchanged. This is an optimistic concurrency guard, not cryptographic audit integrity, an immutable history or a receipt identifier.

The existing `content_hash` remains the separate approval/handoff contract and keeps its historical format. Do not substitute the editing version into those endpoints. Conditional preconditions prevent lost updates, the same general purpose described in [RFC9110's If-Match guidance](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match); this application uses a JSON precondition and409, not an implemented HTTP If-Match/ETag/412 protocol.

The browser accepts a successful change only when the response identifies the selected record, has valid tokens and required display fields, matches the exact submitted subject/body, returns `needs_review`, and has a different editing version. No authored message is added to localStorage or sessionStorage. A synchronous in-flight guard also prevents duplicate submission within the mounted editor.

## Verification and limits

Backend coverage in `backend/tests/test_draft_save.py` includes required/malformed tokens, no-op approval preservation, state/record/workspace/field-boundary versions, real concurrent requests with one winner, current-state reads, auth/CSRF/roles/isolation and locked states. Frontend `draft-save.test.tsx` exercises conflict/cancel/focus, explicit rebase versus separate save, explicit discard, matching current-state recovery, mismatched responses/reads, validation repair and locked-state comparison.

The full browser harness invokes `scripts/e2e-draft-save.mjs` in both languages with two real same-account tabs. It requires two stale-save rejections (including a change after comparison), all nine exported table arrays unchanged after rejected saves and read-only comparison choices, explicit saves requiring new review, English committed-but-mismatched response and Dutch committed-response network interruption, and recovery without duplicate writes. Desktop1440x1000/mobile390x844 geometry, selected automated accessibility scans, focus containment/Escape and browser error/storage checks accompany screenshots. These are fictional local fixtures with external requests blocked, not Robert's installation or provider account.

Observed executions, exact revisions, browser engines, counts and publication status belong in [the dated acceptance ledger](PRODUCTION_READINESS.md#personal-version-bound-draft-saving-2026-10-01), not inferred from this test description. Branded/physical-device and dedicated assistive-technology acceptance remain separate. Forms/autosave phase021 and overall production readiness remain partial; this change does not resolve all original specification or privacy/archive/manual-provider/operator gates.
