# API usage audit

All non-health endpoints below require an authenticated workspace member unless marked public. All writes except authentication require the CSRF header. Mutation roles are enforced server-side; UI visibility is not an authorization boundary.

| API | Consumer | Tests/evidence |
|---|---|---|
| `GET /api/health/live`, `/ready` | Docker/operations | CLI/Docker health; database readiness branch. |
| `GET /api/auth/status` | App bootstrap (public) | First-run UI. |
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
