@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR%"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"

echo =========================================
echo   ModuleAgent - Release Build
echo =========================================
echo.

REM -- Check Node.js --
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is required
    exit /b 1
)

REM -- Install dependencies --
if not exist "node_modules\" (
    echo.
    echo [1/4] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        exit /b 1
    )
) else (
    echo [1/4] node_modules exists, skip install
)

REM -- Build Electron --
echo.
echo [2/4] Building Electron bundle...
call npm run build:electron
if errorlevel 1 (
    echo [ERROR] Build failed
    exit /b 1
)

REM -- Package with electron-builder --
echo.
echo [3/4] Packaging portable exe...
call npx electron-builder build --win portable
if errorlevel 1 (
    echo [ERROR] Packaging failed
    exit /b 1
)

REM -- Done --
echo.
echo [4/4] Done!
echo.
echo Output: %ROOT%\release\
dir /b "%ROOT%\release\*.exe" 2>nul
echo.

exit /b 0
