"""Read interpreter linkage and an in-memory engine before native provisioning."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import sysconfig

module = importlib.util.find_spec('_sqlite3')
origin = Path(module.origin) if module and module.origin not in {'built-in', 'frozen', None} else None
with sqlite3.connect(':memory:') as connection:
    version = connection.execute('SELECT sqlite_version()').fetchone()[0]
connection.close()
linkage = None
if sys.platform == 'darwin' and origin:
    linkage = subprocess.check_output(['otool', '-L', str(origin)], text=True)
print(json.dumps({'python':sys.version,'platform':sys.platform,'compiled_platform':sysconfig.get_platform(),
    'machine':os.uname().machine if hasattr(os, 'uname') else sysconfig.get_platform(),
    'original_sqlite_version':version,'module_origin':str(origin) if origin else module.origin,
    'module_sha256':hashlib.sha256(origin.read_bytes()).hexdigest() if origin else None,
    'linkage':linkage,'operator_data_opened':False},indent=2))
