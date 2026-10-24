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
DLLs; Linux/macOS build checksum-verified official source. The first Mac ARM
SDK survey found a statically embedded older engine and provisioning failed.
Mac profiles now build the exact CPython standard-library SQLite module from
verified source against the selected SDK, within the project. The original
SDK remains unchanged. This correction still requires hosted qualification. See the
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

## Browser-test proxy security finding

GitHub CodeQL alert 7 reports a request-forgery path in the fictional response
proxy: resolving an incoming absolute URL against the backend base can select
another authority. The prepared correction uses a literal loopback hostname,
a separately validated numeric port and an origin-form-only request path.
It replaces the forwarded Host header with the owned backend identity.
Fifteen actual Node tests pass, including rejection before dispatch of
absolute/network-path/backslash/control targets and a real loopback body/query
round trip. Hosted browser compatibility and CodeQL closure remain separate
requirements; the alert has not been dismissed.

## Container dependency correction

The first image build failed when removing Debian's `libsqlite3-0`: `util-linux`
needs `liblastlog2-2`, which depends on that library package. The prepared fix
builds a local Debian package containing the verified SQLite 3.54.1 library,
upgrades the package normally and refreshes the loader cache. It records the
verified source/runtime provenance and preserves the system dependency graph.
The image inventory gate now also requires package version `3.54.1-0simbi1`;
an additional fixture rejects the older system package. All 13 focused native
and image-policy cases pass locally. The actual image build and installed
package scan must still qualify the correction.

All image, edge, storage and Compose gates now run in an independent CI job,
so a container failure is visible without waiting for the full browser suite.
The full unit and browser gates remain enabled in their original jobs.

## Edge and archive qualification follow-up

The API image now builds and its isolated probe verifies Python 3.15.1,
UID 10001, SQLite 3.54.1 and the identical upgraded system library. The edge's
upstream executable capability caused `operation not permitted` under the
offline restricted profile. `Dockerfile.caddy` removes that capability during
the build, retains the upstream binary hash and copies it into pinned Alpine
3.24.3. Offline version/configuration qualification then passed. Production
Compose retains only the low-port binding capability for the edge.

The subsequent image scan reported 164 findings (44 high, 58 medium, 61 low,
one unknown). Its configuration ID differs from Docker's inspected descriptor
ID, so exact-image attribution still needs byte-level archive reconciliation.
The new gate verifies the saved configuration bytes, its descriptor ancestry,
platform and filesystem against the inspected image, records the archive hash,
then compares the scanner's configuration ID. Nineteen focused archive/native/
image-policy cases pass locally; the hosted archive proof is still required.
No findings are suppressed, and the installed-image gate remains failed.

A possible next API base, pinned Python 3.15.1 on Alpine 3.24, was checked in
the official registry. Alpine's current `sqlite-libs` is still 3.53.4-r0, so
switching the base alone cannot preserve the required current SQLite version.
No API rebase or passing replacement scan is claimed here.

## Alpine API candidate

The subsequent hosted archive proof passed and attributed the same 164 findings
to the exact exported Debian image: 88 OS packages, with no findings reported
in its 20-package Python result. The scan gate remained failed.

The new candidate now uses the digest-verified official Python 3.15.1 Alpine
3.24 base, stable repository updates and the verified SQLite 3.54.1 library
packaged as `sqlite-libs`. The package is signed with an ephemeral builder key
and installed offline using only that key's temporary public-key directory.
The private key is removed before the builder layer is committed; normal
repository keys remain unchanged. No signature bypass is used.

A separate build target runs the entire backend suite against the Alpine libc
with networking disabled. Development tools and tests are excluded from the
final application image. API and edge scans both execute and each scan/proof
status must succeed; an API failure no longer prevents edge evidence collection.
This was initially a prepared compatibility change. The exact hosted result
and subsequent edge source candidate are recorded below.

## Verified Alpine API and current edge candidate

At `8ea460112943524a3f387a4530f74b38f96c1c85`, hosted run
40041873982 verified the API archive/configuration identity and reported zero
findings across 33 Alpine OS packages and 20 Python distributions. The API
configuration digest was
`sha256:5ce42b08875519a42b3bcc33eaeeefb36a8cb049b18bb80eb3ea85a537a0edc8`.
The network-disabled Alpine backend qualification passed 503 cases with no
failures or skips. This supersedes the older Debian API result for that head.
The main verification job, four added native platform jobs, Firefox/WebKit
checks, and Windows standalone job also passed.

The separate edge scan still reported 20 findings in the upstream Go binary;
its Alpine OS result had none. The combined image gate failed. There was no
advisory suppression or severity exclusion.

The new edge candidate builds standard Caddy 2.11.7 from checksum-locked Go
modules using the pinned Go 1.27.3 image. It uses x/net 0.61.0 and x/crypto
0.58.0. Module download and verification are separate from the network-disabled
compilation step. The final image retains upstream assets and module license
notices, and includes hashed build information, module locks, compile package
paths and build environment. The offline runtime verifier requires the exact
Go version, matching binary hash, source lockfiles, and module checksums.

Local Linux amd64 cross-compilation succeeded using Go 1.27.3: 160 modules and
1,030 package paths were recorded. None of the seven affected OpenPGP package
paths in the primary advisory
[GO-2026-5932](https://vuln.go.dev/ID/GO-2026-5932.json) occur in that compile
graph. Other x/crypto packages are included. This is evidence for that local
binary only, not a waiver or proof for the later hosted container. The raw
scanner and zero-finding gate remain unchanged. The source-built image still
requires hosted build, offline runtime, exact archive and scan qualification;
no passing replacement edge image or live TLS acceptance is claimed here.

The first hosted source-built image (`c6189c2`) built successfully and passed
its Go version, binary hash and intermediate evidence checks, then failed the
exact `go.sum` comparison. `go mod download all` had added 742 checksum lines,
without removing any original line. Local complete module download and
verification reproduced exactly the hosted checksum set. The source lock now
includes those entries. The builder compares both lockfiles before and after
download and fails if either changes. This retains the exact-source boundary;
the runtime comparison was not relaxed. All eight other jobs at `c6189c2`
passed. The corrected head still requires its own hosted image and scan result.
