## Task 29: Update src/main/index.ts for electron-vite dual-mode

### Changes Made
- Removed `import { context as esbuildContext } from 'esbuild'` (line 6)
- Removed `getResourcePath()` helper (dead code after edits)
- Updated `createWindow()`: preload path → `path.join(__dirname, '../preload/index.mjs')`, dual-mode dev/prod
- Removed `setupDevHotReload()` call from `app.whenReady()`
- Removed `setupDevHotReload` function, `reloadTimer` variable, `debounceReload` function (22 lines)
- Kept `import fs from 'fs'` — still used by `config:save` (`fs.promises.writeFile`) and `window-all-closed` (`fs.unlinkSync`)

### Verification
- `npx tsc --noEmit` — zero errors from `src/main/index.ts`
- All other errors are pre-existing in `src/tui/` (JSX types) and `src/agents/` (TS6305 build output)
- `Menu.setApplicationMenu(null)` preserved, all IPC handlers unchanged, BrowserWindow config unchanged
