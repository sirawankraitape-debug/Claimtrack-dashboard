@echo off
chcp 65001 >nul
title ClaimTrack Server
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║         ClaimTrack - เริ่มต้น Server          ║
echo  ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0server"

:: ตรวจสอบ Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [!] ไม่พบ Node.js — กรุณาติดตั้งจาก:
    echo      https://nodejs.org/download
    echo.
    pause
    exit /b 1
)

:: ติดตั้ง dependencies ครั้งแรก
if not exist node_modules (
    echo  [*] กำลังติดตั้ง dependencies (ครั้งแรกใช้เวลาสักครู่)...
    echo.
    npm install
    if errorlevel 1 (
        echo.
        echo  [!] ติดตั้งไม่สำเร็จ กรุณาลองใหม่
        pause
        exit /b 1
    )
    echo.
)

echo  [*] กำลังเริ่ม Server (SQLite mode — ไม่ต้องตั้งค่าอะไรเพิ่ม)
echo  [*] เปิดเบราว์เซอร์ที่: http://localhost:3000
echo  [*] เพื่อนร่วมงานใช้ IP ของเครื่องนี้แทน localhost
echo.

:: เปิดเบราว์เซอร์หลัง server เริ่มได้ 2 วินาที
start "" /b cmd /c "timeout /t 2 >nul && start http://localhost:3000"

node server.js
echo.
echo  Server หยุดทำงานแล้ว
pause
