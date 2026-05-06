# Agent Backend Migration — 前后端职责分离

## TL;DR

> **Quick Summary**: 将 agent 状态管理（流数据累积、会话历史、状态追踪）从渲染进程 Pinia store 迁移到 Electron 主进程，渲染进程仅保留 UI 展示状态。定义新的 preload API 契约，合并多次 IPC 为单次调用，状态变更从轮询改为推送。
>
> **Deliverables**:
> - 主进程 `AgentStateManager` 类：流累积 + 上下文持久化 + 状态推送
> - 新的 preload/主进程 IPC 通道：`agent:send` (合并), `agent:status` (推送), `context:get`/`context:clear`
> - 渲染进程 `agentStore` 精简为 IPC 代理层
> - 首启时 `localStorage` → 磁盘自动迁移
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Wave 1 (主进程基础设施) → Wave 2 (IPC 通道) → Wave 3 (渲染进程精简)

---

## Context

### Original Request
将 agent 相关逻辑从渲染进程移到 Electron 主进程，桌面渲染进程仅负责渲染相关状态和逻辑。

### Interview Summary
经前后端分离审计确认，当前架构存在以下过度耦合：
- 流数据累积（chunk → 完整回复字符串）在渲染进程完成
- 会话历史 (`contextMap`) 仅存在于渲染进程 `localStorage`
- Agent 状态通过渲染进程每 3s 轮询同步（主进程已有 `agentStatus` Map）
- `sendMessage()` 串联 3 次 IPC：`agent:start` → `ensureStreamListener` → `agent:send`
- `cancelAgent()` 乐观更新渲染进程状态（IPC 未确认前已标记 `interrupted`）
- `stream_snapshot` localStorage 是脆弱的崩溃恢复 hack

### Metis Review
关键发现：
1. `agentCmd`/`agentArgs` 在渲染进程存有副本但**从未与 configStore 同步**（`setAgentConfig` 导出但无调用者），每条 ChatMsg 都标记 `agentCmd: 'opencode'` 而非实际配置 — 潜藏 bug
2. `ensureStreamListener` 不是 IPC 调用（只是本地 `ipcRenderer.on` 注册），实际 sendMessage 只有 **2 次** IPC
3. `saveContext()` 从 **6 个不同代码路径**触发（stream chunk、user msg、first chunk、cross-context、finish、snapshot restore）— 迁移时容易遗漏
4. 上下文文件需写入用户项目目录 (`.module-agent/context/`)，用原子写入防止崩溃损坏
5. 首启需从 `localStorage` 迁移旧数据到磁盘

### Guardrails Applied
- `AgentOrchestrator` / `AgentLauncher` / `ModuleScanner` / `ModuleGraph` **不动**
- Vue 组件模板和样式**不动** — 只改数据来源
- preload API 只增不减，逐步替换
- 上下文存储用 JSON 文件（匹配 localStorage 语义），**不加** SQLite/数据库
- 不添加任何 UI 功能（无分页、无搜索、无导出）
- 不碰 `src/cli/` / `src/tui/` 路径

---

## Work Objectives

### Core Objective
将 agent 状态管理完全移到主进程，渲染进程通过精简的 IPC 接口获取 UI 就绪的数据。

### Concrete Deliverables
- `src/agents/AgentStateManager.ts` — 流累积 + 上下文持久化 + 状态推送
- 新/修改 IPC 通道：`agent:send` (合并), `agent:cancel` (返回确认), `agent:status` (推送), `context:get`, `context:clear`, `context:clearAll`
- 精简 `src/renderer/src/stores/agent.ts` — 移除 `streamState` 累积、`contextMap` 持久化、轮询 timer、localStorage 读写
- 更新 `src/preload/index.ts` — 新的 `ModuleAgentApi` 类型
- 更新 `ContextCards.vue` / `StreamArea.vue` / `DrawerPanel.vue` — 数据来源从 store 改为 IPC

### Must Have
- 主进程流累积 (reply/thinking/tools)
- 主进程上下文持久化到磁盘（项目目录下 `.module-agent/context/`）
- Push-based agent 状态（替代轮询）
- 合并 send + start 为单次 IPC
- Cancel 返回确认后才变更渲染进程状态
- 首启 localStorage 迁移到磁盘

