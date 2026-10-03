@echo off
setlocal
set "POKERACE_EXE=%~dp0native\Pokerace.Client\artifacts\launcher-win-x64\Pokerace.Client.exe"
if not exist "%POKERACE_EXE%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0native\Pokerace.Client\tools\build-launcher.ps1"
  if errorlevel 1 goto failed
)
"%POKERACE_EXE%" play %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Le lancement a echoue. Consultez le message ci-dessus.
pause
exit /b 1
