@echo off
title ClaimTrack Server
set "NODE_DIR=D:\DATA\Desktop\node-v24.16.0-win-x64"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CLI=%NODE_DIR%\node_modules\npm\bin\npm-cli.js"
set PATH=%NODE_DIR%;%PATH%

cd /d "%~dp0server"

if not exist "%NODE_EXE%" (
    echo ERROR: node.exe not found at %NODE_EXE%
    pause
    exit /b 1
)

:: Fix npm if broken
if not exist "%NPM_CLI%" (
    echo Fixing npm... please wait...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$tmp='%TEMP%\npm_fix';" ^
        "if(Test-Path $tmp){Remove-Item $tmp -Recurse -Force};" ^
        "New-Item -ItemType Directory -Path $tmp | Out-Null;" ^
        "Invoke-WebRequest -Uri 'https://registry.npmjs.org/npm/-/npm-10.9.2.tgz' -OutFile \"$tmp\npm.tgz\" -UseBasicParsing;" ^
        "tar -xzf \"$tmp\npm.tgz\" -C $tmp;" ^
        "$dest='%NODE_DIR%\node_modules\npm';" ^
        "if(Test-Path $dest){Remove-Item $dest -Recurse -Force};" ^
        "Move-Item \"$tmp\package\" $dest;" ^
        "Remove-Item $tmp -Recurse -Force"
    if errorlevel 1 (
        echo Failed to fix npm. Check internet connection.
        pause
        exit /b 1
    )
    echo npm fixed.
)

:: Clean install if better-sqlite3 missing
if exist node_modules (
    if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
        echo Removing old node_modules...
        rmdir /s /q node_modules
    )
)

:: Install all dependencies
if not exist node_modules (
    echo Installing dependencies...
    "%NODE_EXE%" "%NPM_CLI%" install
    if errorlevel 1 (
        echo Install failed.
        pause
        exit /b 1
    )
)

echo Starting ClaimTrack Server...
echo Open browser: http://localhost:3000
echo.
start "" /b cmd /c "timeout /t 2 >nul && start http://localhost:3000"
"%NODE_EXE%" server.js
echo.
echo Server stopped.
pause
