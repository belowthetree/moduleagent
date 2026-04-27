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

if "%~1"=="" (
    echo ModuleAgent - modular agent framework
    echo.
    echo   module-agent gui         Start graphical interface
    echo   module-agent [command]   CLI mode
    echo.
    echo   CLI commands: init scan tree workspace serve
    goto :eof
)

if /i "%~1"=="gui" (
    echo Building and launching GUI...
    call npm run build:electron --silent
    if errorlevel 1 exit /b 1

    if exist "%ROOT%\node_modules\electron\dist\electron.exe" (
        call "%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%"
        goto :eof
    )

    echo.
    echo Electron binary not found. To install:
    echo   node node_modules/electron/install.js
    echo.
    exit /b 1
)

npx tsx "%ROOT%\src\cli\main.ts" %*
