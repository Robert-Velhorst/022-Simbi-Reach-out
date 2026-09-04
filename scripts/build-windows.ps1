$ErrorActionPreference = "Stop"
. "$PSScriptRoot/common.ps1"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Create the project virtual environment before building the Windows app."
}

Push-Location $ProjectRoot
try {
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        Invoke-SimbiNative pnpm.cmd @('install', '--frozen-lockfile')
        Invoke-SimbiNative pnpm.cmd @('build')
    } finally {
        Pop-Location
    }
    Invoke-SimbiNative $Python @('-m', 'pip', 'install', '-e', '.[dev]')
    Invoke-SimbiNative $Python @('-m', 'PyInstaller', '--noconfirm', '--clean', 'simbi-windows.spec')
    $Output = Join-Path $ProjectRoot "dist\Simbi Reach-Out\Simbi Reach-Out.exe"
    if (-not (Test-Path -LiteralPath $Output -PathType Leaf)) {
        throw "Windows build did not produce the expected executable."
    }
    Write-Host "Windows standalone build: $Output"
} finally {
    Pop-Location
}
