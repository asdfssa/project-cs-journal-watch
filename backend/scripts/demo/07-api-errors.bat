@echo off
chcp 65001 >nul
title Demo - 07-api-errors
cd /d "%~dp0..\.."
node "scripts\demo\07-api-errors.js" %*
echo.
pause
