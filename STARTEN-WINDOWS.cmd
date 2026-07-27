@echo off
title mpScroll Workshop
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte zuerst Node.js 22 oder neuer installieren.
  pause
  exit /b 1
)
node server.mjs
pause
