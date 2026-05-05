# Learnings: Fix launcher dependency check

## Pattern applied
When checking for installed deps in launcher scripts, check for a specific key dependency (electron-vite) in addition to the node_modules directory existing. This catches the case where npm install was run before new deps were added to package.json.

## Files modified
- `module-agent.bat` — three sections: `:gui`, `:tui`, `:cli`
- `module-agent.sh` — three functions: `gui()`, `tui()`, `cli()`

## Key dependency chosen
`electron-vite` — a new dev dependency from the migration that won't exist in stale node_modules. Any single key dep would work; electron-vite is a good sentinel because:
1. It was not present before the migration
2. It's required for the build step
3. Its directory reliably appears at `node_modules/electron-vite/` after install

## .bat pattern
```bat
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install --silent
) else if not exist "node_modules\electron-vite\" (
    echo New dependencies detected — reinstalling...
    call npm install --silent
)
if errorlevel 1 exit /b 1
```

## .sh pattern
```bash
if [ ! -d "node_modules" ] || [ ! -d "node_modules/electron-vite" ]; then
    echo "Installing dependencies..."
    npm install --silent || exit 1
fi
```
