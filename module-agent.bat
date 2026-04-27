@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR%"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install --silent
    if errorlevel 1 exit /b 1
)

echo Building and launching ModuleAgent GUI...
call npm run build:electron --silent
if errorlevel 1 exit /b 1

if exist "%ROOT%\node_modules\electron\dist\electron.exe" (
    call "%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%"
) else (
    echo Electron binary not found. Run: node node_modules/electron/install.js
    exit /b 1
)
