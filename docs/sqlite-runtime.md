# Verified native runtime

Simbi uses CPython 3.15.1 with a separate checksum-verified SQLite 3.54.1
library. Native profiles target Windows, Linux and macOS on x86_64 and ARM64.
Every profile has a mandatory hosted qualification job; a configured profile
is not proof that its current SDK and engine have passed that job. Release assets
and SHA3-256 checksums are pinned in `sqlite-runtime.json` from the
[official SQLite release](https://www.sqlite.org/download.html).

## Source checkout

Install uv 0.13.5, Node 26.12.1 and pnpm 12.15.0. Provision the locked Python
environment and native engine before starting a service:

```powershell
uv sync --frozen --extra dev --python 3.15.1
.\.venv\Scripts\python.exe -I scripts/setup_sqlite_runtime.py
$env:PYTHONPATH = "$PWD\runtime_bootstrap;$PWD\backend"
.\.venv\Scripts\python.exe -c "from app.sqlite_runtime import runtime_evidence; print(runtime_evidence())"
```

On Linux, install a C compiler and libc development headers for provisioning.
On macOS, install Xcode command line tools (including `cc`, `otool`,
`install_name_tool` and `codesign`). Use the POSIX commands on either platform:

```sh
uv sync --frozen --extra dev --python 3.15.1
.venv/bin/python -I scripts/setup_sqlite_runtime.py
export PYTHONPATH="$PWD/runtime_bootstrap:$PWD/backend"
.venv/bin/python -c 'from app.sqlite_runtime import runtime_evidence; print(runtime_evidence())'
```

The installer downloads the exact official archive, checks its SHA3-256,
verifies the Windows DLL's SHA-256 or builds the verified SQLite source, then
checks the loaded engine in a fresh process. It provisions only the ignored
checkout-local `.simbi-runtime` directory. First provision requires HTTPS
access to sqlite.org. Windows library selection uses Python's compiled
platform identity and works in a sanitized process environment.

The first Mac ARM hosted survey found SQLite 3.53.4 statically embedded in
the Python.org 3.15.1 extension, so relocating a copied SDK binary failed.
Mac provisioning now compiles the exact CPython 3.15.1 standard-library SQLite
module from the checksum-pinned official source release, using the selected
SDK headers and verified SQLite 3.54.1 header/library. It changes only the new
module's dependency to the adjacent project library and applies an offline
ad hoc signature. The original SDK and extension remain unchanged. First
provision also requires HTTPS access to python.org and retains the CPython
license beside the module. The runtime path includes the Python version and
original extension fingerprint; startup checks source provenance, module hash
and Python ABI. ARM64 and Intel builds require independent hosted qualification.

The early bootstrap profile is required for developer tools that import
`sqlite3` before application modules. Application imports also enforce the
native guard. Missing, tampered, linked, preinitialized or incorrect libraries
stop startup before a database is opened. Use a fresh process for an upgrade.

`dev.ps1`, `build-windows.ps1` and `verify.ps1` provision the frozen uv lock and
native runtime. Manual commands require the environment setup above.

## Container and standalone Windows package

The container installs `requirements-runtime.lock` with required hashes;
`scripts/verify_runtime_lock.py` compares it with the frozen uv resolution.
A build stage compiles SQLite and the final image verifies its version as
UID 10001. Code and native libraries remain root-owned; only data, backups
and HAI exchange directories are writable by the application user.
The prepared final image uses pinned Python 3.15.1 on Alpine 3.24.3, refreshes
the stable package repository's updates, removes the unused Python package
installer and upgrades `sqlite-libs` with the same verified 3.54.1 build.
The APK records source/runtime provenance and provides the shared-library ABI.
An ephemeral builder key signs this one artifact; its public key is selected
only for offline installation. The private key stays out of image layers and
the normal repository trust store is unchanged. The package database, library
ownership, binary hash and actual engine are checked separately.

The `backend-qualification` build target runs the complete backend suite on
the Alpine libc without network access. It contains development tools and is
not the final application image. The application image remains UID 10001;
its independent read-only runtime probe and installed-package scan must pass.
This libc/base change requires fresh qualification before release.

The Hetzner edge is built from `Dockerfile.caddy`: the exact upstream Caddy
2.11.7 binary is checked by hash after copying into pinned Alpine 3.24.3.
Its upstream executable capability is removed during the build, so offline
non-root validation can run with an empty capability set and no new privileges.
Production Compose grants only `NET_BIND_SERVICE` for the edge's low ports,
keeps its root filesystem read-only and stores Caddy state in the existing
dedicated volumes. These prepared settings still require image, configuration,
package-inventory and eventual operator deployment qualification.

The Windows spec includes the verified native DLL, manifest and an early
PyInstaller hook. It removes the older root-level DLL from collection.
Keep the entire generated standalone directory, including `_internal`.
The packaged hook checks SQLite before starting application code.

Retain a complete verified backup and rehearse recovery on copies before an
operator rollout. Synthetic tests check old-engine schema and draft/approval
state preservation, idempotent migrations, WAL, foreign keys, rollback and
backup integrity. They do not modify an operator database or send outreach.

## Compiler tooling

Builds use TypeScript 7.0.2. The linter uses Microsoft's published TypeScript6
compatibility API 6.0.2 through aliases, following the
[official side-by-side configuration](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).
The existing lint rules are retained. Browser, native package and installed
image qualification are recorded separately from source builds.
