# Security, privacy, and threat model

## Trust boundaries

```text
Browser -> loopback API -> local SQLite -> verified local backups
                         -> local maintenance worker -> optional HAI JSON file
Internet -> ngrok/Caddy TLS -> trusted proxy -> production API (explicit deployment only)
Browser --explicit click--> configured HTTPS provider page
```

The API and worker never call the provider. The provider is a separate trust boundary opened only by the user's browser after an explicit action. The HAI boundary is an atomic local file and is metadata-only by default; HAI obtains no Simbi session or send permission.

## Controls

- Salted scrypt password hashes; no fallback or default password.
- Random opaque server-side sessions with bounded expiry.
- Production first-owner setup requires an operator-configured high-entropy token; setup is serialized. Authenticated password change revokes all sessions, including protection against an old-password login racing the change.
- `HttpOnly`, `SameSite=Strict` session cookie and double-submit CSRF control.
- Production startup requires an HTTPS origin, explicit public hostname, trusted proxy list, and secure cookies.
- Failed logins are rate-limited by a one-way client/email fingerprint; unknown users still run a password verification to reduce account enumeration timing signals.
- Role checks on every material write; workspace ownership on every record lookup.
- Parameterized SQL for values. Dynamic table/sort identifiers come only from fixed code allowlists.
- HTTPS-only provider URLs, no embedded credentials, no nonstandard port, and exact configured-host match for handoffs.
- Content Security Policy, HSTS, trusted-host rejection, sanitized request IDs, COOP/CORP, frame denial, MIME sniffing prevention, strict referrer policy, and disabled browser permissions.
- No uploads; CSV imports are bounded, parsed in memory, previewed, and committed atomically only when every row is valid.
- Daily handoff limit, per-prospect cooldown, unique campaign/prospect draft, and idempotent handoff key.
- Explicit state machine blocks impossible or repeated transitions.
- Approval requires the exact saved content hash. Recovery and copy/open actions recheck current contact permission and provider host; stale outcomes cannot overwrite replies or suppression.
- Contact restrictions are retained separately from prospect records, including restrictions provided by manual/CSV intake. Re-importing a deleted prospect does not remove a retained opt-out.
- Validation responses omit submitted field values, preventing password/personal-content echo in error details.
- Shared runtime leases block ordinary restore while app/worker connections are active; restore validates a staged candidate and preserves a safety snapshot before atomic SQLite restoration.
- Support bundle excludes names, emails, provider handles, tokens, credentials, and message bodies.
- Runtime database, logs, exports, backups, uploads, and environment files are ignored by Git.
- Production containers are non-root, capability-free, read-only, resource-limited, log-rotated, and place the trusted Caddy proxy at a fixed private address.

## Threats reviewed

| Threat | Control | Residual risk |
|---|---|---|
| Cross-workspace access | ownership predicate + role dependency + isolation test | A code regression remains possible; keep tests required in CI. |
| CSRF/session theft | strict cookies, CSRF header, short session, CSP | Malware on the local machine is outside the app boundary. |
| Duplicate outreach | state machine, unique draft, idempotency, limit, cooldown | Operator could manually send twice at provider; verify before marking ambiguous actions. |
| SSRF/open redirect | backend never fetches; HTTPS/host validation | Provider itself can redirect after the browser opens it. |
| Formula/CSV injection | imports are data only; no spreadsheet evaluation | Export consumers must still open untrusted CSV/JSON carefully. |
| Sensitive diagnostics | redacted support shape | A full workspace export intentionally contains personal data and must be protected. |
| Provider-policy violation | no automation, explicit compliance gate | Operator remains responsible for every manual send. |
| Local database theft | loopback binding, OS file controls | At-rest encryption is not implemented; use full-disk encryption and protected OS account. |
| Public tunnel abuse | production-only ngrok launcher, HTTPS, trusted host/proxy, secure cookies, login throttling | An unguessable URL is not authentication; supervise and stop temporary tunnels. |
| HAI over-disclosure | metadata-only default, explicit content opt-in, local atomic file, HAI privacy/review gate | Enabling content export discloses prospect/message data to HAI storage. |
| Backup corruption/loss | SQLite backup API, integrity check, daily rotation | Backups share the same machine by default; copy reviewed backups to protected offline storage. |

## Privacy impact

The product stores names, organization/context, source URLs, messages, replies, and operational events. It does not need provider passwords, browser cookies, financial information, or unrelated profile data. Use free-text notes sparingly. Workspace export and prospect deletion provide access/erasure paths; suppressions are retained to prevent renewed contact. Local analytics contain event types and timestamps only.

## Pre-existing credential exposure

The starting `main.py` at commit `6c3c7cb` contained a plaintext email and password. The current tree removes it and no new secret was added. Required owner actions:

1. Rotate the exposed password immediately at the provider and anywhere it was reused.
2. Review provider account sessions/activity and revoke unknown sessions.
3. Coordinate a repository history rewrite with all maintainers, then force-update protected branches/tags and invalidate old clones/forks.
4. Add repository secret scanning and verify the rewritten object database.

History was not rewritten in this implementation because force-rewriting a shared default branch is destructive and requires explicit owner coordination.

## Reporting

Do not open a public issue containing a credential, personal data, database, or export. Contact the repository owner privately with the affected commit/path, impact, and reproduction steps.
