"""Probe only an isolated image's in-memory engine and installed library files."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

from app.sqlite_runtime import runtime_evidence

runtime = runtime_evidence()
assert os.getuid() == 10001
assert sys.version_info[:3] == (3, 15, 1)
assert runtime["version"] == "3.54.1"
version = subprocess.check_output([
    "dpkg-query", "-W", "-f=${Version}", "libsqlite3-0"], text=True).strip()
assert version == "3.54.1-0simbi1"
files = subprocess.check_output(["dpkg-query", "-L", "libsqlite3-0"], text=True).splitlines()
libraries = [Path(name) for name in files if name.endswith("/libsqlite3.so.0")]
assert len(libraries) == 1
digest = hashlib.sha256(libraries[0].read_bytes()).hexdigest()
assert digest == runtime["binary_sha256"]
print(json.dumps({"python":sys.version,"uid":os.getuid(),"sqlite":runtime,
    "system_package_version":version,"system_library_sha256":digest,
    "operator_data_accessed":False}))
