# TUI Interface

## TL;DR

> **Quick Summary**: 使用 Bun + OpenTUI + Solid.js 为 ModuleAgent 添加交互式终端 UI，包含流式上下文显示区、斜杠命令系统和设置向导。所有代码放在 `src/tui/` 目录，零破坏现有 CLI/Electron 路径。

> **Deliverables**:
> - `src/tui/` — TUI 完整实现（入口、组件、服务、类型）
> - 更新 `src/cli/index.ts` — `tui` 命令检测 Bun 并 exec 到 TUI 入口
> - `src/tui/bunfig.toml` + `src/tui/tsconfig.json` — Bun/Solid.js 构建配置

> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1 → Tasks 2-5 → Tasks 6-11 → Tasks 12-15

---

## Context

### Original Request
为项目添加 TUI 界面：上下文列表显示在上方，底部输入框，输入框下方状态栏（显示 agent 状态和工作目录），上下文区域动态显示流式输出，输入 "/" 显示候选命令列表。

### Interview Summary

**Key Discussions**:
- **运行时**: Bun 直接运行。CLI `tui` 命令检测 Bun，有则 exec，无则提示安装
- **Agent 通信**: 直接 inline AgentManager/AgentRouter（非子进程 NDJSON）
- **API 风格**: `@opentui/solid` Solid.js JSX 绑定
- **对话模式**: 单对话上下文，通过 `/list` 切换 agent
- **斜杠命令**: `/list`, `/get <name>`, `/mode <id>`, `/clear`, `/help`, `/quit`
- **设置向导**: 进入后检查运行目录有无 `.module-agent.json`；无则引导完整设置（agent 命令/参数、项目/工作区目录、代码来源）
- **上下文**: 不显示 module.md，ScrollBox 滚动 + `/clear` 清空
- **测试**: 暂不设置自动化测试，Agent QA 场景验证

### Metis Review

