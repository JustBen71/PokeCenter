# Windows counterpart of release-check.sh. Usage: powershell -File tools/release-check.ps1 v0.2.7 [-VersionOnly]
# Stops at the first failure with a non-zero exit code.
param([Parameter(Mandatory = $true)][string]$Tag, [switch]$VersionOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
function Fail($message) { Write-Host "✖ $message" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$arguments) {
    Write-Host "› $exe $($arguments -join ' ')"
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { Fail "$exe $($arguments -join ' ') (code $LASTEXITCODE)" }
}
if ($Tag -notmatch '^v\d+\.\d+\.\d+$') { Fail "tag invalide : $Tag (attendu vX.Y.Z)" }
$version = $Tag.Substring(1)
$csproj = [regex]::Match((Get-Content -Raw 'native/Pokerace.Client/src/Pokerace.Client/Pokerace.Client.csproj'), '<Version>([^<]*)</Version>').Groups[1].Value
$protocol = [regex]::Match((Get-Content -Raw 'native/Pokerace.Client/src/Pokerace.Client/Server/ServerProtocol.cs'), 'ClientVersion = "([^"]*)"').Groups[1].Value
if ($csproj -ne $version) { Fail "Pokerace.Client.csproj <Version> = '$csproj', tag = $Tag" }
if ($protocol -ne $version) { Fail "ServerProtocol.ClientVersion = '$protocol', tag = $Tag" }
if (-not (Test-Path "docs/releases/$Tag.md") -or (Get-Item "docs/releases/$Tag.md").Length -eq 0) { Fail "notes de version manquantes : docs/releases/$Tag.md" }
Write-Host "✔ version $version cohérente (tag, csproj, protocole, notes)"
if ($VersionOnly) { exit 0 }

Run npm @('ci')
Run npm @('run', 'build')
Run npm @('run', 'typecheck')
Run npm @('test')
Run npx @('playwright', 'install', 'chromium')
$env:CI = 'true'
Run npm @('run', 'test:e2e', '-w', '@pokerace/web')
Run dotnet @('test', 'native/Pokerace.Client/Pokerace.Client.sln', '--configuration', 'Release')
Run dotnet @('test', 'bridges/bizhawk/tests/Pokerace.BizHawkBridge.Tests/Pokerace.BizHawkBridge.Tests.csproj', '--configuration', 'Release')
# The real launcher build (bridge against the pinned BizHawk, bundled), then the binary must start.
Run powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'native/Pokerace.Client/tools/build-launcher.ps1')
$exe = Get-ChildItem 'native/Pokerace.Client/artifacts' -Recurse -Filter 'Pokerace.Client.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { Fail 'lanceur Windows introuvable après build-launcher.ps1' }
Run $exe.FullName @('--help')
Write-Host "✔ $Tag : vérifications Windows vertes (E2E BizHawk : bridges/bizhawk/e2e/run-e2e.ps1 -ClientE2E)"
