$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

Push-Location $ProjectRoot
try {
    & $Python -m ruff check backend
    & $Python -m pytest
    & $Python -m pip_audit --skip-editable
    & $Python scripts\benchmark.py
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        pnpm.cmd lint
        pnpm.cmd test
        pnpm.cmd build
        pnpm.cmd audit --audit-level high
        pnpm.cmd exec playwright install chromium
        pnpm.cmd test:e2e:run
    } finally {
        Pop-Location
    }
    & $Python -m app.cli doctor
    docker compose config --quiet
    docker compose -f compose.production.yaml --env-file .env.production.example config --quiet
} finally {
    Pop-Location
}
