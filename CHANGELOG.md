# Changelog

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
