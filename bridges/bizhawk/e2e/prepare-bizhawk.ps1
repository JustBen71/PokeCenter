param([string]$Destination = (Join-Path $PSScriptRoot '../.runtime'))
$ErrorActionPreference = 'Stop'
$pin = Get-Content (Join-Path $PSScriptRoot 'bizhawk-version.json') -Raw | ConvertFrom-Json
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force $Destination | Out-Null
$archive = Join-Path $Destination 'bizhawk.zip'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -UseBasicParsing -Uri $pin.downloadUrl -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sha256) {
    throw 'BizHawk SHA-256 mismatch; discard the archive and investigate the download.'
}
# Always extract verified bytes, rather than trusting a pre-existing executable.
Expand-Archive -LiteralPath $archive -DestinationPath $Destination -Force
Write-Host "BizHawk $($pin.version) verified: $($pin.sha256)"
