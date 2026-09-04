param(
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Ngrok = Get-Command ngrok -ErrorAction SilentlyContinue

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "The project virtual environment is missing. Run the documented installation first."
}
if (-not $Ngrok -or (Get-Item -LiteralPath $Ngrok.Source).Length -eq 0) {
    throw "ngrok is not installed or is not available on PATH. Install it and configure authentication first."
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "frontend\dist\index.html"))) {
    throw "Build the frontend before starting the public tunnel."
}
if ($Port -lt 1024 -or $Port -gt 65535) {
    throw "Port must be between 1024 and 65535."
}

$NgrokProcess = $null
$AppProcess = $null
try {
    $NgrokProcess = Start-Process -FilePath $Ngrok.Source -ArgumentList @("http", $Port, "--log=stdout") -PassThru -WindowStyle Hidden
    $PublicUrl = $null
    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $Tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
            $PublicUrl = ($Tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
            if ($PublicUrl) { break }
        } catch {
            if ($NgrokProcess.HasExited) { throw "ngrok exited before creating a tunnel." }
        }
    }
    if (-not $PublicUrl) { throw "ngrok did not provide an HTTPS tunnel within 30 seconds." }
    $PublicHost = ([uri]$PublicUrl).Host
    $AppEnvironment = @{
        SIMBI_ENV = "production"
        SIMBI_FRONTEND_ORIGIN = $PublicUrl
        SIMBI_ALLOWED_HOSTS = $PublicHost
        SIMBI_COOKIE_SECURE = "true"
        SIMBI_FORWARDED_ALLOW_IPS = "127.0.0.1"
        SIMBI_AUTO_BACKUP = "true"
    }
    foreach ($Entry in $AppEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($Entry.Key, $Entry.Value, "Process")
    }
    $Arguments = @("-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", $Port, "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1", "--no-server-header")
    $AppProcess = Start-Process -FilePath $Python -ArgumentList $Arguments -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden
    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $Ready = Invoke-RestMethod -Uri "$PublicUrl/api/health/ready" -TimeoutSec 3
            if ($Ready.status -eq "ready") { break }
        } catch {
            if ($AppProcess.HasExited) { throw "Simbi exited before becoming ready." }
        }
    }
    if (-not $Ready -or $Ready.status -ne "ready") { throw "The public endpoint did not become ready." }
    Write-Host "Simbi is available through ngrok at $PublicUrl"
    Write-Host "This tunnel exposes Simbi, not HAI. Keep this window open and press Ctrl+C to stop both processes."
    if (-not $NoBrowser) { Start-Process $PublicUrl }
    while (-not $AppProcess.HasExited -and -not $NgrokProcess.HasExited) {
        Start-Sleep -Seconds 1
    }
    throw "The app or ngrok process stopped unexpectedly."
} finally {
    if ($AppProcess -and -not $AppProcess.HasExited) { Stop-Process -Id $AppProcess.Id }
    if ($NgrokProcess -and -not $NgrokProcess.HasExited) { Stop-Process -Id $NgrokProcess.Id }
}
