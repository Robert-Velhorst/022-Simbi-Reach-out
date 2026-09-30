# Changelog

## Unreleased — truthful loading and retries (2026-10-01)

- Overview, prospects, campaigns, templates, review, replies, reminders, audit and reports no longer describe pending/failed first reads as empty records or zero figures.
- Retained results are labelled during refresh or after refresh failure. Failed paged reads retry the requested page; changed searches immediately hide the previous query's rows/errors.
- Draft choices/submission are disabled while prerequisite reads are pending or failed. No provider action, permission or stored record changes from these display repairs.
- Browser tests now use unique fixture directories. `SIMBI_E2E_PORT` selects an unused loopback test port without interrupting another process.

## Unreleased — personal recovery (2026-09-30)

- Windows executable now dispatches operator commands instead of launching the server when arguments are supplied. Backup, restore, diagnostics and support commands use the same standalone storage as normal startup.
- Added `recover-owner --email <existing-local-owner> --confirm`: hidden matching password prompts, one existing personal workspace, local-only mode, offline runtime lock, verified pre-recovery backup, atomic password/session/audit update. Account data and other accounts are preserved.
- Packaged diagnostics recognize the compiled interface without requiring a development manifest. Expanded Windows smoke covers actual executable help, diagnostics, manual backup/restore and unconfirmed recovery refusal.
- Rebuild the Windows package for these commands. Recovery changes the local app login, not Simbi credentials. Pre-recovery backups retain the prior login state; existing login-rate locks still expire normally.
- Refreshed development dependencies after fresh audits found vulnerabilities: Vitest4.1.11, patched Undici/brace-expansion transitives in the lockfile, HTTPX2/HTTPCore2 2.12.0, and a urllib3>=2.8.0 minimum for the audit tool's dependency. See the readiness ledger for dated audit and compatibility evidence.

## Unreleased — production hardening (2026-09-05)

### Fixed

- Admin-only data downloads no longer appear as usable links for viewers/editors; the existing server authorization remains unchanged.
- Viewers retain read-only resource, draft and handoff-history access without being offered editing, approval, provider-opening or outcome-recording controls.
- Shared dialogs now manage keyboard focus, Tab/Shift+Tab wrapping, guarded Escape dismissal and return focus to the current workflow action; native modal behavior blocks background interaction.
- Startup distinguishes a missing/expired session from service/network failures during session lookup, with retry instead of a misleading sign-in prompt.
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