**Identified Gaps** (addressed in plan):
1. **Windows 兼容性风险** (OpenTUI issue #152): 添加可行性 spike 作为 Task 1，验证渲染/退出/Ctrl+C 正常
2. **JSX 配置冲突**: 独立的 `src/tui/tsconfig.json`，不修改根 tsconfig
3. **代码隔离**: 所有 TUI 代码放在 `src/tui/`，仅修改 `src/cli/index.ts` 的 `tui` case
4. **AgentManager 冷启动延迟**: 扫描阶段添加加载状态
5. **Ctrl+C 行为**: 流式输出时取消当前响应，非流式时退出 TUI
6. **Agent 进程异常退出**: 状态栏显示 "disconnected"

---

## Work Objectives

### Core Objective
为 ModuleAgent 创建一个基于 OpenTUI 的终端交互界面，通过 ACP 协议与 agent 实时通信，支持流式输出显示、斜杠命令交互和项目配置引导。

### Concrete Deliverables
- `src/tui/tui-entry.ts` — TUI 入口脚本（Bun 运行）
- `src/tui/tsconfig.json` — Solid.js JSX 配置
- `src/tui/bunfig.toml` — Bun Solid 预加载
- `src/tui/types.ts` — TUI 专用类型定义
- `src/tui/App.tsx` — 主布局组件
- `src/tui/components/ContextArea.tsx` — 上下文流式输出区
- `src/tui/components/InputBox.tsx` — 输入框 + 斜杠触发
- `src/tui/components/StatusBar.tsx` — 状态栏
- `src/tui/components/CommandPalette.tsx` — 命令候选面板
- `src/tui/components/SetupWizard.tsx` — 设置引导界面
- `src/tui/services/AgentService.ts` — Agent 管理封装
- `src/tui/services/StreamHandler.ts` — 流式数据处理器
- 更新 `src/cli/index.ts` — `tui` 命令逻辑

### Definition of Done
- [ ] `bun run src/tui/tui-entry.ts` 在 Windows 终端正常渲染并可用 Ctrl+C 退出
- [ ] 输入消息 → agent 流式回复实时显示在上下文区域
- [ ] `/list` 列出可用模块并支持切换
- [ ] `/clear` 清空上下文区域
- [ ] 状态栏实时反映 agent 状态（idle/streaming/error/disconnected）
- [ ] 无 `.module-agent.json` 时启动设置向导
- [ ] 所有 QA 场景通过

### Must Have
- 上下文区 ScrollBox 流式输出
- 斜杠 "/" 触发命令候选面板
- 状态栏（agent 状态 + 工作目录）
- 设置向导（agent 命令、项目/工作区目录、代码来源）
- Ctrl+C 优雅退出（流式时取消）
- Agent 切换（/list + 选择）

### Must NOT Have (Guardrails)
- 模块树可视化（明确排除）
- 上下文持久化 / session save/load
- 文件浏览器（用户手动输入路径）
- 跨模块 MCP 通信
- 鼠标交互（Windows 已知问题）
- 颜色主题检测
- 修改 AgentManager/AgentLauncher/AgentRouter 接口
- 修改 Electron 路径或 esbuild 构建管线
- console.log 直接输出（使用 OpenTUI 的 console overlay 或禁用）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Framework**: None

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **TUI verification**: Use `interactive_bash` (tmux) to launch TUI, send keystrokes, capture terminal output, validate patterns
- **API verification**: Use Bash (curl/node fetch) for any HTTP endpoints
- **Build verification**: Use Bash (bun run / tsc) for type checking

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 0 (FEASIBILITY SPIKE — BLOCKS ALL):
└── Task 1: OpenTUI Windows smoke test [quick]

Wave 1 (Foundation — after Wave 0 PASSES):
├── Task 2: TUI directory scaffolding + deps [quick]
├── Task 3: TUI types + state definitions [quick]
├── Task 4: Config helper (validate/write .module-agent.json) [quick]
└── Task 5: Service layer (AgentService + StreamHandler) [unspecified-high]

Wave 2 (Components — after Wave 1):
├── Task 6: Main App layout + renderer init [visual-engineering]
├── Task 7: StatusBar component [quick]
├── Task 8: InputBox component + slash detection [visual-engineering]
├── Task 9: CommandPalette component [quick]
├── Task 10: ContextArea component (ScrollBox + streaming) [visual-engineering]
└── Task 11: SetupWizard screens [visual-engineering]

Wave 3 (Integration — after Wave 2):
├── Task 12: Wire App + all components [deep]
├── Task 13: Wire agent lifecycle + streaming pipeline [unspecified-high]
├── Task 14: Implement slash commands (all 6) [quick]
└── Task 15: Update CLI tui command + end-to-end wiring [deep]

Wave FINAL (after ALL tasks):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: TUI QA execution (unspecified-high)
├── Task F3: Code quality check (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

**Critical Path**: Task 1 → Tasks 2-5 → Tasks 6-11 → Tasks 12-15 → F1-F4
**Parallel Speedup**: ~65% faster than sequential
**Max Concurrent**: 4 (Wave 1 & 2)

### Agent Dispatch Summary
- **Wave 0**: 1 — T1 → `quick`
- **Wave 1**: 4 — T2 → `quick`, T3 → `quick`, T4 → `quick`, T5 → `unspecified-high`
- **Wave 2**: 6 — T6 → `visual-engineering`, T7 → `quick`, T8 → `visual-engineering`, T9 → `quick`, T10 → `visual-engineering`, T11 → `visual-engineering`
- **Wave 3**: 4 — T12 → `deep`, T13 → `unspecified-high`, T14 → `quick`, T15 → `deep`
- **Wave FINAL**: 4 — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. **OpenTUI Windows Feasibility Spike**

  **What to do**:
  - Create a minimal test script `src/tui/__spike__/hello-tui.ts` using `@opentui/core`
  - Import `createCliRenderer`, `Box`, `Text` from `@opentui/core`
  - Render a Box with Text showing "OpenTUI OK" and the terminal dimensions
  - Register Ctrl+C handler that calls `renderer.destroy()` then exits
  - Register resize handler that updates the Text content
  - Run via `bun run src/tui/__spike__/hello-tui.ts` on the Windows dev machine
  - Verify: renders cleanly, resizes without crash, Ctrl+C exits cleanly without closing terminal, Unicode displays correctly (测试中文 "你好")

  **Must NOT do**:
  - Do NOT modify any existing project files
  - Do NOT install dependencies globally — use bun add in project
  - Do NOT commit `src/tui/__spike__/` — this is temporary; delete after verification

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, simple render test, no complex logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 0 (sole task)
  - **Blocks**: All subsequent tasks
  - **Blocked By**: None

  **References**:
  - `docs/OPENTUI_DOCS.md:72-114` — Hello World + composition examples to follow
  - `docs/OPENTUI_DOCS.md:124-242` — Renderer config, events (resize, destroy), Ctrl+C behavior
  - `docs/OPENTUI_DOCS.md:524-542` — Keyboard input handler for Ctrl+C
  - Project `package.json:36-45` — existing dependencies (do NOT add @opentui here yet)

  **Acceptance Criteria**:
  - [ ] `bun run src/tui/__spike__/hello-tui.ts` launches without errors
  - [ ] Terminal shows "OpenTUI OK" text in a bordered box
  - [ ] Resizing terminal updates the displayed dimensions
  - [ ] Ctrl+C exits cleanly — terminal returns to normal (not closed, not garbled)
  - [ ] Chinese characters render correctly (no mojibake)

  **QA Scenarios**:

  ```
  Scenario: OpenTUI renders and exits cleanly on Windows
    Tool: interactive_bash (tmux)
    Preconditions: Bun installed, @opentui/core added via bun add
    Steps:
      1. Launch: bun run src/tui/__spike__/hello-tui.ts
      2. Wait 2 seconds for render
      3. Capture terminal output — assert text contains "OpenTUI OK"
      4. Assert terminal output contains dimension numbers (e.g. "80x24" or similar)
      5. Send Ctrl+C keystroke (SIGINT)
      6. Wait 1 second
      7. Assert terminal prompt is visible (shell returned)
      8. Assert exit code is 0
    Expected Result: TUI renders with bordered box, Ctrl+C restores terminal
    Failure Indicators: Crash dump, terminal closed entirely, garbled text, no output
    Evidence: .sisyphus/evidence/task-1-hello-tui.txt

  Scenario: Chinese Unicode rendering
    Tool: interactive_bash (tmux)
    Preconditions: Same as above, script modified to show Chinese text
    Steps:
      1. Update script to include Text({ content: "你好 OpenTUI" })
      2. Launch: bun run src/tui/__spike__/hello-tui.ts
      3. Capture output
      4. Assert "你好 OpenTUI" appears correctly (not garbled)
      5. Ctrl+C to exit
    Expected Result: Chinese characters render as readable text
    Failure Indicators: "???" instead of Chinese, garbled Unicode, squares/boxes
    Evidence: .sisyphus/evidence/task-1-unicode.txt
  ```

  **Commit**: NO (temporary spike file)

---

- [x] 2. **TUI Directory Scaffolding + Dependencies**

  **What to do**:
  - Create `src/tui/` directory (already exists via spike)
  - Create `src/tui/tsconfig.json` with:
    ```json
    {
      "compilerOptions": {
        "jsx": "preserve",
        "jsxImportSource": "@opentui/solid",
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true
      },
      "include": ["./**/*.ts", "./**/*.tsx"]
    }
    ```
  - Create `src/tui/bunfig.toml` with `preload = ["@opentui/solid/preload"]`
  - Add dependencies via `bun add @opentui/core @opentui/solid @opentui/keymap`
  - Verify `bun add` updates root `package.json` and creates `bun.lockb`
  - Delete `src/tui/__spike__/` directory after spike passes
  - Quick check: `bun run src/tui/tui-entry.ts` should at least import `@opentui/core` without errors

  **Must NOT do**:
  - Do NOT modify root `tsconfig.json`
  - Do NOT add `@opentui/*` to `devDependencies` — they're runtime deps

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Boilerplate config files, package install — straightforward setup
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 3, 4, 5)
  - **Blocks**: Tasks 6-11 (components need deps)
  - **Blocked By**: Task 1 (spike must pass)

  **References**:
  - `docs/OPENTUI_DOCS.md:61-69` — Bun install instructions
  - `docs/OPENTUI_DOCS.md:1287-1346` — Solid.js setup (tsconfig, bunfig.toml, render)
  - `docs/OPENTUI_DOCS.md:1427-1464` — Keymap install + basic bindings
  - `AGENTS.md:68-72` — build details (esbuild externals for reference; TUI uses Bun, not esbuild)
  - Project root `tsconfig.json` — reference for compilerOptions to NOT modify

  **Acceptance Criteria**:
  - [ ] `src/tui/tsconfig.json` exists with correct jsx/jsxImportSource
  - [ ] `src/tui/bunfig.toml` exists with Solid preload
  - [ ] `bun add @opentui/core @opentui/solid @opentui/keymap` succeeds
  - [ ] `bun run -e "import { Text } from '@opentui/core'; console.log('OK')"` outputs "OK"

  **QA Scenarios**:

  ```
  Scenario: Solid.js JSX compiles correctly
    Tool: Bash
    Preconditions: Dependencies installed
    Steps:
      1. Create temp file: src/tui/__qa__/test-jsx.tsx with `<text>Hello</text>` component
      2. Run: bun run src/tui/__qa__/test-jsx.tsx
      3. Assert exit code 0 (JSX compiled successfully)
    Expected Result: No errors (or only missing renderer init — JSX parse succeeds)
    Evidence: .sisyphus/evidence/task-2-jsx-compile.txt

  Scenario: Import chain works
    Tool: Bash
    Steps:
      1. Run: bun run -e "
        import { createCliRenderer } from '@opentui/core';
        import { render } from '@opentui/solid';
        console.log('imports OK');
      "
      2. Assert output contains "imports OK"
    Expected Result: All three @opentui packages importable
    Evidence: .sisyphus/evidence/task-2-imports.txt
  ```

  **Commit**: NO (grouped with Wave 1 completion)

---

- [x] 3. **TUI Types + State Definitions**

  **What to do**:
  - Create `src/tui/types.ts` with all TUI-specific type definitions:
    - `AgentStatus`: `'idle' | 'streaming' | 'error' | 'disconnected' | 'loading'`
    - `ChatMessage`: `{ id: string; role: 'user' | 'agent' | 'system'; content: string; time: string }`
    - `CommandDef`: `{ name: string; description: string; handler: () => void; requiresArg?: boolean }`
    - `TuiScreen`: `'setup' | 'chat'`
    - `TuiState`: central Solid signal type — `{ screen, agentStatus, currentAgent, workingDir, messages, inputValue, showCommands, commands, setupStep, setupData }`
  - Create `src/tui/state.ts` with Solid.js reactive state:
    - `createTuiState()` function returning reactive signals/accessors
    - Initialize with defaults: screen='chat', agentStatus='loading'
    - Export `tuiState` singleton (created once, imported by components)

  **Must NOT do**:
  - Do NOT modify existing type files in `src/types/`
  - Do NOT import `@agentclientprotocol/sdk` types directly (wrap in own types)
  - Do NOT use React's `useState` — must be Solid.js `createSignal`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure type definitions and signal creation — no UI, no I/O
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 4, 5)
  - **Blocks**: Tasks 6-11 (all components depend on types)
  - **Blocked By**: Task 1

  **References**:
  - `src/agents/AgentManager.ts:7-16` — AgentEntry type for reference (AgentStatus, name, sessionId)
  - `src/config/defaults.ts:8-41` — ProjectConfig type for setup wizard data fields
  - `electron/main.ts:27-33` — AgentEntry interface for Electron path (status tracking pattern)
  - `electron/renderer/renderer.ts:20-20` — ChatMsg type for message structure
  - `docs/OPENTUI_DOCS.md:1336-1346` — Solid.js hooks for state management

  **Acceptance Criteria**:
  - [ ] `src/tui/types.ts` exports all types listed above
  - [ ] `src/tui/state.ts` exports `tuiState` with all reactive fields
  - [ ] No circular dependencies between types.ts and state.ts

  **QA Scenarios**:

  ```
  Scenario: State signals update correctly
    Tool: Bash (bun REPL)
    Preconditions: types.ts and state.ts exist
    Steps:
      1. Run bun repl script importing state.ts
      2. Create a temp test accessing tuiState.agentStatus
      3. Assert initial value is 'loading'
      4. Set to 'idle', assert new value
    Expected Result: createSignal getter/setter works as Solid.js spec
    Evidence: .sisyphus/evidence/task-3-state.txt
  ```

  **Commit**: NO (grouped with Wave 1 completion)

