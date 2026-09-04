#Requires -Version 7.2
param([string]$Image = 'simbi-reach-out:deployment-smoke')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$SmokeId = 'simbi-smoke-' + [guid]::NewGuid().ToString('N')
$AppName = "$SmokeId-app"
$WorkerName = "$SmokeId-worker"
$Volumes = @("$SmokeId-data", "$SmokeId-backups", "$SmokeId-hai")
$CreatedContainers = @()
$CreatedVolumes = @()
try {
    foreach ($volume in $Volumes) {
        Invoke-SimbiNative docker @('volume', 'create', $volume) | Out-Null
        $CreatedVolumes += $volume
    }
    $Token = [guid]::NewGuid().ToString('N')
    $Runtime = @('--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:size=64m,mode=1777', '--mount', "type=volume,src=$($Volumes[0]),dst=/app/data", '--mount', "type=volume,src=$($Volumes[1]),dst=/app/backups", '--mount', "type=volume,src=$($Volumes[2]),dst=/app/hai")
    foreach ($value in @('SIMBI_ENV=production', 'SIMBI_DATABASE_PATH=/app/data/simbi.db', 'SIMBI_FRONTEND_ORIGIN=https://smoke.example.test', 'SIMBI_ALLOWED_HOSTS=smoke.example.test', 'SIMBI_COOKIE_SECURE=true', 'SIMBI_AUTO_BACKUP=true', 'SIMBI_BACKUP_PATH=/app/backups', 'SIMBI_REQUIRE_MAINTENANCE=true', 'SIMBI_HAI_FEED_PATH=/app/hai/simbi.json', 'SIMBI_HAI_INCLUDE_CONTENT=false', "SIMBI_SETUP_TOKEN=$Token")) { $Runtime += @('--env', $value) }
    # Exercise the image's actual import resolution before starting any services.
    Invoke-SimbiNative docker (@('run', '--rm', '--network', 'none') + $Runtime + @($Image, 'python', '-c', "from pathlib import Path; from app.config import ROOT; assert ROOT == Path('/app'), str(ROOT); assert list((ROOT/'backend/migrations').glob('*.sql')), 'Missing image migrations'; assert (ROOT/'frontend/dist/index.html').is_file(), 'Missing image frontend'; print('Image imports resolve to /app with migrations and frontend assets')"))
    Invoke-SimbiNative docker (@('run', '-d', '--name', $WorkerName, '--network', 'none') + $Runtime + @($Image, 'python', '-m', 'app.worker', '--interval', '30')) | Out-Null
    $CreatedContainers += $WorkerName
    Invoke-SimbiNative docker (@('run', '-d', '--name', $AppName, '-p', '127.0.0.1::8000') + $Runtime + @($Image)) | Out-Null
    $CreatedContainers += $AppName
    $binding = (Invoke-SimbiNative docker @('port', $AppName, '8000/tcp')).Trim()
    $BaseUrl = "http://$binding"
    $Headers = @{Host='smoke.example.test'; Origin='https://smoke.example.test'}
    $Ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { if ((Invoke-RestMethod "$BaseUrl/api/health/ready" -Headers $Headers -TimeoutSec 2).status -eq 'ready') { $Ready = $true; break } } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) { throw 'Isolated production container never became ready with fresh HAI-enabled data.' }
    $Setup = @{display_name='Smoke Owner'; workspace_name='Smoke Workspace'; email='smoke@example.test'; password=([guid]::NewGuid().ToString('N')); setup_token=$Token} | ConvertTo-Json
    Invoke-RestMethod "$BaseUrl/api/auth/setup" -Method Post -Headers $Headers -ContentType 'application/json' -Body $Setup | Out-Null
    Invoke-SimbiNative docker @('restart', $WorkerName) | Out-Null
    $Exported = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker exec $WorkerName python -c "from pathlib import Path; import sys; sys.exit(0 if Path('/app/hai/simbi.json').exists() else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { $Exported = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $Exported) { throw 'HAI export did not persist in its writable volume after setup.' }
    Invoke-SimbiNative docker @('exec', $WorkerName, 'python', '-m', 'app.worker', '--healthcheck')
    Invoke-SimbiNative docker @('exec', $AppName, 'python', '-c', "import json,sqlite3; from pathlib import Path; p=Path('/app/hai/simbi.json'); assert json.loads(p.read_text())['items']==[]; backups=list(Path('/app/backups').glob('simbi-*.db')); assert backups; c=sqlite3.connect(backups[0]); assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; c.close(); print('Persistent backup integrity and private HAI feed verified')")
    & docker exec $AppName python -m app.worker --once 2>$null
    if ($LASTEXITCODE -eq 0) { throw 'A second container bypassed the singleton maintenance lock.' }
    Invoke-SimbiNative docker @('stop', $WorkerName) | Out-Null
    $notReady = Invoke-WebRequest "$BaseUrl/api/health/ready" -Headers $Headers -SkipHttpErrorCheck -TimeoutSec 3
    if ($notReady.StatusCode -ne 503) { throw 'Readiness stayed healthy after maintenance stopped.' }
    Write-Host 'PASS: production containers, HAI bootstrap/export permissions, backup integrity, cross-container singleton lock and fail-closed maintenance readiness.'
} catch {
    $Failure = $_
    foreach ($name in $CreatedContainers) {
        Write-Host "Bounded diagnostics for owned container $name (no configuration/environment dump):"
        try {
            & docker inspect --format '{{json .State}}' $name 2>&1 | ForEach-Object { "$($_)".Substring(0, [Math]::Min(4000, "$($_)".Length)) }
            & docker logs --tail 60 $name 2>&1
        } catch { Write-Warning "Container diagnostics unavailable for $name." }
    }
    throw $Failure
} finally {
    foreach ($name in $CreatedContainers) { Invoke-SimbiNative docker @('rm', '-f', $name) | Out-Null }
    foreach ($name in $CreatedVolumes) { Invoke-SimbiNative docker @('volume', 'rm', $name) | Out-Null }
}
