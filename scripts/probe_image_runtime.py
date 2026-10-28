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
version = "3.54.1-r0"
query = ["apk", "--no-network", "query", "--from", "installed", "--installed",
         "--format", "json", "--fields", "name,version"]
packages = json.loads(subprocess.check_output([*query, "sqlite-libs"], text=True))
assert packages == [{"name":"sqlite-libs", "version":version}]
library = Path("/usr/lib/libsqlite3.so.0")
owner = json.loads(subprocess.check_output([*query, "--match", "owner", str(library)], text=True))
assert owner == packages
digest = hashlib.sha256(library.read_bytes()).hexdigest()
assert digest == runtime["binary_sha256"]
print(json.dumps({"python":sys.version,"uid":os.getuid(),"sqlite":runtime,
    "system_package_version":version,"system_library_sha256":digest,
    "operator_data_accessed":False}))
