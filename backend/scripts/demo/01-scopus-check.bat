@echo off
chcp 65001 >nul
title Demo - 01-scopus-check
cd /d "%~dp0..\.."
node "scripts\demo\01-scopus-check.js" %*
echo.
pause
