@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

if not exist "node_modules\" (
    echo [ModuleAgent] Installing dependencies...
    call npm install --silent
    if errorlevel 1 (
        echo [ModuleAgent] Failed to install dependencies
        exit /b 1
    )
)

npx tsx "%SCRIPT_DIR%src/cli/main.ts" %*
