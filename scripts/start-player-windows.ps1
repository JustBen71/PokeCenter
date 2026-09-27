$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv-player\Scripts\python.exe"
if (-not (Test-Path $Python)) { & (Join-Path $PSScriptRoot "setup-player-windows.ps1") }
& $Python (Join-Path $Root "apps\agent\player_client.py") @args
exit $LASTEXITCODE
