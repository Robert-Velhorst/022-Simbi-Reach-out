# Goal completion matrix

Statuses are evidence-based: **Implemented**, **Partial**, **Blocked**, or **Not applicable**. “Implemented” means code and proportional automated evidence exist; browser/deployment-specific phases remain partial until their dedicated verification is recorded.

This matrix originated with the earlier implementation and contains historical verification counts. It is not an unrestricted production-completion certificate. Use [the current production acceptance ledger](PRODUCTION_READINESS.md) for subsequent evidence and open gates; source rechecks may downgrade entries here.

Scope clarification on 2026-09-05: the owner confirmed this is a personal tool for his own Simbi account. Shared-service requirements are not release gates; optional existing capabilities are preserved. Not applicable below means excluded by that explicit personal-use decision, not silently omitted or claimed implemented. Personal safety, recovery, workflow and relevant original usability requirements remain in scope.

| Phase | Status | Evidence / exact gap |
|---:|---|---|
| 000 Repository integrity | Implemented | Remote/default/commit/history audited in `TECHNICAL_AUDIT.md`. |
| 001 File/dependency audit | Implemented | Legacy tree and new manifests/lock described; unsafe runtime removed. |
| 002 Product definition | Implemented | README and campaign purpose/lawful-context contract. |
| 003 Critical path | Implemented | `CRITICAL_PATH.md` and passing API acceptance test. |
| 004 Architecture | Implemented | FastAPI/SQLite/React/worker decision recorded. |
| 005 Data ownership/persistence | Implemented | Migrated schema, workspace foreign keys, isolation test. |
| 006 Configuration guards | Implemented | Typed env parsing; production HTTPS, explicit hostname, trusted-proxy, and secure-cookie fail-safe. |
| 007 Authentication/session | Implemented | scrypt, opaque expiry, strict cookie, login throttling, first-run setup/login tests. |
| 008 Authorization/ownership | Implemented | Roles, owned lookups, cross-workspace test. |
| 009 API/error envelope | Implemented | Structured code/message/details/request ID; frontend error test. |
| 010 Frontend architecture | Implemented | React app shell, routes, focused page/components. |
| 011 Core vertical slice | Implemented | Campaign through reply/report wired. |
| 012 Provider reality | Partial | Public homepage/sign-in inspection and a one-off actual app-to-Simbi-homepage handoff/Back/Not sent check are evidenced. The latter used a fresh fictional workspace and blocked external writes. Authenticated manual-use acceptance remains open; public navigation is not messaging integration or delivery proof. |
| 013 Compliance boundary | Implemented | Current primary sources, owner acknowledgement, activation gate. |
| 014 No fake success | Implemented | Handoff never marks sent; operator records outcome. |
| 015 Files/uploads/media | Not applicable | Product exposes no upload/media persistence; CSV parsed in memory. |
| 016 Background jobs | Implemented | Reminder cleanup, daily verified backups, retention pruning, and optional atomic HAI feed refresh. |
| 017 Idempotency | Implemented | Required unique handoff key and replay test. |
| 018 Limits/cooldowns | Implemented | Daily campaign limit and per-prospect cooldown enforced server-side. |
| 019 Audit history | Implemented | Material events persisted without bodies/credentials. |
| 020 Dashboard/next action | Implemented | Exception-first dashboard and real empty states. |
| 021 Forms/validation/autosave | Partial | Explicit manual saves now require serialized editing versions, reject stale overwrites, preserve no-op approval/history and offer verified current-state comparison/recovery without implicit writes. RAM-only unsaved text can be lost on selection/navigation/reload; no durable autosave/crash recovery. See DRAFT_SAVING.md and exact dated evidence. |
| 022 Search/filter/sort/page | Implemented | Bounded server search/sort/pagination helpers; draft filters. |
| 023 Import/export | Implemented | Atomic CSV preview/commit and authenticated JSON export. |
| 024 Templates/defaults | Implemented | Reusable versioned templates with four explicit fields. |
| 025 AI abstraction/fallback | Implemented | Deterministic renderer is the safe provider-independent default; no fake AI. |
| 026 Human review/approval | Implemented | Four explicit checks, edit reset, role/compliance/pause guards. |
| 027 Notifications/reminders | Implemented | User and worker reminders; no external notification claims. |
| 028 Privacy/deletion | Partial | Paged age-based and named-record cleanup with verified exact-receipt recovery, separate sole-owner retirement and historical known-field audit minimization have exact previews/current-password/CSRF/session/verified-backup gates. Historical minimization removes only known duplicate reason/URL/unrecognized-check text; event identities/chronology/recognized evidence and operational restrictions/settings remain. General anonymization/expiry, external-copy cleanup and secure erasure remain incomplete. See PRIVACY_CLEANUP.md and AUDIT_PRIVACY.md. |
| 029 Web security | Implemented | CSP, HSTS, trusted hosts, sanitized request IDs, COOP/CORP, frame/MIME/referrer/permissions headers, CSRF and login throttling. |
| 030 Secrets/rotation | Blocked | Current tree clean; pre-existing Git-history credential needs owner-coordinated rewrite/rotation. |
| 031 One-command local dev | Implemented | Docker Compose and `scripts/dev.ps1`. |
| 032 Docker/deployment | Implemented | Non-root image, Caddy TLS edge, private fixed-proxy network, read-only filesystems, health checks, resource/log limits, and validated Compose. |
| 033 Migrations/rollback | Implemented | Ordered migration ledger; backup-first restore and rollback runbook. |
| 034 CLI/doctor | Implemented | migrate/doctor/backup/restore/reconcile/purge/support commands. |
| 035 Health/readiness | Implemented | Separate liveness and database readiness endpoints. |
| 036 Operator diagnostics | Implemented | Doctor, redacted support bundle, audit and counts. |
| 037 Demo mode labelling | Implemented | Visible banner and external handoff hard block. |
| 038 Fake provider lab | Not applicable | Tests require no fake provider; boundary is verified without network. |
| 039 Factories/fixtures | Implemented | Isolated owner/foundation fixtures and throwaway database. |
| 040 Backend tests | Implemented | 96 tests passed with the personal-recovery release across backend security, workflow, isolation, recovery and worker paths; see the dated ledger. |
| 041 Frontend tests | Implemented | Frontend tests cover API/UI, roles, dialogs, truthful loading/reminder labels, stale reads, bilingual catalog/state contracts and workflows; see the dated ledger for current verified counts. |
| 042 Worker tests | Implemented | Reminder idempotency test passes. |
| 043 End-to-end tests | Implemented | Reproducible real-browser critical path passes without provider navigation. |
| 044 Acceptance matrix | Implemented | `ACCEPTANCE_TESTS.md` with automated/manual cases. |
| 045 Adversarial tests | Implemented | Missing CSRF/check/key, unsafe URLs, suppression, invalid CSV. |
| 046 Cross-user isolation | Implemented | Second-workspace direct-ID test returns 404/no records. |
| 047 Path traversal | Not applicable | No file path or upload endpoint exists; restore CLI validates explicit `.db` file. |
| 048 Provider failure | Implemented | Ambiguous/cancelled outcomes and no blind retry; no provider call exists. |
| 049 Accessibility | Partial | Native mobile navigation, hidden-sidebar focus protection, first-tab bypass, destination/return focus, Help, resize/short-screen scroll, solid focus indicators and named keyboard-scrollable tables implemented. Unit regressions and full owner/viewer eleven-route bilingual desktop/mobile checks with selected WCAG scans are in ACCESSIBILITY.md; exact executed outcomes belong in the dated ledger. Not every action/state/role, full keyboard-only outreach or screen-reader/zoom/high-contrast certification. |
| 050 Responsive/browser | Partial | Exact Chromium/Firefox/WebKit selection and full-workflow/retirement CI jobs are implemented. Current dated browser acceptance is in PRODUCTION_READINESS.md and reproduction in BROWSER_COMPATIBILITY.md. Playwright engines/resized desktop viewports do not certify branded browsers, physical devices or virtual keyboards. |
| 051 Performance/indexing | Implemented | Domain indexes, bounded queries/imports, production bundle baseline. |
| 052 Large dataset/pagination | Implemented | 10,000-prospect/draft benchmark: 0.014s query baseline and 3.7 MB database on the verification machine. |
| 053 Backup/restore | Implemented | SQLite backup API, integrity/schema-checked restore, backup-first behavior. |
| 054 Reconciliation/repair | Implemented | Detects orphans/impossible sends; safe explicit repair. |
| 055 Local analytics | Implemented | Schema is local/event-minimal; no external telemetry. |
| 056 SaaS without billing | Not applicable | Owner explicitly chose a personal tool for his own account on 2026-09-05, not a shared SaaS. No tenant provisioning, workspace switching or billing is required; existing deployment and isolation controls remain preserved. |
| 057 i18n Dutch/English | Implemented | Typed691-key English/Dutch UI catalogs add19 draft-save conflict/comparison/recovery labels to the existing keyboard/privacy/retirement controls. Pre-auth/header preference and localized notices/statuses/counts/dates preserve authored data/API/CSV/template values. Unit/static and actual workflow evidence are in LOCALIZATION.md and the dated ledger; diagnostics/CLI/docs are not automatically translated. |
| 058 Feature flags | Implemented | Workspace-scoped flag schema; no risky feature is silently enabled. |
| 059 State machines | Implemented | Explicit draft transition map and guarded endpoints. |
| 060 Domain specification | Implemented | Schema and `CRITICAL_PATH.md`. |
| 061 Invariants/constraints | Implemented | SQL checks/uniques/FKs plus server domain guards. |
| 062 Pre-action safety screen | Implemented | Review panel with source, consent, quality and four checks. |
| 063 Credential verification | Not applicable | Product refuses provider credentials; only approved HTTPS base link stored. |
| 064 Threat model | Implemented | `SECURITY.md` trust boundaries/threat/control table. |
| 065 Privacy impact | Implemented | Data categories, minimization, rights and residual risk documented. |
| 066 Supply chain | Implemented | Pinned patched Python versions, pnpm lock, clean Python/frontend audits, non-root container, CI. |
| 067 License/services | Partial | Provider/legal sources reviewed; repo has no owner-supplied license. |
| 068 CI/CD gates | Implemented | Lint/tests/build/secret guard/Docker build workflow. |
| 069 Release/canary/rollback | Partial | Runbook, production Compose, ngrok launcher and rollback controls implemented; owner domain/ngrok live canary remains external. |
| 070 Operator runbook | Implemented | Start, stop, backup, restore, incident and troubleshooting. |
| 071 User guide/help | Implemented | README plus page-specific safe guidance and empty states. |
| 072 Error catalog | Implemented | Runbook maps operational error codes to safe action. |
| 073 UI action audit | Partial | Version-bound draft save/current-state comparison adds exact response/recovery/explicit-choice guards and stable localized accessible names. Focused tests and actual bilingual sibling-tab Chromium checks preserve nine exported tables at nonwrite boundaries, reject post-comparison changes and recover committed response interruption without duplicate writes. Existing eleven-route owner/viewer navigation remains covered. Exact current/source CI is in the ledger; every action/state/optional role and dedicated assistive-technology acceptance remain open. |
| 074 Endpoint usage audit | Implemented | Endpoint/consumer/test map in `API_USAGE_AUDIT.md`. |
| 075 Documentation truth | Implemented | Claims distinguish implemented, partial, blocked and external. |
| 076 Technical debt | Implemented | Partial/N/A/blocked gaps retained in this matrix and final report. |
| 077 Bug hunt log | Implemented | Worklog records SQLite handle leak and dependency-major issue/fixes. |
| 078 Red-team loop one | Implemented | Secret/automation and provider-policy review. |
| 079 Red-team loop two | Implemented | CSRF/URL/isolation/suppression/import adversarial tests. |
| 080 Red-team loop three | Implemented | Browser console, CSP, accessibility, mobile and manual-provider boundary exercised. |
| 081 Non-technical simulation | Implemented | First-run setup through truthful Not sent outcome executed in a clean browser database. |
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
| 096 Final verification | Partial | Personal draft-save follow-up:289 backend/198 frontend/691 keys, final local full Chromium/both retirement locales, actual sibling-tab conflicts/late-change/current-state recovery/Dutch committed-response abort,4 added comparison scans and retained complete prior workflows pass. Exact-source/PR/merge/publication evidence is recorded separately in the ledger, never inferred from PR97's previous three-engine/Windows/container results. README follows conflict-free merge separately. General privacy/archive/manual-provider/operator and broader device/action/accessibility/credential gates remain open. |
| 097 Final response | Partial | Incremental publication/verification results are reported; the full production objective still has open original requirements. |
| 098 Maintenance plan | Implemented | Runbook release/backup/restore plus changelog discipline. |
| 099 Roadmap/blockers | Implemented | Exact remaining gaps listed here/final report. |
| 100 Provider cleanup/account safety | Blocked | Provider password rotation/session review/history rewrite require owner actions. |
| 101 Support bundle | Implemented | CLI/API redacted bundle and explicit test. |
| 102 Retention/archive | Partial | Retention preference, explicit1000-contact scan continuation/50-contact batches, bounded linked histories, streamed restriction digests, owner-only older-receipt lookup, sole-owner retirement and owner-confirmed historical known-field audit minimization are implemented with verified recovery copies. Old audit eligibility uses the workspace preference; scans/batches have explicit continuation, with no automatic purge or general scrubber. Core history/restrictions remain; fresh setup cannot bypass lost restrictions. External-copy coordination, general expiry/anonymization, secure erasure and long-term archival acceptance remain unfinished. See AUDIT_PRIVACY.md. |
| 103 Prototype-to-production | Partial | Production guards, packaging, recovery and deployment configuration exist. Actual intended deployment, operator acceptance, credential response and receiving-side HAI acceptance if enabled are not complete. |
| 104 Safety stop | Implemented | Owner/admin pause blocks approval and handoff. |
| 105 Onboarding | Implemented | First-owner setup and guided compliance next action. |
| 106 Roles/team | Not applicable | Expanded team lifecycle is not required for the explicitly confirmed sole-owner personal target. Existing owner/admin/editor/viewer checks and local member creation remain preserved and tested; role editing/removal are still absent, not claimed complete. |
| 107 Quality/confidence | Implemented | Deterministic 0-100 score plus named signals, never permission. |
| 108 Human decision minimization | Implemented | Defaults/templates/queue reduce clerical work; risky judgment retained. |
| 109 Exception dashboard | Implemented | Ambiguous and low-quality items prioritized. |
| 110 Safe retries/recovery | Implemented | Idempotent replay, cancelled return, ambiguous manual resolution. |
| 111 Ambiguous action | Implemented | Persisted handoff reload and explicit resolution. |
| 112 Version/changelog | Implemented | Version `1.0.0`, pinned manifests, `CHANGELOG.md`. |
| 113 Regression baseline | Implemented | Backend/frontend suites and production bundle. |
| 114 Maintenance/refactor | Implemented | Focused modules, explicit dependency boundaries, no duplicate runtime. |
| 115 Human-operator readiness | Partial | Local Chromium coverage now includes a fictional sent/reply/reminder/report journey alongside Not sent/Stop contact. This is local record-keeping acceptance, not actual delivery or the complete real operator journey; authenticated provider/manual-use acceptance remains open. |
