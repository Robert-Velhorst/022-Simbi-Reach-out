#Requires -Version 7.2
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot '.venv/Scripts/python.exe'
Assert-SimbiPortAvailable 8000
Assert-SimbiPortAvailable 5173
if (-not (Test-Path -LiteralPath $Python)) {
    Invoke-SimbiNative python @('-m', 'venv', (Join-Path $ProjectRoot '.venv'))
}
$Api = $null
$Worker = $null
$Frontend = $null
Push-Location $ProjectRoot
try {
    Invoke-SimbiNative $Python @('-m', 'pip', 'install', '-e', '.[dev]')
    Push-Location (Join-Path $ProjectRoot 'frontend')
    try { Invoke-SimbiNative pnpm.cmd @('install', '--frozen-lockfile') } finally { Pop-Location }
    $ChildEnvironment = @{SIMBI_ENV='local'; SIMBI_FRONTEND_ORIGIN='http://127.0.0.1:5173'; SIMBI_ALLOWED_HOSTS='127.0.0.1,localhost'; SIMBI_COOKIE_SECURE='false'; SIMBI_REQUIRE_MAINTENANCE='true'}
    $Worker = Start-SimbiProcess $Python @('-m', 'app.worker') -WorkingDirectory $ProjectRoot -Environment $ChildEnvironment
    $Api = Start-SimbiProcess $Python @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000', '--reload') -WorkingDirectory $ProjectRoot -Environment $ChildEnvironment
    $Frontend = Start-SimbiProcess (Get-Command pwsh).Source @('-NoProfile', '-File', "$PSScriptRoot/run-frontend.ps1") -WorkingDirectory $ProjectRoot
    Write-Host 'API: http://127.0.0.1:8000/api/health/ready'
    Write-Host 'App: http://127.0.0.1:5173; Ctrl+C stops API, maintenance worker and frontend.'
    while (-not $Api.HasExited -and -not $Worker.HasExited -and -not $Frontend.HasExited) { Start-Sleep -Seconds 1 }
    throw 'A development process stopped; the remaining owned processes will stop.'
} finally {
    Stop-SimbiProcess $Frontend
    Stop-SimbiProcess $Api
    Stop-SimbiProcess $Worker
    Pop-Location
}
