$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root ".venv-player"

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python 3.12 est requis. Installez-le depuis python.org en activant le lanceur 'py'."
}

& py -3.12 -m venv $Venv
if ($LASTEXITCODE -ne 0) { throw "Impossible de créer l'environnement Python 3.12." }
$Python = Join-Path $Venv "Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -r (Join-Path $Root "apps\agent\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "L'installation des dépendances a échoué." }

$Config = Join-Path $Root "deploy\player\player.env"
if (-not (Test-Path $Config)) {
    Copy-Item (Join-Path $Root "deploy\player\player.env.example") $Config
}

Write-Host "Installation terminée. Lancez player.cmd : il demandera votre pseudo et le code du salon."