### Must NOT Have
- 数据库依赖（SQLite 等）
- SQL 查询 / 全文搜索
- 会话加密
- UI 分页 / 加载更多
- Agent 崩溃自动重启
- CLI/TUI 路径修改
- 跨模块消息的单独存储（仍与常规消息存在同一文件）
- 非文本流块的处理（仍只处理 `type === 'text'`）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (vitest + @vue/test-utils)
- **Automated tests**: Tests-after (更新现有测试以匹配新架构，可能添加集成测试)
- **Framework**: vitest

### QA Policy
Every task MUST include agent-executed QA scenarios:
- **CLI/API**: `curl` + `bash` 验证主进程 IPC 返回结构
- **UI**: Playwright 验证渲染进程正确显示从主进程获取的数据
- **Evidence**: `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — main process infrastructure):
├── Task 1: AgentStateManager class skeleton + types [deep]
├── Task 2: Stream accumulation in main process [deep]
├── Task 3: Context persistence (disk read/write) [deep]
└── Task 4: Push-based status events [quick]

Wave 2 (After Wave 1 — IPC rework, MAX PARALLEL):
├── Task 5: Consolidated agent:send IPC handler [deep]
├── Task 6: Agent:cancel with confirmation [quick]
├── Task 7: Context IPC (get/clear/clearAll) [quick]
├── Task 8: New preload API surface + types [deep]
└── Task 9: localStorage migration on first launch [quick]

Wave 3 (After Wave 2 — renderer cleanup, MAX PARALLEL):
├── Task 10: Strip agentStore: remove streamState/cumulative, poll timer, localStorage RW [deep]
├── Task 11: Update DrawerPanel to use new IPC flow [deep]
├── Task 12: Update ContextCards/StreamArea to receive pre-assembled data [visual-engineering]
├── Task 13: Update existing tests [unspecified-high]
└── Task 14: Cleanup dead code (agentCmd/agentArgs in store) [quick]

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review
├── Task F3: Real manual QA (playwright)
└── Task F4: Scope fidelity check
```

**Critical Path**: Task 1 → Task 1.5 (typecheck) → Task 5 → Task 6 → Task 7 → Task 8 → Task 10

---

## TODOs

- [x] 1. AgentStateManager class skeleton + types

  **What to do**:
  - Create `src/agents/AgentStateManager.ts` with:
    - `streamAccumulator: Map<string, { reply, thinking, tools, finished, sections }>`
    - `contextStore: Map<string, ChatMsg[]>` (in-memory cache)
    - `contextBaseDir: string` (set to `<projectRoot>/.module-agent/context/`)
  - Type definition for `StreamAccumulator` and `StreamSection` interfaces
  - Methods: `initContextDir()`, `startStream(moduleName)`, `appendChunk(moduleName, type, text)`, `finishStream(moduleName)`, `cancelStream(moduleName)`, `stopStream(moduleName)`
  - Export as singleton or instantiable class

  **Must NOT do**:
  - Do NOT modify `AgentOrchestrator` or `AgentLauncher`
  - Do NOT add database dependencies

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: New module with complex state management and concurrency considerations
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundational)
  - **Parallel Group**: Wave 1 (start immediately)
  - **Blocks**: Task 2, 3, 4, 5, 6, 7, 10
  - **Blocked By**: None

  **References**:
  - `src/renderer/src/stores/agent.ts:14-20` — Current streamState structure to replicate
  - `src/renderer/src/stores/agent.ts:21` — Current contextMap type
  - `src/types/preload.ts:26-38` — ChatMsg interface
  - `src/main/index.ts:42-53` — Existing main process global state pattern

  **Acceptance Criteria**:
  - [ ] `AgentStateManager` class compiles without errors
  - [ ] All methods have proper TypeScript types

  **QA Scenarios**:
  ```
  Scenario: Class instantiation
    Tool: Bash (node REPL)
    Preconditions: None
    Steps:
      1. Import AgentStateManager
      2. Create instance with contextBaseDir = '/tmp/test-context'
      3. Call initContextDir()
    Expected Result: Directory created, no errors
    Evidence: .sisyphus/evidence/task-1-init.txt
  ```

  **Commit**: YES
  - Message: `refactor(agent): add AgentStateManager class skeleton`
  - Files: `src/agents/AgentStateManager.ts`

