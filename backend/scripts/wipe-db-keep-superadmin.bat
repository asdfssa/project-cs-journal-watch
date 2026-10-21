@echo off
chcp 65001 >nul
title Wipe DB (เก็บเฉพาะ SuperAdmin)
cd /d "%~dp0.."
node "scripts\wipe-db-keep-superadmin.js" %*
echo.
pause