---

- [x] 4. **Config Helper Module**

  **What to do**:
  - Create `src/tui/config.ts` with helper functions:
    - `validateModuleAgentJson(projectRoot: string): Promise<boolean>` — checks `.module-agent.json` exists and has `agents.default.command`
    - `writeModuleAgentJson(projectRoot: string, config: Partial<ProjectConfig>): Promise<void>` — writes/updates `.module-agent.json` using `ConfigLoader` and Zod schema validation
    - `getDefaultConfig(): ProjectConfig` — returns `DEFAULT_CONFIG` from `src/config/defaults.ts`
    - `resolveProjectRoot(cwd?: string): string` — reuses `src/cli/utils/project-root.ts` logic
  - The module should:
    - Read existing config via `ConfigLoader.load()` if file exists
    - Merge user input with existing config (don't overwrite unrelated fields)
    - Validate with `ProjectConfigSchema` before writing
    - Log errors on write failure

  **Must NOT do**:
  - Do NOT duplicate `ConfigLoader` logic — import and wrap it
  - Do NOT modify `ConfigLoader.ts` or `schema.ts`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Thin wrapper around existing ConfigLoader, simple file I/O
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 5)
  - **Blocks**: Task 11 (setup wizard), Task 13 (agent lifecycle)
  - **Blocked By**: Task 1

  **References**:
  - `src/config/ConfigLoader.ts` — load() method to reuse
  - `src/config/defaults.ts:26-41` — DEFAULT_CONFIG for fallback
  - `src/config/schema.ts:15-25` — ProjectConfigSchema for validation
  - `src/cli/utils/project-root.ts` — resolveProjectRoot for directory walking
  - `.module-agent.json` — example to validate against

  **Acceptance Criteria**:
  - [ ] `validateModuleAgentJson()` returns `true` when `.module-agent.json` exists with command
  - [ ] `validateModuleAgentJson()` returns `false` when file missing or command empty
  - [ ] `writeModuleAgentJson()` creates file if not exists, merges if exists
  - [ ] Written file passes `ProjectConfigSchema.parse()`

  **QA Scenarios**:

  ```
  Scenario: Validate detects missing config
    Tool: Bash
    Preconditions: Non-existent project directory
    Steps:
      1. Create temp dir: mkdir -p /tmp/test-no-config
      2. Run bun script calling validateModuleAgentJson('/tmp/test-no-config')
      3. Assert returns false
      4. Cleanup: rm -rf /tmp/test-no-config
    Expected Result: Returns false for missing .module-agent.json
    Evidence: .sisyphus/evidence/task-4-validate-missing.txt

  Scenario: Write config creates valid file
    Tool: Bash
    Preconditions: Temp project directory
    Steps:
      1. Create temp dir: mkdir -p /tmp/test-proj
      2. Run bun script calling writeModuleAgentJson('/tmp/test-proj', { agents: { default: { command: 'echo' } } })
      3. Read /tmp/test-proj/.module-agent.json
      4. Assert JSON contains "command": "echo"
      5. Cleanup: rm -rf /tmp/test-proj
    Expected Result: Valid .module-agent.json created with merged defaults
    Evidence: .sisyphus/evidence/task-4-write-config.txt
  ```

  **Commit**: NO (grouped with Wave 1 completion)

---

- [x] 5. **Service Layer — AgentService + StreamHandler**

  **What to do**:
  - Create `src/tui/services/AgentService.ts`:
    - Wraps `AgentManager` initialization: `init(projectRoot)` → loads config, scans modules, builds graph, creates AgentManager
    - `startMainAgent()` — lazily starts main agent via `agentManager.startMainAgent(cwd, onSessionUpdate)`
    - `startModuleAgent(name)` — lazily starts module agent via `agentManager.startModuleAgent(name, cwd, onSessionUpdate)`
    - `sendMessage(text)` — routes via AgentRouter, sends prompt
    - `cancel()` — cancels current agent prompt
    - `getCurrentAgent()` / `setCurrentAgent(name)` — tracks active agent
    - `listAgents()` — returns available module names from graph
    - `getAgentStatus()` — returns current status
    - `dispose()` — calls `agentManager.stopAll()`
  - Create `src/tui/services/StreamHandler.ts`:
    - `onSessionUpdate` callback: captures `agent_message_chunk`, `agent_thought_chunk`, `tool_call` events
    - Appends to in-memory buffer (array of strings)
    - Calls callback to update Solid state (new messages appended, not re-rendered)
    - Handles session end → marks message complete, resets agent status to idle
    - Handles errors → marks agent status as error, captures error message
  - Both must handle the case where agent is not yet started (lazy start)

  **Must NOT do**:
  - Do NOT modify `AgentManager.ts`, `AgentLauncher.ts`, or `AgentRouter.ts`
  - Do NOT import `electron/main.ts` — TUI services are standalone
  - Do NOT use event emitters from Node — use Solid signals

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration logic bridging AgentManager/AgentRouter to Solid state; moderate complexity
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 13 (wiring agent lifecycle)
  - **Blocked By**: Task 1

  **References**:
  - `src/agents/AgentManager.ts:33-62` — startMainAgent pattern (config, launch, newSession, sessionId)
  - `src/agents/AgentManager.ts:64-93` — startModuleAgent pattern
  - `src/agents/AgentRouter.ts:87-119` — sendToAgent pattern (prompt blocks, system prompt injection)
  - `src/agents/AgentLauncher.ts:56-67` — sessionUpdate callback signature (agent_message_chunk, tool_call)
  - `electron/main.ts:249-257` — onSessionUpdate forwarding pattern (moduleName, sessionId, notification)
  - `electron/main.ts:665-664` — stream listener pattern (agent_message_chunk content extraction)
  - `src/core/ModuleScanner.ts` — scan() for project scanning
  - `src/core/ModuleGraph.ts` — build() for graph construction
  - `src/cli/commands/serve.ts:113-118` — scanProject pattern (ConfigLoader → Scanner → Graph)

  **Acceptance Criteria**:
  - [ ] `AgentService.init(projectRoot)` scans project and creates AgentManager
  - [ ] `AgentService.sendMessage("hello")` starts main agent if not running, sends prompt
  - [ ] `StreamHandler` captures `agent_message_chunk` and calls update callback with text
  - [ ] `AgentService.cancel()` calls agent connection cancel
  - [ ] `AgentService.dispose()` kills all agent processes

  **QA Scenarios**:

  ```
  Scenario: AgentService initializes and lists modules
    Tool: Bash
    Preconditions: A test project with .module-agent.json and a few module.md files
    Steps:
      1. Import AgentService, call init(testProjectRoot)
      2. Assert init returns without throwing
      3. Call listAgents()
      4. Assert array contains at least "main"
      5. Call getAgentStatus() → assert "idle"
    Expected Result: AgentService initializes, lists modules, status is idle
    Failure Indicators: Init throws, listAgents returns empty, status is error
    Evidence: .sisyphus/evidence/task-5-init.txt

  Scenario: Agent send/receive cycle
    Tool: interactive_bash (tmux)
    Preconditions: Agent binary (opencode or test stub) available
    Steps:
      1. Call sendMessage("test message")
      2. Wait for stream chunks
      3. Assert stream handler captured output text
      4. Assert agent status transitioned streaming → idle
    Expected Result: Message sent, streaming output captured, status returns to idle
    Failure Indicators: Agent fails to start (command not found is acceptable), timeout 30s
    Evidence: .sisyphus/evidence/task-5-stream.txt
  ```

  **Commit**: NO (grouped with Wave 1 completion)