- [x] 2. Stream accumulation in main process

  **What to do**:
  - Implement `appendChunk(moduleName, updateType, data)` in AgentStateManager
  - Handle 4 update types: `agent_message_chunk` → reply, `agent_thought_chunk` → thinking, `tool_call` → tools, `plan` → reply annotation
  - Implement `getStreamState(moduleName)` returning accumulated state for push to renderer
  - Wire into `main/index.ts` `onSessionUpdate` callback — call `stateManager.appendChunk()` BEFORE `webContents.send`
  - The `agent:stream` event should now carry accumulated state, not raw ACP chunks
  - Update `AgentStreamData` type in `preload.ts` to reflect new payload shape

  **Must NOT do**:
  - Do NOT change the `onSessionUpdate` callback signature
  - Do NOT add new stream event types beyond the existing 4

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires careful integration with existing stream callback, type changes across IPC boundary
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 5, 6, 10, 11, 12
  - **Blocked By**: Task 1

  **References**:
  - `src/main/index.ts:160-168` — Current onSessionUpdate that relays raw data
  - `src/renderer/src/stores/agent.ts:273-339` — Current stream accumulation logic (to replicate in main)
  - `src/types/preload.ts:40-46` — AgentStreamData interface (to update)
  - `src/renderer/src/stores/__tests__/stream.test.ts:52-97` — Test expectations for accumulation

  **Acceptance Criteria**:
  - [ ] Stream chunks accumulate correctly in main process
  - [ ] `getStreamState()` returns complete accumulated data
  - [ ] `agent:stream` events carry structured state, not raw chunks

  **QA Scenarios**:
  ```
  Scenario: 3 message chunks → concatenated reply
    Tool: Bash (node test script)
    Preconditions: AgentStateManager initialized
    Steps:
      1. Call appendChunk('mod', 'agent_message_chunk', { content: { type: 'text', text: 'Hello' } })
      2. Call appendChunk('mod', 'agent_message_chunk', { content: { type: 'text', text: ' World' } })
      3. Call getStreamState('mod')
    Expected Result: reply === 'Hello World', sections.reply === true
    Evidence: .sisyphus/evidence/task-2-accumulate.txt

  Scenario: Tool call accumulation
    Tool: Bash (node test script)
    Preconditions: AgentStateManager initialized
    Steps:
      1. Call appendChunk('mod', 'tool_call', { title: 'read_file', kind: 'read', status: 'completed' })
      2. Call getStreamState('mod')
    Expected Result: tools contains '[read] read_file (completed)'
    Evidence: .sisyphus/evidence/task-2-tools.txt
  ```

  **Commit**: YES
  - Message: `refactor(agent): move stream accumulation to main process`
  - Files: `src/agents/AgentStateManager.ts`, `src/main/index.ts`, `src/types/preload.ts`

- [x] 3. Context persistence (disk read/write)

  **What to do**:
  - Implement `saveContext(moduleName)` — writes `contextMap[moduleName]` to `<contextBaseDir>/<moduleName>.json` using atomic write (write to `.tmp` then `fs.rename`)
  - Implement `loadContext(moduleName)` — reads from disk, returns `ChatMsg[]`
  - Implement `clearContext(moduleName)` — deletes file
  - Implement `clearAllContexts()` — removes all files in contextBaseDir
  - ContextBaseDir = `<currentProjectRoot>/.module-agent/context/`
  - Handle: directory doesn't exist → create it; file doesn't exist → return empty array
  - Add `setContextBaseDir(baseDir: string)` method for project switching

  **Must NOT do**:
  - Do NOT use sync file operations (`fs.writeFileSync`) — use `fs.promises`
  - Do NOT store context outside the project's `.module-agent/` directory

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: File I/O with atomic writes, concurrency considerations
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 5, 7, 9, 10
  - **Blocked By**: Task 1

  **References**:
  - `src/renderer/src/stores/agent.ts:67-86` — Current saveContext/loadContext logic
  - `src/renderer/src/stores/agent.ts:94-103` — Current clearContext
  - `src/renderer/src/stores/agent.ts:105-118` — Current clearAllContexts
  - `src/main/index.ts` — `fs` imports, pattern for file operations in main process
  - `src/agents/McpServerBuilder.ts` — Example of writing files to project directory

  **Acceptance Criteria**:
  - [ ] `saveContext` writes valid JSON to disk
  - [ ] `loadContext` reads from disk, returns `ChatMsg[]`
  - [ ] Atomic write: partial writes don't corrupt existing file
  - [ ] `clearContext` removes file from disk

  **QA Scenarios**:
  ```
  Scenario: Save and load context roundtrip
    Tool: Bash (node test script)
    Preconditions: contextBaseDir = '/tmp/test-context'
    Steps:
      1. Create ChatMsg[] with 2 messages
      2. Call saveContext('mod-test', msgs)
      3. Call loadContext('mod-test')
    Expected Result: Returns 2 messages with matching content
    Evidence: .sisyphus/evidence/task-3-roundtrip.txt

  Scenario: Clear context removes file
    Tool: Bash (ls)
    Preconditions: File exists from previous scenario
    Steps:
      1. Call clearContext('mod-test')
      2. Check if file exists
    Expected Result: File does not exist
    Evidence: .sisyphus/evidence/task-3-clear.txt
  ```

  **Commit**: YES
  - Message: `refactor(agent): add context persistence to disk`
  - Files: `src/agents/AgentStateManager.ts`

