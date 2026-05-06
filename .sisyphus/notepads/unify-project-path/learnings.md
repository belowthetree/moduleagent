# Learnings

## Conventions
- Test patterns: `import { describe, it, expect, beforeEach, vi } from 'vitest'`
- Pinia stores: `setActivePinia(createPinia())` in beforeEach
- Mock strategy: `vi.mock('fs-extra')` for filesystem, `vi.spyOn()` for logger

## RED Phase results (schema.test.ts)
- Created `src/config/__tests__/schema.test.ts` with 9 test cases for the new `projectPath`-only schema
- Tests use `safeParse()` and check `result.success` boolean
- **Result: 7 failed, 2 passed** — correct RED phase behavior
- Failed tests (7): valid-new-format, reject-old-fields (x2), ConfigEntrySchema, WorkspaceConfigSchema, empty exclude, optional modules
- Passed tests (2): projectPath required, projectPath type check — pass coincidentally because old schema also rejects bad input
- Import path from `__tests__/` to `schema.ts`: `../schema`

## RED Phase results (defaults.test.ts)
- Created `src/config/__tests__/defaults.test.ts` with 7 test cases for new `projectPath` defaults
- Tests import `DEFAULT_CONFIG_ENTRY`, `DEFAULT_WORKSPACE_CONFIG`, `DEFAULT_CONFIG` from `../defaults`
- Tests check: projectPath exists, no old fields, agent config, name, workspace wrapping, backward compat alias, exclude
- **Result: 2 failed, 5 passed** — correct RED phase behavior
- Failed tests (2): projectPath field, no old fields — both fail because defaults.ts still has old structure
- Passed tests (5): agent config, name, workspace wrapping, DEFAULT_CONFIG alias, exclude — these don't depend on changed fields

