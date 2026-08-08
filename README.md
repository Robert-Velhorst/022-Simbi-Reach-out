# Simbi Reach-Out

Simbi Reach-Out is a local-first, review-gated workspace for preparing thoughtful networking and exchange outreach. It turns manually supplied prospect context into an auditable workflow:

> product purpose -> authorized prospect record -> template -> human review -> manual provider handoff -> response tracking -> reminders -> reports

It does **not** scrape Simbi, log into a provider, fill provider forms, or send messages. The legacy Selenium/browser-automation runtime has been removed from the active tree because Simbi's terms prohibit scraping, automated queries/agents, harvesting, spam, and unsolicited messages.

## Start with Docker

```powershell
docker compose up --build
```

Open <http://127.0.0.1:8000>. Create the first local owner, then complete **Settings -> Compliance acknowledgement** before activating a campaign.

The Compose project binds only to `127.0.0.1`, persists SQLite in the named `simbi-data` volume, and runs the reminder worker separately.

## Start natively on Windows

Requirements: Python 3.11+, Node 22+, and pnpm 11.

```powershell
.\scripts\dev.ps1
```

The app is at <http://127.0.0.1:5173>; the API is at <http://127.0.0.1:8000>. Runtime data is written under `data/` and ignored by Git.

## Build the Windows 11 standalone app

The build machine needs Python, Node, and pnpm; the resulting folder does not. It contains the Python runtime, backend, migrations, and compiled frontend:

```powershell
.\scripts\build-windows.ps1
.\dist\Simbi Reach-Out\Simbi Reach-Out.exe
```

The executable opens <http://127.0.0.1:8765>, keeps all traffic on loopback, stores data and daily verified backups under `%LOCALAPPDATA%\Simbi Reach-Out`, and runs maintenance in the same process to keep the footprint small. Keep its console window open; press Ctrl+C there to stop cleanly.

## Publish through ngrok

Install and authenticate ngrok first, build the frontend, then run:

```powershell
.\scripts\start-ngrok.ps1
```

The launcher starts an ephemeral HTTPS tunnel, then starts Simbi in production mode with the exact public hostname, secure cookies, trusted proxy headers, automatic backups, and a loopback-only origin server. It exposes Simbi only—not HAI—and stops both child processes when the launcher exits. Treat the URL as private and temporary.

For a long-lived server with a real domain and automatic TLS, copy `.env.production.example` to an untracked `.env.production`, set `SIMBI_DOMAIN`, and use `compose.production.yaml`. Caddy is the only public service; the app and worker have fixed CPU/memory limits and an internal network.

## Connect to HAI

Simbi implements HAI's existing `generic_json_feed` contract. The default export contains only actionable workflow metadata; prospect names and draft text are excluded unless the operator explicitly opts in.

```powershell
.\.venv\Scripts\python.exe -m app.cli hai-export C:\path\to\hai\data\phase2\feeds\simbi.json
```

In HAI, set `HAI_PHASE2_FEEDS_DIR` to that folder and include `simbi.json` in `HAI_PHASE2_FEED_FILES`. For continuous refresh, set `SIMBI_HAI_FEED_PATH` to the same absolute file before starting the Simbi worker. HAI privacy-scans and review-gates the items; the connector cannot send outreach or receive provider credentials. `SIMBI_HAI_INCLUDE_CONTENT=true` is a sensitive, explicit opt-in.

## Verify

```powershell
.\scripts\verify.ps1
```

Individual commands:

```powershell
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m pip_audit --skip-editable
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir frontend test:e2e
.\.venv\Scripts\python.exe -m app.cli doctor
```

## Operator commands

```powershell
# Apply pending migrations
.\.venv\Scripts\python.exe -m app.cli migrate

# Run one reminder-maintenance cycle
.\.venv\Scripts\python.exe -m app.worker --once

# Create a consistent SQLite backup
.\.venv\Scripts\python.exe -m app.cli backup

# Validate relationships and ambiguous send records
.\.venv\Scripts\python.exe -m app.cli reconcile

# Create a PII-redacted diagnostic bundle
.\.venv\Scripts\python.exe -m app.cli support-bundle

# Create HAI's metadata-only generic JSON feed
.\.venv\Scripts\python.exe -m app.cli hai-export C:\path\to\simbi.json
```

Restore requires an explicit confirmation and automatically backs up the current database first:

```powershell
.\.venv\Scripts\python.exe -m app.cli restore .\backups\simbi-YYYYMMDDTHHMMSSZ.db --confirm
```

## Safety model

- Every record belongs to a workspace and every API query enforces that boundary.
- Owner, admin, editor, and viewer roles restrict writes.
- Passwords use salted scrypt; sessions are opaque, expiring, `HttpOnly`, `SameSite=Strict` cookies.
- Writes require a same-site CSRF cookie/header pair.
- Untrusted hostnames are rejected, login abuse is rate-limited, request IDs are sanitized, and production adds HSTS plus cross-origin isolation headers.
- Campaign activation and draft approval require a recorded compliance review.
- Approval requires four explicit pre-action checks.
- Provider handoffs require an idempotency key, active campaign, daily limit, per-prospect cooldown, approved provider hostname, and an unpaused workspace.
- A handoff returns copyable text and an HTTPS link. It never claims the message was sent.
- The operator records `sent`, `not sent`, or `ambiguous`; ambiguous outcomes must be checked manually before resolution.
- Opt-outs enter a durable suppression list and stop all unfinished drafts for that prospect.
- Demo mode blocks external handoffs and is visibly labelled.
- Audit events omit credentials and message bodies.
- Daily SQLite backups use SQLite's consistent backup API and pass an integrity check before retention pruning.

## Documentation

- [Technical audit](docs/TECHNICAL_AUDIT.md)
- [Critical path](docs/CRITICAL_PATH.md)
- [Security and threat model](docs/SECURITY.md)
- [Provider compliance boundary](docs/PROVIDER_COMPLIANCE.md)
- [Operator runbook](docs/OPERATOR_RUNBOOK.md)
- [Acceptance tests](docs/ACCEPTANCE_TESTS.md)
- [UI action audit](docs/UI_ACTION_AUDIT.md)
- [API usage audit](docs/API_USAGE_AUDIT.md)
- [Completion matrix](docs/GOAL_COMPLETION_MATRIX.md)
- [Final verification](docs/FINAL_VERIFICATION_REPORT.md)

## Important credential warning

The starting Git history contains a plaintext credential in legacy `main.py`. The credential is absent from the current tree and active product, but history cleanup requires an owner-approved coordinated history rewrite and immediate provider-side credential rotation. See [Security](docs/SECURITY.md#pre-existing-credential-exposure).

## License

No license was present at the audited starting commit. Treat the repository as all-rights-reserved until the owner adds an explicit license.
