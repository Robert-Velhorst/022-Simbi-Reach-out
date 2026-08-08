$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

Push-Location $ProjectRoot
try {
    & $Python -m ruff check backend
    & $Python -m pytest
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        pnpm.cmd lint
        pnpm.cmd test
        pnpm.cmd build
    } finally {
        Pop-Location
    }
    & $Python -m app.cli doctor
} finally {
    Pop-Location
}
