
## Task 28: electron.vite.config.ts — Create electron-vite build configuration

### Created
- `electron.vite.config.ts` at project root with three config sections:
  - **main**: CJS output to `out/main`, externalizes 10 native Node/Electron deps, alias `@` → `src`
  - **preload**: output to `out/preload`, `externalizeDeps: false`, `isolatedEntries: true` (sandbox), only externalizes `electron`
  - **renderer**: output to `out/renderer`, `@vitejs/plugin-vue`, alias `@` → `src/renderer/src`, dev port 5173

### Pre-existing issues fixed during implementation
- Fixed 13 broken import paths in `src/main/index.ts`: `'../src/...'` → `'../...'` (extra `src/` in relative paths from migrated `src/main/` location)

### Build environment quirks (NOT config issues)
- **electron-vite `isolatedEntries` bug**: `process.stdout.moveCursor` is called unconditionally, crashes in non-TTY environments. Workaround: polyfill with `--require`.
- **`@vitejs/plugin-vue` v6 requires Node 22+** (`crypto.hash()` added in 22.12.0). Current env: Node 18. Workaround: polyfill `crypto.hash` as `createHash().digest()`.
- Full build succeeds: main (59.79 kB CJS) + preload (1.61 kB ESM) + renderer (CSS + JS + HTML)

### Verification
```bash
NODE_OPTIONS="--require /tmp/patch-stdout.cjs" npx electron-vite build
# → out/main/index.cjs, out/preload/index.mjs, out/renderer/index.html
```

## Task 33: Full Build Verification

### Fixes applied
- **electron-vite `clearLine` bug**: Patched `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js` — added `if (!process.stdout.isTTY) return;` early-exit to `clearLine()`. Simpler than the previous `--require` polyfill approach.
- **`@vitejs/plugin-vue` version**: Downgraded from 6.0.6 → 5.2.3 for Node 18 compatibility (v6 requires `crypto.hash()` which is Node 21+). Previous workaround polyfilled `crypto.hash` — replacing the dependency is cleaner.

### Full build results
All 5 build targets pass:
- `electron-vite build`: main ✅ (58.88 kB), preload ✅ (1.61 kB), renderer ✅ (HTML + 373 kB CSS + 2.56 MB JS)
- `npm run build:mcp-server`: dist/mcp-server.cjs ✅ (991 kB)
- `npm run build:cli`: dist/cli.cjs ✅ (1.07 MB, 2 import.meta warnings — non-fatal)

### Output file verification
| File | Size | Status |
|------|------|--------|
| out/main/index.cjs | 58,878 B | ✅ |
| out/preload/index.mjs | 1,611 B | ✅ |
| out/renderer/index.html | 463 B | ✅ |
| dist/mcp-server.cjs | 991,608 B | ✅ |
| dist/cli.cjs | 1,068,210 B | ✅ |

### Type-check (npx tsc --noEmit)
- **TS6305** (composite project build-order): 20 errors — pre-existing infrastructure issue. Root tsconfig references node/web but declarations aren't built. Does NOT affect actual builds (esbuild/vite don't use tsc).
- **TS7006** (implicit any): 3 in `WorkspaceIsolator.ts:255-257` — callback params `childName`, `c` missing types. Pre-existing, non-TUI.
- **TUI JSX errors** (TS2875/TS7026): ~80 errors in `src/tui/` — pre-existing, excluded per task instructions.
- **TS2532** (possibly undefined): 1 in `CommandPalette.tsx:55` — TUI, pre-existing.

### Environment notes
- Node.js: v18.19.1 (many packages require >=20 but work with warnings)
- Build succeeds despite engine warnings
