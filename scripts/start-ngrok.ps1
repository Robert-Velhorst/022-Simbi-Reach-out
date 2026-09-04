#Requires -Version 7.2
param([ValidateRange(1024,65535)][int]$Port = 8000, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot '.venv/Scripts/python.exe'
# Check before ngrok discovery/start: never tunnel an existing service.
Assert-SimbiPortAvailable $Port
$Ngrok = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { throw 'Install the project virtual environment first.' }
if (-not $Ngrok -or (Get-Item -LiteralPath $Ngrok.Source).Length -eq 0) { throw 'Install ngrok and configure authentication first.' }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'frontend/dist/index.html'))) { throw 'Build the frontend before starting the public tunnel.' }
$NgrokProcess = $null
$AppProcess = $null
$WorkerProcess = $null
try {
    $Upstream = "http://127.0.0.1:$Port"
    $NgrokProcess = Start-SimbiProcess $Ngrok.Source @('http', $Upstream, '--log=stdout', '--log-format=json') -WorkingDirectory $ProjectRoot -CaptureOutput
    $PublicUrl = Get-SimbiTunnelUrl -Process $NgrokProcess -Upstream $Upstream
    # Drain later output so ngrok cannot deadlock on its redirected pipe.
    $drainTask = $NgrokProcess.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
    $PublicHost = ([uri]$PublicUrl).Host
    $AppEnvironment = @{SIMBI_ENV='production'; SIMBI_FRONTEND_ORIGIN=$PublicUrl; SIMBI_ALLOWED_HOSTS=$PublicHost; SIMBI_COOKIE_SECURE='true'; SIMBI_FORWARDED_ALLOW_IPS='127.0.0.1'; SIMBI_AUTO_BACKUP='true'; SIMBI_REQUIRE_MAINTENANCE='true'}
    Assert-SimbiPortAvailable $Port
    $WorkerProcess = Start-SimbiProcess $Python @('-m', 'app.worker') -WorkingDirectory $ProjectRoot -Environment $AppEnvironment
    $AppProcess = Start-SimbiProcess $Python @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', "$Port", '--proxy-headers', '--forwarded-allow-ips', '127.0.0.1', '--no-server-header') -WorkingDirectory $ProjectRoot -Environment $AppEnvironment
    $Ready = $null
    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        if ($AppProcess.HasExited -or $WorkerProcess.HasExited -or $NgrokProcess.HasExited) { throw 'A required process exited before readiness.' }
        try {
            $Ready = Invoke-RestMethod -Uri "$Upstream/api/health/ready" -Headers @{Host=$PublicHost; 'X-Forwarded-Proto'='https'} -TimeoutSec 2
            if ($Ready.status -eq 'ready') { break }
        } catch { $Ready = $null }
        Start-Sleep -Milliseconds 500
    }
    if (-not $Ready -or $Ready.status -ne 'ready') { throw 'The application and maintenance worker did not become ready.' }
    Write-Host "Simbi is available through ngrok at $PublicUrl"
    Write-Host 'This exposes Simbi, not HAI. Keep this window open; Ctrl+C stops all three owned processes.'
    if (-not $NoBrowser) { Start-Process $PublicUrl }
    while (-not $AppProcess.HasExited -and -not $WorkerProcess.HasExited -and -not $NgrokProcess.HasExited) { Start-Sleep -Seconds 1 }
    throw 'The app, maintenance worker or ngrok stopped unexpectedly.'
} finally {
    Stop-SimbiProcess $NgrokProcess
    Stop-SimbiProcess $AppProcess
    Stop-SimbiProcess $WorkerProcess
}
