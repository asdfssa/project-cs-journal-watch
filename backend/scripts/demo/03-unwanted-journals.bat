@echo off
chcp 65001 >nul
title Demo - 03-unwanted-journals
cd /d "%~dp0..\.."
node "scripts\demo\03-unwanted-journals.js" %*
echo.
pause
