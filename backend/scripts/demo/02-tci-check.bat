@echo off
chcp 65001 >nul
title Demo - 02-tci-check
cd /d "%~dp0..\.."
node "scripts\demo\02-tci-check.js" %*
echo.
pause
