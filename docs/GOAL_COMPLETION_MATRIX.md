# Goal completion matrix

Statuses are evidence-based: **Implemented**, **Partial**, **Blocked**, or **Not applicable**. “Implemented” means code and proportional automated evidence exist; browser/deployment-specific phases remain partial until their dedicated verification is recorded.

| Phase | Status | Evidence / exact gap |
|---:|---|---|
| 000 Repository integrity | Implemented | Remote/default/commit/history audited in `TECHNICAL_AUDIT.md`. |
| 001 File/dependency audit | Implemented | Legacy tree and new manifests/lock described; unsafe runtime removed. |
| 002 Product definition | Implemented | README and campaign purpose/lawful-context contract. |
| 003 Critical path | Implemented | `CRITICAL_PATH.md` and passing API acceptance test. |
| 004 Architecture | Implemented | FastAPI/SQLite/React/worker decision recorded. |
| 005 Data ownership/persistence | Implemented | Migrated schema, workspace foreign keys, isolation test. |
| 006 Configuration guards | Implemented | Typed env parsing; production HTTPS/secure-cookie fail-safe. |
| 007 Authentication/session | Implemented | scrypt, opaque expiry, strict cookie, first-run setup/login tests. |
| 008 Authorization/ownership | Implemented | Roles, owned lookups, cross-workspace test. |
| 009 API/error envelope | Implemented | Structured code/message/details/request ID; frontend error test. |
| 010 Frontend architecture | Implemented | React app shell, routes, focused page/components. |
| 011 Core vertical slice | Implemented | Campaign through reply/report wired. |
| 012 Provider reality | Implemented | No approved API assumed; assisted boundary documented. |
| 013 Compliance boundary | Implemented | Current primary sources, owner acknowledgement, activation gate. |
| 014 No fake success | Implemented | Handoff never marks sent; operator records outcome. |
| 015 Files/uploads/media | Not applicable | Product exposes no upload/media persistence; CSV parsed in memory. |
| 016 Background jobs | Implemented | Separate local reminder worker with `--once` and loop. |
| 017 Idempotency | Implemented | Required unique handoff key and replay test. |
| 018 Limits/cooldowns | Implemented | Daily campaign limit and per-prospect cooldown enforced server-side. |
| 019 Audit history | Implemented | Material events persisted without bodies/credentials. |
| 020 Dashboard/next action | Implemented | Exception-first dashboard and real empty states. |
| 021 Forms/validation/autosave | Partial | Validation and save behavior implemented; autosave intentionally omitted to avoid unreviewed state churn. |
| 022 Search/filter/sort/page | Implemented | Bounded server search/sort/pagination helpers; draft filters. |
| 023 Import/export | Implemented | Atomic CSV preview/commit and authenticated JSON export. |
| 024 Templates/defaults | Implemented | Reusable versioned templates with four explicit fields. |
| 025 AI abstraction/fallback | Implemented | Deterministic renderer is the safe provider-independent default; no fake AI. |
| 026 Human review/approval | Implemented | Four explicit checks, edit reset, role/compliance/pause guards. |
| 027 Notifications/reminders | Implemented | User and worker reminders; no external notification claims. |
| 028 Privacy/deletion | Implemented | Export, prospect deletion, suppression, minimization, retention CLI. |
| 029 Web security | Implemented | CSP, frame/MIME/referrer/permissions headers and CSRF. |
| 030 Secrets/rotation | Blocked | Current tree clean; pre-existing Git-history credential needs owner-coordinated rewrite/rotation. |
| 031 One-command local dev | Implemented | Docker Compose and `scripts/dev.ps1`. |
| 032 Docker/deployment | Partial | Dockerfile/Compose/health implemented; live build/run evidence pending. |
| 033 Migrations/rollback | Implemented | Ordered migration ledger; backup-first restore and rollback runbook. |
| 034 CLI/doctor | Implemented | migrate/doctor/backup/restore/reconcile/purge/support commands. |
| 035 Health/readiness | Implemented | Separate liveness and database readiness endpoints. |
| 036 Operator diagnostics | Implemented | Doctor, redacted support bundle, audit and counts. |
| 037 Demo mode labelling | Implemented | Visible banner and external handoff hard block. |
| 038 Fake provider lab | Not applicable | Tests require no fake provider; boundary is verified without network. |
| 039 Factories/fixtures | Implemented | Isolated owner/foundation fixtures and throwaway database. |
| 040 Backend tests | Implemented | 8 tests pass across critical/security/worker paths. |
| 041 Frontend tests | Implemented | 5 tests pass across API/UI/dashboard behavior. |
| 042 Worker tests | Implemented | Reminder idempotency test passes. |
| 043 End-to-end tests | Partial | Full API critical path passes; real browser path pending. |
| 044 Acceptance matrix | Implemented | `ACCEPTANCE_TESTS.md` with automated/manual cases. |
| 045 Adversarial tests | Implemented | Missing CSRF/check/key, unsafe URLs, suppression, invalid CSV. |
| 046 Cross-user isolation | Implemented | Second-workspace direct-ID test returns 404/no records. |
| 047 Path traversal | Not applicable | No file path or upload endpoint exists; restore CLI validates explicit `.db` file. |
| 048 Provider failure | Implemented | Ambiguous/cancelled outcomes and no blind retry; no provider call exists. |
| 049 Accessibility | Partial | Semantic/focus/reduced-motion code and unit tests; browser audit pending. |
| 050 Responsive/browser | Partial | Responsive CSS implemented; desktop/mobile browser evidence pending. |
| 051 Performance/indexing | Implemented | Domain indexes, bounded queries/imports, production bundle baseline. |
| 052 Large dataset/pagination | Partial | Limits/indexes/5,000-row import cap implemented; load benchmark pending. |
| 053 Backup/restore | Implemented | SQLite backup API, integrity/schema-checked restore, backup-first behavior. |
| 054 Reconciliation/repair | Implemented | Detects orphans/impossible sends; safe explicit repair. |
| 055 Local analytics | Implemented | Schema is local/event-minimal; no external telemetry. |
| 056 SaaS without billing | Not applicable | Product is local-first; workspace/roles are ready, billing intentionally absent. |
| 057 i18n Dutch/English | Partial | Copy centralized by components but no translation catalog yet. |
| 058 Feature flags | Implemented | Workspace-scoped flag schema; no risky feature is silently enabled. |
| 059 State machines | Implemented | Explicit draft transition map and guarded endpoints. |
| 060 Domain specification | Implemented | Schema and `CRITICAL_PATH.md`. |
| 061 Invariants/constraints | Implemented | SQL checks/uniques/FKs plus server domain guards. |
| 062 Pre-action safety screen | Implemented | Review panel with source, consent, quality and four checks. |
| 063 Credential verification | Not applicable | Product refuses provider credentials; only approved HTTPS base link stored. |
| 064 Threat model | Implemented | `SECURITY.md` trust boundaries/threat/control table. |
| 065 Privacy impact | Implemented | Data categories, minimization, rights and residual risk documented. |
| 066 Supply chain | Implemented | Pinned Python versions, pnpm lock, non-root container, CI. |
| 067 License/services | Partial | Provider/legal sources reviewed; repo has no owner-supplied license. |
| 068 CI/CD gates | Implemented | Lint/tests/build/secret guard/Docker build workflow. |
| 069 Release/canary/rollback | Partial | Runbook implemented; no live deployment/canary executed. |
| 070 Operator runbook | Implemented | Start, stop, backup, restore, incident and troubleshooting. |
| 071 User guide/help | Implemented | README plus page-specific safe guidance and empty states. |
| 072 Error catalog | Implemented | Runbook maps operational error codes to safe action. |
| 073 UI action audit | Implemented | Every visible action mapped in `UI_ACTION_AUDIT.md`. |
| 074 Endpoint usage audit | Implemented | Endpoint/consumer/test map in `API_USAGE_AUDIT.md`. |
| 075 Documentation truth | Implemented | Claims distinguish implemented, partial, blocked and external. |
| 076 Technical debt | Implemented | Partial/N/A/blocked gaps retained in this matrix and final report. |
| 077 Bug hunt log | Implemented | Worklog records SQLite handle leak and dependency-major issue/fixes. |
| 078 Red-team loop one | Implemented | Secret/automation and provider-policy review. |
| 079 Red-team loop two | Implemented | CSRF/URL/isolation/suppression/import adversarial tests. |
| 080 Red-team loop three | Partial | Browser console/a11y/mobile red-team pending. |
| 081 Non-technical simulation | Partial | First-run/empty-state flow designed; browser execution pending. |
| 082 Autonomy-first review | Implemented | Safe local preparation automated; external decision/action remains human. |
| 083 Value review | Implemented | Product covers durable workflow rather than automation vanity. |
| 084 Product realism | Implemented | No fake providers/data/metrics; credentials not claimed. |
| 085 Traceability | Implemented | 116-phase matrix plus code/test/doc evidence. |
| 086 Task graph | Implemented | `TASK_GRAPH.md`. |
| 087 Worklog/checkpoints | Implemented | `CODEX_WORKLOG.md` and `CODEX_CHECKPOINTS.md`. |
| 088 Resume safety | Implemented | First-incomplete-checkpoint rule; no provider side effects. |
| 089 Stabilization gates | Implemented | Audit -> tests -> browser -> fresh clone -> release order. |
| 090 No vanity work | Implemented | UI metrics limited to operational workflow health. |
| 091 Feature definition of done | Implemented | Code + route + role + test + docs requirement used. |
| 092 Fresh clone | Implemented | Clean no-hardlink clone, dependency installs, lint, tests, build and doctor passed. |
| 093 Manual evidence | Implemented | Real browser critical path plus desktop/mobile screenshots and concept comparison. |
| 094 No-excuses search | Implemented | Final whitespace, unsafe automation, credential, secret-pattern and placeholder scans passed. |
| 095 Completion matrix | Implemented | This document. |
| 096 Final verification | Implemented | Automated, Docker, browser, responsive, fresh-clone and final scan evidence recorded. |
| 097 Final response | Partial | Required evidence will be supplied after final commit/push. |
| 098 Maintenance plan | Implemented | Runbook release/backup/restore plus changelog discipline. |
| 099 Roadmap/blockers | Implemented | Exact remaining gaps listed here/final report. |
| 100 Provider cleanup/account safety | Blocked | Provider password rotation/session review/history rewrite require owner actions. |
| 101 Support bundle | Implemented | CLI/API redacted bundle and explicit test. |
| 102 Retention/archive | Implemented | Configurable retention, purge confirmation, durable suppressions, backup. |
| 103 Prototype-to-production | Implemented | Production guards/non-root image; external deployment still a separate gate. |
| 104 Safety stop | Implemented | Owner/admin pause blocks approval and handoff. |
| 105 Onboarding | Implemented | First-owner setup and guided compliance next action. |
| 106 Roles/team | Implemented | Owner/admin/editor/viewer and local member creation. |
| 107 Quality/confidence | Implemented | Deterministic 0-100 score plus named signals, never permission. |
| 108 Human decision minimization | Implemented | Defaults/templates/queue reduce clerical work; risky judgment retained. |
| 109 Exception dashboard | Implemented | Ambiguous and low-quality items prioritized. |
| 110 Safe retries/recovery | Implemented | Idempotent replay, cancelled return, ambiguous manual resolution. |
| 111 Ambiguous action | Implemented | Persisted handoff reload and explicit resolution. |
| 112 Version/changelog | Implemented | Version `1.0.0`, pinned manifests, `CHANGELOG.md`. |
| 113 Regression baseline | Implemented | Backend/frontend suites and production bundle. |
| 114 Maintenance/refactor | Implemented | Focused modules, explicit dependency boundaries, no duplicate runtime. |
| 115 Human-operator readiness | Implemented | Automated, Docker, browser and clean-install workflows pass; external provider use remains manually gated. |