---

- [x] 6. **Main App Layout + Renderer Init**

  **What to do**:
  - Create `src/tui/App.tsx` — the main Solid.js application component
  - Create `src/tui/renderer.ts` — factory function that:
    - Calls `createCliRenderer({ exitOnCtrlC: false, targetFps: 30 })` (custom Ctrl+C handling)
    - Registers keyboard handler: Ctrl+C during streaming → cancel; otherwise → destroy + exit
    - Registers resize handler → updates terminal dimensions in state
    - Calls `render(() => <App />, renderer)` from `@opentui/solid`
    - Returns cleanup function that calls `renderer.destroy()`
  - `App.tsx` layout:
    - Top-level `<box flexDirection="column" width="100%" height="100%">`
    - Child 1: `<ContextArea>` — `flexGrow: 1` fills available space
    - Child 2: `<box flexDirection="column">` wrapper for input + status
      - `<InputBox>` — fixed height (3 rows)
      - `<StatusBar>` — fixed height (1 row)
    - Conditional: `<CommandPalette>` — absolute positioned above input when visible
    - Conditional: `<SetupWizard>` — replaces entire view when screen='setup'
  - Export `startTui(projectRoot: string, agentCmd?: string, agentArgs?: string[])` as main entry

  **Must NOT do**:
  - Do NOT hardcode dimensions — use flexGrow/flexShrink
  - Do NOT call `process.exit()` directly — use cleanup chain (renderer.destroy → process.exit)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Layout composition using Solid JSX, flex layout with Box components
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on components below)
  - **Parallel Group**: Wave 2 start — after Tasks 7-11 created, Task 6 wires them
  - **Blocks**: Task 12 (wiring), Task 15 (entry point)
  - **Blocked By**: Tasks 2, 3, 5

  **References**:
  - `docs/OPENTUI_DOCS.md:1287-1316` — Solid.js render() + basic component pattern
  - `docs/OPENTUI_DOCS.md:970-994` — Box component (flexDirection, flexGrow, width/height)
  - `docs/OPENTUI_DOCS.md:124-160` — Renderer config options (exitOnCtrlC, targetFps)
  - `docs/OPENTUI_DOCS.md:212-222` — Renderer events (resize, focus, blur, destroy)
  - `docs/OPENTUI_DOCS.md:1336-1346` — Solid hooks (useRenderer, useKeyboard, onResize)
  - `electron/renderer/renderer.ts:617-663` — sendContextMsg pattern for send/cancel/stream lifecycle

  **Acceptance Criteria**:
  - [ ] `App.tsx` renders layout with context area (70%+), input (3 lines), status bar (1 line)
  - [ ] Resize event updates terminal dimensions in state
  - [ ] Ctrl+C during idle → TUI exits cleanly
  - [ ] Ctrl+C during streaming → agent cancelled, TUI stays running
  - [ ] `renderer.destroy()` restores terminal on any exit path

  **QA Scenarios**:

  ```
  Scenario: Layout renders with all three zones
    Tool: interactive_bash (tmux)
    Preconditions: Stub components (showing placeholder text) wired in App.tsx
    Steps:
      1. Launch: bun run src/tui/tui-entry.ts
      2. Wait 2 seconds
      3. Capture output
      4. Assert text contains status bar pattern: "agent:" or status indicator
      5. Assert visible area has prompt-like region at bottom
      6. Ctrl+C to exit
    Expected Result: Three-zone layout visible, bottom has input area
    Failure Indicators: All zones collapsed, nothing visible, crash
    Evidence: .sisyphus/evidence/task-6-layout.txt

  Scenario: Ctrl+C exits cleanly
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Wait 1 second
      3. Send Ctrl+C
      4. Wait 1 second
      5. Assert shell prompt visible
      6. Assert exit code 0
    Expected Result: Terminal restored to pre-launch state
    Evidence: .sisyphus/evidence/task-6-ctrlc.txt
  ```

  **Commit**: NO (grouped with Wave 2)

---

- [x] 7. **StatusBar Component**

  **What to do**:
  - Create `src/tui/components/StatusBar.tsx`
  - Solid component reading from `tuiState`:
    - Left side: `agent: <status>` with color coding (idle=green, streaming=yellow, error=red, disconnected=gray)
    - Right side: `<working directory>` (truncated if too long to fit)
  - Use Solid's `useRenderer()` to get current terminal width
  - Truncate working dir path to fit available space
  - Format: `agent: idle  │  /path/to/project` (pipe separator, consistent padding)
  - Style: background color slightly different from main area (visual separation)

  **Must NOT do**:
  - Do NOT hardcode color strings — use RGBA or hex from OpenTUI
  - Do NOT show any private/personally identifiable paths

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple read-only component, pure presentation
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8, 9, 10, 11)
  - **Blocks**: Task 12 (wiring)
  - **Blocked By**: Tasks 2, 3

  **References**:
  - `docs/OPENTUI_DOCS.md:944-968` — Text component (content, fg, bg, attributes)
  - `docs/OPENTUI_DOCS.md:970-994` — Box component (backgroundColor, padding)
  - `docs/OPENTUI_DOCS.md:1341-1342` — useTerminalDimensions() for width
  - `electron/renderer/renderer.ts:205-210` — updateStatusBar pattern (agent info + path display)
  - `src/tui/types.ts` — AgentStatus type for color mapping

  **Acceptance Criteria**:
  - [ ] Status bar shows "agent: idle" when no message in flight
  - [ ] Status bar shows "agent: streaming" during agent response
  - [ ] Working directory displayed correctly
  - [ ] Path truncated when too long (ellipsis or cut)

  **QA Scenarios**:

  ```
  Scenario: Status bar shows idle state
    Tool: interactive_bash (tmux)
    Preconditions: App renders with StatusBar component
    Steps:
      1. Launch TUI with known project root
      2. Capture output
      3. Assert bottom line contains "agent: idle" or "agent: loading"
      4. Assert bottom line contains project directory name
      5. Ctrl+C to exit
    Expected Result: Status bar visible with status + path
    Evidence: .sisyphus/evidence/task-7-status-idle.txt

  Scenario: Status bar transitions during streaming
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Send a message to agent
      3. Immediately capture status bar
      4. Assert contains "agent: streaming"
      5. Wait for completion, capture again
      6. Assert contains "agent: idle"
    Expected Result: Status transitions idle → streaming → idle
    Evidence: .sisyphus/evidence/task-7-status-transition.txt
  ```

  **Commit**: NO (grouped with Wave 2)

