# Issues

## [2026-05-06] Bug: Empty .module-agent.json doesn't trigger setup screen

**Root cause**: `main.ts` only called `loadFromLocalStorage()` at startup, which restores a cached `projectPath` from localStorage. If localStorage had a stale value from a previous session but `.module-agent.json` was later deleted/emptied, the router guard saw a truthy `projectPath` and skipped `/setup`. MainView then loaded with broken config.

**Fix**: Added config file validation in `main.ts` after `loadFromLocalStorage()`:
- If `projectPath` is set, calls `loadFromProject(projectPath)` to read `.module-agent.json`
- If ConfigLoader returns defaults (`projectPath: '.'`), clears `projectPath` → router redirects to `/setup`
- If load throws, catches and clears → router redirects
- If config is valid, proceeds normally

**Files changed**: `src/renderer/src/main.ts` (+16 lines, lines 24-39)
