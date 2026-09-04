#Requires -Version 7.2
param([string]$Executable = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist/Simbi Reach-Out/Simbi Reach-Out.exe'))
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw 'Build the standalone executable first.' }
$SmokeRoot = Join-Path ([IO.Path]::GetTempPath()) ('simbi-windows-smoke-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $SmokeRoot | Out-Null
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$probe.Start()
$Port = $probe.LocalEndpoint.Port
$probe.Stop()
$AppProcess = $null
try {
    $SmokeEnvironment = @{LOCALAPPDATA=$SmokeRoot; SIMBI_WINDOWS_PORT="$Port"; SIMBI_WINDOWS_NO_BROWSER='true'; SIMBI_ENV='local'; SIMBI_DATABASE_PATH="$SmokeRoot/data/simbi.db"; SIMBI_BACKUP_PATH="$SmokeRoot/backups"; SIMBI_AUTO_BACKUP='true'; SIMBI_HAI_FEED_PATH=''; SIMBI_FRONTEND_ORIGIN="http://127.0.0.1:$Port"; SIMBI_ALLOWED_HOSTS='127.0.0.1,localhost'; SIMBI_COOKIE_SECURE='false'; SIMBI_REQUIRE_MAINTENANCE='true'}
    $AppProcess = Start-SimbiProcess $Executable -WorkingDirectory $SmokeRoot -Environment $SmokeEnvironment
    $Ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($AppProcess.HasExited) { throw "Standalone process exited early: $($AppProcess.ExitCode)" }
        try {
            $response = Invoke-RestMethod "http://127.0.0.1:$Port/api/health/ready" -TimeoutSec 1
            if ($response.status -eq 'ready') { $Ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $Ready) { throw 'Standalone executable never became ready.' }
    $page = Invoke-WebRequest "http://127.0.0.1:$Port/" -TimeoutSec 3
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<html') { throw 'Packaged frontend was not served.' }
    if (@(Get-ChildItem "$SmokeRoot/backups/simbi-*.db" -ErrorAction SilentlyContinue).Count -lt 1) { throw 'Packaged maintenance did not create a persistent backup.' }
    Stop-SimbiProcess $AppProcess
    Assert-SimbiPortAvailable $Port
    Write-Host 'PASS: isolated Windows executable readiness, packaged frontend, maintenance backup and owned-process stop.'
} finally {
    Stop-SimbiProcess $AppProcess
    $resolvedSmoke = [IO.Path]::GetFullPath($SmokeRoot)
    if (-not $resolvedSmoke.StartsWith([IO.Path]::GetTempPath()) -or (Split-Path $resolvedSmoke -Leaf) -notlike 'simbi-windows-smoke-*') { throw 'Unsafe smoke cleanup path' }
    Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force
}
