# API usage audit

The local-password caller now accepts `POST /api/auth/password` only after the complete body contains exactly-true changed/reauthenticate fields. Actual HTTP status is retained separately from payload codes; only inspected403/current_password_invalid and422/validation_failed permit correction without the uncertainty latch. The unchanged backend transaction updates the hash, revokes that user's sessions and audits once. Nine actual caller cases and the separate native bilingual helper cover pending, correctable, contradictory/lost real commits and deliberate same-owner sign-in; no provider operation, idempotency receipt or durable browser password copy is added. See [PASSWORD_RECOVERY](PASSWORD_RECOVERY.md) and [exact publication evidence](PRODUCTION_READINESS.md#personal-local-password-confirmation-preparation-2026-10-02).

All non-health endpoints below require an authenticated workspace member unless marked public. Writes require the CSRF header except setup/login; logout and password changes are not exempt. Mutation roles are enforced server-side; UI visibility is not an authorization boundary.

Successful GETs for bootstrap/session/settings/overview/reports/handoffs additionally use a pure consumed operational guard, including requested handoff target and structurally safe active URL. Preserve real SQLite0/1, nullable SQL aggregates and blocked historical strings; no POST-instruction/pagination requirement is invented for handoff GET. This does not verify authenticity, every schema/semantic or generic mutation proof. [Exact contracts/recovery](OPERATIONAL_READS.md) and [actual execution/publication evidence](PRODUCTION_READINESS.md#operational-read-contracts-and-truthful-safety-state-2026-10-02) remain separate.

The shared client rejects unreadable/primitive successful JSON, bounds the full body read, removes cancellation listeners, and reports interrupted writes as unconfirmed without retry. Seven core POST response contracts now check creation identities/states, submitted campaign/prospect/template values and CSV stages/counts; paged consumers check requested offset/limit and count metadata. Draft confirmations now check exact selected IDs, reply confirmations check conversation/trimmed text/received instant, and reminder confirmations check nullable targets/title/due instant. Supplied timestamps are validated before writes and normalize to UTC without historical rewrites; creation IDs must be positive safe JSON integers. Seven core GET pages additionally validate consumed row shapes and page-unique safe IDs before rendering/selection; nullable historical links and additive fields remain. Rendering semantics, server-assigned reply-time truth, other record fields and other endpoints remain limited. Co-deploy matching frontend/backend; older minimal returns are unverified, not failed-commit proof. Specific refusals and domain-specific recovery remain preserved; no generic idempotency is added. See [the precise contract and limits](REQUEST_RECOVERY.md) and exact executed evidence in the production ledger.

| API | Consumer | Tests/evidence |
|---|---|---|
| `GET /api/health/live`, `/ready` | Docker/operations | CLI/Docker health; database readiness branch. |
| `GET /api/auth/status` | App bootstrap (public) | First-run UI. |
| `POST /api/auth/password` | Signed-in Settings → Account password; session and CSRF required | Exact true/true receipt, actual403/422 pre-write pairs, synchronous pending/uncertain repeat protection and deliberate sign-in. Nine actual caller cases plus bilingual native real-commit/lost-response/session-revocation checks; [contract and limits](PASSWORD_RECOVERY.md). |
| `POST /api/privacy/retirement/preview`, `/confirm`; `GET /api/privacy/retirement/receipt/{plan_id}` | Owner Settings retirement; completion receipt is capability-only public read | Sole-owner/safety-stop/current session/password/CSRF/acknowledgement gates; exact snapshots, backup/rollback, no bootstrap after retirement, revoked sessions, maintenance/export serialization, response-loss recovery. See PRIVACY_CLEANUP.md. |
| `POST /api/auth/setup`, `/login` | Auth UI (public, one-time/credential guarded) | All backend suites. |
| `POST /api/auth/logout`, `GET /api/me` | App shell | CSRF/security tests. |
| `GET /api/overview` | Dashboard | Frontend dashboard test and critical path. |
| `GET/POST /api/campaigns` | Campaign page | Critical path. |
| `PATCH /api/campaigns/{id}/status` | Campaign page | Compliance gate in critical path. |
| `GET/POST /api/prospects`; deprecated `DELETE /api/prospects/{id}` | Prospect page; direct deletion rejects without privacy preview | Import/isolation/URL/suppression and bypass-rejection tests. |
| `POST /api/settings/retention`; `POST /api/privacy/preview`, `/confirm`; `GET /api/privacy/receipts`, `/receipts/{plan_id}` | Owner-only Settings privacy controls: retention, contact, campaign or template scope | Strict retention-only ID cursor,1000-contact scan pages/1000-row linked-history bounds/50-contact batches, semantic age checks, complete streamed restriction digest, exact plans, password/CSRF/current role/session, shared managed maintenance lease before backup/writer, stale/uncertain protection, rollback/retry/validated receipts and owner-only exact older-receipt lookup, isolation, campaign restriction/cascade and template-link preservation. Bilingual rendered continuation/cancel/backup/preservation/response-recovery fixtures; precise contract in PRIVACY_CLEANUP.md. |
| `POST /api/privacy/audit/preview`, `/confirm`; `GET /api/privacy/audit/receipts` | Owner-only Settings historical audit detail controls; separate confirmation scope | Exact old event IDs/known fields, bounded scan cursor/batches, malformed/recent protection, current session/owner/password/CSRF/throttle, verified original backup, stale/cross-scope/cross-owner refusal, rollback/idempotent receipt. No event deletion or operational restriction/settings changes. Bilingual rendered confirmation and wrong-plan response/retry/reload proof; policy in AUDIT_PRIVACY.md. |
| `POST /api/prospects/import` | Prospect CSV modal | Atomic preview/commit test. |
| `GET/POST /api/templates` | Templates/review | Placeholder validation and critical path. |
| `GET/POST /api/drafts` | Review queue | Paged draft listing includes editing/approval versions; deterministic preparation, suppression and worker tests. |
| `GET /api/drafts/{id}` | Read-only current saved-version comparison | Authenticated owned record; viewer read, unknown/foreign404, no audit/record mutation. See DRAFT_SAVING.md. |
| `PATCH /api/drafts/{id}` | Explicit draft save | Required expected_edit_version, serialized stale409/nonmutation, exact no-op preservation and authoritative full-record response; editable states, CSRF/role/isolation and two concurrent requests. See DRAFT_SAVING.md. |
| `POST /api/drafts/{id}/review` | Pre-action review | Missing-check failure and success tests. |
| `POST /api/drafts/{id}/handoff` | Manual handoff modal | Idempotency, provider host, limits, cooldown, pause, demo gates. |
| `GET /api/handoffs` | Ambiguous-action recovery | Workspace-scoped persisted handoff lookup. |
| `POST /api/handoffs/{id}/outcome` | Handoff modal | Sent/reply and worker tests. |
| `GET/POST /api/replies` | Replies page | Critical path. |
| `GET/POST/PATCH /api/reminders` | Reminders page/worker | Worker idempotency test. |
| `POST /api/suppressions` | Privacy/opt-out flow | Suppression test. |
| `GET /api/audit` | Dashboard/audit page | Critical-path event assertions. |
| `GET /api/reports/summary` | Reports page | Critical-path funnel assertion. |
| `GET /api/settings` | Settings page | Auth and role ownership. |
| `POST /api/settings/compliance`, `/provider`, `/pause`, `/team` | Settings controls | Critical path, URL/CSRF/isolation tests. |
| `GET /api/export` | Data-access control | Suppression export test. |
| `GET /api/support-bundle` | Diagnostics | Explicit redaction test. |

No endpoint performs external HTTP, provider login, scraping, form filling, or sending. A repository search for legacy automation terms is a CI gate.

## Paged record contract increment

The earlier introductory limitation about list rows is narrowed by `pageRecords.ts`: all seven GET pages for campaigns, prospects, templates, drafts, replies, reminders and audit now reject malformed consumed row fields or duplicate/unsafe identities before rendering or raw API selection use. The complete page fails rather than silently losing a bad row; metadata checks still belong to `usePage`. Last verified results remain labeled out of date until explicit read Retry succeeds. The guard preserves additive fields, nullable historical template links/actor labels/targets and old date/status strings; it neither repairs data nor proves every field's meaning or record authenticity. Other endpoints retain their own contracts. See [the authoritative read boundary](REQUEST_RECOVERY.md#core-paged-record-reads) and the exact [current ledger](PRODUCTION_READINESS.md#core-paged-record-contracts-2026-10-02).
