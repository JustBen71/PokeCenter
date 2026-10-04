@echo off
setlocal
set "POKERACE_EXE=%~dp0native\Pokerace.Client\artifacts\launcher-win-x64\Pokerace.Client.exe"
if not exist "%POKERACE_EXE%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0native\Pokerace.Client\tools\build-launcher.ps1"
  if errorlevel 1 goto failed
)
rem Port du serveur : demande a chaque lancement (Entree = conserver),
rem ou donne directement : pokerace.cmd 3000   ou   pokerace.cmd --port 3000
set "POKERACE_ARGS=%*"
echo %~1| findstr /r "^[0-9][0-9]*$" >nul && set "POKERACE_ARGS=--port %*"
"%POKERACE_EXE%" play %POKERACE_ARGS%
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Le lancement a echoue. Consultez le message ci-dessus.
pause
exit /b 1
