# Security, privacy, and threat model

## Trust boundaries

```text
Browser -> loopback API -> local SQLite
                         -> local reminder worker
Browser --explicit click--> configured HTTPS provider page
```

The API and worker never call the provider. The provider is a separate trust boundary opened only by the user's browser after an explicit action.

## Controls

- Salted scrypt password hashes; no fallback or default password.
- Random opaque server-side sessions with bounded expiry.
- `HttpOnly`, `SameSite=Strict` session cookie and double-submit CSRF control.
- Production startup requires HTTPS origin and secure cookies.
- Role checks on every material write; workspace ownership on every record lookup.
- Parameterized SQL for values. Dynamic table/sort identifiers come only from fixed code allowlists.
- HTTPS-only provider URLs, no embedded credentials, no nonstandard port, and exact configured-host match for handoffs.
- Content Security Policy, frame denial, MIME sniffing prevention, strict referrer policy, and disabled browser permissions.
- No uploads; CSV imports are bounded, parsed in memory, previewed, and committed atomically only when every row is valid.
- Daily handoff limit, per-prospect cooldown, unique campaign/prospect draft, and idempotent handoff key.
- Explicit state machine blocks impossible or repeated transitions.
- Support bundle excludes names, emails, provider handles, tokens, credentials, and message bodies.
- Runtime database, logs, exports, backups, uploads, and environment files are ignored by Git.

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
