# Operator runbook

## Daily start

1. Start with `docker compose up --build` or `scripts/dev.ps1`.
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

1. Run `scripts/verify.ps1` and Docker build.
2. Back up the database.
3. Apply migrations with `simbi migrate`; migrations are forward-only and idempotently recorded.
4. Deploy one local/canary workspace first and run the critical path without sending.
5. Roll back application image only after checking schema compatibility. Restore the pre-release backup if a migration must be reversed.

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
