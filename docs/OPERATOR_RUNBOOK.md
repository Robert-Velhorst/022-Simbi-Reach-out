# Operator runbook

## Daily start

1. Start with `docker compose up --build`, `scripts/dev.ps1`, or the built Windows executable.
2. Confirm `/api/health/ready` returns `ready`.
3. Open the dashboard and confirm the environment banner says `LOCAL ASSISTED MODE` (or explicitly labelled demo mode).
4. Resolve ambiguous handoffs before preparing new outreach.
5. Review policy acknowledgement date and campaign limits.

## Safe outreach operation

- Add only a prospect/source you may lawfully use.
- Open the source and verify it still matches the planned message.
- Edit the deterministic draft; quality signals are aids, not permission.
- Save edits, then complete all safety checks. Approval is tied to the exact saved text; reload and re-review if another editor changes it.
- Copy and open the provider only when still appropriate.
- Record the exact external result. When unsure, choose **ambiguous**.
- Record objections immediately with **Prospects → Stop contact** and a reason; never delete a suppression just to retry. Restrictions survive prospect deletion/re-import.

## Emergency stop

Settings -> Emergency safety stop blocks approvals and new handoffs while preserving local investigation, export, reply recording, and audit access. Resume only after the incident is understood and recorded.

## Backup and restore

Production and Windows standalone modes create one integrity-checked backup per day and retain 30 days by default. Manual backups remain appropriate before upgrades or imports.

Create a backup before upgrades, restore tests, or bulk imports:

```powershell
.\.venv\Scripts\python.exe -m app.cli backup
```

Test restore on a non-production copy with the app and worker stopped. Restore takes an exclusive runtime lease, validates integrity/foreign keys/exact schema/migration history, stages any upgrade, and makes a safety snapshot before restoring through SQLite's atomic backup transaction. It never replaces a live WAL database with a raw file copy:

```powershell
.\.venv\Scripts\python.exe -m app.cli restore .\backups\simbi-...db --confirm
```

For Docker recovery, stop app/worker writers and use controlled access to the volume. Do not copy a live WAL database as a single file. Workspace JSON export is not a restorable database backup. A corrupt existing target that cannot produce a valid safety snapshot requires separate recovery planning; the ordinary restore refuses it. Backup publication requires filesystem hard-link support.

## Reconciliation

```powershell
.\.venv\Scripts\python.exe -m app.cli reconcile
.\.venv\Scripts\python.exe -m app.cli reconcile --repair
```

Repair expires sessions and changes impossible `sent` records without `sent_at` to `ambiguous`. It never infers that an external send happened.

## Support bundle

```powershell
.\.venv\Scripts\python.exe -m app.cli support-bundle
```

The generated JSON is ignored by Git and excludes personal content. Review it before sharing. A full export is not a support bundle and must be treated as sensitive.

## Release and rollback

1. Run `scripts/verify.ps1`, build the Windows artifact, and build the container.
2. Back up the database.
3. Apply migrations with `simbi migrate`; migrations are forward-only and idempotently recorded.
4. Deploy one local/canary workspace first and run the critical path without sending.
5. Roll back application image only after checking schema compatibility. Restore the pre-release backup if a migration must be reversed.

## HAI feed

HAI integration is local, pull-based, and read-only. Export once with `simbi hai-export <path>` or configure `SIMBI_HAI_FEED_PATH` for worker refresh. Leave `SIMBI_HAI_INCLUDE_CONTENT=false` unless the owner has reviewed the prospect and draft disclosure. HAI receives no cookie, provider credential, or send authority.

HAI configuration:

```text
HAI_PHASE2_FEEDS_DIR=<parent folder of the Simbi feed>
HAI_PHASE2_FEED_FILES=simbi.json
```

The file is written atomically. A repeated unchanged export does not rewrite it. If HAI is unavailable, Simbi continues normally and no outreach action is attempted.

## ngrok incident boundary

The ngrok launcher is for temporary, explicitly supervised access. It must not expose HAI or a development-mode Simbi process. It supervises app, maintenance, and its owned tunnel; stop the launcher to stop all three. It refuses occupied origin ports and selects only its process's reported tunnel. If the URL was disclosed unexpectedly, stop it immediately, review audit events, change the application password to revoke that user's sessions, and rotate the ngrok credential if compromise is suspected. Restarting alone does not revoke database-backed sessions.

## First-owner and password controls

Production first-owner setup requires the configured `SIMBI_SETUP_TOKEN`, a unique random secret of 32–200 characters. Missing/incorrect tokens fail closed. Keep ingress restricted during bootstrap and remove the token from the deployment environment after creating the owner. Settings provides authenticated password change, which requires the current password and signs out every session for that account. Forgotten-password recovery and team-member removal are not supplied workflows.

Readiness in supervised/production modes requires a live singleton worker with recent successful maintenance and no newer failure. Check worker logs, storage permissions and backup/feed destinations if readiness returns `maintenance_unavailable`; do not disable the health gate to conceal a failure.

## Troubleshooting

| Symptom | Meaning | Safe next action |
|---|---|---|
| `compliance_required` | Policy acknowledgement is absent | Owner/admin reviews current policy and records all confirmations. |
| `workspace_paused` | Emergency stop is active | Investigate; do not bypass. Resume in Settings only after review. |
| `daily_limit_reached` | Campaign handoff cap reached | Wait until the next UTC day or lower activity; do not create a second campaign to evade it. |
| `cooldown_active` | Prospect was prepared recently | Wait until the returned time and verify relevance again. |
| `idempotency_required` | Handoff request lacked a stable key | UI generates one; API clients must reuse one only for the same action. |
| `ambiguous` | External result is unknown | Check provider conversation manually; never retry blindly. |
| database unavailable | SQLite file/volume is inaccessible | Stop writers, inspect permissions/disk, restore only from a verified backup. |
