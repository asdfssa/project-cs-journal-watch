@echo off
chcp 65001 >nul
title Journal Watch Backend
cd /d "%~dp0"

rem 1) ติดตั้งแพ็กเกจครั้งแรก
if not exist node_modules (
  echo [1/2] ติดตั้งแพ็กเกจ ^(npm install^)...
  call npm install
)

rem 2) เริ่ม backend (ปิดด้วย Ctrl+C) — ต้องเปิด DB ไว้เองก่อน
echo [2/2] เริ่ม backend ที่ http://localhost:3001
call npm start

echo.
echo backend หยุดทำงานแล้ว ^(ดูข้อความด้านบนว่าเกิดอะไรขึ้น^)
pause