- [x] 4. Push-based agent status events

  **What to do**:
  - In `main/index.ts`, at EVERY `agentStatus.set()` call site (currently lines 268, 282, 295, 308, 319), add `mainWindow?.webContents.send('agent:status', { name: moduleName, status })`
  - New IPC channel: `agent:status` (push from main → renderer)
  - Add `agent:status` to preload `onAgentStatus` listener in `src/preload/index.ts`
  - In agentStore: remove polling timer (`startRunningPoll`/`stopRunningPoll`), replace with `ensureStatusListener()` that reacts to push events
  - Add status listener lifecycle management

  **Must NOT do**:
  - Do NOT remove the `agent:getRunning` handler yet (existing consumers may need it)
  - Do NOT change `agentStatus` Map structure

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Follows existing IPC event pattern, mostly wiring
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 9)
  - **Parallel Group**: Wave 1/2
  - **Blocks**: Task 10
  - **Blocked By**: Task 1

  **References**:
  - `src/main/index.ts:268` — agentStatus.set('error') at agent:start failure
  - `src/main/index.ts:282` — agentStatus.set('streaming')
  - `src/main/index.ts:295` — agentStatus.set('idle')
  - `src/main/index.ts:308` — agentStatus.set('idle') at cancel
  - `src/main/index.ts:319` — agentStatus.delete at stop
  - `src/preload/index.ts:27-31` — Pattern for event listeners (onAgentStream)
  - `src/renderer/src/stores/agent.ts:440-452` — Current polling to remove

  **Acceptance Criteria**:
  - [ ] Status change in main process triggers `agent:status` push event
  - [ ] Renderer updates `runningAgents` from push events
  - [ ] Polling timer removed from agentStore

  **QA Scenarios**:
  ```
  Scenario: Status push on stream start
    Tool: Bash (node test script)
    Preconditions: AgentStateManager + orchestrator ready
    Steps:
      1. Send message to agent (triggers streaming)
      2. Listen for agent:status events
    Expected Result: Event with status: 'streaming' received
    Evidence: .sisyphus/evidence/task-4-status.txt
  ```

  **Commit**: YES
  - Message: `refactor(agent): push-based agent status, remove polling`
  - Files: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/stores/agent.ts`

---



- [x] 5. Consolidated agent:send IPC handler

  **What to do**:
  - New IPC handler `agent:send` replaces the two-step `agent:start` + `agent:send`
  - Handler logic: check if agent running → if not, start it via orchestrator → build prompt blocks → send via ACP → accumulate stream in stateManager → wait for finish → return accumulated `{ reply, thinking, tools }` as result
  - Update preload `sendMessage` to call the new handler
  - In agentStore `sendMessage()`: single IPC call, no manual startAgent or finishStream
  - Add `sendingLock` (per-module Map) in main process to prevent concurrent sends

  **Must NOT do**:
  - Do NOT remove the old `agent:start` handler yet (keep for backward compat during migration)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex IPC handler consolidation, per-module locking, proper error handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 10, 11
  - **Blocked By**: Task 1, 2, 3

  **References**:
  - `src/main/index.ts:257-271` — Current agent:start handler
  - `src/main/index.ts:273-302` — Current agent:send handler
  - `src/main/index.ts:282-295` — Prompt building + ACP prompt call
  - `src/renderer/src/stores/agent.ts:385-427` — Current sendMessage (to consolidate)
  - `src/renderer/src/stores/agent.ts:208-268` — Current finishStream (to move to main)
  - `src/main/index.ts:43` — `lastSent` dedup pattern

  **Acceptance Criteria**:
  - [ ] Single `agent:send` IPC starts agent if needed AND sends message
  - [ ] Result includes accumulated reply/thinking/tools
  - [ ] Per-module sending lock prevents concurrent sends
  - [ ] Error path properly handles start failure, send failure

  **QA Scenarios**:
  ```
  Scenario: Send to cold module (auto-start)
    Tool: Bash (curl-like test via IPC)
    Preconditions: No agent running for module
    Steps:
      1. Invoke agent:send for module that has no running agent
      2. Wait for result
    Expected Result: Returns { reply: '...', thinking: '...', tools: '...' }, agent started automatically
    Failure Indicators: { error: '...' } without reply
    Evidence: .sisyphus/evidence/task-5-cold-send.txt

  Scenario: Concurrent send blocked
    Tool: Bash (node test script)
    Preconditions: Agent running for module
    Steps:
      1. Send message A to module
      2. Immediately send message B to same module
    Expected Result: Message B rejected or queued
    Evidence: .sisyphus/evidence/task-5-lock.txt
  ```

  **Commit**: YES
  - Message: `refactor(ipc): consolidate agent:send to single IPC with auto-start`
  - Files: `src/main/index.ts`, `src/renderer/src/stores/agent.ts`

- [x] 6. Agent:cancel with confirmation

  **What to do**:
  - Update `agent:cancel` IPC handler to return `{ success: true, accumulated: { reply, thinking, tools } }` instead of `{}`
  - Before cancelling, capture accumulated stream state from stateManager
  - In agentStore `cancelAgent()`: wait for IPC result, THEN update local message status to 'interrupted'
  - Remove the optimistic local state mutation
  - Update preload return type

  **Must NOT do**:
  - Do NOT change the ACP `connection.cancel()` call itself

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small IPC handler change + renderer store change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 7, 8, 9)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 10
  - **Blocked By**: Task 1, 2

  **References**:
  - `src/main/index.ts:304-312` — Current cancel handler
  - `src/renderer/src/stores/agent.ts:371-383` — Current cancelAgent (optimistic)
  - `src/renderer/src/components/StreamArea.vue:35-37` — Cancel button
  - `src/renderer/src/components/ContextCards.vue:95-97` — Cancel button

  **Acceptance Criteria**:
  - [ ] Cancel returns accumulated stream state
  - [ ] Renderer updates message status ONLY after IPC resolves
  - [ ] Cancel button still works in StreamArea and ContextCards

  **QA Scenarios**:
  ```
  Scenario: Cancel during streaming
    Tool: Bash (node test script)
    Preconditions: Agent streaming
    Steps:
      1. Invoke agent:cancel
      2. Check return value
    Expected Result: { success: true, accumulated: { reply: 'partial text...' } }
    Evidence: .sisyphus/evidence/task-6-cancel.txt
  ```

  **Commit**: YES
  - Message: `refactor(ipc): agent:cancel returns confirmation with accumulated state`
  - Files: `src/main/index.ts`, `src/renderer/src/stores/agent.ts`

- [x] 7. Context IPC (get/clear/clearAll)

  **What to do**:
  - New IPC handler `context:get(moduleName)` → loads from stateManager disk store, returns `ChatMsg[]`
  - New IPC handler `context:clear(moduleName)` → deletes file, clears in-memory cache
  - New IPC handler `context:clearAll()` → removes all context files
  - Update preload API: `getContext(moduleName)`, `clearContext(moduleName)`, `clearAllContexts()`
  - In agentStore: replace localStorage-backed `restoreContext`/`clearContext`/`clearAllContexts` with IPC calls
  - In DrawerPanel.vue: `restoreContext` call in `watch` now goes through IPC

  **Must NOT do**:
  - Do NOT send full context arrays without size limits (add optional `limit` param, default 200)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward IPC handlers → disk I/O wrappers
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6, 8, 9)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 10, 11
  - **Blocked By**: Task 1, 3

  **References**:
  - `src/main/index.ts:100-105` — Pattern for IPC handlers
  - `src/preload/index.ts:13-14` — Pattern for IPC invoke wrappers
  - `src/renderer/src/stores/agent.ts:82-92` — Current restoreContext (to replace)
  - `src/renderer/src/stores/agent.ts:94-118` — Current clearContext/clearAllContexts

  **Acceptance Criteria**:
  - [ ] `context:get` returns messages from disk, falls back to empty array
  - [ ] `context:clear` removes file from disk
  - [ ] Renderer no longer reads `localStorage` for context

  **QA Scenarios**:
  ```
  Scenario: Get context after save
    Tool: Bash (node test script)
    Preconditions: Context saved for module
    Steps:
      1. Invoke context:get for module
      2. Check returned messages
    Expected Result: Array of ChatMsg with matching content
    Evidence: .sisyphus/evidence/task-7-get.txt
  ```

  **Commit**: YES
  - Message: `refactor(ipc): add context get/clear/clearAll IPC handlers`
  - Files: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/stores/agent.ts`