---

- [x] 8. **InputBox Component + Slash Detection**

  **What to do**:
  - Create `src/tui/components/InputBox.tsx`
  - Use OpenTUI's `<input>` Solid component (or `InputRenderable` for finer control)
  - Properties: `placeholder="输入消息 (输入 / 查看命令)..."`
  - Keyboard handling via `useKeyboard`:
    - `Enter`: submit current input as agent message
    - `Tab`: autocomplete first matching command (when slash mode)
    - `Escape`: dismiss command palette, clear input
    - `/`: set `tuiState.showCommands = true`, trigger command palette
    - `Backspace` when input is only `/`: dismiss command palette
    - Any key after `/`: filter commands (passed to CommandPalette)
  - On Enter submit:
    - If input starts with `/`, route to command handler
    - Otherwise, route to `AgentService.sendMessage(input)`
    - Clear input after submit
  - Disable input while agent is streaming

  **Must NOT do**:
  - Do NOT implement command execution logic here — delegate to command handler
  - Do NOT block terminal input — use OpenTUI's event system

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Interactive input component with keyboard event handling, state management
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 9, 10, 11)
  - **Blocks**: Task 12 (wiring)
  - **Blocked By**: Tasks 2, 3

  **References**:
  - `docs/OPENTUI_DOCS.md:997-1014` — Input component (placeholder, width, value, events)
  - `docs/OPENTUI_DOCS.md:1338-1340` — useKeyboard hook (key events, release)
  - `docs/OPENTUI_DOCS.md:524-567` — KeyEvent properties (name, ctrl, shift)
  - `docs/OPENTUI_DOCS.md:1431-1463` — Keymap basic bindings (for reference; we use raw keyboard for simplicity)
  - `electron/renderer/renderer.ts:617-663` — sendContextMsg pattern (input → send → stream lifecycle)
  - `src/tui/state.ts` — tuiState.inputValue, tuiState.showCommands

  **Acceptance Criteria**:
  - [ ] Typing "/" shows command palette
  - [ ] Typing "/" then backspace (to empty) hides command palette
  - [ ] Enter submits non-slash text as agent message
  - [ ] Enter on slash command executes command
  - [ ] Input disabled during agent streaming
  - [ ] Input cleared after successful submit

  **QA Scenarios**:

  ```
  Scenario: Slash triggers command palette
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Type "/"
      3. Capture output
      4. Assert command palette is visible with command list
      5. Press Escape
      6. Assert command palette hidden, input cleared
    Expected Result: Command palette appears on "/", dismisses on Escape
    Evidence: .sisyphus/evidence/task-8-slash.txt

  Scenario: Enter sends message to agent
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI with running agent
      2. Type "hello world"
      3. Press Enter
      4. Assert input cleared
      5. Assert context area shows "hello world" as user message
      6. Assert agent status changes to "streaming"
    Expected Result: Message sent, input cleared, agent responds
    Evidence: .sisyphus/evidence/task-8-send.txt
  ```

  **Commit**: NO (grouped with Wave 2)

---

- [x] 9. **CommandPalette Component**

  **What to do**:
  - Create `src/tui/components/CommandPalette.tsx`
  - Uses OpenTUI `<select>` Solid component (or `SelectRenderable`) for the list
  - Appears as an overlay above the input box when `tuiState.showCommands === true`
  - Commands list:
    - `/list` — 列出所有模块
    - `/get <name>` — 查看模块详情
    - `/mode <id>` — 切换 agent 模式
    - `/clear` — 清空上下文
    - `/help` — 显示帮助
    - `/quit` — 退出 TUI
  - Filtering: as user types after "/", filter commands by prefix match
    - e.g., "/li" → shows only `/list`
    - "/xyz" → shows "无匹配命令" (no matching commands)
  - Selection: `Up/Down` arrows to navigate, `Enter` to execute, `Escape` to close
  - Selected command fills the input (e.g., selecting `/list` sets input to "/list")
  - For commands with args (`/get`, `/mode`), show placeholder hint after selection

  **Must NOT do**:
  - Do NOT implement command execution — only selection and input population
  - Do NOT add fuzzy matching — prefix match only
  - Do NOT persist command history

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple list selection component with prefix filtering
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 10, 11)
  - **Blocks**: Task 12 (wiring)
  - **Blocked By**: Tasks 2, 3

  **References**:
  - `docs/OPENTUI_DOCS.md:1055-1077` — Select component (options list, keyboard nav, selectedIndex)
  - `docs/OPENTUI_DOCS.md:1358-1360` — Dynamic component for conditional rendering
  - `docs/OPENTUI_DOCS.md:1436-1463` — Keymap commands/getCommands pattern
  - `src/tui/types.ts` — CommandDef type

  **Acceptance Criteria**:
  - [ ] Shows all 6 commands when "/" typed with no filter
  - [ ] Filters to matching commands when characters typed after "/"
  - [ ] Shows "无匹配命令" when no commands match filter
  - [ ] Arrow keys navigate selection
  - [ ] Enter selects and populates input with chosen command
  - [ ] Escape closes palette without selecting

  **QA Scenarios**:

  ```
  Scenario: Command palette shows all commands
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Type "/"
      3. Assert visible items: /list, /get, /mode, /clear, /help, /quit
      4. Press Down 3 times
      5. Assert "/mode" is highlighted/selected
      6. Press Enter
      7. Assert input now contains "/mode "
    Expected Result: All commands visible, navigable, selectable
    Evidence: .sisyphus/evidence/task-9-palette-all.txt

  Scenario: Filter shows matching only
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Type "/li"
      3. Assert only "/list" is visible in palette
      4. Type "xyz" (so input is "/lixyz")
      5. Assert "无匹配命令" or empty palette
    Expected Result: Prefix filtering works, edge case shows no-match state
    Evidence: .sisyphus/evidence/task-9-filter.txt
  ```

  **Commit**: NO (grouped with Wave 2)

---

