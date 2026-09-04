# API usage audit

All non-health endpoints below require an authenticated workspace member unless marked public. All writes except authentication require the CSRF header. Mutation roles are enforced server-side; UI visibility is not an authorization boundary.

| API | Consumer | Tests/evidence |
|---|---|---|
| `GET /api/health/live`, `/ready` | Docker/operations | CLI/Docker health; database readiness branch. |
| `GET /api/auth/status` | App bootstrap (public) | First-run UI. |
| `POST /api/auth/setup`, `/login` | Auth UI (public, one-time/credential guarded) | All backend suites. |
| `POST /api/auth/logout`, `GET /api/me` | App shell | CSRF/security tests. |
| `GET /api/overview` | Dashboard | Frontend dashboard test and critical path. |
| `GET/POST /api/campaigns` | Campaign page | Critical path. |
| `PATCH /api/campaigns/{id}/status` | Campaign page | Compliance gate in critical path. |
| `GET/POST/DELETE /api/prospects` | Prospect page/privacy deletion | Import, isolation, URL, suppression tests. |
| `POST /api/prospects/import` | Prospect CSV modal | Atomic preview/commit test. |
| `GET/POST /api/templates` | Templates/review | Placeholder validation and critical path. |
| `GET/POST/PATCH /api/drafts` | Review queue | Critical path, suppression and worker tests. |
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
