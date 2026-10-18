@echo off
chcp 65001 >nul
title Demo - 05-api-scopus
cd /d "%~dp0..\.."
node "scripts\demo\05-api-scopus.js" %*
echo.
pause
