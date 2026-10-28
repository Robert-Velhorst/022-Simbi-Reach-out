# Canonical CLI and Mergo parent source ports

The selected Go-Sockaddr1.0.7 module still imports github.com/mitchellh/cli1.1.5
in eight production files. Its CLI/Sprig dependency chain retains the old
github.com/imdario/mergo identity. The private source overlays migrate those
imports to github.com/hashicorp/cli1.1.7, select Sprig/v3's current3.3.0 release
and canonical dario.cat/mergo1.0.2, and prepare current final declaration targets
for the other existing manifest entries. Go1.27.3 is the language/SDK target.
No module replacement/exclusion, prerelease declaration or downgrade is selected.

The complete121 Go-Sockaddr and25 CLI published source inputs, original licenses
and immutable Git commits are recorded. All19 original Go case files and all
fixtures/helper bodies remain unchanged. The production imports, two manifests
and documented address-port comparator are the functional overlays. These are private
source ports, not unmodified upstream releases or adopted application dependencies.

The additive disposable hosted worker verifies both full Git checkouts, checks
all public-proxy declaration candidates against the actual Go client's latest
queries, runs ordinary tidy/checksum verification, and compiles both complete
production package sets. A normal Go workspace composes the private parent
sources; no replace/exclude clause is introduced. Both complete original case
commands run with JSON reporting, without case filters, -short flags, new tests
or altered assertions. The CLI's upstream WASM build command also remains an
independent required result. Only production overlay files may be formatted.
All original case/fixture hashes must match even after failure.

Every command failure remains retained and fails the job. A normal resolver may
expose further parent constraints; those are unqualified findings, not permission
to adopt prereleases or forced versions. Passing these integration cases does not
prove complete transitive/higher-major currency, all vendor-case acceptance,
image safety, database/provider/hardware or deployment acceptance. The remaining
Caddy identity/pseudo-version failures and strict image gate remain unchanged.

The unrelated five-import Crypto11 test exception remains unapplied. No original
application workflow/case, runtime dependency graph, billing, credential,
real-data/provider/host/DNS setting or deployment is changed. All compiler and
SDK execution occurs on hosted workers, never locally. All four portfolio
requirements across44 eligible repositories remain incomplete.

## Original-case findings and comparator repair

The first complete worker at445229b passed the CLI production build, all82
original test/subtest pass events (zero failures/skips), and its upstream WASM
build. Go-Sockaddr compiled, but recorded280 passing,41 failing and4 existing
skipped test/subtest events. Those counts include parent/subtest events;
they are not counts of unique functions. All19 original case files and their
fixture/helper bodies remained byte-identical.

The failed network-size sorting case exposed an implementation defect. The
comparator documents that, for equal address/mask, an address with a port sorts
before one without a port. Previously it returned false whenever either port
was absent, in both directions, making comparator equivalence non-transitive.
The production fix returns true only when the left address has a port in this
branch; two present ports keep their existing numeric comparison. This restores
the documented ordering and Go's [strict-weak-order requirement](https://pkg.go.dev/sort#Interface).
The original regression case is untouched and must pass on the fresh hosted head.

Other observed failures include a real Linux loopback flag containing `running`
and template cases requiring `lo0`, `en0` and particular developer-machine IP
addresses. Real interface names/flags are not rewritten to make those assertions
green. No synthetic network, assertion update, helper injection, case filter or
new skip is introduced. Those original host contracts remain explicit
unqualified failures requiring their own decision.
