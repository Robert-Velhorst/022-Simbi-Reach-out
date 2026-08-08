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

## Verify

```powershell
.\scripts\verify.ps1
```

Individual commands:

```powershell
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m pytest
pnpm --dir frontend test
pnpm --dir frontend build
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
- Campaign activation and draft approval require a recorded compliance review.
- Approval requires four explicit pre-action checks.
- Provider handoffs require an idempotency key, active campaign, daily limit, per-prospect cooldown, approved provider hostname, and an unpaused workspace.
- A handoff returns copyable text and an HTTPS link. It never claims the message was sent.
- The operator records `sent`, `not sent`, or `ambiguous`; ambiguous outcomes must be checked manually before resolution.
- Opt-outs enter a durable suppression list and stop all unfinished drafts for that prospect.
- Demo mode blocks external handoffs and is visibly labelled.
- Audit events omit credentials and message bodies.

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