## RED Phase results (ConfigLoader.test.ts)
- Created `src/config/__tests__/ConfigLoader.test.ts` with 7 test cases for new ConfigLoader behavior
- Mock strategy: `vi.mock('fs-extra')` at top level, `vi.mocked(fs.pathExists).mockResolvedValue()`, `vi.mocked(fs.readJson).mockResolvedValue()`
- Logger spy: `vi.spyOn(defaultLogger, 'warn')` with `.mockRestore()` in each test
- **Result: 3 failed, 4 passed** — correct RED phase behavior
- Failed tests (3):
  1. Valid new-format config — current code returns defaults (can't parse `projectPath`)
  2. Old-format config rejected — current code migrates instead of falling back
  3. Invalid JSON fallback — current code throws instead of catching
- Passed tests (4): no config file, loadOrCreate creates, getDefaultConfig by name, getDefaultConfig fallback — unchanged behavior
- Key insight: Tests that verify NEW behavior fail; tests for stable unchanged behavior pass

## GREEN Phase — schema.ts
- Removed `CodeSourceSchema` (lines 8-13), `workspace`, `codeSource`, `modulesPath` from `ProjectConfigSchema`
- Added `projectPath: z.string()` (required)
- All 9 schema tests now pass: `npm run test src/config/__tests__/schema.test.ts` → 1 file, 9 tests, all passed
- `ConfigEntrySchema` and `WorkspaceConfigSchema` automatically inherit `projectPath` via `ProjectConfigSchema.extend()` — no changes needed
- Next: update `defaults.ts` for task 5 (GREEN phase)
- LSP not available in this env, but vitest as test runner confirms compilation is clean

## GREEN Phase — defaults.ts
- Removed `CodeSourceConfig` interface entirely (was lines 1-6)
- Removed `workspace`, `codeSource`, `modulesPath` from `ProjectConfig` interface
- Added `projectPath: string` to `ProjectConfig` interface
- Updated `DEFAULT_CONFIG_ENTRY`: removed workspace/codeSource/modulesPath values, added `projectPath: '.'`
- Preserved `DEFAULT_CONFIG` backward compat alias and `DEFAULT_WORKSPACE_CONFIG`
- All 7 defaults tests now pass: `npm run test src/config/__tests__/defaults.test.ts` → 1 file, 7 tests, all passed
- Downstream consumers (setup.ts, tui/*) still reference old fields — those are separate parallel tasks

## GREEN Phase — SetupWizard.tsx (Task 7/8)
- Removed all old state signals: `workspacePath`, `modulesPath`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`
- Removed fallback signals: `fallbackWorkspacePath`, `fallbackModulesPath`, `fallbackCodeSourcePath`, `fallbackCodeSourceUrl`, `fallbackCodeSourceBranch`
- Added single `projectPath` signal with `fallbackProjectPath` using existing data, workingDir, or process.cwd()
- Reduced steps from 5 (0-4) to 3 (0-2): Agent config → Project path → Summary/confirm
- Removed Tab handler (was for codeSource type toggle)
- Updated `saveStepData`: only cases 0 (command/args) and 1 (projectPath)
- Updated `handleComplete`: removed `CodeSourceConfig` construction, removed workspace/codeSource/modulesPath from merged object, passes only `agents` and `projectPath`
- Updated `summaryText`: shows only Agent command, project directory, and config save directory
- Step 1 text explains: ".module-agent/module/ and .module-agent/workspace/ will be auto-created"
- Note: `writeModuleAgentJson()` in `tui/config.ts` still has old field references (lines 52-54) - needs separate update in Task 9

## GREEN Phase — ConfigLoader.ts
- Removed `migrateLegacyConfig()` function entirely
- Removed `ProjectConfigSchema` import (only `WorkspaceConfigSchema` needed)
- Simplified `load()`: read file → `WorkspaceConfigSchema.safeParse()` → return or fallback
- Added try/catch around `fs.readJson()` for invalid JSON fallback
- Added `projectPath` vs `projectRoot` consistency check (warning only, no rejection)
- Old-format configs now fall back to defaults with warning (no migration)
- All 7 ConfigLoader tests pass: `npm run test src/config/__tests__/ConfigLoader.test.ts` → 1 file, 7 tests, all passed

## TUI Path Migration (Task 9)

- **AgentService.ts**: Replaced `import fs from 'fs'` → `import fs from 'fs-extra'` for `ensureDirSync`. Removed `normalizeCodeSourcePath` import (unused after removing fallback chain). Removed 27-line `modulesPath`/`codeSource.path` fallback chain. New logic: `path.join(this.config.projectPath, '.module-agent', 'module')` + `fs.ensureDirSync(moduleScanPath)` before scanning. Dedup (Set-based merge) preserved unchanged.
- **config.ts**: `writeModuleAgentJson()` now writes `projectPath: entryConfig.projectPath ?? DEFAULT_CONFIG_ENTRY.projectPath` only. Removed `workspace`, `codeSource`, `modulesPath` lines.
- **renderer.tsx**: Replaced `hasModulesPath = config.modulesPath || (config.codeSource.type === 'local' && config.codeSource.path)` → `hasProjectPath = !!config.projectPath`. Updated comment and warning message to reference project path instead of module folder.
- Typecheck: No new errors introduced. Only pre-existing TS6305/TS2875 issues remain in these files.

## GREEN Phase — setup.ts (CLI)
- Removed workspace path prompt (old lines 130-135): `config.workspace.path` prompts
- Removed modulesPath prompt (old lines 148-150): `config.modulesPath` prompt
- Removed codeSource prompts (old lines 152-169): type, git URL/branch, local path
- Updated first prompt from "模块目录" to "项目路径" with explanation of auto-created `.module-agent/module/` and `.module-agent/workspace/` directories
- Added `config.projectPath = projectRoot` assignment after prompt resolution
- Updated `isConfigComplete()` to check `!!config.projectPath` instead of `!!(config.agents.default.command && config.workspace.path)`
- Simplified summary to show `projectPath` + derived paths (`.module-agent/module/`, `.module-agent/workspace/`)
- Agent command/args prompts preserved unchanged
- `ModuleGenerator.generate()` call preserved unchanged
- No errors from setup.ts in typecheck (pre-existing errors from other files only)

## Task 7 — Update Electron main/index.ts + AgentOrchestrator.ts

### Files changed
- `src/main/index.ts` — project:scan, config:save, config:get handlers, orchestrator construction
- `src/agents/AgentOrchestrator.ts` — replaced `codeSource` with `projectPath` in options/fields/constructor/_resolveCwd

### Key decisions
1. **Auto-create dirs with `fs.mkdirSync(path, { recursive: true })`** instead of importing `fs-extra` — Node.js built-in since v10.12 does the same as `ensureDirSync`.
2. **Bridge `codeSource` as `{ type: 'local', path: this.projectPath }`** in `_resolveCwd` when calling `prepareModuleWorkspace` — because Task 11 hasn't updated WorkspaceIsolator yet. The `codeSourcePathForModule` function uses `codeSource.path` as the base directory, so passing `projectPath` there works correctly. Task 11 will clean this up.
3. **Kept `workspaceRoot` parameter in `project:scan` handler** — preload still passes it, Tasks 13/15 will update callers later. Internally, we derive workspaceRoot from `config.projectPath`.
4. **Removed `normalizeCodeSourcePath` import** — no longer used after replacing the modulesPath/codeSource.path fallback chain with direct `path.join(config.projectPath, '.module-agent', 'module')`.
5. **Kept `codeSourcePathForModule` and `resolveGitCodeSource` in WorkspaceIsolator imports and orchestrator construction** — the orchestrator's `WorkspaceIsolator` interface still declares them (Task 12 will update). They're passed as function references but the orchestrator no longer calls them directly.

### Removed
- `let currentCodeSource` variable (line 42) — all 2 references removed
- `config:save` handler: `codeSource` and `modulesPath` update logic (lines 461-462)
- `config:get` handler: `codeSource` and `modulesPath` in return value (lines 472-474)
- `modulesPath`/`codeSource.path` ternary fallback chain (lines 118-122)

### Verification
- `npm run typecheck`: NO errors in `src/main/index.ts` or `src/agents/AgentOrchestrator.ts` (except pre-existing TS6305 infrastructure issue)
- `npm run test`: 6 passed (config tests + renderer tests), 1 pre-existing SVGTree failure
- All config tests from Tasks 1-3 still pass

## GREEN Phase — renderer mock (Task 14)
- Updated `src/renderer/src/__mocks__/moduleAgent.ts` to match expected preload signatures
- `scanProject`: removed `_workspaceRoot` param (now single `_projectRoot: string`)
- `saveAgentConfig`: replaced `_codeSource?: CodeSource, _modulesPath?: string` with `_projectPath?: string`
- `getAgentConfig`: return type changed from `codeSource?: CodeSource; modulesPath?: string` to `projectPath?: string`
- Default return value: replaced `codeSource: { type: 'local', path: '/mock/project' }, modulesPath: '/mock/modules'` with `projectPath: '/mock/project'`
- Removed unused `CodeSource` type import
- Mock factory structure and trigger helpers untouched
- All 20 renderer store tests still pass (3 files)
- No new typecheck errors

## Task 16 — Update preload types & implementation (Task 15/16)

### Files changed
- `src/types/preload.ts` — API interface (ModuleAgentApi) + removed CodeSource
- `src/preload/index.ts` — actual bridge implementation

### Changes in `src/types/preload.ts`
1. **Removed `CodeSource` interface** entirely (was lines 72-77)
2. **`scanProject`**: `(projectRoot: string, workspaceRoot: string)` → `(projectRoot: string)`
3. **`saveAgentConfig`**: removed `codeSource?: CodeSource, modulesPath?: string`, added `projectPath?: string`
4. **`getAgentConfig` return type**: removed `codeSource?: CodeSource; modulesPath?: string`, added `projectPath?: string`

### Changes in `src/preload/index.ts`
1. **`scanProject`**: single-param, calls `ipcRenderer.invoke('project:scan', projectRoot)`
2. **`saveAgentConfig`**: `projectPath?: string` param, passes `{ command, args, projectPath }` to `config:save`
3. **`getAgentConfig`**: return type now `{ command, args, projectPath? }`

### Key decisions
- Inline type annotations for `saveAgentConfig`/`getAgentConfig` matched the old `CodeSource` shape — replaced with simple `projectPath?: string`
- Main process `config:save` handler already expects `projectPath` in the updates object — preload now sends it directly
- No new typecheck errors beyond pre-existing TS6305 infrastructure issue

## Task 10 — AgentOrchestrator.ts interface + AgentManager.ts cleanup

### Files changed
- `src/agents/AgentOrchestrator.ts` — updated WorkspaceIsolator interface + _resolveCwd

### Changes in `src/agents/AgentOrchestrator.ts`
1. **`WorkspaceIsolator` interface** — three method signatures changed:
   - `codeSourcePathForModule(node, codeSource: {type; path?} | null)` → `codeSourcePathForModule(node, projectPath: string | null)`
   - `prepareModuleWorkspace(node, options)`: `options.codeSource` → `options.projectPath` in the options type
   - `resolveGitCodeSource(codeSource, ...)` → `resolveGitCodeSource(projectPath, ...)`
2. **`_resolveCwd()`** — removed bridge `codeSource: { type: 'local', path: this.projectPath }` object, passes `projectPath: this.projectPath` directly

### AgentManager.ts
- Already clean — zero `codeSource` references. No changes needed.

### Verification
- `npm run typecheck`: No new errors. Only pre-existing TS6305 infrastructure + TUI JSX errors.
- The interface/implementation mismatch with `src/agents/WorkspaceIsolator.ts` (old `codeSource` signatures) is expected — T11 will update the implementation to match.

## Task 11 (Final) — Simplify WorkspaceIsolator.ts

### Files changed
- `src/agents/WorkspaceIsolator.ts` — removed `resolveGitCodeSource`, simplified `codeSourcePathForModule` and `prepareModuleWorkspace`
- `src/agents/AgentOrchestrator.ts` — updated `WorkspaceIsolator` interface, removed `gitCacheDir`, simplified `_resolveCwd`
- `src/main/index.ts` — removed `resolveGitCodeSource` import and orchestrator wiring

### Changes in `src/agents/WorkspaceIsolator.ts`
1. **Removed `resolveGitCodeSource()`** entirely (33 lines) — git clone/pull logic, `simple-git` imports, `os.tmpdir()` no longer used
2. **`codeSourcePathForModule`** simplified: new signature `(node: ModuleGraphNode, projectPath: string): string` — returns `path.join(projectPath, node.relativePath)` directly (was 23 lines with `codeSource` config switch, `normalizeCodeSourcePath`, existsSync checks, src/ prefix fallback — now 4 lines)
3. **`prepareModuleWorkspace` options**: `codeSource` + `gitCacheDir` removed, `projectPath: string` added
4. **All 5 fallback paths preserved**:
   - No workspaceRoot → return node.absolutePath
   - No srcDir (empty projectPath) → warn + return node.absolutePath
   - srcDir doesn't exist → ensureDir(destDir) + return destDir
   - srcDir === destDir → return destDir
   - Copy error → warn + return node.absolutePath
5. **Sub-module exclusion preserved** (lines 104-113 in new file)
6. **Removed imports**: `os`, `normalizeCodeSourcePath` from PathUtils
7. **`simple-git`** only consumer was `resolveGitCodeSource` — zero references remaining in file

### Changes in `src/agents/AgentOrchestrator.ts`
1. **`WorkspaceIsolator` interface**: removed `resolveGitCodeSource`, updated `codeSourcePathForModule` and `prepareModuleWorkspace` signatures
2. **Removed `gitCacheDir`** property from `AgentOrchestrator` class
3. **`_resolveCwd`**: passes `projectPath: this.projectPath` directly (bridge comment removed)

### Changes in `src/main/index.ts`
1. Removed `resolveGitCodeSource` from import block (line 20)
2. Removed `resolveGitCodeSource` from orchestrator workspaceIsolator object

### Pitfall: accidental property deletion
- When editing the "Mutable instance state" block to remove `gitCacheDir`, accidentally removed `pendingStarts` and `agents` too. These are adjacent Map properties. Fixed by restoring them.
- Lesson: use more targeted edits — never use broad block replacements that span multiple independent declarations.

### Verification
- `npm run typecheck`: No new errors. Only pre-existing TS6305 + TS7006 (WorkspaceIsolator.ts getSubModuleDirs implicit any — confirmed via git stash to be pre-existing)
- `npm run test`: 6 passed, 5 pre-existing SVGTree failures (vue-test-utils compatibility, unchanged)
- File length: 258 → 163 lines (37% reduction)
- Zero `codeSource` parameter/variable references in file (function name `codeSourcePathForModule` preserved for API stability)

## Task 18 — Update renderer config store (config.ts)

### Files changed
- `src/renderer/src/stores/config.ts` — removed workspacePath/codeSource* refs, simplified to projectPath-only
- `src/renderer/src/stores/__tests__/config.test.ts` — updated all 6 tests, added migration test (7 total)

### Changes in config.ts
1. **LS_KEYS**: Removed `lastWorkspace`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`. Kept `agentCmd`, `agentArgs`, `lastProject`.
2. **State refs**: Removed `workspacePath`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`. Kept `agentCmd`, `agentArgs`, `projectPath`.
3. **loadFromLocalStorage**: Migration — if `lastWorkspace` exists, read → write to `lastProject` → remove `lastWorkspace`. Also cleans up old `codeSource*` keys.
4. **saveToLocalStorage**: Only saves 3 keys: `agentCmd`, `agentArgs`, `lastProject`.
5. **Removed `buildCodeSource()`** entirely.
6. **saveToProject**: Calls `window.moduleAgent.saveAgentConfig(projectRoot, cmd, args, projectPath.value)` — matches updated preload API (4th param is `projectPath?: string`).
7. **loadFromProject**: Destructures `{ command, args, projectPath }` from response. Falls back to `projectRoot` if `projectPath` is absent.
8. **Store return**: Only exposes `agentCmd`, `agentArgs`, `projectPath` + 4 functions.

### Test changes
- Removed assertions for `workspacePath`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`
- Added migration test: `lastWorkspace` → `lastProject` with key cleanup verification
- `saveToProject` spy now checks 4th arg is a string (projectPath), not a CodeSource object
- `loadFromProject` mock returns `{ command, args, projectPath }` instead of `{ command, args, codeSource, modulesPath }`

### Verification
- `npm run test src/renderer/src/stores/__tests__/config.test.ts` → 7 passed (1 file)
- `npm run typecheck` → no new errors (only pre-existing TS6305/TUI/ConfigLoader test issues)
- File length: 99 → 72 lines (27% reduction)

## Task 19 — Update SetupView.vue (renderer)

### Files changed
- `src/renderer/src/views/SetupView.vue` — removed workspace path UI, codeSource UI, simplified to projectPath-only form

### Changes
1. **`startDisabled` computed**: Changed from `!configStore.workspacePath || !configStore.projectPath` → `!configStore.projectPath`
2. **Removed `showCodeSourcePath` computed** — no longer needed
3. **Removed `selectWorkspace()` function** — repurposed not needed since workspacePath removed from store
4. **Removed `selectCodeSourcePath()` function** — codeSource removed from store
5. **`startScan()`**: Changed from `scanProject(configStore.projectPath, configStore.workspacePath)` → `scanProject(configStore.projectPath)` (single param, matches T13 preload API)
6. **Template**: Removed workspace directory form-item, codeSource type select, and conditional codeSource path form-item
7. **Added info alert** explaining auto-created `.module-agent/module/` and `.module-agent/workspace/` dirs
8. **Updated subtitle** from "配置工作目录、模块目录和 Agent 命令后开始" → "选择项目目录，配置 Agent 命令后即可开始扫描"
9. **Updated `selectProject` button label** from "选择模块目录" → "选择项目目录"
10. **Removed dead CSS**: `.full-width` class, `.el-select .el-input__wrapper` rule
11. **Added `.setup-note` style** with inline `<code>` styling for the info alert

### Verification
- `npm run typecheck` → no new errors. Only pre-existing TS6305 + TUI JSX + ConfigLoader test issues remain.
- File length: 245 → 218 lines (11% reduction)

## Startup config validation fix (post-refactoring bug)

### Problem
After refactoring to `projectPath`, the startup flow only restored config from localStorage, never validated the actual `.module-agent.json` file. If `lastProject` localStorage key had a stale value but the config file was deleted/emptied, the router guard (checking `!configStore.projectPath`) saw a truthy value and didn't redirect to `/setup`. MainView loaded with broken config.

### Solution
Added config file validation between `loadFromLocalStorage()` and `app.mount()` in `main.ts`:
1. If `projectPath` is truthy, call `loadFromProject(projectPath)` to read the actual config file
2. ConfigLoader returns `projectPath: '.'` when file is missing/invalid → clear to `''` → router redirects to `/setup`
3. If load throws → catch → clear → redirect to `/setup`
4. If config is valid → `projectPath` stays → MainView loads normally

### Key insight
The `projectPath` default value `'.'` (from `DEFAULT_CONFIG_ENTRY`) serves as a reliable sentinel: it only appears when ConfigLoader falls back to defaults. No real user would set `projectPath: '.'` (they use absolute paths in the UI).

### Final state
- 22 implementation tasks + 1 bug fix + 4 final-wave reviews = 27 work items
- 24 source files modified
- Net: -740 / +324 lines
- 23 new tests (schema, defaults, ConfigLoader)
- Zero new type errors
- Zero new test failures

## Task — Generate Modules feature

### Files changed
- `src/main/index.ts` — added `project:generateModules` IPC handler + ModuleGenerator import, changed `fs` import from `'fs'` to `'fs-extra'` (needed for `fs.pathExists`)
- `src/preload/index.ts` — added `generateModules` bridge method
- `src/types/preload.ts` — added `generateModules` to `ModuleAgentApi` interface
- `src/renderer/src/views/MainView.vue` — added empty state UI with "生成模块" button, `generating` ref, `generateModules()` function, CSS

### Key decisions
1. **`fs` → `fs-extra` swap in main/index.ts**: Node's `fs` doesn't have `pathExists`. All existing code (writeFile, mkdirSync, unlinkSync, readdir, promises) works with `fs-extra` since it re-exports everything from Node's `fs`. Zero impact on existing functionality.
2. **Recursive depth limit of 5**: Prevents runaway recursion in deeply nested project structures.
3. **Skip rules**: Hidden dirs (`.`), `node_modules`, and config `exclude` patterns — same filtering as module scanning.
4. **No overwrite**: Only generates `module.md` if it doesn't already exist (`fs.pathExists` check).
5. **Auto-rescan**: After successful generation, calls `projectStore.scanProject()` to discover newly created modules and update the tree.

### Verification
- `npm run typecheck`: Zero new errors across all 4 changed files
- Only pre-existing TS6305 composite project infrastructure errors remain

### ModuleGenerator API
- `ModuleGenerator.generate({ dirPath, extraExclude }): Promise<string>` — returns module.md content as string, does NOT write to disk
- Uses `isBuiltinExcluded` internally to filter submodules
- The IPC handler is responsible for writing files and directory traversal
