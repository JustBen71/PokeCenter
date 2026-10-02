param([switch]$DisposableCi, [switch]$ClientE2E, [string]$Dotnet = 'dotnet', [string]$Python = 'python')
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -and !$DisposableCi) {
    throw 'Run in a disposable CI/VM. This harness must not depend on the maintainer PC. For an isolated VM, explicitly pass -DisposableCi.'
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $root '.runtime'
$artifacts = Join-Path $root 'artifacts/e2e'
New-Item -ItemType Directory -Force $artifacts | Out-Null
$process = $null
$oldToken = $env:POKERACE_BRIDGE_TOKEN
$oldPort = $env:POKERACE_BRIDGE_PORT
$oldLog = $env:POKERACE_BRIDGE_LOG
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class E2EWindows {
    public delegate bool Callback(IntPtr handle, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
    public static bool Close(uint pid) {
        // Process.CloseMainWindow excludes invisible windows. Address only the
        // verified EmuHawk main window of the process this harness launched.
        bool posted = false;
        EnumWindows((h, s) => {
            uint owner; GetWindowThreadProcessId(h, out owner);
            if (owner != pid) return true;
            var title = new StringBuilder(2048); GetWindowText(h, title, title.Capacity);
            if (!title.ToString().EndsWith(" - BizHawk", StringComparison.Ordinal)) return true;
            posted = PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE, normal application shutdown
            return !posted;
        }, IntPtr.Zero);
        return posted;
    }
    public static string[] Read(uint pid) {
        var lines = new List<string>();
        Callback read = (h, s) => { var text = new StringBuilder(2048); GetWindowText(h, text, text.Capacity); if(text.Length > 0) lines.Add(text.ToString()); return true; };
        EnumWindows((h, s) => { uint owner; GetWindowThreadProcessId(h, out owner); if(owner == pid) { read(h, s); EnumChildWindows(h, read, s); } return true; }, IntPtr.Zero);
        return lines.ToArray();
    }
}
'@
$stage = 'prepare'
try {
    & (Join-Path $PSScriptRoot 'prepare-bizhawk.ps1') -Destination $runtime
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bizhawk-version.json') -Destination $artifacts
    $stage = 'build'
    & $Dotnet restore (Join-Path $root 'Pokerace.BizHawkBridge.sln')
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
    & $Dotnet build (Join-Path $root 'Pokerace.BizHawkBridge.sln') --configuration Release --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $external = Join-Path $runtime 'ExternalTools'
    foreach ($name in @('Pokerace.BizHawkBridge.dll', 'Pokerace.BizHawkBridge.Core.dll')) {
        Copy-Item -LiteralPath (Join-Path $root "src/Pokerace.BizHawkBridge/bin/Release/net48/$name") -Destination $external -Force
    }
    $tool = [IO.Path]::GetFullPath((Join-Path $external 'Pokerace.BizHawkBridge.dll'))
    $rom = Join-Path $runtime 'pokerace-test.nes'
    & $Python (Join-Path $PSScriptRoot 'test-rom/build.py') $rom
    if ($LASTEXITCODE -ne 0) { throw 'ROM build failed.' }
    Get-FileHash -LiteralPath $rom -Algorithm SHA256 | ConvertTo-Json | Set-Content (Join-Path $artifacts 'rom-hash.json')
    # This trusts only the freshly built DLL in this throwaway configuration.
    # BizHawk 2.11.1 ExternalToolManager uses absolute filename and SHA512:UPPERCASEHEX.
    $trusted = @{}
    $trusted[$tool] = 'SHA512:' + (Get-FileHash -LiteralPath $tool -Algorithm SHA512).Hash
    $config = Join-Path $runtime 'e2e.config.json'
    # GitHub's disposable Windows runner is elevated. BizHawk otherwise opens
    # a modal privilege notice before constructing MainForm or loading our DLL.
    # Apply this only to the generated CI configuration, never a user's config.
    @{ LastWrittenFrom = '2.11.1'; FirstBoot = $false; SkipSuperuserPrivsCheck = $true; SkipOutdatedOsCheck = $true; DispMethod = 1; SoundEnabled = $false; SoundOutputMethod = 'Dummy'; TrustedExtTools = $trusted } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $config -Encoding utf8
    $fixture = Get-Content (Join-Path $PSScriptRoot 'test-config.json') -Raw | ConvertFrom-Json
    $env:POKERACE_BRIDGE_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    if ($env:GITHUB_ACTIONS -eq 'true') { Write-Host "::add-mask::$env:POKERACE_BRIDGE_TOKEN" }
    $portReservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $portReservation.Start()
    $env:POKERACE_BRIDGE_PORT = [string]$portReservation.LocalEndpoint.Port
    $portReservation.Stop()
    $env:POKERACE_BRIDGE_LOG = Join-Path $artifacts 'bridge.log'
    $stage = 'launch'
    $process = Start-Process -FilePath (Join-Path $runtime 'EmuHawk.exe') -WorkingDirectory $runtime -WindowStyle Hidden -PassThru `
        -ArgumentList @("--config=`"$config`"", '--open-ext-tool-dll=Pokerace.BizHawkBridge', "`"$rom`"") `
        -RedirectStandardOutput (Join-Path $artifacts 'bizhawk.stdout.log') -RedirectStandardError (Join-Path $artifacts 'bizhawk.stderr.log')
    $stage = 'wait-for-bridge-and-sentinel'
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    $lastReadinessError = ''
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) { throw "BizHawk exited before readiness (exit $($process.ExitCode))." }
        $client = [Net.Sockets.TcpClient]::new()
        try {
            if (!$client.ConnectAsync('127.0.0.1', [int]$env:POKERACE_BRIDGE_PORT).Wait(1000)) { throw 'Connection timeout.' }
            $stream = $client.GetStream()
            $stream.ReadTimeout = 3000; $stream.WriteTimeout = 3000
            $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false))
            $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
            $writer.AutoFlush = $true; $writer.NewLine = "`n"
            function Request($request) {
                $request.id = [Guid]::NewGuid().ToString('N')
                $writer.WriteLine(($request | ConvertTo-Json -Compress))
                $line = $reader.ReadLine()
                if ($null -eq $line) { throw 'Bridge disconnected.' }
                $response = $line | ConvertFrom-Json
                if (!$response.ok -or $response.id -ne $request.id) { throw 'Bridge response failed.' }
                return $response
            }
            $null = Request @{ type = 'hello'; protocolVersion = 1; sessionToken = $env:POKERACE_BRIDGE_TOKEN }
            $null = Request @{ type = 'ping' }
            $status = Request @{ type = 'getStatus' }
            if (!$status.gameLoaded) { throw 'Game not loaded yet.' }
            $system = Request @{ type = 'getSystem' }
            if ($system.systemId -ne $fixture.expectedSystemId) { throw 'Wrong system.' }
            Request @{ type = 'getGameInfo' } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $artifacts 'game.json')
            $domains = Request @{ type = 'listMemoryDomains' }
            $domains | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $artifacts 'domains.json')
            $address = [Convert]::ToInt64($fixture.testAddress.Substring(2), 16)
            $initial = Request @{ type = 'readMemory'; domain = $fixture.preferredDomain; address = $address; length = $fixture.initialBytes.Length / 2 }
            if ($initial.data -ne $fixture.initialBytes) { throw 'Sentinel not ready.' }
            $ready = $true
            break
        }
        catch {
            $lastReadinessError = $_.Exception.Message
            Start-Sleep -Milliseconds 200
        }
        finally { $client.Dispose() }
    }
    if (!$ready) { throw "Bridge/sentinel readiness timeout: $lastReadinessError" }
    Start-Sleep -Milliseconds 250
    $stage = 'doctor-write-read-restore'
    $cli = Join-Path $root 'tools/Pokerace.BizHawkBridge.Cli/bin/Release/net8.0/Pokerace.BizHawkBridge.Cli.dll'
    & $Dotnet $cli doctor --port $env:POKERACE_BRIDGE_PORT --domain $fixture.preferredDomain --address $fixture.testAddress `
        --expect $fixture.initialBytes --data $fixture.writeBytes --write-test 2>&1 | Tee-Object -FilePath (Join-Path $artifacts 'doctor.log')
    if ($LASTEXITCODE -ne 0) { throw 'Doctor failed to verify write/read-back/restore.' }
    if ($ClientE2E) {
        $stage = 'server-client-bridge-read-write-restore'
        $repo = [IO.Path]::GetFullPath((Join-Path $root '../..'))
        $project = Join-Path $repo 'native/Pokerace.Client/src/Pokerace.Client/Pokerace.Client.csproj'
        & $Dotnet build $project --configuration Release
        if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }
        & node --import tsx (Join-Path $repo 'native/Pokerace.Client/tools/e2e-client.mjs') $Dotnet 2>&1 |
            Tee-Object -FilePath (Join-Path $artifacts 'client-e2e.log')
        if ($LASTEXITCODE -ne 0) { throw 'Client E2E failed.' }
    }
    $stage = 'close'
    if (![E2EWindows]::Close($process.Id) -or !$process.WaitForExit(10000)) { throw 'BizHawk did not shut down cleanly.' }
    if ($process.ExitCode -ne 0) { throw "BizHawk exit code $($process.ExitCode)." }
    'E2E_BIZHAWK_VERIFIED: real DLL + homebrew + read/write/read-back/restore + clean exit' | Set-Content (Join-Path $artifacts 'result.txt')
    Write-Host 'E2E_BIZHAWK_VERIFIED'
}
catch {
    "FAILED stage=$stage : $($_.Exception.Message)" | Set-Content (Join-Path $artifacts 'result.txt')
    # Diagnostics from this disposable runner only, before closing any dialog.
    if ($null -ne $process -and !$process.HasExited) {

        [E2EWindows]::Read($process.Id) | Set-Content (Join-Path $artifacts 'windows.txt')
        Get-Content (Join-Path $artifacts 'windows.txt') | Write-Host
    }
    throw
}
finally {
    if ($null -ne $process) {
        if (!$process.HasExited) { $null = [E2EWindows]::Close($process.Id); if (!$process.WaitForExit(5000)) { $process.Kill() } }
        $process.Dispose()
    }
    $env:POKERACE_BRIDGE_TOKEN = $oldToken
    $env:POKERACE_BRIDGE_PORT = $oldPort
    $env:POKERACE_BRIDGE_LOG = $oldLog
}
