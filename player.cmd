@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
if not exist ".venv-player\Scripts\python.exe" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-player-windows.ps1"
  if errorlevel 1 goto failed
)
".venv-player\Scripts\python.exe" "apps\agent\player_client.py" %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo Le client n'a pas pu demarrer. Consultez le message ci-dessus.
pause
exit /b 1
