# Caddy full-graph stable-source qualification

The retained installed-image job at commit
015fd431a136b7d9e6c13c5d0b16041a23e65019 reported one edge-image finding:
GO-2026-5932 on golang.org/x/crypto v0.58.0. The same artifact's API-image
scan had no findings. These are dated scan observations, not a fresh scan or
production-acceptance result. The independent full image gate remains strict.

The official [Go advisory](https://vuln.go.dev/ID/GO-2026-5932.json) marks the
old OpenPGP package unsafe and gives no fixed version. Current public module
metadata identifies x/crypto v0.58.0 and Caddy v2.11.7 as the latest tagged
releases. Neither observation permits suppressing a module-level finding or
claiming every included component current.

## Additional hosted qualification

The additive Caddy workflow operates only on disposable GitHub-hosted workers.
It copies this proposal's edge wrapper into temporary storage, inventories every
selected module, queries public final tags and makes ordinary go get requests
for newer tagged stable versions. It does not downgrade pseudo-versions, choose
prereleases, add replace/exclude clauses or force a parent API contract. Untagged
or pseudo-version selections remain explicitly unqualified by the final graph
gate. Resolver failure is retained rather than replaced by an older toolchain.

The worker uses the existing checksum-pinned Go 1.27.3 image and checksum
database. It compiles the full standard Caddy distribution and records actual
binary build information, hash and linked package paths. It independently
checks out the complete upstream Caddy v2.11.7 source commit
72dd0fb067f6d7826c7f79907670ba4a713bfe37 and records every tracked source hash.
A normal Go workspace then selects the candidate graph for the unchanged
upstream `go test ./...` command. No -short/-run filter, case/helper/fixture
change or upstream manifest rewrite is introduced. Post-suite source hashes
must match even when the original command fails.

All resolver, compilation, original-case and whole-graph results remain separate
gates. A successful compile does not clear an image vulnerability, establish
behavioral compatibility, prove every module current or establish live TLS.
Generated module files are evidence until reviewed and deliberately adopted;
this workflow does not replace the production edge lock or image. Existing
application cases, workflows, runtime/image verifiers and zero-finding gates
remain unchanged. No application/compiler/package-manager/scanner or native
suite is executed locally.

No live deployment, TLS issuance, DNS, server, provider, real database, billing
or operator-data change is part of this source qualification. All four portfolio
requirements remain incomplete until their respective evidence qualifies.

## Canonical Go release selection correction

The first graph candidate used the maximum numeric final tag from the proxy
version list. That is insufficient for Go: it can select obsolete incompatible
tags (Prometheus v2.5.0+incompatible and Blackfriday v2.0.0+incompatible) and
does not implement the Go client's retraction policy. Those148 raw differences
are retained diagnostic evidence, not148 proven outdated runtime imports.

The verifier now delegates each path's latest query to the actual Go1.27.3
client with normal checksum/retraction/module semantics. Raw numeric maxima
remain diagnostic fields only. Query errors, pseudo-versions and missing final
targets remain unqualified; no downgrade, forced replacement or prerelease is
selected. JSON stdout and diagnostic stderr are retained separately so a warning
cannot corrupt the metadata stream or disappear from evidence. The corrected
targets need fresh hosted resolution/compilation/original-case/graph evidence.
This correction changes no application or original-case source and clears no
advisory. [Go's version query rules](https://go.dev/ref/mod#version-queries).
