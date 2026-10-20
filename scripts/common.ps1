#Requires -Version 7.2

function Invoke-SimbiNative {
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$Arguments = @())
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE." }
}

function Assert-SimbiPortAvailable {
    param([Parameter(Mandatory)][ValidateRange(1024, 65535)][int]$Port)
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    $probe.Server.ExclusiveAddressUse = $true
    try { $probe.Start() } catch { throw "Port $Port is already in use. Nothing was exposed or stopped." }
    finally { $probe.Stop() }
}

function Start-SimbiProcess {
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$Arguments = @(), [string]$WorkingDirectory = $PWD.Path, [hashtable]$Environment = @{}, [switch]$CaptureOutput)
    $start = [Diagnostics.ProcessStartInfo]::new($FilePath)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WorkingDirectory = $WorkingDirectory
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    foreach ($entry in $Environment.GetEnumerator()) { $start.Environment[$entry.Key] = $entry.Value }
    if ($CaptureOutput) { $start.RedirectStandardOutput = $true }
    return [Diagnostics.Process]::Start($start)
}

function Stop-SimbiProcess {
    param($Process)
    if ($Process -and -not $Process.HasExited) {
        # A retained process handle, not a name/PID search, limits cleanup to our process tree.
        try { $Process.Kill($true) }
        catch [System.InvalidOperationException] { if (-not $Process.HasExited) { throw } }
        if (-not $Process.WaitForExit(10000)) { throw "Owned process $($Process.Id) did not stop." }
    }
}
