@echo off
setlocal enableextensions
title mpScroll Workshop
cd /d "%~dp0"

echo.
echo   mpScroll startet ...
echo   Suche Node.js ...

set "NODE_EXE="

REM --- 0) Mitgeliefertes Node bevorzugen (Paket ohne Installation) ---
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if defined NODE_EXE goto :run

REM --- 1) Node ueber den PATH ---
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"

REM --- 2) Bekannte Installationsorte direkt pruefen ---
REM     (findet Node auch, wenn der PATH nach der Installation noch nicht
REM      aktualisiert ist - also OHNE Neustart)
call :try "%ProgramFiles%\nodejs\node.exe"
call :try "%ProgramW6432%\nodejs\node.exe"
call :try "%ProgramFiles(x86)%\nodejs\node.exe"
call :try "%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NVM_SYMLINK call :try "%NVM_SYMLINK%\node.exe"
call :try "%ProgramData%\chocolatey\bin\node.exe"
call :try "%USERPROFILE%\scoop\shims\node.exe"
call :try "%USERPROFILE%\scoop\apps\nodejs\current\node.exe"
call :try "%LOCALAPPDATA%\Volta\bin\node.exe"

if defined NODE_EXE goto :run

REM --- 3) Nicht gefunden -> optional automatisch installieren ---
echo.
echo   Node.js ist noch nicht installiert.
where winget >nul 2>&1 || goto :manual
echo   Es kann jetzt automatisch installiert werden (dauert 1-2 Minuten).
set "ANTWORT="
set /p "ANTWORT=   Jetzt installieren? (J = Ja):  "
if /i not "%ANTWORT%"=="J" goto :manual
echo.
echo   Installiere Node.js ... eine eventuelle Windows-Abfrage bitte mit "Ja" bestaetigen.
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
call :try "%ProgramFiles%\nodejs\node.exe"
call :try "%ProgramW6432%\nodejs\node.exe"
if defined NODE_EXE goto :run

:manual
echo.
echo   Node.js konnte nicht gefunden/installiert werden.
echo   Bitte einmal manuell installieren:  https://nodejs.org   ^(gruener LTS-Knopf^)
echo   Danach dieses Fenster schliessen und STARTEN-WINDOWS erneut doppelklicken.
echo.
pause
exit /b 1

:run
echo   Node gefunden: %NODE_EXE%
echo.
"%NODE_EXE%" server.mjs
echo.
echo   (Server beendet.)
pause
exit /b 0

:try
if not defined NODE_EXE if exist "%~1" set "NODE_EXE=%~1"
goto :eof
