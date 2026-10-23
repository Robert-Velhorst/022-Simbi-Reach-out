"""Package the verified current library without breaking Debian dependencies."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = json.loads((ROOT / "sqlite-runtime.json").read_text(encoding="utf-8"))
architecture = subprocess.check_output(["dpkg", "--print-architecture"], text=True).strip()
profile, multiarch = {
    "amd64": ("linux-x86_64", "x86_64-linux-gnu"),
    "arm64": ("linux-arm64", "aarch64-linux-gnu"),
}[architecture]
target = ROOT / ".simbi-runtime/sqlite" / spec["version"] / profile
library = target / spec[profile]["library"]
provenance = json.loads((target / "integrity.json").read_text(encoding="utf-8"))
digest = hashlib.sha256(library.read_bytes()).hexdigest()
if (digest != provenance["binary_sha256"]
        or provenance["source_sha3_256"] != spec[profile]["archive_sha3_256"]):
    raise RuntimeError("Only the verified SQLite build can be packaged")
evidence = json.loads(subprocess.check_output([
    sys.executable, "-c",
    "import json; from app.sqlite_runtime import runtime_evidence; print(json.dumps(runtime_evidence()))",
], env={**os.environ, "PYTHONPATH": str(ROOT / "backend")}, text=True))
if evidence["version"] != spec["version"] or evidence["binary_sha256"] != digest:
    raise RuntimeError("The packaged library must be the qualified active engine")
with tempfile.TemporaryDirectory(prefix="simbi-sqlite-deb-") as temporary:
    package = Path(temporary)
    package.chmod(0o755)
    (package / "DEBIAN").mkdir()
    (package / "DEBIAN/control").write_text(
        "Package: libsqlite3-0\nSource: sqlite3\n"
        f"Version: {spec['version']}-0simbi1\nArchitecture: {architecture}\n"
        "Section: libs\nPriority: optional\nMaintainer: Simbi Reach-Out\n"
        "Depends: libc6 (>= 2.34)\n"
        "Description: Verified current SQLite shared library for Simbi\n"
        " Built from the checksum-pinned official upstream release.\n",
        encoding="utf-8",
    )
    destination = package / "usr/lib" / multiarch / "libsqlite3.so.0"
    destination.parent.mkdir(parents=True)
    shutil.copyfile(library, destination)
    destination.chmod(0o644)
    documentation = package / "usr/share/doc/libsqlite3-0"
    documentation.mkdir(parents=True)
    (documentation / "simbi-build.json").write_text(
        json.dumps({"runtime": evidence, "build": provenance}, indent=2) + "\n", encoding="utf-8")
    (documentation / "copyright").write_text(
        "SQLite is in the public domain.\n"
        "Upstream: https://www.sqlite.org/copyright.html\n"
        f"Verified source: {spec[profile]['url']}\n", encoding="utf-8")
    subprocess.run(["dpkg-deb", "--root-owner-group", "--build", str(package),
                    "/tmp/simbi-libsqlite3.deb"], check=True, timeout=60)
