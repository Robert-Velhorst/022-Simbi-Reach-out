# Audit privacy: minimized new entries and owner-controlled historical details

The audit log records who changed local state, what changed and when. It is not an anonymous log, a message archive, a provider activity feed or proof that a message was delivered. New entries omit known unnecessary copies. A separate owner-confirmed operation can minimize those same known fields in old entries without deleting events or changing operational restrictions. Nothing runs automatically or changes Simbi.

## What is stored where

| Action | New audit `details` | Operational data that remains |
|---|---|---|
| Stop contact (`prospect.suppressed`) | `{ "restriction": "do_not_contact" }` | The suppression registry retains the normalized provider/source identity and the original reason. The contact becomes opted out; pending handoffs and open reminders are cancelled and applicable drafts become suppressed. |
| Save provider handoff link (`provider.updated`) | `{ "mode": "assisted" }` | The validated full URL remains in provider settings, including its path/query if supplied. Saving a URL does not authenticate, fetch or verify a provider account. |
| Approve/decline a draft (`draft.approved`, `draft.declined`) | A sorted, duplicate-free `checks` list containing only recognized check names | Draft text, state and review metadata remain in the draft. Approval still requires all four checks, the current saved-content hash, current permission and the existing safety gates. |

The recognized checks are `source_authorized`, `message_personalized`, `policy_reviewed` and `manual_send_understood`. Existing review requests may include extra strings, but those strings are not copied into new review audit entries. They cannot substitute for missing required checks. Declining does not require all four checks and records only recognized names actually supplied.

The first suppression reason remains authoritative: another Stop contact request does not overwrite it. Neither suppression reasons nor provider URLs are erased from their operational records by this policy. Enter only necessary information and never paste provider passwords, cookies or unrelated personal information into these fields.

Event ID, workspace, actor reference, event type, entity type/ID and timestamp are retained. The audit page resolves the actor's display name from the local account. Provider labels can be user-entered identifiers. Other existing audit metadata, including prepared-handoff content hashes, record references, quality signals, compliance acknowledgements and cleanup receipts, is unchanged. This is **not a universal personal-data scrubber**, removal of every identifier, a legal retention rule or cryptographic tamper protection.

## Preservation and copies

