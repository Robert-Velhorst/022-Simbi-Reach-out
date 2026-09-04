# Technical audit

Audit date: 2026-08-08
Starting branch: `main`
Starting commit: `6c3c7cbd23a4aa8edd3e1b0f6eb2fb8f13b3e44d`
Remote default branch: `main`

## True starting point

The repository was not greenfield despite the README saying only “Just a test”. It contained:

- `main.py`: Selenium login, page traversal, contact discovery, message composition, and a plaintext email/password.
- `simbi_automation_consolidated.py` and `simbi_automation_windows.py`: broader scraping, automated messaging, optional ML matching, input simulation, password configuration, and CSV/JSON runtime output.
- `config.py`, `simbi_config.json`, shell launchers, and an empty `.gitignore`.
- No dependency lock, tests, database migrations, application UI, authorization, CI, Docker, or operational documentation.

Historic commits also contain deleted/re-added copies of the same automation. No alternate remote branches existed.

## Risk findings and disposition

| Finding | Severity | Disposition |
|---|---:|---|
| Plaintext provider credential committed | Critical | Removed from current tree; rotation and coordinated history rewrite still required. |
| Scraping and automated-agent behavior prohibited by current Simbi terms | Critical | Removed from active product. No browser automation dependency remains. |
| Automated/unsolicited messaging path | Critical | Replaced by reviewed, copy-and-open manual handoff with truthful outcome recording. |
| Provider credentials persisted in JSON | High | Provider credentials are no longer accepted or stored. |
| No authentication or ownership model | High | Added scrypt auth, sessions, roles, workspace ownership, and cross-workspace tests. |
| No duplicate prevention/rate controls | High | Added draft uniqueness, handoff idempotency, daily limits, and prospect cooldowns. |
| CSV/runtime files could enter Git | High | Added comprehensive ignore rules and local data directories. |
| Fake success after clicking send | High | Product cannot send; only the operator can record a manually verified outcome. |
| No durable state/audit trail | Medium | Added migrated SQLite domain model and append-only operational audit events. |
| No recovery procedures | Medium | Added backup, integrity-checked restore, reconciliation, support bundle, and worker idempotency. |

## Architecture decision

- **Backend:** FastAPI with Python's SQLite driver. The small dependency surface and explicit SQL make ownership predicates, state transitions, and migrations reviewable.
- **Frontend:** React + TypeScript + Vite. The UI is an exception-first operational dashboard, not a marketing shell.
- **Storage:** one local SQLite database in WAL mode; Docker uses a named volume. No cloud sync or telemetry.
- **Worker:** a separate, local reminder-maintenance process. It changes only local state and performs no provider calls.
- **Provider boundary:** HTTPS links restricted to the configured host. The system never fetches, authenticates, fills, or sends on the provider.

## Preserved domain value

The legacy scripts demonstrated the original purpose—identify a relevant member request, personalize a message, avoid duplicates, and track the interaction. Those concepts were retained as prospects, templates, deterministic rendering, unique campaign/prospect drafts, handoff idempotency, replies, and reminders. The unsafe execution mechanism was not retained.

## Current source roots

- `backend/app`: API, security, domain rules, database access, worker, and operator CLI.
- `backend/migrations`: ordered schema migrations.
- `backend/tests`: acceptance, security, isolation, import, suppression, and worker tests.
- `frontend/src`: authenticated product UI.
- `scripts`: Windows development and verification commands.
- `docs`: operating, security, compliance, audit, and verification evidence.
- `.github/workflows`: CI quality gates.
