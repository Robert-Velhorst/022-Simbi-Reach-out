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
- Complete all safety checks.
- Copy and open the provider only when still appropriate.
- Record the exact external result. When unsure, choose **ambiguous**.
- Record objections immediately with the suppression action; never delete a suppression just to retry.

## Emergency stop

Settings -> Emergency safety stop blocks approvals and new handoffs while preserving local investigation, export, reply recording, and audit access. Resume only after the incident is understood and recorded.

## Backup and restore

Production and Windows standalone modes create one integrity-checked backup per day and retain 30 days by default. Manual backups remain appropriate before upgrades or imports.

Create a backup before upgrades, restore tests, or bulk imports:

```powershell
.\.venv\Scripts\python.exe -m app.cli backup
```

Test restore on a non-production copy. Restore validates SQLite integrity and the migration table, then automatically backs up the current database before copying the candidate:

```powershell
.\.venv\Scripts\python.exe -m app.cli restore .\backups\simbi-...db --confirm
```

Docker volume backup should stop app/worker writers first, then copy using SQLite's backup API from a temporary container or export the workspace JSON. Do not copy a live WAL database as a single file.

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

The ngrok launcher is for temporary, explicitly supervised access. It must not expose HAI or a development-mode Simbi process. Stop the launcher to stop both the app and tunnel. If the URL was disclosed unexpectedly, stop it immediately, review audit events, expire sessions by restarting after deleting them through a reviewed maintenance step, and rotate the ngrok credential if compromise is suspected.

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
