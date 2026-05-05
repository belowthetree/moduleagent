@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR%"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"

set "MODE=%1"
set "PROJECT=%2"

if "%MODE%"=="--help" goto :usage
if "%MODE%"=="-h" goto :usage
if "%MODE%"=="tui" goto :tui
if "%MODE%"=="list" goto :cli
if "%MODE%"=="get" goto :cli
if "%MODE%"=="serve" goto :cli
if "%MODE%"=="" goto :gui

echo Unknown option: %MODE%
goto :usage

:gui
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install --silent
) else if not exist "node_modules\electron-vite\" (
    echo New dependencies detected — reinstalling...
    call npm install --silent
)
if errorlevel 1 exit /b 1

echo Building and launching ModuleAgent GUI...
call npm run build:electron --silent
if errorlevel 1 exit /b 1

if exist "%ROOT%\node_modules\electron\dist\electron.exe" (
    call "%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%"
) else (
    echo Electron binary not found. Run: node node_modules/electron/install.js
    exit /b 1
)
goto :eof

:tui
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install --silent
) else if not exist "node_modules\electron-vite\" (
    echo New dependencies detected — reinstalling...
    call npm install --silent
)
if errorlevel 1 exit /b 1

where bun >nul 2>nul
if errorlevel 1 (
    echo Error: Bun is required for TUI mode. Install it from https://bun.sh
    exit /b 1
)

REM Set UTF-8 encoding for proper ANSI/VT rendering
chcp 65001 >nul 2>nul

REM @opentui/core uses OS-filtered optionalDependencies. On shared
REM WSL/Windows node_modules, install the missing platform package.
for /f "tokens=*" %%i in ('bun -e "process.stdout.write('@opentui/core-' + process.platform + '-' + process.arch)"') do set "PLATFORM_PKG=%%i"
if not exist "%ROOT%\node_modules\!PLATFORM_PKG!\" (
    echo Installing !PLATFORM_PKG! for current platform...
    bun add !PLATFORM_PKG!@0.2.2 --optional
)

if "%PROJECT%"=="" (
    echo Starting TUI - auto-detecting project...
    echo.
    bun run --cwd "%ROOT%\src\tui" "%ROOT%\src\cli\tui-entry.ts" --project "%ROOT%"
) else (
    echo Starting TUI - project: %PROJECT%...
    echo.
    bun run --cwd "%ROOT%\src\tui" "%ROOT%\src\cli\tui-entry.ts" --project "%PROJECT%"
)
goto :eof

:cli
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install --silent
) else if not exist "node_modules\electron-vite\" (
    echo New dependencies detected — reinstalling...
    call npm install --silent
)
if errorlevel 1 exit /b 1

call npm run build:cli --silent
if errorlevel 1 exit /b 1

if "%MODE%"=="get" (
    set "MODULE_NAME=%2"
    set "PROJ=%3"
    if "%PROJ%"=="" (
        node "%ROOT%\dist\cli.cjs" get !MODULE_NAME!
    ) else (
        node "%ROOT%\dist\cli.cjs" get !MODULE_NAME! --project "!PROJ!"
    )
) else (
    if "%PROJECT%"=="" (
        node "%ROOT%\dist\cli.cjs" %MODE%
    ) else (
        node "%ROOT%\dist\cli.cjs" %MODE% --project "%PROJECT%"
    )
)
goto :eof

:usage
echo ModuleAgent Launcher
echo.
echo Usage:
echo   module-agent.bat                    Launch GUI (default)
echo   module-agent.bat tui [project]      Start TUI mode
echo   module-agent.bat list [project]     List all modules (JSON)
echo   module-agent.bat get ^<name^> [project] Get module details (JSON)
echo   module-agent.bat serve [project]    Stdio NDJSON server
echo.
echo If project-path is omitted, current directory is used.
echo.
goto :eof
