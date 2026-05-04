# Learnings: Refactor electron/main.ts

## Key decisions

### 1. Orchestrator created inside project:scan, not at module level
`AgentOrchestrator` holds `graph`, `projectRoot`, `workspaceRoot`, `codeSource` as constructor params (private). These are set during `project:scan`. Creating the orchestrator at module level with dummy values would require either mutable setters (the class doesn't have them) or recreating on each scan. Chose: create lazily inside `project:scan`, set `orchestrator = new ...`, and guard all IPC handlers with `if (!orchestrator) return { error: 'no module graph loaded' }`.

### 2. Eliminated local `agents` Map
Original code had its own `Map<string, AgentEntry>` for tracking running agents. After refactoring, `orchestrator.getAgent()` / `orchestrator.listAgents()` serve the same purpose. Updated `agent:cancel`, `agent:stop`, `agent:isRunning`, `agent:getRunning` IPC handlers to use orchestrator methods instead. The orchestrator's `AgentEntry` has `.launched.connection` and `.launched.process` — path is one level deeper but functionally identical.

### 3. McpBackend integration uses callbacks
`McpBackendServer` is callback-based. The `getAgentEntry` callback wraps `orchestrator.getAgent()` and returns `{ launched, sessionId }` (the shape McpBackend expects). The `startAgent` callback calls `orchestrator.startAgent()` and converts Promise<AgentEntry> → Promise<boolean>. The `buildPromptBlocks` callback uses the shared `buildPromptBlocks()` function with captured closure variables (`currentGraph`, `prompts`, `sessionPrompted`).

### 4. Workspace isolator adapter objects
`AgentOrchestrator` requires `WorkspaceIsolator`, `PromptBuilder`, `McpServerBuilder` interfaces. The standalone functions from shared modules match these interfaces exactly, so simple object literals (`{ workspacePathForModule, ... }`) serve as adapters.

### 5. Orchestrator state wiring
`orchestrator.mcpBackendPort` and `orchestrator.mcpGraphFile` are public properties (not private). Set them AFTER both the orchestrator and mcpBackend are created, so the orchestrator's `startAgent()` can pass them to `buildMcpServers()`.

### 6. sendCrossContext channel preservation
Original used `'agent:cross-context'` channel with object payload `{ moduleName, crossModule, direction, phase, content, time }`. Preserved exact same format in both the orchestrator callback and the mcpBackend callback.

### 7. agent:start no longer needs cwd/config params from renderer
The orchestrator's `startAgent()` handles cwd resolution and config loading internally. The original handler accepted `_cmd`, `_args`, `cwd` from the renderer but config always overrode them anyway. Removed the passing — the orchestrator loads config from project, which matches original behavior.

### 8. Build: esbuild bundles shared modules
The `build:main` esbuild config does NOT list `../src/agents/*` as externals, so the shared modules (WorkspaceIsolator, PromptBuilder, McpServerBuilder, McpBackend, AgentOrchestrator) are all bundled into `electron/main.cjs`. No build config changes needed.

## What was removed (753 → 386 lines)
- 11 inline functions (~280 lines of body)
- `cachedMainPrompt`, `cachedSubPrompt` (replaced by `prompts` from `loadSystemPrompts()`)
- `gitCacheDir` Map (now `orchestrator.gitCacheDir`)
- `agents` Map (now `orchestrator.getAgent()`)
- `mcpBackendServer` raw http.Server (now `mcpBackend` McpBackendServer instance)
- `ensureModuleAgentRunning` (merged into `startAgent` pipeline)
- Unused imports: `fse`, `http`, `ClientSideConnection`, `SessionNotification`, `ContentBlock`, `McpServer`, `ChildProcess`

## Diff review findings (task 15)

### All 8 IPC handlers verified — no signature breaks
- agent:start, agent:send, agent:cancel, agent:stop, agent:isRunning, agent:getRunning, project:scan, config:save, config:get — all signatures identical between old and new.
- `cwd` renamed to `_cwd` in agent:start (same string type, unused param).

### Zero orphaned references
- `grep` across entire repo confirmed: `ensureModuleAgentRunning`, `startMcpBackend`, `gitCacheDir` — only in their new module homes (AgentOrchestrator, WorkspaceIsolator).
- `fs-extra` / `fse` and `http` imports fully removed from electron/.

### All 12 old functions migrated
- 11 local functions + `AgentEntry` interface + `agents` Map — all replaced by 5 dedicated modules.

### Build: zero errors in refactored files
- `npx tsc --noEmit` shows zero errors in `electron/main.ts`, `src/agents/{AgentOrchestrator,McpBackend,McpServerBuilder,PromptBuilder,WorkspaceIsolator}.ts`.
- All pre-existing errors are in `src/tui/**/*.tsx` (React JSX type defs).

### Minor note (non-blocking)
- `agent:stop` uses `orchestrator!.agents.delete(moduleName)` — direct public Map access rather than `orchestrator.stopAgent()`. Functionally equivalent, just a design nit.
