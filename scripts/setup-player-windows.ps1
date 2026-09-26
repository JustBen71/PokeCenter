$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root ".venv-player"

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python 3.12 est requis. Installez-le depuis python.org en activant le lanceur 'py'."
}

& py -3.12 -m venv $Venv
$Python = Join-Path $Venv "Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -r (Join-Path $Root "apps\agent\requirements.txt")

$Config = Join-Path $Root "deploy\player\player.env"
if (-not (Test-Path $Config)) {
    Copy-Item (Join-Path $Root "deploy\player\player.env.example") $Config
}

Write-Host "Installation terminée. Renseignez deploy\player\player.env puis lancez scripts\start-player-windows.ps1."