- [x] 8. New preload API surface + types

  **What to do**:
  - Update `ModuleAgentApi` in `src/types/preload.ts`:
    - Replace `startAgent` + `sendMessage` → single `sendMessage(moduleName, text, cwd): Promise<{ reply, thinking, tools, stopReason?, error? }>`
    - Update `cancelAgent` return type: `Promise<{ success: boolean, accumulated: { reply, thinking, tools } }>`
    - Add `getContext(moduleName): Promise<ChatMsg[]>`
    - Add `clearContext(moduleName): Promise<void>`
    - Add `clearAllContexts(): Promise<void>`
    - Add `onAgentStatus(callback): () => void` for `agent:status` push events
    - Update `onAgentStream` callback type to receive accumulated state, not raw ACP
    - Keep `stopAgent`, `isAgentRunning`, `getRunningAgents` for now
  - Update `src/preload/index.ts` to match
  - The `AgentStreamData` type should now carry `reply`/`thinking`/`tools` strings, not raw `data` object

  **Must NOT do**:
  - Do NOT remove any API without verifying zero callers
  - Do NOT change the preload's `contextBridge` pattern

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Type definition is the contract between front/backend — must be exhaustive and correct
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6, 7, 9)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 10, 11, 12
  - **Blocked By**: Task 1

  **References**:
  - `src/types/preload.ts:64-108` — Current ModuleAgentApi interface
  - `src/preload/index.ts` — Current preload implementation
  - `src/renderer/src/stores/agent.ts` — All current API usages to verify coverage

  **Acceptance Criteria**:
  - [ ] New `ModuleAgentApi` covers all renderer needs
  - [ ] Type imports compile across all files
  - [ ] No unused API methods remain

  **QA Scenarios**:
  ```
  Scenario: Type check passes
    Tool: Bash (npm run typecheck)
    Preconditions: All files updated to use new types
    Steps:
      1. Run npm run typecheck
    Expected Result: No errors in changed files
    Evidence: .sisyphus/evidence/task-8-typecheck.txt
  ```

  **Commit**: YES
  - Message: `refactor(types): update preload API surface for backend migration`
  - Files: `src/types/preload.ts`, `src/preload/index.ts`

