#Requires -Version 7.2
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
Push-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend')
try { Invoke-SimbiNative pnpm.cmd @('dev', '--host', '127.0.0.1', '--strictPort') }
finally { Pop-Location }
