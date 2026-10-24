# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
import hashlib
import json
from pathlib import Path
import sysconfig

native_spec = json.loads(Path("sqlite-runtime.json").read_text(encoding="utf-8"))
native_key = {"win-amd64":"windows-x86_64", "win-arm64":"windows-arm64"}[sysconfig.get_platform().lower()]
native = Path(".simbi-runtime/sqlite") / native_spec["version"] / native_key / "sqlite3.dll"
if hashlib.sha256(native.read_bytes()).hexdigest() != native_spec[native_key]["binary_sha256"]:
    raise RuntimeError("Pinned SQLite DLL is missing or invalid; provision it before packaging")

hiddenimports = collect_submodules("uvicorn")
datas = [
    ("sqlite-runtime.json", "."),
    ("frontend/dist", "frontend/dist"),
    ("backend/migrations", "backend/migrations"),
]

a = Analysis(
    ["scripts/windows_entry.py"],
    pathex=["backend"],
    binaries=[(str(native), str(native.parent).replace("\\", "/"))],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=["scripts/sqlite_pyinstaller_hook.py"],
    excludes=["pytest", "httpx"],
    noarchive=False,
    optimize=1,
)
# The verified nested DLL is loaded by the runtime hook before _sqlite3.
# Do not also ship the interpreter's older root-level SQLite DLL.
a.binaries = [entry for entry in a.binaries if entry[0].lower() != "sqlite3.dll"]
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Simbi Reach-Out",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="Simbi Reach-Out",
)