- [x] 10. **ContextArea Component (ScrollBox + Streaming)**

  **What to do**:
  - Create `src/tui/components/ContextArea.tsx`
  - Uses OpenTUI `<scrollbox>` Solid component with `flexGrow: 1`, `stickyScroll: true`, `stickyStart: "bottom"`
  - Content: mapped from `tuiState.messages` array:
    - Each message renders as `<box flexDirection="column" padding={1}>`
    - User messages: prefix "👤 " + content, right-aligned style
    - Agent messages: prefix "🤖 " + content, left-aligned style
    - System messages: prefix "ℹ️ " + content, dimmed style
    - Error messages: prefix "❌ " + content, red text
    - Timestamp displayed in dimmed text on right side
  - Streaming mode: when `agentStatus === 'streaming'`, append chunks to last agent message in real-time
    - Use Solid's reactivity to update content on each chunk
    - Auto-scroll to bottom via `stickyStart: "bottom"`
  - On message complete: add timestamp, set message as final
  - ScrollBox supports `viewportCulling` for performance with many messages

  **Must NOT do**:
  - Do NOT implement message persistence (no file I/O for context)
  - Do NOT implement thinking/tool toggle — show all text flat
  - Do NOT use `marked` or Markdown rendering — plain text only

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex scrollable content area with streaming update, conditional styling, reactivity
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 11)
  - **Blocks**: Task 12 (wiring)
  - **Blocked By**: Tasks 2, 3

  **References**:
  - `docs/OPENTUI_DOCS.md:1102-1122` — ScrollBox (stickyScroll, stickyStart, viewportCulling, scrollTo)
  - `docs/OPENTUI_DOCS.md:944-968` — Text component (content, fg, bg for message styling)
  - `docs/OPENTUI_DOCS.md:970-994` — Box for message containers (padding, flexDirection, gap)
  - `docs/OPENTUI_DOCS.md:1336-1346` — Solid hooks for reactive list rendering
  - `electron/renderer/renderer.ts:292-320` — appendStream/appendThinking pattern (chunk-by-chunk append)
  - `electron/renderer/renderer.ts:486-573` — renderContextCards for message display pattern
  - `src/tui/state.ts` — tuiState.messages, tuiState.agentStatus

  **Acceptance Criteria**:
  - [ ] Messages displayed in chronological order (oldest top, newest bottom)
  - [ ] Auto-scrolls to bottom on new message
  - [ ] Agent streaming chunks appear in real-time in the same message block
  - [ ] User messages visually distinct from agent messages
  - [ ] ScrollBox handles 100+ messages without performance degradation

  **QA Scenarios**:

  ```
  Scenario: Messages display in order with auto-scroll
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Send message "msg 1"
      3. Wait for response
      4. Send message "msg 2"
      5. Assert both messages visible in context area
      6. Assert newest message at bottom (scroll position at end)
    Expected Result: Both send+receive pairs visible, scrolled to bottom
    Evidence: .sisyphus/evidence/task-10-messages.txt

  Scenario: Streaming output updates in real-time
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Send a message that triggers multi-chunk response
      3. During streaming, capture output mid-response
      4. Assert partial output visible
      5. Wait for completion
      6. Assert full output visible
    Expected Result: Partial output updates live, final output shows complete response
    Evidence: .sisyphus/evidence/task-10-streaming.txt
  ```

  **Commit**: NO (grouped with Wave 2)

---

- [x] 11. **SetupWizard Screens**

  **What to do**:
  - Create `src/tui/components/SetupWizard.tsx`
  - Multi-step form rendered when `tuiState.screen === 'setup'`
  - Steps (sequential, not tabs):
    1. **Step 1: Agent 命令** — Input for `agent command` (default: "opencode"), input for `agent args` (default: "acp"). Show hint text.
    2. **Step 2: 项目目录** — Input for `project root` (pre-filled with detected cwd). Show validation: ✅ if `.module-agent.json` or `module.md` files found.
    3. **Step 3: 工作区目录** — Input for `workspace path` (default: ".module-agent/workspaces"). Show hint.
    4. **Step 4: 代码来源** — `<select>` for type (local/git), conditional `input` for `path` (local) or `url` + `branch` (git).
    5. **Step 5: 确认** — Summary display of all settings, "开始 (Enter)" to save and proceed.
  - Navigation: `Enter` to advance, `Escape` to go back (step 1 Escape exits TUI)
  - On finish: call `config.writeModuleAgentJson()`, scan project, transition to `screen='chat'`
  - Show loading state during project scanning after step 5
  - Handle errors: if scan fails, show error and allow retry or go back

  **Must NOT do**:
  - Do NOT implement a file browser dialog — paths are typed manually
  - Do NOT validate paths deeply (filesystem access check optional) — just validate format
  - Do NOT call `dialog.showOpenDialog` (Electron only)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Multi-step wizard with conditional fields, validation, state transitions
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 10)
  - **Blocks**: Task 12 (wiring)
  - **Blocked By**: Tasks 2, 3, 4 (config helper)

  **References**:
  - `docs/OPENTUI_DOCS.md:997-1014` — Input component for text fields
  - `docs/OPENTUI_DOCS.md:1055-1077` — Select component for code source type
  - `docs/OPENTUI_DOCS.md:944-968` — Text for hints and labels
  - `docs/OPENTUI_DOCS.md:1338-1340` — useKeyboard for Enter/Escape navigation
  - `electron/renderer/renderer.ts:77-138` — openSettings/saveSettings GUI pattern (fields: agentCmd, agentArgs, workspace, project, codeSource)
  - `electron/renderer/renderer.ts:848-878` — startScan pattern (load config, scan, transition to main)
  - `.module-agent.json` — example config file structure
  - `src/config/defaults.ts:26-41` — DEFAULT_CONFIG for default values
  - `src/tui/config.ts` — validate/write helper functions

  **Acceptance Criteria**:
  - [ ] Step 1 shows agent command + args inputs with defaults pre-filled
  - [ ] Step 2 pre-fills project root with cwd
  - [ ] Step 4 toggle shows local path vs git url+branch based on type selection
  - [ ] Step 5 summary shows all collected values
  - [ ] Enter on step 5 saves config, scans project, transitions to chat
  - [ ] Escape on step 1 exits TUI; Escape on other steps goes back
  - [ ] Scan errors shown with retry option

  **QA Scenarios**:

  ```
  Scenario: Setup wizard completes and transitions to chat
    Tool: interactive_bash (tmux)
    Preconditions: No .module-agent.json in test project dir
    Steps:
      1. Launch TUI in empty project dir
      2. Assert setup screen visible (not chat)
      3. Navigate through steps with Enter
      4. On step 5, press Enter
      5. Assert project scans (brief loading message)
      6. Assert screen transitions to chat with status bar
    Expected Result: Wizard runs, config saved, chat screen active
    Evidence: .sisyphus/evidence/task-11-wizard-complete.txt

  Scenario: Setup wizard Esc exits
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI without config
      2. On step 1, press Escape
      3. Assert exit code 0
      4. Assert terminal restored
    Expected Result: Escape on first step exits cleanly
    Evidence: .sisyphus/evidence/task-11-wizard-esc.txt
  ```

  **Commit**: NO (grouped with Wave 2)

---

- [x] 12. **Wire App Layout + All Components**

  **What to do**:
  - Integrate all Wave 2 components into `App.tsx`:
    - Import ContextArea, InputBox, StatusBar, CommandPalette, SetupWizard
    - Conditional rendering: `screen === 'setup'` → `<SetupWizard>`, `screen === 'chat'` → chat layout
    - Wire `tuiState` reactive signals to all components
    - Wire InputBox Enter handler → delegates to AgentService or command handler
    - Wire InputBox "/" handler → CommandPalette visibility
    - Wire CommandPalette selection → InputBox value
  - Add component-level event coordination:
    - When agent starts streaming: disable input, show cancel hint
    - When streaming completes: enable input, update status
    - When command executed: hide palette, clear or populate input
  - Create `src/tui/components/index.ts` barrel export

  **Must NOT do**:
  - Do NOT modify individual component internals — only wire at App level
  - Do NOT add new features during wiring — pure integration

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Cross-component integration with event coordination, reactive state wiring
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Tasks 6-11)
  - **Blocks**: Tasks 13, 14, 15
  - **Blocked By**: Tasks 6-11 (all components)

  **References**:
  - `docs/OPENTUI_DOCS.md:1336-1346` — Solid reactive rendering (signals, conditional JSX)
  - `src/tui/state.ts` — tuiState with all signals
  - `src/tui/App.tsx` — existing layout skeleton
  - `src/tui/components/ContextArea.tsx`, `InputBox.tsx`, etc. — component interfaces
  - `electron/renderer/renderer.ts:617-663` — sendContextMsg lifecycle (send → stream → complete)

  **Acceptance Criteria**:
  - [ ] App renders chat screen when state.screen === 'chat'
  - [ ] App renders setup wizard when state.screen === 'setup'
  - [ ] Input disabled during streaming, enabled otherwise
  - [ ] Command palette visible when showCommands === true
  - [ ] All components imported from barrel export

  **QA Scenarios**:

  ```
  Scenario: Full chat flow with wired components
    Tool: interactive_bash (tmux)
    Preconditions: All components implemented, App wired
    Steps:
      1. Launch TUI
      2. Assert status bar visible with status
      3. Assert input area visible at bottom
      4. Type "/" → assert command palette appears
      5. Press Escape → assert palette disappears
      6. Type "hello" → press Enter
      7. Assert input disabled during streaming
      8. Assert context area shows messages
      9. Assert status transitions streaming → idle
    Expected Result: All components work together in coordinated flow
    Evidence: .sisyphus/evidence/task-12-wired-flow.txt
  ```

  **Commit**: NO (grouped with Wave 3)

