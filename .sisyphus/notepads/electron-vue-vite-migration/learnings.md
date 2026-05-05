## F2: Code Quality Review — Learnings

### TypeCheck
- All TUI errors are pre-existing (JSX intrinsic elements, react/jsx-runtime missing)
- CommandPalette.tsx:55 TS2532 "Object possibly undefined" also pre-existing
- **0 new type errors** introduced by this change

### Tests
- 25/30 pass (83%)
- 5 failing tests all in SVGTree.test.ts — pre-existing:
  - 4×: `SupportedEventInterface is not a constructor` — @vue/test-utils env incompatibility
  - 1×: dot-streaming class not found — SVGTree component behavior
- SVGTree.test.ts unchanged in this diff
- **0 new test failures** introduced

### Dependencies
- jsdom downgraded 29→24 (compatibility)
- Added happy-dom (alternative DOM env for vitest)
- @vitejs/plugin-vue downgraded 6→5 (electron-vite compat)
- html-encoding-sniffer added as direct dep (resolution fix for jsdom v24)

## F4: DEVELOPMENT.md Documentation Update — Learnings

### What was done
- Updated `docs/DEVELOPMENT.md` (420 lines) to reflect the Electron + Vue 3 + Vite migration
- 6 sections modified, 3 preserved as-is per requirements

### Key changes
- **Section 1**: tech stack table — esbuild row replaced with electron-vite + esbuild, new Vue 3 + Element Plus + Pinia row
- **Section 1**: fixed stale CLI claim (was "removed" → now "secondary path")
- **Section 2**: complete directory tree rewrite — `electron/` → `src/main/`, `src/preload/`, `src/renderer/src/` (with Vue SFC component layout)
- **Section 5**: HTML DOM tree → Vue component tree (SetupView.vue, MainView.vue, SVGTree.vue, DrawerPanel.vue, StreamArea.vue, etc.)
- **Section 5**: ChatMsg updated with `'cross'` role, `'interrupted'` status, `crossDirection`, `crossModule`
- **Section 6**: esbuild-centric build commands → electron-vite workflow with `npm run dev`, `npm run test`, `npm run test:e2e`, `npm run dist`
- **Section 8**: new "构建与工具链" subsection (electron-vite, module aliases, multi tsconfig, Vite HMR, CSP, app.getAppPath)
- **Section 8**: added WSL/Linux Windows absolute path gotcha
- **Section 9**: checklist updated — electron-builder marked done, integration testing added, descriptions refined

### Approach
- Read entire file first (349 lines), gathered source of truth from actual codebase (package.json, glob file listings, src/types/preload.ts)
- One interface change at a time, verified with full file read-through
- Sections 3 (ACP/MCP), 4 (关键接口), 7 (会话初始化) left untouched per task instructions

### Verification
- No LSP for .md files — manual full-file read-through confirmed structural integrity
- All section headers preserved, no broken markdown syntax
