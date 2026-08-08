$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    python -m venv (Join-Path $ProjectRoot ".venv")
}

Push-Location $ProjectRoot
try {
    & $Python -m pip install -e ".[dev]"
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        pnpm install --frozen-lockfile
    } finally {
        Pop-Location
    }

    $Api = Start-Process -FilePath $Python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", "8000", "--reload") `
        -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
    try {
        Write-Host "API: http://127.0.0.1:8000/api/health/ready"
        Write-Host "App: http://127.0.0.1:5173"
        Push-Location (Join-Path $ProjectRoot "frontend")
        try {
            pnpm dev
        } finally {
            Pop-Location
        }
    } finally {
        if (-not $Api.HasExited) {
            Stop-Process -Id $Api.Id
        }
    }
} finally {
    Pop-Location
}
