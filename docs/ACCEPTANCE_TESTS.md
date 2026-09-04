# Acceptance test matrix

Automated results are updated in `FINAL_VERIFICATION_REPORT.md`. Tests use a throwaway local SQLite database and never access a provider.

| ID | Scenario | Expected |
|---|---|---|
| A01 | First owner setup | One owner/workspace/session created; second setup rejected. |
| A02 | Missing CSRF on write | `403 csrf_failed`; security headers present. |
| A03 | Campaign activation without compliance | Blocked; succeeds only after all four acknowledgements. |
| A04 | Unsafe prospect URL | HTTP, embedded credentials, and nonstandard ports rejected. |
| A05 | CSV with one invalid row | Preview reports error; commit writes zero rows. |
| A06 | Template render | Only documented fields accepted; deterministic text enters review. |
| A07 | Approval without checks | Rejected; all four checks required. |
| A08 | Handoff without idempotency | Rejected; repeated valid key returns same handoff. |
| A09 | Manual send outcome | No provider call; operator records sent/not-sent/ambiguous. |
| A10 | Reply | Only valid after external-action state; closes reminders and reports replied. |
| A11 | Suppression | Prospect becomes opted out; unfinished drafts terminal; new draft blocked. |
| A12 | Cross-workspace ID guess | Returns not found and lists no foreign records. |
| A13 | Worker repeated run | Creates exactly one reminder after seven days; second run is a no-op. |
| A14 | Support bundle | Contains diagnostics but no owner email/password/message content. |
| A15 | Frontend API client | Adds CSRF to writes and surfaces structured backend errors. |
| A16 | Shared UI | Dialog is labelled/closable; notices announced; status readable. |
| A17 | Dashboard empty state | Shows real next action and explicit no-send wording. |
| A18 | Production frontend build | TypeScript and Vite complete without errors. |
| A19 | Responsive browser | No overflow or clipped primary controls at desktop/mobile widths. |
| A20 | Full browser critical path | First run through reply/report works using local data only. |
| A21 | Login abuse | Five failures lock the client/account fingerprint; a correct password is rejected until the lock expires. |
| A22 | Host/proxy boundary | Untrusted Host is rejected; production requires HTTPS, exact hostname, and trusted forwarded source. |
| A23 | Backup integrity | Online SQLite backup passes `PRAGMA integrity_check` and preserves records. |
| A24 | HAI connector default | Actionable items match HAI generic feed format without prospect/message content or send authority. |
| A25 | HAI content opt-in | Personal content appears only with explicit `--include-content`/environment opt-in. |
| A26 | Large dataset | 10,000 prospects/drafts remain within the 2-second query and 30 MB database budgets. |
| A27 | Dependency audits | Python and pnpm report no known vulnerabilities. |
| A28 | Windows standalone | Bundled executable starts on loopback, serves compiled UI, migrates local data, and stops cleanly. |

A19/A20 evidence includes reproducible screenshots, accessibility results, and browser-console review. A dedicated screen-reader audit and a live ngrok/domain canary remain manual gates for broad hosted release.
