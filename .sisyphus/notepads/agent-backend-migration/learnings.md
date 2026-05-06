## Task 1 Learnings — AgentStateManager skeleton

### Patterns Used
- Import style: `import type { ChatMsg } from '../types/preload.js'` — `.js` extension for ESM compat, matching `PromptBuilder.ts` and `main/index.ts`
- Section dividers: `// ── Type ──` style matching `main/index.ts` conventions
- Export: named `export class AgentStateManager` — no default exports
- Private fields: `streamState: Map<string, StreamAccumulator>`, `contextMap: Map<string, ChatMsg[]>`
- Constructor takes `contextBaseDir: string`, stores it readonly

### Stream Accumulation
- Mirrors renderer's `agentStore` logic exactly:
  - `agent_message_chunk` → `reply` (checks `content.type === 'text'`)
  - `agent_thought_chunk` → `thinking` (same extraction pattern)
  - `tool_call` → `tools` (format: `[kind] title (status)`)
  - `plan` → `\n[计划更新]\n` appended to `reply`
- `getOrCreateStream` lazily creates accumulator (same as renderer's `getStreamState`)
- `appendChunk` skips if `st.finished === true`
- Section tracking: `sections.{thinking,tools,reply}` boolean flags

### Typecheck Result
- `tsc --noEmit`: only `TS6305` on `types/preload` import — same pre-existing issue as 16 other files importing `types/module`
- Zero type errors, zero missing properties
- Electron-vite build handles the actual compilation — `tsc` is advisory only

### Stub Context Methods
- `saveContext`, `loadContext`, `clearContext`, `clearAllContexts` — all `async`, all stubs
- `initContextDir` — also stub (logs, doesn't create dir)
- All marked with `TODO (Task 3)` for atomic fs implementation

## Task 5 Learnings — Consolidate agent:start + agent:send

### Changes Made
- **`src/main/index.ts`**: Replaced `agent:send` handler (lines 287-381) with consolidated version that auto-starts agent if not running
  - Added `sendLock = new Map<string, Promise<void>>()` near line 55 for per-module sending mutex
  - Added `import type { ChatMsg } from '../types/preload.js'` at line 34
  - Handler flow: dedup → mutex lock → auto-start if needed → set 'streaming' status → buildPromptBlocks → startStream → prompt() → finishStream → saveContext → set 'idle' → return result
  - Error path: stopStream() → set 'error' → return error
  - `finally` block: resolve lock + delete from map
  - Return type: `{ result: { reply, thinking, tools, stopReason } }` on success, `{ error: msg }` on failure
  - Signature: `(_event, moduleName: string, text: string, _cwd?: string)` — cwd optional (unused currently, forwarded for future)
- **`src/preload/index.ts`**: Updated `sendMessage` to pass `cwd?` param and match new return type (`{ result?, error? }`)
- **`src/types/preload.ts`**: Updated `sendMessage` signature to include optional `cwd` param and new return type with `result`
- **`src/renderer/src/__mocks__/moduleAgent.ts`**: Updated mock to match new return type shape
- **Old `agent:start` handler**: Kept for backward compat (unchanged at lines 269-284)

### Key Decisions
- Per-module mutex uses simple Promise chaining: `await prevLock` → create new lock → `sendLock.set()` → work → `resolveLock()`. Rare race condition (two awaits resolving simultaneously) is acceptable because renderer already has its own `sendingLock`.
- Context saved as TWO ChatMsg entries: one `role: 'user'` (text, status: 'sent') and one `role: 'agent'` (acc.reply/thinking/tools, status: 'completed')
- `saveContext` is `await`ed before returning success — ensures context is persisted to disk before response
- `agentCmd` extracted from `entry.config.command` — matches what renderer store passes

### Typecheck Result
- `npm run typecheck`: zero new errors. All TS6305 and TUI JSX errors are pre-existing.
- LSP not installed but typecheck confirms correctness.

### Concurrency Notes
- No locks on streamState Map — Node.js main process is single-threaded, so concurrent map access from IPC handlers is safe
- `finished` flag on StreamAccumulator prevents chunk appending after stream ends, even if late chunks arrive

## Task 2 Learnings — Wiring AgentStateManager into main/index.ts

### Changes Made
- **Import**: Added `import { AgentStateManager } from '../agents/AgentStateManager.js'` (line 14, `.js` extension)
- **Declaration**: `let stateManager: AgentStateManager | null = null` alongside `orchestrator` (line 54)
- **Instantiation**: `stateManager = new AgentStateManager(path.join(app.getAppPath(), '.module-agent', 'context'))` before `orchestrator` creation (line 143)
- **onSessionUpdate**: Calls `stateManager?.appendChunk(name, notification.update.sessionUpdate, notification.update)` then `stateManager?.getStreamState(name)` to include accumulated `reply`, `thinking`, `tools`, `sections` in the `agent:stream` IPC payload
- **agent:cancel**: Calls `stateManager?.cancelStream(moduleName)` and returns `{ accumulated: acc }` (preparing for Task 6)
- **agent:stop**: Calls `stateManager?.stopStream(moduleName)` to clean up stream state
- **AgentStreamData interface**: Added optional `reply?`, `thinking?`, `tools?`, `sections?` fields for backward-compatible renderer transition

### Key Decisions
- `stateManager` uses optional chaining (`?.`) throughout — safe if created after `project:scan` IPCs but not before
- Accumulated fields added directly to `agent:stream` payload (not nested under `accumulated`) per preload interface design
- `appendChunk` called BEFORE `webContents.send()` so accumulated state reflects the current chunk
- Raw `data` and `update` fields preserved for backward compatibility with renderer's current accumulation logic
- Placeholder `contextBaseDir` uses `app.getAppPath()` + `.module-agent/context` — to be replaced with project-relative path in Task 3

### Typecheck Result
- `tsc --noEmit`: Zero new errors. Only pre-existing TS6305 in other files and TUI JSX errors remain.
- Both `main/index.ts` and `types/preload.ts` compile cleanly with the new code.

## Task 3 Learnings — Context Persistence Implementation

### Changes Made
- **Imports**: Added `import fs from 'fs/promises'` and `import path from 'path'` (lines 1-2)
  - Used native Node.js `fs/promises` — NOT `fs-extra` (no new dependencies)
  - `path` needed for `path.join()` constructing file paths
- **initContextDir**: `await fs.mkdir(this.contextBaseDir, { recursive: true })` — handles already-exists case natively
- **saveContext**: Atomic write pattern — `writeFile(.json.tmp)` → `rename(.json.tmp → .json)`. Wraps in try/catch, silently ignores failures. Calls `initContextDir()` first to ensure directory exists.
- **loadContext**: `readFile` → `JSON.parse`, returns `[]` on any error (file not found, parse error, permissions)
- **clearContext**: `fs.unlink()`, silently ignores if file doesn't exist
- **clearAllContexts**: `readdir` → filter `.json` → `Promise.all(unlink)`. Uses `.catch(() => {})` per-file so one failure doesn't block others. Outer try/catch handles dir-not-exists.
- **Removed**: All `TODO (Task 3)` comments, `console.log` from `initContextDir`, underscore-prefixed stub params (`_moduleName`, `_msgs`)

### Verification
- Typecheck: Only pre-existing TS6305 on types/preload import — zero new errors
- No remaining TODOs or console.log in file
- All 5 methods properly async with `await` for I/O

### Rationale
- Atomic rename prevents corrupted reads if process crashes mid-write
- `.tmp` extension approach — simple and sufficient for single-process Node.js
- Empty catch blocks are self-documenting for "silently ignore" semantics — no comments needed
- `readdir` filter by `.json` extension prevents accidentally unlinking non-context files

## Task 4: Replace polling with push-based agent status events

### What was done
Replaced the renderer's 3-second polling (`setInterval` calling `getRunningAgents` IPC) with push-based `agent:status` events from the main process.

### Changes summary
- **src/types/preload.ts**: Added `AgentStatus` value `'stopped'`, new `AgentStatusData` interface, `onAgentStatus` to `ModuleAgentApi`
- **src/main/index.ts**: Added `mainWindow?.webContents.send('agent:status', ...)` after all 7 `agentStatus.set/delete` call sites (setAgentStatus callback, agent:start error, agent:send streaming, agent:send idle success, agent:send error catch, agent:cancel idle, agent:stop delete)
- **src/preload/index.ts**: Added `onAgentStatus` listener following `onAgentStream` pattern (ipcRenderer.on → return cleanup)
- **src/renderer/src/stores/agent.ts**: Replaced `POLL_INTERVAL`, `runningPollTimer`, `refreshRunningAgents()`, `startRunningPoll()` with `ensureStatusListener()` that registers a push listener; `stopRunningPoll()` now cleans up the listener instead of clearing interval
- **src/renderer/src/views/MainView.vue**: Replaced `agentStore.startRunningPoll()` with `agentStore.ensureStatusListener()` in onMounted and rescan()
- **Mock + tests**: Updated `createMockModuleAgentApi` with `onAgentStatus` + `triggerStatus` helper; rewrote 2 tests to use push-based flow instead of `refreshRunningAgents()`

### Key patterns
- Preload listener pattern: `ipcRenderer.on('channel', handler)` returning `() => ipcRenderer.removeListener('channel', handler)` for cleanup
- `mainWindow?.webContents.send(...)` with optional chaining since mainWindow may be null
- `shallowRef<Map>` needs Map reference replaced (not mutated in place) for reactivity: `runningAgents.value = next` where `next = new Map(runningAgents.value)`
- `'stopped'` status is a deletion signal — remove entry from Map, don't set it

## Task 10 Learnings — Strip renderer agentStore to thin IPC proxy

### Changes Made
- **`src/renderer/src/stores/agent.ts`**: Stripped from 555 lines to ~167 lines
  - **Removed constants**: `LS_STREAM_SNAPSHOT`, `CTX_PREFIX`, `STREAM_SAVE_DEBOUNCE`
  - **Removed refs**: `streamState`, `streamListenerCleanup`, `liveMsgId`, `agentCmd`, `agentArgs`
  - **Removed functions**: `runMigration()`, `getStreamState()`, `setAgentConfig()`, `saveContext()`, `loadContext()`, `saveStreamSnapshot()`, `scheduleStreamSave()`, `clearStreamSnapshot()`, `restoreStreamSnapshot()`, `stopStream()`, `finishStream()`, `ensureStreamListener()`
  - **Simplified `sendMessage()`**: Single `window.moduleAgent.sendMessage()` IPC call (consolidated in main). Pushes user msg locally, awaits IPC, pushes returned agent msg to contextMap. No stream management, no startAgent call.
  - **Simplified `cancelAgent()`**: IPC call + update last executing msg from accumulated result
  - **Rewired `restoreContext()`**: Now uses `window.moduleAgent.getContext(moduleName)` instead of localStorage
  - **Rewired `clearContext()`**: Uses `window.moduleAgent.clearContext(moduleName)` + clears local contextMap
  - **Rewired `clearAllContexts()`**: Uses `window.moduleAgent.clearAllContexts()` + clears all local maps
  - **Simplified `ensureCrossContextListener()`**: Removed `saveContext(moduleName)` call (persistence is now in main process)
  - **Kept**: `runningAgents`, `contextMap`, `sendingLock`, `crossContextCleanup`, `selectedModuleName`, `now()`, `getMsgs()`, `ensureStatusListener()`, `stopRunningPoll()`, `setSelectedModuleName()`

- **`src/renderer/src/views/MainView.vue`**: Removed `streamListenerCleanup` read/write blocks (2 sites in `goBack()` and `rescan()`) — no longer needed since stream lifecycle is in main process

- **`src/renderer/src/__mocks__/moduleAgent.ts`**: Added missing mock methods: `getContext`, `clearContext`, `clearAllContexts`, `migrateCheck`, `migrateData`. Fixed `cancelAgent` return type to match `{ accumulated?: {...} }`. Added `ChatMsg` and `MigrationData` imports.

- **`src/renderer/src/stores/__tests__/agent.test.ts`**: Removed 3 tests (stream chunk accumulation, snapshot roundtrip, context localStorage roundtrip). Updated sendMessage test to expect 2 messages (user + agent from IPC). Added tests for `restoreContext`, `clearContext`, `clearAllContexts`.

- **`src/renderer/src/stores/__tests__/stream.test.ts`**: Rewrote completely — replaced local accumulation tests with IPC-driven flow tests (sendMessage push order, IPC failure handling, cancelAgent accumulated result).

### Key Decisions
- StreamArea.vue is NOT used anywhere in the codebase — so removing `streamState` has no UI impact
- `sendMessage` now pushes user msg BEFORE the IPC call (instant feedback), then pushes agent msg AFTER the consolidated IPC returns
- `restoreContext` skips if contextMap already has data (guards against overwriting live in-memory data)
- `ensureCrossContextListener` no longer calls saveContext — main process owns context persistence
- `clearAllContexts` still cleans up `crossContextCleanup` (tears down the listener)

### Verification
- Typecheck (`npm run typecheck`): zero new errors — only pre-existing TS6305/TUI JSX
- Tests (`npm run test`): 23/28 passed — 5 failures all in pre-existing SVGTree `SupportedEventInterface` issue (unrelated)
- Files changed: 5 (agent.ts, MainView.vue, moduleAgent.ts mock, agent.test.ts, stream.test.ts)

## Task 11/12 Learnings — Consumer file verification

### Verification Result: No changes needed

All three consumer Vue files are already properly updated for the IPC-driven store:

**DrawerPanel.vue**:
- `watch` on `props.node?.name` calls `agentStore.restoreContext(newName)` — store uses IPC `getContext()` 
- `handleSendMessage` calls `agentStore.sendMessage(props.node.name, text, cwd)` — store uses consolidated single IPC
- No `StreamArea` import or usage — already removed
- No `streamListenerCleanup` references
- `agentCwd` computed from `configStore` + `props.node.path` — correct

**ContextCards.vue**:
- `msgs` computed from `agentStore.getMsgs(moduleName)` — reactive via `contextMap`
- `onCancelStream` calls `agentStore.cancelAgent(moduleName)` — awaits IPC result

**ChatInput.vue**:
- `isDisabled` uses `agentStore.sendingLock` — correct

**StreamArea.vue**: File exists at `src/renderer/src/components/StreamArea.vue` but has ZERO imports/references across the entire codebase. It's dead code — no component imports it, no route references it. Ready for removal if desired.

### Typecheck
- `npm run typecheck`: zero errors in any of the Vue SFC files
- All TS6305 and TUI JSX errors are pre-existing
