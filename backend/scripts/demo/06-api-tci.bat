@echo off
chcp 65001 >nul
title Demo - 06-api-tci
cd /d "%~dp0..\.."
node "scripts\demo\06-api-tci.js" %*
echo.
pause