---

- [x] 13. **Wire Agent Lifecycle + Streaming Pipeline**

  **What to do**:
  - Create `src/tui/services/index.ts` barrel export for services
  - Wire AgentService into TUI startup flow:
    - On TUI launch (after config validated/written): call `AgentService.init(projectRoot)`
    - Set `tuiState.agentStatus = 'loading'` during init
    - On init success: set `tuiState.agentStatus = 'idle'`, `tuiState.workingDir = projectRoot`
    - On init failure: set `tuiState.agentStatus = 'error'`, show error in context
  - Wire StreamHandler into AgentService:
    - Pass `onSessionUpdate` callback from StreamHandler when creating agents
    - On `agent_message_chunk`: append to current message content, update reactive state
    - On `agent_thought_chunk`: prepend to thinking (shown inline or skipped per guardrail)
    - On session end: finalize message, reset status to idle
  - Wire message sending:
    - `InputBox` Enter → `AgentService.sendMessage(text)` → StreamHandler callback → reactive update
  - Wire agent switching:
    - `/list` selection → `AgentService.setCurrentAgent(name)` → clear context → update status
  - Wire error handling:
    - Agent process exits unexpectedly: status → 'disconnected', context shows "[Agent 已断开连接]"
    - Prompt fails: status → 'error', context shows error message

  **Must NOT do**:
  - Do NOT modify AgentManager internals — wrap only
  - Do NOT implement thinking toggle — all output shown inline

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core integration pipeline — agent lifecycle + streaming + state sync
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 14)
  - **Parallel Group**: Wave 3 (with Tasks 14, 15)
  - **Blocks**: None
  - **Blocked By**: Tasks 5, 12

  **References**:
  - `src/tui/services/AgentService.ts` — init/sendMessage/cancel/listAgents
  - `src/tui/services/StreamHandler.ts` — chunk capture + state update
  - `src/tui/state.ts` — tuiState signals
  - `src/agents/AgentManager.ts:33-93` — startMainAgent/startModuleAgent lifecycle
  - `electron/main.ts:249-257` — onSessionUpdate → renderer IPC forwarding
  - `electron/main.ts:730-731` — agent process cleanup on exit

  **Acceptance Criteria**:
  - [ ] TUI launch scans project and shows agent status 'idle'
  - [ ] Sending message via InputBox → agent responds → output visible in ContextArea
  - [ ] Streaming chunks appear in real-time (not batched at end)
  - [ ] `/list` → select module → switches agent, context cleared
  - [ ] Agent process exit → status shows 'disconnected'
  - [ ] Ctrl+C during streaming → agent cancelled, output preserved

  **QA Scenarios**:

  ```
  Scenario: End-to-end message round-trip
    Tool: interactive_bash (tmux)
    Preconditions: Agent binary available
    Steps:
      1. Launch TUI with valid config
      2. Type "hello" and press Enter
      3. Wait for streaming indicator
      4. Assert context area shows user message "hello"
      5. Wait for completion (max 30s)
      6. Assert context area shows agent response
      7. Assert status returns to "idle"
    Expected Result: Full send → stream → receive cycle works
    Failure Indicators: Agent fails to start (check command), timeout, status stuck streaming
    Evidence: .sisyphus/evidence/task-13-roundtrip.txt

  Scenario: Agent disconnect handled gracefully
    Tool: interactive_bash (tmux)
    Steps:
      1. Start TUI with running agent
      2. Kill agent process externally (simulate crash)
      3. Assert status changes to "disconnected"
      4. Assert context shows "[Agent 已断开连接]"
    Expected Result: Disconnect detected, status updated, message shown
    Evidence: .sisyphus/evidence/task-13-disconnect.txt
  ```

  **Commit**: NO (grouped with Wave 3)

---

- [x] 14. **Implement Slash Commands**

  **What to do**:
  - Create `src/tui/commands.ts` with command handler registry:
    - `/help`: shows inline help in context area listing all 6 commands with descriptions
    - `/list`: populates CommandPalette with module names as a temporary overlay. On selection: calls `AgentService.setCurrentAgent()`, clears context, shows "已切换到 <name>" system message
    - `/get <name>`: if name provided, shows module info (path, children count, description) as system message in context. If no name, show "用法: /get <name>" error
    - `/mode <id>`: calls `AgentService.setMode(id)`. Shows "模式已切换: <id>" or error if mode not found
    - `/clear`: clears `tuiState.messages = []`, shows "上下文已清空" system message
    - `/quit`: calls `AgentService.dispose()` → `renderer.destroy()` → `process.exit(0)`
  - Each command: defined as `CommandDef` object in an array
  - Command execution: `executeCommand(name, arg?)` function called by InputBox
  - Unknown command: shows "未知命令: /xxx，输入 /help 查看可用命令"

  **Must NOT do**:
  - Do NOT add commands beyond the 6 listed
  - Do NOT persist command history
  - Do NOT add command aliases

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple command dispatch pattern, each handler is 2-5 lines
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 13)
  - **Parallel Group**: Wave 3 (with Tasks 13, 15)
  - **Blocks**: None
  - **Blocked By**: Task 12

  **References**:
  - `src/tui/types.ts` — CommandDef type
  - `src/tui/state.ts` — tuiState for context updates
  - `src/tui/services/AgentService.ts` — setCurrentAgent, setMode, dispose
  - `src/agents/AgentManager.ts:95-121` — setMode/setAllModes/getAvailableModes
  - `src/cli/commands/get.ts` — getModule command for /get implementation pattern
  - `src/cli/commands/list.ts` — listModules command for /list implementation pattern

  **Acceptance Criteria**:
  - [ ] `/help` shows all 6 commands in context area
  - [ ] `/list` shows module names for selection
  - [ ] `/list` → select → agent switches, context cleared
  - [ ] `/get <name>` shows module info or error
  - [ ] `/mode <id>` switches mode or shows error
  - [ ] `/clear` empties context
  - [ ] `/quit` exits cleanly
  - [ ] Unknown command shows help hint

  **QA Scenarios**:

  ```
  Scenario: All slash commands execute correctly
    Tool: interactive_bash (tmux)
    Steps:
      1. Type "/help" → Enter → assert help text in context
      2. Type "/list" → Enter → assert module list visible → select main → assert switched
      3. Type "/get unknown-module" → Enter → assert error message
      4. Type "/mode plan" → Enter → assert mode change or error (depends on agent)
      5. Type "/clear" → Enter → assert context emptied
      6. Type "/quit" → Enter → assert TUI exits code 0
    Expected Result: Each command executes with appropriate output/behavior
    Evidence: .sisyphus/evidence/task-14-commands.txt

  Scenario: Unknown command handled
    Tool: interactive_bash (tmux)
    Steps:
      1. Type "/foobar" → Enter
      2. Assert message contains "未知命令" or "查看 /help"
    Expected Result: Graceful error, no crash
    Evidence: .sisyphus/evidence/task-14-unknown-cmd.txt
  ```

  **Commit**: NO (grouped with Wave 3)

