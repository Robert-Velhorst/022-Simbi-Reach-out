# Personal data cleanup

Local history removal for the personal workspace owner—not a Simbi deletion/integration, legal retention recommendation, anonymization or secure-erasure service. Never use cleanup to conceal an uncertain provider action or bypass an opt-out.

## Operator procedure

1. Sign in as the local **owner** and open **Settings → Privacy & cleanup**. Admin/editor/viewer roles cannot perform cleanup. Export workspace JSON first if you need a readable copy; JSON cannot be restored through the app.
2. Optionally save **Keep inactive contact history for (days)**: 30–3650 days. This is your preference, not a legal rule or automatic purge. Initial setup uses `SIMBI_RETENTION_DAYS`; later changes belong to this workspace. The CLI's analytics/session cleanup continues using the environment setting.
3. Choose **Old, closed contact history**, or **One selected contact and all its local history**. Individual selection supports name search and pages of 50 contacts. A failed search is not an empty result.
4. Click **Preview cleanup**. Read the exact names and counts for contacts, drafts, handoffs, replies and linked reminders. Age-based previews also show their fixed cutoff, protected-old-contact count and eligible contacts left after the batch. Preview/cancel does not delete contact/conversation records.
5. Click **Review removal**, check the explicit acknowledgement and enter your **local app password**, not a provider password. Cancel/Escape removes nothing; reopening clears password/acknowledgement. Pending requests disable repeat submission and closing.
6. A verified SQLite recovery copy must succeed before deletion. Backup failure removes nothing. Success shows a timestamp, contact count and recovery filename. Keep the file private in `SIMBI_BACKUP_PATH`; standalone Windows uses its normal per-user runtime configuration.
7. If a response is interrupted, do not assume failure. Retry **the same preview** with fresh acknowledgement/password to retrieve its receipt without repeating removal. After refresh, **Check cleanup receipts** shows this owner's last ten completed plans; older metadata remains in the database/backup.
8. Expired, replaced or changed previews must be generated and reviewed again. Never substitute a freshly computed batch for one already confirmed.

## Exact policy and retained data

Removal deletes the selected prospect rows. Foreign-key cascades remove their drafts, handoffs, replies and directly/indirectly linked reminders. Campaign descriptions, templates, unrelated contacts/history, account data, audit history, analytics, provider settings, HAI files, exports and other backups are not removed.

Every removed contact retains a canonical provider/source identity in the suppression registry. New tombstones say `Local history removed; do not contact`; existing restrictions/reasons are preserved. Linked suppression prospect IDs become null. Recreating/importing that identity is still opted out: removal must not erase duplicate/cooldown evidence and allow renewed outreach. Retained source identifiers and potentially identifying historical audit/suppression text mean this is **not complete anonymization or secure erasure**. No restriction-release workflow is added.

Age-based scans consider up to 1000 old contacts and reject larger scans rather than presenting incomplete counts. Batches contain at most 50 eligible contacts. Only displayed, fixed IDs can be removed. All relevant contact/conversation/campaign timestamps and record-specific audit activity must predate the cutoff. Missing time zones/invalid dates are protected. Every linked campaign must be archived; open reminders, recent activity and prepared/opened/ambiguous handoffs protect contacts. Ambiguous/handoff-created drafts are protected even with inconsistent handoff links. Contacts without conversations can qualify when their own history is old. Templates/campaigns remain.

Individual removal does not require old age or archived campaigns and includes linked reminders, as shown in the preview. It still refuses pending/uncertain handoffs: resolve the actual outcome first. Inconsistent cross-workspace references or invalid stored source URLs fail closed instead of cascading into another workspace.

## Safety and recovery contract

- Immutable migration `003_privacy_cleanup.sql` adds owner/workspace-bound plans/receipts without rewriting existing records. Plans store IDs/counts/cutoff/content digest, not duplicate names, notes, messages or passwords.
- Previews last ten minutes. A new preview invalidates that owner's older pending previews, including other tabs. Relevant content/state/links, suppression registry and retention preference are rechecked under a writer transaction.
- Current session, membership and owner role are rechecked inside that transaction. Confirmation requires CSRF, password verification and acknowledgement. Failed reauthentication is throttled separately from sign-in attempts. Clients cannot add target IDs/counts/content or use another owner's/workspace's plan.
- Before any cleanup write, the transaction reserves SQLite's writer lock. A separate reader copies and integrity-checks the committed pre-cleanup database. Deletion, new suppression identities, receipt and non-content audit summary commit together; database errors roll them back. A recovery copy may remain after failure and is not itself proof of successful removal.
- Completed-plan retry returns its stored receipt without a second backup/audit/deletion. Newly added contacts are never silently included. Filesystem administrators can still modify SQLite; cryptographic audit integrity is not claimed.
- Recovery copies include all database records, local password hashes and sessions for all workspaces—not redacted support data. Existing worker backup-pruning rules apply in the backup folder; make a separately protected copy if longer retention is needed.
- Use the existing offline, backup-first restore procedure, testing on an isolated installation first. Full restore can resurrect removed data, old passwords/sessions and older suppression/safety state. Reconcile restrictions/outcomes before resuming. Never silently restore the real installation during a test.

Implementation follows [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html) and the [Python SQLite backup API](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup). Actual isolated SQLite tests check the writer lock, snapshot contents and rollback, not only these documents.

## API

| Endpoint | Contract |
|---|---|
| `POST /api/settings/retention` | Owner + CSRF; `{ "retention_days": 90 }`; preference only, no automatic personal purge. |
| `POST /api/privacy/preview` | Owner + CSRF; `{ "kind": "retention" }` or `{ "kind": "prospect", "prospect_id": 123 }`. Returns opaque plan ID, expiry, cutoff, names/counts and batch figures. |
| `POST /api/privacy/confirm` | Owner + CSRF + fresh password; `{ "plan_id": "opaque32hex", "current_password": "local password", "confirmed": true }`; returns completion receipt/backup basename. |
| `GET /api/privacy/receipts` | Current owner; last ten completed receipts for this owner/workspace, no message content. |
| `DELETE /api/prospects/{id}` | Deprecated bypass: existing owned contact returns `409 privacy_preview_required`; foreign contacts remain `404`. Use the two-step privacy contract. |

Strict bodies reject extra fields. Wrong password/role/CSRF: 403; throttling: 429. Expired/replaced/stale/empty/protected/oversized plans: structured 409. Invalid selection/body: 422. Backup failure: `503 privacy_backup_failed`, no deletion. Network interruption is not an operation result: use retry/receipts.

## Verification and remaining scope

Backend fixtures cover preservation, counts, actual pre-removal backup contents/integrity, cascade scope, retained suppression/recreation, receipt replay, stale/expired/replaced previews, activity/uncertainty protections, password/CSRF/roles/session/throttling, cross-workspace plans/links, writer lock, backup and post-backup rollback failures, batch/scan limits and preference validation. Frontend tests cover pending duplicate submissions, cleared secrets/checks, stale-preview renewal, interrupted-response retry, truthful errors, search/paging and Dutch controls. Chromium acceptance exercises both locales, cancel/focus return, desktop/short-mobile confirmation, real fictional-contact removal, unrelated-record preservation and receipt recovery after reload. See the dated [readiness ledger](PRODUCTION_READINESS.md) for actual results.

Account/workspace-wide deletion, dedicated campaign/template removal, audit-content retention/redaction policy, external-copy/HAI deletion coordination, encryption/secure erasure and operator-tested long-term archival remain separate work. Phases 028/102 and the overall goal stay partial/open. Tests never remove Robert's real records or mutate his provider account.