- Existing audit entries are unchanged unless the owner explicitly confirms the separate historical operation below. Startup/migration, reading the log, exporting, backing up and ordinary record cleanup do not redact them.
- Contact/campaign/template cleanup preserves audit history. Removing a contact retains its do-not-contact identity and original restriction reason; recreating/importing that identity must not reopen outreach.
- Workspace JSON export includes `audit_events` and `suppressions`, so it can still contain old audit text and current restriction reasons. Provider settings are not part of that JSON export. SQLite backups include the entire database, including provider settings and older audit content, local credential hashes and sessions. Protect both kinds of copies.
- The audit page is read-only. Settings has a separate exact-preview historical minimization control, not arbitrary editing or event deletion. There is no automatic audit-content expiry. Do not edit the database to bypass restrictions or conceal an uncertain outcome.
- Separate single-owner [installation retirement](PRIVACY_CLEANUP.md#personal-installation-retirement) removes active account/workspace audit records only after its exact-preview, password, safety-stop and verified-backup gates. Its protected pre-retirement backup, existing exports/HAI files and other external copies remain. Retirement is not fresh setup or secure erasure.

General historical anonymization/expiry, external-copy cleanup/HAI receiving-side coordination, secure erasure and long-term archival acceptance remain unfinished. This narrow operation does not fulfill every privacy requirement. Development fixtures never authorize cleanup of Robert's real data or changes to his provider account.

## Historical detail minimization: operator procedure

1. Sign in as the local **owner** and open **Settings → Minimize old audit details → Preview old audit details**. No provider password belongs here. Admin/editor/viewer roles cannot preview, confirm or read these receipts.
2. Review the exact event IDs, types, entity references, timestamps and field names. The preview and stored plan contain no copies of the text being removed. Only events strictly older than the workspace's retention preference (30–3650 days) qualify; this is not a legal recommendation. Only the four known event types above are scanned.
3. The page scans at most1000 events in ascending ID order and selects at most50 eligible events. Figures describe **this scan page**, not the entire log. Recent, invalid-date, malformed/non-object JSON, duplicate JSON keys, nonstandard constants, JSON numbers that cannot be preserved exactly on re-encoding, container nesting beyond64 levels (root object counts as1) and unexpectedly shaped target fields are protected. Other keys and event types are left untouched, even if they contain personal text. A page with no eligible entries is not proof that the log is free of personal data.
4. Choose **Review audit minimization**. Acknowledge the exact fields and retained copies, then enter the current **local account password**. Cancel/Escape changes no audit details; reopening clears credentials and acknowledgement. Pending requests block closing and duplicate submission.
5. Confirmation requires a verified whole-database recovery copy first. A changed target row, retention preference, expired ten-minute plan, another owner's plan or replaced preview fails closed. A new privacy/retirement/audit preview replaces this owner's other pending previews, including other tabs. Database failure after backup rolls back all detail changes and the receipt; a backup file alone is not completion proof.
6. Success shows an event-update count, time and recovery basename—not contacts removed. Retry the **same preview** after an interrupted/unverified response to retrieve its existing receipt without another update/backup. The UI refuses wrong-plan, wrong-kind, count-mismatched or malformed completion receipts. **Check audit minimization receipts** shows this owner's last ten completed audit operations across reload; the general cleanup receipt list also labels audit updates separately. Older receipts remain stored but are not shown in this last-ten list.
7. Repeat **Preview old audit details** on the same page until its eligible batches are processed, then use **Next audit scan page**. The button is unavailable while selected events remain. **Restart audit scan** begins at ID0. A later scan is new work, not an automatic continuation of a prior confirmation. New/out-of-page events are never silently added to a plan.

### Exact historical changes and preserved evidence

| Known old entry | Only allowed detail change |
|---|---|
| `prospect.suppressed` with a string `reason` | Remove that key; preserve all other keys. The separate suppression registry is unchanged, including its reason and identity. |
| `provider.updated` with a string `base_url` | Remove that key; preserve all other keys. The configured provider URL/mode is unchanged. |
| `draft.approved` / `draft.declined` with a list consisting only of strings | Remove only unrecognized strings from `checks`. Recognized strings retain their original order and duplicates; all other keys, including any content hash, remain. If no unrecognized string exists, the entry is not changed. |

No event row is deleted. IDs, workspace, actor, type, entity reference and timestamp stay unchanged. No drafts, approvals, handoffs, replies, contacts, campaigns, templates, reminders, restrictions or provider settings are changed. JSON representation of a changed `details` object is canonicalized; other keys/values retain their JSON meaning, not necessarily their original whitespace. New minimized events retain the fixed markers described above; historical minimization does not invent those markers in older entries.

The recovery copy retains **all original content**, account credential hashes and sessions for all workspaces. Existing JSON exports, earlier backups and HAI/external copies are unchanged. Worker backup rotation can later prune the configured backup folder; preserve a separately protected copy if needed. A full restore can resurrect removed text and older operational/password/session state. Use [the isolated restore procedure](../README.md#test-a-restore-without-replacing-the-real-database), never replace the real installation during verification.

### API and transaction boundary

| Endpoint | Contract |
|---|---|
| `POST /api/privacy/audit/preview` | Current owner + CSRF; `{}` or `{ "after_id": 1000 }`. Cursor is a nonnegative SQLite integer ID. Returns opaque plan ID, ten-minute expiry, exact selected event metadata/field names, cutoff and scan-page counts/continuation. |
| `POST /api/privacy/audit/confirm` | Current owner + CSRF + current password + `{ "plan_id": "opaque32hex", "current_password": "local password", "confirmed": true }`. Returns typed `audit_redaction` receipt, `counts.audit_events`, time, backup basename and replay flag. |
| `GET /api/privacy/audit/receipts` | Current owner, last ten completed audit-only receipts for this workspace/owner, no original field text. |

Strict bodies reject extra target IDs/content/counts. Confirmation shares the existing privacy reauthentication throttle, reserves the maintenance operation lease before SQLite's writer transaction, rechecks current session/owner/password and the exact selected-row digest, then uses a separate reader for the integrity/foreign-key-checked committed pre-change backup. Detail updates, receipt and counts-only completion event commit atomically. Ordinary cleanup confirmation refuses audit plans, including completed ones; audit confirmation refuses other scopes. No arbitrary audit-edit endpoint is added.

Malformed input is422; wrong role/password/session/CSRF is403 (or normal authentication rejection); password throttling is429; stale/expired/replaced/empty/wrong-scope/busy plans are409; verified-backup failure is503 with no detail update. No automatic migration redaction, schema alteration or new dependency is involved; the deployed migration003 plan format supports this distinct scope. Cryptographic tamper protection against filesystem administrators remains absent.

## Developer enforcement and evidence

`backend/app/main.py` avoids passing suppression text, provider URLs or unknown review strings to the audit writer. `backend/app/db.py::audit` enforces the same narrow policy for these four event types, including callers added later: only the fixed restriction/mode values or recognized checklist names are persisted. Unexpected checklist container types become an empty audit checklist; that does not grant approval authority. Other event types retain their existing metadata contract. Direct SQL writes are outside this helper's boundary, so future event/SQL changes still need privacy review.

The new-write policy does not rewrite existing history. The separate `backend/app/audit_privacy.py` operation above updates only explicitly previewed details under owner/password/backup gates. Immutable deployed migrations are preserved. Event chronology, ownership checks, transaction behavior and handoff evidence remain intact.

Run the focused isolated regression suite from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_audit_privacy.py
.\.venv\Scripts\python.exe -m pytest backend/tests/test_audit_cleanup.py
```

Fixtures exercise real authenticated API writes, audit reads and workspace exports; approval and decline; required-check rejection; shared-writer enforcement and malformed checklist containers; actual contact cleanup/recreation with retained restrictions; unchanged legacy history after migration/export/backup; and explicit historical minimization with core evidence/operational preservation, original-data backup, rollback, stale/cross-scope/cross-owner protections, throttling and bounded scan continuation/batches. The full bilingual browser harness seeds old entries only in its own fresh fictional database, exercises the actual Settings controls, cancellation/mobile accessibility, rejects a deliberately substituted wrong-plan receipt after a real successful commit and verifies idempotent retry/reload receipt recovery. Unit tests additionally cover malformed completions, paging and shared-history labels. They use fictional records, not Robert's installed database or Simbi account. Completed results and exact publication identities are recorded in [the production acceptance ledger](PRODUCTION_READINESS.md).
