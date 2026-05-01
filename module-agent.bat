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
goto :eof

:tui
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install --silent
    if errorlevel 1 exit /b 1
)

echo Building ModuleAgent CLI...
call npm run build:cli --silent
if errorlevel 1 exit /b 1

if "%PROJECT%"=="" (
    echo Starting TUI - auto-detecting project...
    echo.
    node "%ROOT%\dist\cli.cjs" tui
) else (
    echo Starting TUI - project: %PROJECT%...
    echo.
    node "%ROOT%\dist\cli.cjs" tui --project "%PROJECT%"
)
goto :eof

:cli
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install --silent
    if errorlevel 1 exit /b 1
)

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
