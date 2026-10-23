# Stable dependency and database runtime update

## Changes

The 24 October registry audit covers all 35 direct frontend, Python runtime,
development and Python build declarations. Every resulting exact declaration
matches its registry's latest stable release. The initial 34-declaration audit
found 11 gaps; the additional declaration is Microsoft's side-by-side
TypeScript compiler alias. This is not a claim that every installed or
transitive component is current.

The update selects Python 3.15.1, uv 0.13.5, Node 26.12.1, pnpm 12.15.0,
TypeScript 7.0.2, Vite 8.3.5, Vitest 5.0.5 and SQLite 3.54.1. The unchanged
lint rules use Microsoft's TypeScript6 compatibility API 6.0.2. Python uses
a frozen universal uv lock and a hash-required production export. The frontend
lock was refreshed through transitive dependencies, including Zod 4.6.7 to
address [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

The native bootstrap checks SQLite before application imports and database
access. It is connected to development launchers, tests, CI, the Linux image
and Windows packaging. Missing, tampered, linked, incompatible or already
initialized libraries stop startup. Windows uses official checksum-verified
DLLs; Linux/macOS build checksum-verified official source. Mac profiles copy
and relocate the selected SDK extension within the project. See the
[native runtime guide](../sqlite-runtime.md).

## Recorded local evidence and limits

| Check | Result and exact scope |
| --- | --- |
| Direct registry audit | 35 declarations current; zero query errors. |
| Backend lint | Passed after native profile changes. |
| Backend suite before Mac/ARM extension | 488 tests passed under actual SQLite 3.54.1, including synthetic old-engine schema/draft/backup preservation. |
| Focused current native and image-policy cases | All 12 passed after Mac/ARM code preparation. A new full backend run is separate. |
| Frontend strict peer install, lint, build | Passed after the full lock refresh. The existing build chunk-size warning remains. |
| Frontend unit suite | 965 cases passed before the transitive refresh. The post-refresh full attempt did not complete and was stopped after a separate worker-startup timeout was reproduced. No tests or timeout gates were weakened; exact final source requires hosted qualification. |
| Dependency vulnerability audits | No known findings across 302 frontend package records and 62 versioned Python distributions; the editable project is excluded. This is advisory coverage, not proof of no vulnerabilities. |
| Chromium workflows after lock refresh | Complete sequential English/Dutch workflow, privacy, retirement, password, response and selected accessibility checks passed on Chromium 156.0.8078.4 with fictional local records. |
| Windows standalone after lock refresh | Built successfully; isolated readiness, frontend, backup/restore, shutdown, diagnostics and unconfirmed-recovery refusal passed. This artifact predates the later Mac/ARM loader/spec additions. |
| Mac, Linux ARM and Windows ARM | Prepared mandatory native CI jobs; no passing result is claimed yet. |
| Docker API and Caddy images | Pinned image checks, native probes and unsuppressed installed-package scans are required in CI. No local daemon-backed result is claimed. |

CI keeps the complete unit/browser/Windows checks and adds native ARM/Intel
qualification and exact-image inventory scans. API and Caddy archives are
scanned without mounting the Docker socket. No vulnerability allowlist or
severity exclusion is introduced. A native SDK, OS, package or image failure
must be resolved before release; configured checks alone are not passing proof.

Hetzner remains the deployment target. No operator database was opened or
migrated, no outreach was sent, and no provider or deployment was changed.
This work is a review draft and requires separate merge approval.
