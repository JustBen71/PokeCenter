$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Config = Join-Path $Root "deploy\player\player.env"
$Python = Join-Path $Root ".venv-player\Scripts\python.exe"

if (-not (Test-Path $Python)) { throw "Exécutez d’abord scripts\setup-player-windows.ps1." }
if (-not (Test-Path $Config)) { throw "Copiez deploy\player\player.env.example vers player.env et renseignez-le." }

Get-Content $Config | ForEach-Object {
    $Line = $_.Trim()
    if ($Line -and -not $Line.StartsWith("#")) {
        $Parts = $Line.Split("=", 2)
        if ($Parts.Count -eq 2) { Set-Item -Path "Env:$($Parts[0].Trim())" -Value $Parts[1].Trim() }
    }
}

foreach ($Name in "SERVER_URL", "PLAYER_ID", "PLAYER_TOKEN", "ROM_PATH") {
    if (-not (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value) { throw "$Name manque dans player.env." }
}

$env:LUA_HOST = "127.0.0.1"
$env:LUA_PORT = "8765"
$env:EXTRACTOR_HOST = "127.0.0.1"
$env:EXTRACTOR_PORT = "8765"
$env:ROM_MANIFEST_PATH = Join-Path $Root "emulator\profiles\rom-manifest.json"

$Detector = $null
if ($env:EXTRACTOR_MODE -ne "lua") {
    $Detector = Start-Process -FilePath $Python -ArgumentList @((Join-Path $Root "emulator\profile_detector.py")) -PassThru -NoNewWindow
}
try {
    if ($env:MGBA_PATH -and (Test-Path $env:MGBA_PATH)) {
        if (-not (Get-Process mGBA -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $env:MGBA_PATH -ArgumentList @($env:ROM_PATH)
        }
    } else {
        Write-Warning "mGBA n’a pas été lancé automatiquement. Ouvrez la ROM dans mGBA sous Windows."
    }
    & $Python (Join-Path $Root "apps\agent\agent.py")
} finally {
    if ($Detector) { Stop-Process -Id $Detector.Id -ErrorAction SilentlyContinue }
}
