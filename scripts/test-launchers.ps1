#Requires -Version 7.2
$ErrorActionPreference = 'Stop'
$Repository = Split-Path -Parent $PSScriptRoot
$Fixture = Join-Path ([IO.Path]::GetTempPath()) ('simbi-launch-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path "$Fixture/scripts", "$Fixture/frontend", "$Fixture/.venv/Scripts", "$Fixture/bin" | Out-Null
try {
    Copy-Item "$PSScriptRoot/*.ps1" "$Fixture/scripts"
    # An executable is required by the launcher, but must never be reached after pnpm fails.
    Copy-Item (Get-Command pwsh).Source "$Fixture/.venv/Scripts/python.exe"
    Set-Content "$Fixture/bin/pnpm.cmd" '@exit /b 19'
    $start = [Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
    $start.ArgumentList.Add('-NoProfile')
    $start.ArgumentList.Add('-File')
    $start.ArgumentList.Add("$Fixture/scripts/build-windows.ps1")
    $start.Environment['PATH'] = "$Fixture/bin;$env:PATH"
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    $output = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -eq 0 -or $output -notmatch 'pnpm.*19') {
        throw "Build must stop and report pnpm's native exit code 19. Actual: $output"
    }
    Write-Host 'PASS: failing package install stops the build with its exit code.'

    . "$PSScriptRoot/common.ps1"
    $env:SIMBI_LAUNCH_TEST = 'parent'
    $child = Start-SimbiProcess -FilePath (Get-Command pwsh).Source -Arguments @('-NoProfile', '-Command', 'if ($env:SIMBI_LAUNCH_TEST -ne "child") { exit 9 }; Start-Sleep -Seconds 30') -Environment @{SIMBI_LAUNCH_TEST='child'}
    try {
        Start-Sleep -Milliseconds 400
        if ($env:SIMBI_LAUNCH_TEST -ne 'parent' -or $child.HasExited) { throw 'Child environment was not isolated.' }
        Stop-SimbiProcess $child
        if (-not $child.HasExited) { throw 'Owned process did not stop.' }
    } finally { Stop-SimbiProcess $child; Remove-Item Env:SIMBI_LAUNCH_TEST }
    Write-Host 'PASS: child-only environment and exact owned-process shutdown.'

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try {
        $blocked = $false
        try { Assert-SimbiPortAvailable -Port $listener.LocalEndpoint.Port } catch { $blocked = $true }
        if (-not $blocked) { throw 'An occupied application port was accepted.' }
        $occupiedStart = [Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
        foreach ($argument in @('-NoProfile', '-File', "$Fixture/scripts/start-ngrok.ps1", '-Port', "$($listener.LocalEndpoint.Port)", '-NoBrowser')) { $occupiedStart.ArgumentList.Add($argument) }
        $occupiedStart.RedirectStandardError = $true
        $occupiedProcess = [Diagnostics.Process]::Start($occupiedStart)
        $occupiedError = $occupiedProcess.StandardError.ReadToEnd()
        $occupiedProcess.WaitForExit()
        if ($occupiedProcess.ExitCode -eq 0 -or $occupiedError -notmatch 'already in use') { throw "Ngrok launcher did not reject the occupied port before dependency/start work: $occupiedError" }
    } finally { $listener.Stop() }
    Write-Host 'PASS: occupied ports are rejected before launch.'

    $tunnelFixture = Start-SimbiProcess (Get-Command pwsh).Source @('-NoProfile', '-Command', 'Write-Output ''{"msg":"started tunnel","addr":"http://127.0.0.1:9999","url":"https://unrelated.example"}''; Write-Output ''{"msg":"started tunnel","addr":"http://127.0.0.1:8123","url":"https://owned.example"}''; Start-Sleep -Seconds 30') -CaptureOutput
    try {
        $url = Get-SimbiTunnelUrl -Process $tunnelFixture -Upstream 'http://127.0.0.1:8123'
        if ($url -ne 'https://owned.example') { throw 'Tunnel discovery selected an unrelated upstream.' }
    } finally { Stop-SimbiProcess $tunnelFixture }
    Write-Host 'PASS: tunnel discovery reads the owned process and selects only its matching upstream.'

    $unrelated = Start-SimbiProcess (Get-Command pwsh).Source @('-NoProfile', '-Command', 'Start-Sleep -Seconds 30')
    $tree = Start-SimbiProcess (Get-Command pwsh).Source @('-NoProfile', '-Command', '$child = Start-Process (Get-Command pwsh).Source -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 30") -WindowStyle Hidden -PassThru; Write-Output $child.Id; Start-Sleep -Seconds 30') -CaptureOutput
    $grandchild = $null
    try {
        $grandchild = Get-Process -Id ([int]$tree.StandardOutput.ReadLine())
        Stop-SimbiProcess $tree
        if (-not $grandchild.WaitForExit(5000)) { throw 'Owned descendant survived process-tree cleanup.' }
        if ($unrelated.HasExited) { throw 'Cleanup stopped an unrelated process.' }
    } finally { Stop-SimbiProcess $tree; Stop-SimbiProcess $grandchild; Stop-SimbiProcess $unrelated }
    Write-Host 'PASS: owned descendant stopped while an unrelated process survived.'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($Fixture)
    if (-not $resolvedFixture.StartsWith([IO.Path]::GetTempPath()) -or (Split-Path $resolvedFixture -Leaf) -notlike 'simbi-launch-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
