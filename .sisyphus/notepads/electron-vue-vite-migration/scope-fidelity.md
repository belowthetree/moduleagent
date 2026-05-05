# F4: Scope Fidelity Check — electron-vue-vite-migration

## VERDICT: CONDITIONAL APPROVE (3 minor guardrail violations)

---

## Task Compliance Matrix (38/38)

| Task | Compliant | Evidence | Issues |
|------|-----------|----------|--------|
| T1 | ✅ | `src/main/index.ts`, `src/preload/index.ts` created. `electron/main.ts` + `electron/preload.ts` have `@legacy`. `src/renderer/` exists. | — |
| T2 | ✅ | All deps installed: vue, element-plus, pinia, vue-router, electron-vite, vitest, @vitejs/plugin-vue, @vue/test-utils, @element-plus/icons-vue, jsdom, @playwright/test, @electron-toolkit/preload, @electron-toolkit/utils | — |
| T3 | ✅ | `tsconfig.json` (references), `tsconfig.node.json`, `tsconfig.web.json` | — |
| T4 | ✅ | `src/renderer/index.html` with dev CSP (unsafe-eval, ws://) | — |
| T5 | ✅ | `src/types/preload.ts` with ModuleAgentApi, TreeNode, ScanResult, LayoutNode, ChatMsg, AgentStatus. sessionId fix present. | — |
| T6 | ✅ | `src/preload/index.ts` imports shared types. onAgentStream has sessionId. 13 methods preserved. IPC calls identical to old preload. | — |
| T7 | ✅ | `src/renderer/src/__mocks__/moduleAgent.ts` + `vitest.setup.ts` | — |
| T8 | ✅ | `src/renderer/src/stores/config.ts` with loadFromLocalStorage/saveToLocalStorage/saveToProject/loadFromProject | — |
| T9 | ✅ | `src/renderer/src/stores/project.ts` with scanProject/layoutTree/findParentName/isCollapsedAncestor | — |
| T10 | ✅ | `src/renderer/src/stores/agent.ts` with all specified methods (sendMessage, ensureStreamListener, refreshRunningAgents, saveStreamSnapshot, etc.) | — |
| T11 | ✅ | `src/renderer/src/composables/useModuleAgent.ts` | — |
| T12 | ✅ | `src/renderer/src/main.ts` (Element Plus init) + `src/renderer/src/composables/useTheme.ts` | — |
| T13 | ✅ | `src/renderer/src/views/SetupView.vue` with el-card, el-form, el-input, el-select, el-button | — |
| T14 | ✅ | `src/renderer/src/views/MainView.vue` with FAB buttons, status bar, drawer slot | — |
| T15 | ✅ | `src/renderer/src/components/SVGTree.vue` with pan/zoom/collapse, constants NODE_W=180, NODE_H=50, H_GAP=80, V_GAP=16 | — |
| T16 | ✅ | `src/renderer/src/components/DrawerPanel.vue` with resize handle, splitter, drawer-width CSS var | — |
| T17 | ✅ | `src/renderer/src/components/StreamArea.vue` with thinking/tools/reply sections | — |
| T18 | ✅ | `src/renderer/src/components/ContextCards.vue` with CTX_PAGE=5 pagination | — |
| T19 | ✅ | `src/renderer/src/components/ChatInput.vue` with el-input + el-button, Enter to send | — |
| T20 | ✅ | `src/renderer/src/components/MessageModal.vue` with el-dialog | — |
| T21 | ✅ | `src/renderer/src/components/SettingsDialog.vue` with config persistence | — |
| T22 | ✅ | `src/renderer/src/components/ThemeToggle.vue` | ⚠️ Uses el-tooltip (not in allowed 11) |
| T23 | ✅ | `src/renderer/src/router/index.ts` with createWebHashHistory, /setup → /main routes | — |
| T24 | ✅ | Stream integration in agent.ts (chunk routing, finishStream, scheduleStreamSave) | — |
| T25 | ✅ | Cross-context listener in agent.ts (onCrossContext → contextMap) | — |
| T26 | ✅ | startRunningPoll/stopRunningPoll in agent.ts (3s interval) | — |
| T27 | ✅ | `src/renderer/src/App.vue` with el-config-provider, router-view | ⚠️ el-config-provider not in allowed 11 (but required by spec i18n) |
| T28 | ✅ | `electron.vite.config.ts` with 3-target build | — |
| T29 | ✅ | `src/main/index.ts` dual-mode loadURL/loadFile, setupDevHotReload removed, esbuild import removed | — |
| T30 | ✅ | package.json scripts updated: dev, build:electron, test | ⚠️ main field is `out/main/index.cjs` vs spec `out/main/index.js` |
| T31 | ✅ | `electron-builder.yml` exists, out/**/*, target portable | ⚠️ Missing asarUnpack for sqlite3 (spec line 1979) |
| T32 | ✅ | `src/renderer/index.html` CSP | — |
| T33 | ✅ | Build verification in commit 99d3a54 | — |
| T34 | ✅ | `src/renderer/src/stores/__tests__/config.test.ts` | — |
| T35 | ✅ | `src/renderer/src/stores/__tests__/agent.test.ts` | — |
| T36 | ✅ | `src/renderer/src/stores/__tests__/stream.test.ts` | — |
| T37 | ✅ | `src/renderer/src/components/__tests__/SVGTree.test.ts` | — |
| T38 | ✅ | `e2e/smoke.spec.ts` + `playwright.config.ts` | — |

---

## Guardrail Compliance

### Must Have — ALL PASS ✅ (6/6)

| Guardrail | Status | Evidence |
|-----------|--------|----------|
| 13 preload IPC methods unchanged | ✅ | 9 IPC channels identical in old/new; 13 API methods preserved in preload |
| localStorage keys preserved | ✅ | All 9 old keys match (`agentCmd`, `agentArgs`, `lastWorkspace`, `lastProject`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`, `drawerWidth`, `stream_snapshot`). One new: `splitRatio` (planned in T16). |
| IPC channel names unchanged | ✅ | Exact match: agent:start, agent:send, agent:cancel, agent:stop, agent:stream, agent:cross-context, project:scan, config:save, config:get |
| contextIsolation/NI/sandbox preserved | ✅ | contextIsolation:true, nodeIntegration:false (sandbox implicit via electron-vite preload build) |
| Main process logic untouched | ✅ | Only BrowserWindow URL loading + import paths changed. IPC handlers identical. |
| @opentui/* untouched | ✅ | Zero modifications to @opentui deps or src/cli/ |

### Must NOT Have — 3 VIOLATIONS ⚠️

| Guardrail | Status | Detail |
|-----------|--------|--------|
| No Element Plus beyond 11 allowed | ⚠️ FAIL | 3 extra: `el-tooltip` (ThemeToggle.vue:9), `el-alert` (SetupView.vue:78, SettingsDialog.vue:96), `el-config-provider` (App.vue:2) |
| No new features | ✅ | No search, git validation, loading skeletons detected |
| No external tree libraries | ✅ | No d3/vis/dagre/cytoscape imports |
| No provide/inject for IPC | ✅ | No provide/inject used (el-config-provider is Element Plus i18n, not Vue DI) |
| No src/core/, src/agents/, src/config/ changes | ✅ | Zero modifications in migration commits |
| No MCP/CLI build changes | ✅ | build:mcp-server and build:cli scripts unchanged |

---

## Contamination Report

### Cross-Task Contamination: CLEAN ✅

- **src/core/**: 0 modifications in migration commits
- **src/agents/**: 0 modifications in migration commits
- **src/config/**: 0 modifications in migration commits
- **src/cli/**: 0 modifications
- **@opentui/**: 0 modifications
- **electron/** renderer files: NOT modified (only main.ts + preload.ts received @legacy comments)

### Task Bundling (cosmetic, not contamination)

Multiple tasks were bundled into single commits (see commit map below). This is a result of parallel execution and does not constitute contamination — each file maps 1:1 to a single task.

| Commit | Tasks |
|--------|-------|
| 61ae511 | T1 |
| 0c1678e | T2 |
| 8c300a1 | T3 |
| ee92190 | T4 |
| dd00ab8 | T5 |
| 8b5cf09 | T6, T8, T9, T10, T12 |
| 7397920 | T7, T11 |
| e8b3c34 | T13, T15, T16, T17, T22 |
| 1cf936f | T14, T18, T19, T20, T21 |
| 7f34353 | T23, T24, T25, T26, T27 |
| 76c70b9 | T28, T29 |
| 99d3a54 | T30, T31, T32, T33 |
| 3c7d0d1 | T34, T35, T36, T37, T38 |

---

## Unaccounted Changes

### Unaccounted Files: CLEAN (0 unexpected)

All 35 new files and 6 modified files map to planned tasks. No extra files exist.

### Unaccounted Dependencies: CLEAN

All 14 new npm packages map to Task 2 spec.

### Unaccounted Config Changes: 1 minor

- `package.json` old `"build": "tsc"` script removed — not in any task spec but acceptable cleanup
- `package.json` `"dist"` script now runs `build:electron` instead of just `build:renderer` — implicit in T30 but not explicitly listed

---

## Issue Summary

### Severity: LOW (3 guardrail violations, all cosmetic/spec-inherent)

1. **[LOW]** `el-tooltip` in ThemeToggle.vue — not in allowed 11 list. Impact: minimal (used for tooltip on theme toggle button). Fix: replace with CSS title attribute or remove.

2. **[LOW]** `el-alert` in SetupView.vue + SettingsDialog.vue — not in allowed 11 list. Impact: specifies "或内联错误消息" as fallback in T13 spec, which means inline error is acceptable. Fix: use inline error div instead of el-alert.

3. **[LOW]** `el-config-provider` in App.vue — not in allowed 11 despite being required by T27 spec (which mandates `<el-config-provider :locale="zhCn">`). This is a **plan-level inconsistency** — the global guardrail prohibits el-config-provider but Task 27 requires it.

### Specification Gaps: 2 minor

4. **[TRIVIAL]** `main` field: plan says `out/main/index.js`, actual `out/main/index.cjs`. Electron-vite produces `.cjs` for CJS format. No functional impact.

5. **[TRIVIAL]** `electron-builder.yml` missing `asarUnpack: ['node_modules/sqlite3']` from plan spec. No sqlite3 dependency exists in project, making this moot.

---

## Final Scores

| Metric | Result |
|--------|--------|
| Tasks Compliant | **38/38** (100%) |
| Must Have Guardrails | **6/6** PASS |
| Must NOT Have Guardrails | **3/6** FAIL (all LOW severity) |
| Contamination | **CLEAN** (0 cross-task issues) |
| Unaccounted Files | **CLEAN** (0 unexpected) |
| **OVERALL VERDICT** | **CONDITIONAL APPROVE** |

---

*Generated: F4 Scope Fidelity Check — 2026-05-05*