---

- [x] 15. **Update CLI tui Command + Entry Point**

  **What to do**:
  - Rewrite `src/cli/tui-entry.ts` as the Bun TUI entry point:
    ```typescript
    // Parse --project flag from process.argv
    // Import and call startTui(projectRoot)
    ```
    - Parse `--project <path>` argument, fallback to `resolveProjectRoot()`
    - Call `startTui(projectRoot)` from `App.tsx`/`renderer.ts`
    - Handle uncaught errors: log, ensure renderer.destroy(), exit 1
  - Update `src/cli/index.ts` `tui` case:
    - Detect Bun: `import.meta.url` check OR try `Bun.version` OR spawn `bun --version`
    - If Bun runtime detected: `await import('../tui/tui-entry.js')` and call main
    - If NOT Bun: check if `bun` command exists via `which bun` / `where bun`; if yes, `exec bun run src/tui/tui-entry.ts` with forwarded args; if no, print:
      ```
      TUI 需要 Bun 运行时。请安装 Bun:
        https://bun.sh
      
      安装后运行: module-agent tui [--project <path>]
      ```
      and exit 1
  - Verify existing CLI commands still work: `module-agent list`, `module-agent serve`

  **Must NOT do**:
  - Do NOT change any other CLI command cases
  - Do NOT add Bun as a project dependency in package.json
  - Do NOT modify the esbuild build:cli target

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Entry point wiring, CLI integration, Bun detection, error handling chains
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO (final integration step)
  - **Parallel Group**: Wave 3 (after Tasks 13, 14)
  - **Blocks**: Final Verification
  - **Blocked By**: Tasks 12, 13, 14

  **References**:
  - `src/cli/index.ts:74-76` — current tui case (prints "hello")
  - `src/cli/utils/project-root.ts` — resolveProjectRoot for --project parsing
  - `src/cli/index.ts:25-51` — argument parsing pattern (--project flag extraction)
  - `src/tui/App.tsx` — startTui export
  - `src/tui/renderer.ts` — renderer factory + cleanup
  - `docs/OPENTUI_DOCS.md:61-69` — Bun install instructions (for error message)

  **Acceptance Criteria**:
  - [ ] `bun run src/cli/tui-entry.ts` launches TUI
  - [ ] `bun run src/cli/tui-entry.ts --project /path` uses specified project
  - [ ] `module-agent tui` with Bun detects runtime and launches TUI
  - [ ] `module-agent tui` without Bun shows install instructions
  - [ ] `module-agent list` still works unchanged
  - [ ] `module-agent serve` still works unchanged

  **QA Scenarios**:

  ```
  Scenario: TUI launches via CLI when Bun is runtime
    Tool: interactive_bash (tmux)
    Preconditions: Running under bun
    Steps:
      1. Run: bun run src/cli/index.ts tui --project ./test-project
      2. Assert TUI renders (not "hello\n")
      3. Ctrl+C to exit
    Expected Result: Full TUI launches, not placeholder
    Evidence: .sisyphus/evidence/task-15-cli-launch.txt

  Scenario: CLI tui without Bun shows helpful error
    Tool: Bash (running under node)
    Steps:
      1. Run: node dist/cli.cjs tui
      2. Assert output contains "Bun"
      3. Assert output contains "bun.sh"
      4. Assert exit code 1
    Expected Result: Clear error message guiding user to install Bun
    Evidence: .sisyphus/evidence/task-15-no-bun-error.txt

  Scenario: Existing CLI commands unaffected
    Tool: Bash
    Steps:
      1. Run: bun run src/cli/index.ts --help
      2. Assert output contains "tui" with "(requires Bun)"
      3. Run: bun run src/cli/index.ts list --project ./test-project
      4. Assert modules listed (not TUI rendered)
    Expected Result: list command works as before, help shows tui
    Evidence: .sisyphus/evidence/task-15-existing-cli.txt
  ```

  **Commit**: YES — `feat(tui): add OpenTUI terminal interface with streaming chat`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`

  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.

  **Output**: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [15/15] | VERDICT: APPROVE/REJECT`

  **Must Have Audit**:
  - Context area ScrollBox with streaming → `src/tui/components/ContextArea.tsx` uses `<scrollbox>`
  - Slash "/" command palette → `src/tui/components/CommandPalette.tsx` triggered by "/"
  - Status bar (status + working dir) → `src/tui/components/StatusBar.tsx`
  - Setup wizard → `src/tui/components/SetupWizard.tsx`
  - Ctrl+C graceful exit → `src/tui/App.tsx` keyboard handler
  - Agent switching via /list → `src/tui/commands.ts` /list handler

  **Must NOT Have Audit**:
  - No module tree visualization → grep for "tree|renderSvg|layoutNode" in src/tui/
  - No context persistence → grep for "localStorage|ctx_|saveContext" in src/tui/
  - No modified AgentManager/AgentLauncher/AgentRouter → git diff src/agents/
  - No modified Electron path → git diff electron/
  - No mouse interaction → grep for "onMouse|mouse" in src/tui/

- [x] F2. **TUI QA Execution** — `unspecified-high` (+ `interactive_bash` tmux)

  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (setup wizard → scan → chat → send → stream → commands → quit).

  **Required executions** (from all tasks):
  1. Task 1: OpenTUI Windows render + Ctrl+C exit + Unicode
  2. Task 2: JSX compiles, imports work
  3. Task 3: State signals update
  4. Task 4: Config validate/write
  5. Task 5: AgentService init + send/receive
  6. Task 6: Layout renders + Ctrl+C exit
  7. Task 7: Status bar idle + streaming transition
  8. Task 8: Slash triggers palette + Enter sends message
  9. Task 9: Palette shows all + prefix filter
  10. Task 10: Messages display + streaming updates
  11. Task 11: Setup wizard complete + Esc exit
  12. Task 12: Full wired flow
  13. Task 13: End-to-end round-trip + disconnect
  14. Task 14: All slash commands + unknown command
  15. Task 15: CLI launch + no-Bun error + existing CLI

  **Output**: `Scenarios [N/15 pass] | Integration [PASS/FAIL] | Edge Cases [N tested] | VERDICT`

- [x] F3. **Code Quality Check** — `unspecified-high`

  Check: no `as any`/`@ts-ignore` in new code, no `console.log` (use TUI overlay or remove), no commented-out code blocks, no unused imports, consistent Solid patterns (not mixing React hooks), proper cleanup in error paths. Run root `tsc --noEmit` to verify no type regressions.

  **Output**: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`

  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance per task. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes in existing code.

  **Output**: `Tasks [15/15 compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **All tasks**: Single logical commit after Wave 3 integration verified
  - Message: `feat(tui): add OpenTUI terminal interface with streaming chat`
  - Files: `src/tui/**`, `src/cli/index.ts`

---

## Success Criteria

### Verification Commands
```bash
bun run src/tui/tui-entry.ts --project ./test-project  # TUI launches with status bar
npx tsc --noEmit                                      # Root project still type-checks
```

### Final Checklist
- [ ] OpenTUI renders on Windows without crash
- [ ] Agent streaming output visible in context area
- [ ] All 6 slash commands functional
- [ ] Status bar updates correctly
- [ ] Setup wizard works when config missing
- [ ] Ctrl+C clean exit
- [ ] Existing CLI commands unaffected
- [ ] Root `tsc --noEmit` passes
