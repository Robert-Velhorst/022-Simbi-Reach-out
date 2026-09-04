# Changelog

## Unreleased — production hardening (2026-09-05)

### Fixed

- Durable restrictions for manual/CSV intake, duplicate imports and deletion/recreation, including records created before this upgrade.
- Stale handoff outcomes, cross-draft idempotency reuse, missing retry content and recovered provider actions that bypassed current permission.
- First-owner setup races, unprotected production bootstrap, password-change/login races and validation input echo.
- Transactional migrations, collision-safe backups, staged/offline schema-validated restore and app/worker lifetime locks.
- Repeated completed reminders, false-positive maintenance readiness, native command failures, unsupervised launcher children and incorrect tunnel selection.
- Stale draft editors, unreachable later pages, missing opt-out UI, selector/load retries, clipboard failures and interrupted-handoff recovery.

### Added

- Operator setup token, authenticated password change with all-session revocation, exact-content approval and a reason-bearing Stop contact control.
- Bounded frontend/API operation pages, private container HAI storage, persistent local backups and reproducible pnpm selection.
- Regression tests, process/executable/container smoke scripts and expanded browser acceptance. See [production acceptance](docs/PRODUCTION_READINESS.md) for exact proof and remaining external gates.

### Upgrade notes

- API approval clients must send `expected_content_hash` from the current draft listing. Missing/stale content is rejected.
- Fresh production setup requires a configured `SIMBI_SETUP_TOKEN`; existing initialized accounts do not need it to sign in.
- Development/ngrok launchers now include maintenance. Do not start a duplicate worker. PowerShell scripts require 7.2+.
- Stop app and worker before restoration; backup publication requires a filesystem supporting hard links. Historical credential rotation and external provider/hosting/HAI acceptance remain separate owner tasks.

## 1.0.0 - 2026-08-08

### Added

- Local-first FastAPI/SQLite application with first-run owner setup and role-based team access.
- React operations dashboard covering prospects, campaigns, templates, review, assisted handoffs, replies, reminders, reports, audit history, and settings.
- Compliance acknowledgement, suppression controls, emergency pause, rate/cooldown limits, idempotency, deterministic quality checks, and ambiguous-action recovery.
- Database migrations, worker, operator CLI, backups/restores, reconciliation, support diagnostics, Docker, CI, and test suites.

### Removed

- Selenium scraping, automated messaging, input simulation, provider password storage, and the exposed plaintext credential from the current tree.

### Security

- Added scrypt password hashing, opaque sessions, CSRF enforcement, workspace isolation, strict provider URL validation, security headers, and audit logging.
