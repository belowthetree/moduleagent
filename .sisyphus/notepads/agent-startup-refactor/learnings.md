## T1: Created `src/agents/McpServerBuilder.ts`

- Extracted `writeMcpGraphFile` from `electron/main.ts:206-216`
- Type import uses alias pattern matching `electron/main.ts:18`: `import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js'`
- PID-suffixed filename: `mcp-graph-${process.pid}.json` for multi-process safety
- Default tempDir: `os.tmpdir()` via `tempDir || os.tmpdir()`
- Uses `fs.writeFileSync` (sync I/O as required)
- Logs via `defaultLogger.info(...)` 
- `npx tsc --noEmit` — zero McpServerBuilder errors

## T13: dedupMessage + createSessionPrompted exports

**Completed**: Added two exports to `src/agents/PromptBuilder.ts` (appended after T2's functions).

### `dedupMessage`
- Signature: `(lastSent: Map<string, { text: string; time: number }>, moduleName: string, text: string, windowMs = 3000): boolean`
- Returns `true` = duplicate (should be ignored), `false` = new message
- Check: same moduleName + same text + within windowMs (default 3000ms)
- Non-duplicate: sets `lastSent.set(moduleName, { text, time: Date.now() })` before returning false
- Logs `[dedup] ${moduleName} — duplicate ignored` via `defaultLogger.info` when dedup fires

### `createSessionPrompted`
- Returns `new Set<string>()` — empty set keyed by moduleName
- Factory function for both Electron and TUI paths

### Verification
- `npx tsc --noEmit` — zero PromptBuilder errors
- Pre-existing TSX errors in `src/tui/` (unrelated — React/JSX types not installed)

## T4: Added `buildMcpServers` to `src/agents/McpServerBuilder.ts`

- Appended after T3's `writeMcpGraphFile` (unchanged)
- Signature: `buildMcpServers(options: { moduleName, basePath, backendPort, graphFile, nodeBin? }): McpServerStdio[]`
- `basePath` replaces `app.getAppPath()` for portability
- `nodeBin` defaults to `'node'`; callers pass `process.execPath` on Windows
- Bundle path: `path.join(basePath, 'dist', 'mcp-server.cjs')`
- Three guard conditions return `[]` with warns:
  1. `!backendPort` → "backend port not ready"
  2. `!graphFile` → "graph file not written"
  3. `!fs.existsSync(bundlePath)` → "MCP server bundle not found"
- Args: `[bundlePath, '--graph-file', graphFile, '--backend-url', backendUrl, '--module-name', moduleName]`
- env format: `Array<{name: string, value: string}>` (empty array `[]`) — Zod-compliant per AGENTS.md
- Logs server config (command, args, tools list) via `defaultLogger.info`
- Import: `import type { McpServerStdio } from '@agentclientprotocol/sdk'`
- Verification: `npx tsc --noEmit` — zero McpServerBuilder errors

## T2: Added `resolveGitCodeSource` + `prepareModuleWorkspace` to WorkspaceIsolator.ts

- Appended after T1's `workspacePathForModule` and `codeSourcePathForModule` (unchanged)
- New imports: `os`, `fse` from `fs-extra`, `defaultLogger` from `../core/Logger.js`, `ModuleGraph as ModuleGraphType` from `../types/module.js`

### `resolveGitCodeSource`
- Signature: `(codeSource, gitCacheDir, _onLog?) => Promise<string>`
- Early return `''` if not git or no url
- Cache key: `${url}@${branch || 'main'}` — checks `gitCacheDir` Map + `fs.existsSync` for cache hit
- Cache path: `os.tmpdir()/module-agent-git-cache/{repoName}` (os.tmpdir() replaces app.getAppPath())
- On cache hit + exists: dynamic `import('simple-git')` + `simpleGit(cachePath).pull()` (wraps in try/catch)
- On miss: `fse.ensureDir` parent dir, clone with `--branch` + `--single-branch`
- Stores in `gitCacheDir` before returning

### `prepareModuleWorkspace`
- Signature: `(node, options) => Promise<string>`
  - `options.workspaceRoot`, `options.codeSource`, `options.graph`, `options.gitCacheDir`, `options.onLog?`
- Calls T1's `workspacePathForModule(node, workspaceRoot, '')` for destDir
- Calls T1's `codeSourcePathForModule(node, codeSource)` first; if '' and git, calls `resolveGitCodeSource` + resolves from git root (direct/`src/` prefix mapping)
- No srcDir → warn + return `node.absolutePath`
- srcDir not on disk → warn + `fse.ensureDir(destDir)` + return `destDir`
- srcDir === destDir → return `destDir` (no copy)
- Collects subModulePaths from `options.graph.nodes` (root module only, excludes children)
- `fse.copy` filter excludes: `node_modules`, `.git`, subModulePaths (prefix match)
- Copy failure → error log + return `node.absolutePath` (never throws)
- Uses `defaultLogger` for all logging (warn/info/error)

### Verification
- `npx tsc --noEmit` — zero WorkspaceIsolator errors
- Pre-existing TSX errors in `src/tui/` only (unrelated — React/JSX types not installed)

## T6: Added `getSubModuleDirs` to `src/agents/WorkspaceIsolator.ts`

- Appended after `prepareModuleWorkspace` (unchanged)
- Signature: `(node: ModuleGraphNode, graph: ModuleGraphType | null, workspacePathFn: (n: ModuleGraphNode) => string): string[]`
- Returns `[]` when graph is null (guard before map/filter)
- Uses type predicate `(c): c is ModuleGraphNode => !!c` to filter out undefined graph lookups
- Maps filtered children through `workspacePathFn` to get final paths
- No new imports needed — `ModuleGraphNode` and `ModuleGraphType` already imported from T1
- Matches `electron/main.ts:286-292` exactly
- Section separator comments match existing style (lines 75-77, 125-127)
- Verification: `npx tsc --noEmit` — zero WorkspaceIsolator errors

## T8: Created `src/agents/McpBackend.ts`

- Extracted `startMcpBackend` HTTP handler from `electron/main.ts:92-204` into `McpBackendServer` class
- All Electron dependencies injected via `McpBackendCallbacks` interface — NO `BrowserWindow`/`ipcMain`/`mainWindow` references
- `sendCrossContext` and `setAgentStatus` are optional in the interface (TUI path may not implement them)
- `onLog` is also optional — falls back to `defaultLogger` when not provided
- Streaming capture via temporary `onSessionUpdate` handler override (restored in `finally` block)
- `start()` is idempotent — returns existing port if already running
- `stop()` cleanly closes the server and resets port to 0
- `getPort()` returns 0 when not started
- HTTP handler replicates all logic from electron/main.ts: method check (405), missing targetModule (400), agent not found (404), auto-start via `callbacks.startAgent`, prompt+streaming capture, cross-context notifications, error handling (500)
- `callbacks.getAgentEntry` called twice on auto-start path (after start to re-fetch), matching original pattern
- Imports: `http` from `node:http`, `ClientSideConnection`+`ContentBlock` from `@agentclientprotocol/sdk`, `defaultLogger` from `../core/Logger.js`
- Zero comments — self-documenting code
- Verification: `npx tsc --noEmit` — zero McpBackend errors (all errors are pre-existing TUI JSX issues)

## T5: Created `src/agents/AgentOrchestrator.ts`

### Overview
Created unified agent startup orchestrator that merges `agent:start` IPC handler and `ensureModuleAgentRunning` into one `startAgent()` method. Dependency-injected via constructor.

### `AgentEntry` interface (exported)
```typescript
interface AgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;
  sessionId: string;
  modulePath: string;
  capabilities?: AgentCapabilities;
}
```
Uses `launched` field name (matching Electron path), not `agent` (AgentManager convention).

### Dependency interfaces (exported)
- `WorkspaceIsolator` — typed contract for the 5 workspace functions (workspacePathForModule, codeSourcePathForModule, getSubModuleDirs, prepareModuleWorkspace, resolveGitCodeSource)
- `PromptBuilder` — typed contract for buildPromptBlocks
- `McpServerBuilder` — typed contract for buildMcpServers + writeMcpGraphFile

### `startAgent()` pipeline — 11 steps matching spec
1. Resolve config: explicit override > ConfigLoader.getDefaultConfig (per-module) > hardcoded fallback
2. Look up node from `this.graph`
3-4. Prepare workspace + resolve cwd via `_resolveCwd()`
5. Get subModuleDirs via `workspaceIsolator.getSubModuleDirs()` with closure over workspacePathForModule
6. `launcher.launch(config, name, cwd, logger, { subModuleDirs })` — **5 args**, options is 5th
7. Wire `launched.onSessionUpdate` to `callbacks.onSessionUpdate`
8. `mcpServerBuilder.buildMcpServers({ moduleName, basePath, backendPort, graphFile })`
9. `launched.connection.newSession({ cwd, mcpServers })` — passes mcpServers through
10. `sessionPrompted.delete(moduleName)` — reset for first prompt injection
11. Build AgentEntry, store in `this.agents`

### Concurrency protection
- `pendingStarts: Map<string, Promise<AgentEntry>>` — check at start, return existing promise
- Store promise before awaiting, delete in `finally` block
- Failed launches: kill process in catch, re-throw, not cached in `agents`

### Config resolution
- `startAgent(options)` accepts optional `config: AgentConfig` override
- Fallback: `ConfigLoader.load(projectRoot)` → `getDefaultConfig()` → check `modules[moduleName]` first, then `default`
- Hardcoded fallback: `{ command: 'opencode', args: ['acp'] }`

### Workspace cwd resolution (`_resolveCwd()`)
- No node → projectRoot
- workspaceRoot set AND node.relativePath !== '.' → prepareWorkspace + workspacePathForModule
- node.relativePath === '.' → projectRoot (root module, no isolation)
- Otherwise → node.absolutePath

### Instance properties
- `gitCacheDir = new Map<string, string>()` — passed to prepareModuleWorkspace
- `mcpBackendPort = 0` / `mcpGraphFile = ''` — mutable, set externally after MCP backend starts
- `sessionPrompted` / `lastSent` — public, external code reads/modifies

### Verification
- `npx tsc --noEmit` — zero AgentOrchestrator errors
- Only pre-existing JSX errors in `src/tui/` (unrelated)

## T12: Refactor AgentManager + AgentService — pass subModuleDirs to launcher

### Changes Made

**AgentManager.ts** (2 methods modified):
- `startMainAgent(mainCwd, onSessionUpdate?, subModuleDirs?)` — added optional `subModuleDirs?: string[]` as 4th param. Passes `{ subModuleDirs: subModuleDirs ?? [] }` as 5th arg to `this.launcher.launch()`
- `startModuleAgent(moduleName, moduleCwd, onSessionUpdate?, subModuleDirs?)` — same pattern, 4th param
- Both launcher calls went from 4 args → 5 args (`LaunchOptions` object as last arg)
- Backward compatible: defaults to `[]` when not passed

**AgentService.ts** (1 method modified):
- Added static import: `import { getSubModuleDirs, workspacePathForModule } from '../../agents/WorkspaceIsolator.js'`
- `startModuleAgent(name)` now computes `subDirs` via:
  ```ts
  getSubModuleDirs(node, this.graph, (n) => workspacePathForModule(n, null, this.projectRoot))
  ```
- Passes `subDirs` as 4th arg to `this.agentManager.startModuleAgent()`
- Uses `workspacePathForModule(n, null, this.projectRoot)` — null workspaceRoot means it falls back to `node.absolutePath`

### Key decisions
- Static import for WorkspaceIsolator (not dynamic `await import`) — no circular dependency, simpler
- `startMainAgent` in AgentService unchanged for T12 — plan says "Keep it simple for T12"
- All callers that don't pass `subModuleDirs` get default `[]` from `subModuleDirs ?? []`

### Verification
- `npx tsc --noEmit` — zero AgentManager/AgentService errors
- All errors are pre-existing JSX/React issues in `src/tui/*.tsx` (unrelated)