- [x] 9. localStorage migration on first launch

  **What to do**:
  - In `main/index.ts` after IPC handlers registered, check via IPC if renderer has old `localStorage` data
  - New IPC channel: `migrate:check` → renderer checks `localStorage` for `ctx_*` and `stream_snapshot` keys
  - If data found: renderer sends them to main process via `migrate:data`
  - Main process writes to disk via stateManager
  - Renderer clears `localStorage` keys after successful migration
  - `migrate:data` handler reads the data and calls `saveContext()` for each module

  **Must NOT do**:
  - Do NOT assume migration data is valid JSON — wrap in try/catch
  - Do NOT block app startup on migration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward IPC + file write
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6, 7, 8)
  - **Parallel Group**: Wave 2
  - **Blocks**: None (runs once, after migration renderer no longer uses localStorage)
  - **Blocked By**: Task 1, 3

  **References**:
  - `src/renderer/src/stores/agent.ts:70` — CTX_PREFIX key format
  - `src/renderer/src/stores/agent.ts:6` — LS_STREAM_SNAPSHOT key
  - `src/renderer/src/stores/agent.ts:76-80` — loadContext format
  - `src/renderer/src/stores/agent.ts:155-185` — restoreStreamSnapshot format

  **Acceptance Criteria**:
  - [ ] Old `ctx_*` keys migrated to disk files
  - [ ] `stream_snapshot` key migrated and deleted
  - [ ] After migration, `localStorage.getItem('ctx_...')` returns null
  - [ ] Migration failure doesn't crash the app

  **QA Scenarios**:
  ```
  Scenario: Migration with existing data
    Tool: Bash (node test script)
    Preconditions: localStorage has ctx_mod-test key with valid JSON
    Steps:
      1. Start migration
      2. Check disk file exists at contextBaseDir/mod-test.json
      3. Check localStorage key is deleted
    Expected Result: File matches localStorage content, key removed
    Evidence: .sisyphus/evidence/task-9-migrate.txt

  Scenario: No data to migrate (clean state)
    Tool: Bash (node test script)
    Preconditions: localStorage has no ctx_* keys
    Steps:
      1. Start migration
    Expected Result: No error, no files created
     Evidence: .sisyphus/evidence/task-9-noop.txt
  ```

  **Commit**: YES
  - Message: `feat(agent): migrate localStorage context to disk on first launch`
  - Files: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/stores/agent.ts`

---

- [x] 10. Strip agentStore: remove streamState/cumulative, poll timer, localStorage RW

  **What to do**:
  - Remove: `streamState`, polling timer, `streamSaveTimer`, `saveStreamSnapshot`/`restoreStreamSnapshot`/`clearStreamSnapshot`, `saveContext`/`loadContext`/`restoreContext`, `liveMsgId`, `agentCmd`/`agentArgs`, `setAgentConfig`, `getStreamState`
  - Keep: `runningAgents` (push), `contextMap` (IPC), `sendingLock` (simplified), status listener, `crossContextCleanup`, `cancelAgent` (IPC-wait), `sendMessage` (single IPC), `getMsgs`, `clearContext`/`clearAllContexts` (IPC wrappers)
  - **Must NOT**: remove `contextMap` ref — Vue components depend on its reactivity
  - **Agent**: `deep` | Wave 3 | Blocks 11,12 | Blocked by 1-8
  - **Refs**: `agent.ts` full, `MainView.vue:44-49,93,110`
  - Commit: `refactor(renderer): strip agentStore to IPC proxy layer`

- [x] 11. Update DrawerPanel to use new IPC flow
  - Verified: watch → restoreContext uses IPC getContext; handleSendMessage single IPC ✅
- [x] 12. Update ContextCards/StreamArea for backend-driven state
  - Verified: msgs reactive from IPC-backed getMsgs; cancelAgent awaits IPC ✅

- [x] 13. Update existing tests
  - Update agent.test.ts, stream.test.ts; add mock for new IPC handlers
  - **Agent**: `unspecified-high` | Wave 3 (sequential) | Blocked by 10-12
  - **Refs**: `agent.test.ts`, `stream.test.ts`, `moduleAgent.ts` mock
  - Commit: `test(renderer): update tests for backend migration`

- [x] 14. Cleanup dead code
  - Remove uncalled exports from agentStore; remove old IPC handlers if unused; verify typecheck
  - **Agent**: `quick` | Wave 3 (last) | Blocked by 13
  - **Refs**: `agent.ts` exports, `main/index.ts:257-328`
  - Commit: `chore: remove dead code after backend migration`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle` → `APPROVE` (B1+B2 fixed: history preserved, project-relative dir)
- [x] F4. **Scope Fidelity Check** — `deep` → `APPROVE` (all 7 exclusions verified clean)

---

## Commit Strategy

- **Wave 1**: `refactor(agent): add AgentStateManager with stream accumulation and context persistence` ✅ (4 commits)
- **Wave 2**: `refactor(ipc): consolidate agent IPC, add push-based status` ✅ (5 commits)
- **Wave 3**: `refactor(renderer): strip agentStore to IPC proxy layer` ✅ (2 commits)

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck        # ✅ Zero new errors (112 pre-existing unrelated)
npm run test             # ✅ 23/28 pass (5 pre-existing SVGTree failures)
```

### Final Checklist
- [x] `streamState` 完全从渲染进程移除
- [x] `contextMap` 持久化在磁盘，非 localStorage
- [x] `agent:send` 单次 IPC 完成 start + send + accumulate
- [x] Agent 状态通过 `agent:status` 推送
- [x] 旧 `localStorage` 数据迁移到磁盘
- [x] 多模块同时流式输出无干扰
- [x] 应用重启后上下文恢复
