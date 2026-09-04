$ErrorActionPreference = "Stop"
. "$PSScriptRoot/common.ps1"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

Push-Location $ProjectRoot
try {
    Invoke-SimbiNative $Python @('-m', 'ruff', 'check', 'backend')
    Invoke-SimbiNative $Python @('-m', 'pytest')
    Invoke-SimbiNative $Python @('-m', 'pip_audit', '--skip-editable')
    Invoke-SimbiNative $Python @('scripts/benchmark.py')
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        Invoke-SimbiNative pnpm.cmd @('lint')
        Invoke-SimbiNative pnpm.cmd @('test')
        Invoke-SimbiNative pnpm.cmd @('build')
        Invoke-SimbiNative pnpm.cmd @('audit', '--audit-level', 'high')
        Invoke-SimbiNative pnpm.cmd @('exec', 'playwright', 'install', 'chromium')
        Invoke-SimbiNative pnpm.cmd @('test:e2e:run')
    } finally {
        Pop-Location
    }
    Invoke-SimbiNative $Python @('-m', 'app.cli', 'doctor')
    Invoke-SimbiNative docker @('compose', 'config', '--quiet')
    Invoke-SimbiNative docker @('compose', '-f', 'compose.production.yaml', '--env-file', '.env.production.example', 'config', '--quiet')
    Invoke-SimbiNative (Get-Command pwsh).Source @('-NoProfile', '-File', "$PSScriptRoot/test-launchers.ps1")
} finally {
    Pop-Location
}
