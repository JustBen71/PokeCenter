$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root '.player-runtime\mgba-portable'
$Staging = Join-Path $Runtime ([Guid]::NewGuid().ToString('N'))
$Url = 'https://s3.amazonaws.com/mgba/mGBA-build-latest-win64.7z'
New-Item -ItemType Directory -Force $Staging | Out-Null
$Archive = Join-Path $Staging 'mgba.7z'
Write-Host 'Téléchargement de mGBA portable officiel (version de développement avec --script)...'
Invoke-WebRequest -Uri $Url -OutFile $Archive
$Entries = & tar.exe -tf $Archive
if ($LASTEXITCODE -ne 0) { throw "Impossible de lire l'archive mGBA (tar.exe requis)." }
foreach ($Entry in $Entries) {
    if ($Entry -match '(^[/\\])|(^[A-Za-z]:)|((^|[/\\])\.\.([/\\]|$))') { throw 'Chemin invalide dans cette archive.' }
}
& tar.exe -xf $Archive -C $Staging
if ($LASTEXITCODE -ne 0) { throw "Extraction de mGBA impossible." }
$Executables = @(Get-ChildItem -LiteralPath $Staging -Filter 'mGBA.exe' -File -Recurse)
if ($Executables.Count -ne 1) { throw 'Exécutable mGBA absent ou ambigu.' }
$Executable = $Executables[0].FullName
# These options exit before creating the Qt application or any game window.
$HelpText = (& $Executable --help 2>&1 | Out-String)
if ($HelpText -notmatch '--script\s') { throw 'Cette version ne prend pas en charge le chargement Lua direct.' }
$Version = (& $Executable --version 2>&1 | Out-String).Trim()
$Config = Join-Path $Root 'deploy\player\player.env'
$Lines = if (Test-Path -LiteralPath $Config) { @(Get-Content -LiteralPath $Config) } else { @() }
$Lines = @($Lines | Where-Object { $_ -notmatch '^\s*MGBA_PATH=' }) + "MGBA_PATH=$Executable"
[System.IO.File]::WriteAllLines($Config, $Lines, (New-Object System.Text.UTF8Encoding $false))
@{source=$Url;sha256=(Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash;version=$Version;executable=$Executable} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Runtime 'installed.json') -Encoding UTF8
Write-Host "mGBA portable configure. Votre installation existante reste inchangee. Relancez player.cmd."
