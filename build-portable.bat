@echo off
REM ----- RSS Video Monitor: Portable Build Batch -----
REM Place this file in your project root directory.

chcp 65001 >nul
cd /d "%~dp0"

REM Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Please run this script AS ADMINISTRATOR!
    pause
    exit /b 1
)

echo [1/2] Installing dependencies: npm install
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)

echo [2/2] Building Windows portable: npm run build:win
call npm run build:win
if %errorlevel% neq 0 (
    echo [ERROR] npm run build:win failed!
    pause
    exit /b 1
)

echo.
echo ================================================
echo           BUILD FINISHED SUCCESSFULLY!
echo Your portable EXE is in: dist\win-unpacked\
echo Your ZIP is in: dist\RSS视频监控-v1.0.0-portable.zip
echo ================================================
pause
exit /b 0