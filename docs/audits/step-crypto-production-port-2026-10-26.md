# Canonical Crypto11 parent production candidate

The private overlay preserves the complete published go.step.sm/crypto v0.91.0
input ledger, source license and immutable upstream Git identity. It changes
only the production Crypto11 import, the corresponding module requirement to
github.com/eclipse-keypont/crypto11 v1.6.8, and the Go directive to1.27.3.
It is a source port, not an unmodified publisher release or production dependency
replacement. No module replace/exclude clause or forced version is introduced.

The additive hosted worker checks out the complete upstream Git source, verifies
all507 published payload hashes, applies only the production overlay and retains
every original test and fixture. It compiles all ordinary SDK production packages
with CGO enabled and native compiler/PCSC headers. Actual package/module metadata
must show the canonical Crypto11 identity at1.6.8 without replacement, and signed
Go checksum verification remains enabled. Builds run as the worker's ordinary
UID. No SDK program, original SDK suite or real device is invoked.

Five original PKCS11 case files still import the old module path. Their separate
five-import migration is unapplied pending Robert's explicit original-case
preservation exception. It is not included in this overlay or workflow. No case,
assertion, fixture, helper body, build tag or test-selection setting changes.
The worker verifies all original case/fixture hashes after compilation, including
on a failed build. This production build cannot establish original-case behavior,
real HSM/provider acceptance, complete stable-graph acceptance or image safety.

The earlier all-module Caddy resolution failure, Smallstep certificates' other
legacy identity, Mergo migration, pseudo-version parent contracts and strict
GO-2026-5932 image finding remain open. No audit, advisory or source gate is
weakened. Existing application/native/browser/image workflows remain unchanged.
No source-port integration, main merge, local compiler/package/scanner execution,
deployment, server, billing, credential, real key or database mutation occurred.
