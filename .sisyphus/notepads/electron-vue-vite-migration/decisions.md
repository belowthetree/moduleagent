
## F1 Plan Compliance Audit — Findings

### Must Have (8 checks)

1. **13 preload IPC methods** — PASS. All 13 methods present in `src/preload/index.ts` with identical IPC channel names to `electron/preload.ts`. Runtime behavior unchanged. Types externalized to `src/types/preload.ts`.

2. **localStorage keys** — PASS. All 11 required keys preserved: `ctx_`, `lastWorkspace`, `lastProject`, `agentCmd`, `agentArgs`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`, `drawerWidth`, `stream_snapshot`. New planned keys (`theme`, `splitRatio`) added for migration features.

3. **IPC channel names** — PASS. All 11 `ipcMain.handle` channels in `src/main/index.ts` match preload invocations exactly: `dialog:selectDir`, `project:scan`, `project:getTree`, `agent:start`, `agent:send`, `agent:cancel`, `agent:stop`, `agent:isRunning`, `agent:getRunning`, `config:save`, `config:get`.

4. **contextIsolation/nodeIntegration** — PASS (with note). `contextIsolation: true`, `nodeIntegration: false` confirmed in `src/main/index.ts:64-65`. `sandbox: true` was NOT present in original `electron/main.ts` either — this is a plan specification bug, NOT an implementation regression. Both old and new code are identical on this point.

5. **EVM module tree** — PASS. SVGTree.vue implements: recursive layoutTree algorithm (lines 144-168), SVG rendering with `<rect>`/`<path>`/`<text>`, pan via middle-click drag (lines 252-266), zoom via wheel 0.3-2.5 scale (lines 272-279), collapse/expand via +/- circle buttons (lines 61-77, 246-250), and agent status dots with `dot-idle`/`dot-streaming`/`dot-error` CSS classes (lines 52-58).

6. **Streaming** — PASS. StreamArea.vue implements thinking/tools/reply sections (lines 65-119), blinking cursor for active streaming (`.stream-active::after` CSS animation), cancel button (lines 123-129), and thinking toggle for finished streams. agent.ts implements `saveStreamSnapshot()`, `restoreStreamSnapshot()`, `scheduleStreamSave()` with 2s debounce, and `clearStreamSnapshot()`.

7. **Cross-context events** — PASS. agent.ts `ensureCrossContextListener()` (lines 256-279) registers `onCrossContext` callback, appends to contextMap with `role: 'cross'`, auto-paginates to latest page when drawer matches, and persists via `saveContext()`.

8. **3-second agent polling** — PASS. agent.ts defines `POLL_INTERVAL = 3000` (line 9), `startRunningPoll()` uses `setInterval(refreshRunningAgents, POLL_INTERVAL)` (line 342), and `stopRunningPoll()` clears the timer.

### Must NOT Have (5 checks)

1. **No new features** — PASS. No search feature, git validation, or loading skeletons found in renderer code. The "search" hit in stream.test.ts is a mock tool_call name, not a UI feature.

2. **No external tree libraries** — PASS. No D3, vis.js, or any tree library imports found in any source file. Only false positives in package-lock.json integrity hashes.

3. **Element Plus component limit** — VIOLATION (minor). The allowed list specifies exactly 11 components. Actual usage:
   - From allowed list (8 of 11 used): el-input, el-button, el-dialog, el-select, el-option, el-card, el-form, el-form-item
   - NOT used from allowed list (3): el-drawer (custom implementation), el-pagination (custom pagination), el-scrollbar
   - **Beyond allowed list (2 violations)**: el-alert (SetupView.vue:78, SettingsDialog.vue:96), el-tooltip (ThemeToggle.vue:9)
   - el-config-provider (App.vue:2) is required Element Plus infrastructure, not a UI component — judged as exempt.

4. **No @opentui/* modifications** — PASS. Zero @opentui references in src/renderer/.

5. **No provide/inject for IPC** — PASS. No custom provide/inject for IPC communication. Only el-config-provider uses Vue's provide/inject internally for Element Plus theme/locale configuration.

### Deliverables

- **38 tasks**: All marked [x] complete in plan. Git log shows 15 commits covering all waves (scaffold → deps → config → types → stores → components → integration → build → tests).
- **Evidence files**: 6 files in `.sisyphus/evidence/` (tasks 13, 14, 15 + F2, F3, F4). Most per-task evidence files are missing per the plan's requirement of one evidence file per task.

