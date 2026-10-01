# Audit privacy: new entries and retained history

The audit log records who changed local state, what changed and when. It is not an anonymous log, a message archive, a provider activity feed or proof that a message was delivered. This policy reduces unnecessary copies in **new entries only**. It does not rewrite existing history or change do-not-contact protections.

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

- Existing audit entries are unchanged, including historical suppression reasons, provider URLs or extra checklist text. Startup/migration, reading the log, exporting and creating a backup do not redact them.
- Contact/campaign/template cleanup preserves audit history. Removing a contact retains its do-not-contact identity and original restriction reason; recreating/importing that identity must not reopen outreach.
- Workspace JSON export includes `audit_events` and `suppressions`, so it can still contain old audit text and current restriction reasons. Provider settings are not part of that JSON export. SQLite backups include the entire database, including provider settings and older audit content, local credential hashes and sessions. Protect both kinds of copies.
- The audit UI has no edit/delete/redaction control. There is no automatic audit-content expiry or continuing-workspace historical redaction operation. Do not edit the database to bypass restrictions or conceal an uncertain outcome.
- Separate single-owner [installation retirement](PRIVACY_CLEANUP.md#personal-installation-retirement) removes active account/workspace audit records only after its exact-preview, password, safety-stop and verified-backup gates. Its protected pre-retirement backup, existing exports/HAI files and other external copies remain. Retirement is not fresh setup or secure erasure.

Historical redaction, external-copy cleanup/HAI receiving-side coordination, secure erasure and long-term archival acceptance remain separate unfinished requirements. No policy here authorizes deleting Robert's actual data or changing his provider account.

## Developer enforcement and evidence

`backend/app/main.py` avoids passing suppression text, provider URLs or unknown review strings to the audit writer. `backend/app/db.py::audit` enforces the same narrow policy for these four event types, including callers added later: only the fixed restriction/mode values or recognized checklist names are persisted. Unexpected checklist container types become an empty audit checklist; that does not grant approval authority. Other event types retain their existing metadata contract. Direct SQL writes are outside this helper's boundary, so future event/SQL changes still need privacy review.

No schema migration, existing-data rewrite, new deletion endpoint, dependency change or permission expansion is involved. Immutable deployed migrations are preserved. Existing event chronology, ownership checks, transaction behavior and handoff evidence remain intact.

Run the focused isolated regression suite from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_audit_privacy.py
```

Fixtures exercise real authenticated API writes, audit reads and workspace exports; approval and decline; required-check rejection; shared-writer enforcement and malformed checklist containers; actual contact cleanup/recreation with retained restrictions; and unchanged legacy history after migration/export and an integrity-checked SQLite backup. They use fictional records, not Robert's installed database or Simbi account. Completed results and exact publication identities are recorded in [the production acceptance ledger](PRODUCTION_READINESS.md).
