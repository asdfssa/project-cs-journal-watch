@echo off
chcp 65001 >nul
title Demo - 04-scopus-key-rotation
cd /d "%~dp0..\.."
node "scripts\demo\04-scopus-key-rotation.js" %*
echo.
pause
