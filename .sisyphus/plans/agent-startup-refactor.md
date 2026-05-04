# Agent 启动流程统合 — 共享模块提取

## TL;DR

> **Quick Summary**: 将 `electron/main.ts` 中的 agent 启动逻辑提取到 `src/agents/` 共享模块，消除 GUI/TUI 两套实现的差异（subModuleDirs、workspace 隔离、MCP 后端），使两路径共用同一套代码。
> 
> **Deliverables**:
> - `src/agents/WorkspaceIsolator.ts` — workspace 路径计算、代码源解析、git clone、复制隔离
> - `src/agents/PromptBuilder.ts` — 系统 prompt 加载、首消息上下文注入、消息消抖
> - `src/agents/McpServerBuilder.ts` — MCP server 配置构建、graph 文件序列化
> - `src/agents/McpBackend.ts` — HTTP 后端服务器、跨模块调度、请求路由
> - `src/agents/AgentOrchestrator.ts` — 统一 agent 启动流程（合并 agent:start + ensureModuleAgentRunning）
> - 更新 `electron/main.ts` — 替换内联函数为共享模块导入
> - 更新 `src/agents/AgentManager.ts` — 传递 subModuleDirs + mcpServers
> - 更新 `src/agents/AgentRouter.ts` — 使用共享 PromptBuilder
> - 更新 `src/tui/services/AgentService.ts` — 接入 workspace 隔离
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 6 waves
> **Critical Path**: T1 → T2-T4 → T5-T7 → T8-T10 → T11-T13 → T14-T15

---

## Context

### Original Request
用户要求将 Electron GUI 和 TUI 的 agent 启动流程对齐，将共享逻辑提取到 `src/agents/` 模块，避免两套重复实现。"流程对齐，然后修复差异。建议将流程固化在 src/ 内的模块内，避免 GUI 和 TUI 实现两份同样的逻辑"。

范围确认：完整提取所有 11 个函数 + MCP 后端全量搬入 src/，一步到位。

### Interview Summary

**Key Discussions**:
- **范围**: 完整提取（非最小修复），11 个函数 + MCP HTTP 后端
- **MCP**: 全量搬入 `src/agents/McpBackend.ts`，Electron 只保留 BrowserWindow 回调注入
- **优先级**: 一步到位 — 修复 + 提取在一个计划中完成
- **测试**: Agent QA only，`npx tsc --noEmit` + `npm run build:electron` 为守卫

**Research Findings** (from explore agent):
- `electron/main.ts` 有 753 行，14 个模块级状态变量，11 个待提取函数
- `AgentLauncher.ts` 已支持 `{ subModuleDirs }` 第 5 参数 — TUI 没传
- `AgentManager.startModuleAgent()` 只传 4 个参数给 `launcher.launch()`
- `AgentService.init()` 传 `mcpServers: []` 给 AgentManager
- `AgentRouter` 中有**部分重复**的 prompt 构建逻辑（与 Electron 的 `buildPromptBlocks` 重复）
- `src/cli/commands/serve.ts` 不涉及 agent 生命周期 — 无需修改

### Metis Review

**Identified Gaps** (addressed in plan):

1. **sessionPrompted key 不一致**: Electron 用 `moduleName`，AgentRouter 用 `sessionId` → **统一为 `moduleName`**（生存 span 更大）
2. **agent:start 和 ensureModuleAgentRunning 重复**: 两处逻辑相同但分别实现 → **合并为 AgentOrchestrator.startAgent()**
3. **14 个状态变量未分类**: 需明确每个变量的归属（留 main.ts / 移实例属性 / 移构造函数参数）
4. **AgentRouter 的 prompt 构建重复**: `sendToAgent()` 有自己的实现 → **重构为使用共享 PromptBuilder**
5. **并发启动竞态**: `ensureModuleAgentRunning` 无锁 → **添加 pending-startup Map 防双重启动**
6. **mcp-graph.json 文件名冲突**: Electron 和 TUI 同时运行时共享路径 → **文件名加 PID 后缀**
7. **gitCacheDir 生命周期**: Electron 中是进程级单例，TUI 中是实例级 → **保持 Map 实例属性，TUI 每次 init 重建**

**Decisions Made**:
- 模块拆分：新增 `AgentOrchestrator.ts`（合并启动逻辑），其余 4 个模块不变
- 分两阶段：Wave 1-2 提取纯函数 → Wave 3-4 提取有状态模块 → Wave 5-6 集成
- `sessionPrompted` 统一 key 为 `moduleName`
- `buildMcpServers` 接受 `basePath` 参数替代 `app.getAppPath()`

---

## Work Objectives

### Core Objective
将 agent 启动流程的共享逻辑从 `electron/main.ts` 提取到 5 个新的 `src/agents/` 模块，消除 GUI/TUI 之间的 7 个实现差异，使两条路径使用完全相同的代码。

### Concrete Deliverables
- `src/agents/WorkspaceIsolator.ts` — 7 个方法：workspacePathForModule, codeSourcePathForModule, resolveGitCodeSource, prepareModuleWorkspace, getSubModuleDirs, getGitCache, clearGitCache
- `src/agents/PromptBuilder.ts` — 3 个方法：loadSystemPrompts, buildPromptBlocks, dedupMessage
- `src/agents/McpServerBuilder.ts` — 2 个方法：buildMcpServers, writeMcpGraphFile
- `src/agents/McpBackend.ts` — McpBackendServer 类：start, stop, handleRequest
- `src/agents/AgentOrchestrator.ts` — AgentOrchestrator 类：startAgent（合并 agent:start + ensureModuleAgentRunning）
- `electron/main.ts` — 替换内联函数为共享模块导入，14 个状态变量减至 ~8 个
- `src/agents/AgentManager.ts` — startMainAgent/startModuleAgent 传 subModuleDirs
- `src/agents/AgentRouter.ts` — 重构 sendToAgent 使用 PromptBuilder
- `src/tui/services/AgentService.ts` — init 中创建 WorkspaceIsolator，传递 workspace root
- `src/tui/renderer.tsx` — 传递代码源配置给 AgentService

### Definition of Done
- [ ] `npx tsc --noEmit` 通过，零新增类型错误
- [ ] `npm run build:electron` 通过，所有 5 个子构建成功
- [ ] `AgentManager.startModuleAgent()` 传 5 个参数给 `launcher.launch()`（含 subModuleDirs）
- [ ] `AgentManager.startMainAgent/startModuleAgent` 传 mcpServers 给 `newSession()`
- [ ] `electron/main.ts` 中 `agent:start` 和 `ensureModuleAgentRunning` 合并为单一 `startAgent()` 调用
- [ ] `AgentRouter.sendToAgent()` 使用共享 PromptBuilder
- [ ] `sessionPrompted` 在两条路径中使用统一 key（moduleName）
- [ ] MCP backend 可被 Electron 和 TUI 独立启动

### Must Have
- subModuleDirs 传给所有 launcher.launch() 调用
- workspace 隔离逻辑复用（prepareModuleWorkspace）
- MCP server 配置在两条路径中一致构建
- 系统 prompt 加载和首消息注入统一
- Electron 路径零回归（所有 IPC handler 保持原有行为）
- TUI 路径新增 subModuleDirs + MCP 传递

### Must NOT Have (Guardrails)
- **NO** 修改 ACP 协议层（connection.ts, handlers/fs.ts）
- **NO** 修改 AgentLauncher.launch() 签名（已支持 subModuleDirs）
- **NO** 修改 `src/cli/commands/serve.ts`（不涉及 agent 生命周期）
- **NO** 修改 `electron/renderer/` 或 `electron/preload.ts`
- **NO** 新增 npm 依赖（simple-git, fs-extra 已存在于 electron 路径；共享模块需确认）
- **NO** console.log — 全部通过 defaultLogger
- **NO** 改变任何函数的现有行为（纯提取 + 参数化）

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None (Agent QA only)
- **Framework**: N/A — `npx tsc --noEmit` + `npm run build:electron` 为守卫

### QA Policy
Every task includes agent-executed QA scenarios using Bash for type-check/build verification and interactive_bash (tmux) for TUI behavior verification.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (PURE FUNCTIONS — foundation, MAX PARALLEL):
├── T1: WorkspaceIsolator.ts (workspacePathForModule + codeSourcePathForModule) [quick]
├── T2: PromptBuilder.ts (loadSystemPrompts + buildPromptBlocks) [quick]
├── T3: McpServerBuilder.ts (writeMcpGraphFile) [quick]
└── T4: Dedup + sessionPrompted (extract from electron/main.ts) [quick]

Wave 2 (PURE FUNCTIONS — depends on Wave 1):
├── T5: WorkspaceIsolator.ts (resolveGitCodeSource + prepareModuleWorkspace) [deep]
├── T6: WorkspaceIsolator.ts (getSubModuleDirs) [quick]
└── T7: McpServerBuilder.ts (buildMcpServers — param: basePath) [quick]

Wave 3 (STATEFUL MODULES — depends on Wave 2):
├── T8: AgentOrchestrator.ts (unified startAgent — merge agent:start + ensureModuleAgentRunning) [deep]
└── T9: McpBackend.ts (HTTP server + cross-module dispatch) [deep]

Wave 4 (INTEGRATION — Electron path, depends on Wave 3, MAX PARALLEL):
├── T10: Refactor electron/main.ts (replace inline functions with imports) [deep]
├── T11: Refactor AgentRouter.ts (use shared PromptBuilder) [quick]
└── T12: Refactor TUI AgentService.ts + AgentManager.ts (subModuleDirs + workspace) [unspecified-high]

Wave 5 (VERIFICATION — depends on Wave 4):
├── T13: Full build + type-check (npm run build:electron + npx tsc --noEmit) [quick]
├── T14: TUI smoke test (interactive_bash: launch + /list + /tree + message send) [unspecified-high]
└── T15: Electron diff review (verify no regressions in main.ts) [unspecified-high]
```

**Critical Path**: T1-T4 → T5-T7 → T8-T9 → T10-T12 → T13-T15
**Parallel Speedup**: ~55% faster than sequential
**Max Concurrent**: 4 (Wave 1)

### Agent Dispatch Summary
- **Wave 1**: 4 tasks — T1-T4 → `quick`
- **Wave 2**: 3 tasks — T5 → `deep`, T6,T7 → `quick`
- **Wave 3**: 2 tasks — T8,T9 → `deep`
- **Wave 4**: 3 tasks — T10 → `deep`, T11 → `quick`, T12 → `unspecified-high`
- **Wave 5**: 3 tasks — T13 → `quick`, T14 → `unspecified-high`, T15 → `unspecified-high`
- **FINAL**: 4 tasks — F1 → `oracle`, F2-F4 → `unspecified-high`

---

## TODOs

- [x] 1. **WorkspaceIsolator.ts — path 计算函数**

  **What to do**:
  - 创建 `src/agents/WorkspaceIsolator.ts`
  - 从 `electron/main.ts:277-317` 提取两个纯函数，参数化所有依赖：
    - `workspacePathForModule(node, workspaceRoot, projectRoot)` — 计算模块的 workspace 绝对路径（原 lines 277-284）
    - `codeSourcePathForModule(node, codeSource)` — 解析本地代码源路径（原 lines 294-317）
  - 提取 `normalizeCodeSourcePath` 调用保持不变（已从 `src/core/PathUtils.js` 导入）
  - 函数签名中的 `currentWorkspaceRoot`、`currentProjectRoot`、`currentCodeSource` 改为显式参数
  - 处理默认值：`workspacePathForModule` 的 `node.relativePath === '.'` 分支保持不变
  - `codeSourcePathForModule` 的 `resolvePath` 内嵌函数保持逻辑不变（try direct → try src/ → fallback direct）

  **Must NOT do**:
  - 不修改 `codeSourcePathForModule` 的路径解析逻辑（src/ 前缀试探、fallback）
  - 不新增 import — `path`、`fs` 已可用

  **Recommended Agent Profile**:
  - **Category**: `quick` — 纯函数提取，无状态耦合
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T2, T3, T4)
  - **Parallel Group**: Wave 1
  - **Blocks**: T5 (prepareModuleWorkspace 依赖这两个函数)
  - **Blocked By**: None

  **References**:
  - `electron/main.ts:277-284` — workspacePathForModule 源码（复制逻辑，参数化 currentWorkspaceRoot/currentProjectRoot）
  - `electron/main.ts:294-317` — codeSourcePathForModule 源码（复制 resolvePath 内嵌函数，参数化 currentCodeSource）
  - `src/core/PathUtils.ts:1-22` — normalizeCodeSourcePath（已导入，无需修改）
  - `src/types/module.ts:28-36` — ModuleGraphNode 类型（relativePath, name 字段）

  **Acceptance Criteria**:
  - [ ] `npx tsc --noEmit` 中零 WorkspaceIsolator.ts 相关错误
  - [ ] `workspacePathForModule(node, '/workspace', '/project')` 对 `relativePath: '.'` 返回 `/workspace/main`
  - [ ] `workspacePathForModule(node, null, '/project')` 回退到 `node.absolutePath`
  - [ ] `codeSourcePathForModule(node, { type: 'local', path: '/src' })` 返回 direct/src-prefix/fallback 之一

  **QA Scenarios**:

  ```
  Scenario: Type-check passes for new module
    Tool: Bash
    Preconditions: WorkspaceIsolator.ts created, imports correct
    Steps:
      1. Run: npx tsc --noEmit
      2. Assert: no errors containing "WorkspaceIsolator" in output
    Expected Result: Zero type errors for the new module
    Evidence: .sisyphus/evidence/task-1-tsc.txt
  ```

  **Commit**: NO (groups with Wave 1)

- [x] 2. **PromptBuilder.ts — 系统 prompt 加载 + 首消息构建**

  **What to do**:
  - 创建 `src/agents/PromptBuilder.ts`
  - 从 `electron/main.ts:51-84` 提取两个函数，参数化所有依赖：
    - `loadSystemPrompts(basePath: string)` — 读取 `config/mainagentprompt.md` 和 `config/subagentprompt.md`（原 lines 51-58）
      - `basePath` 替换 `app.getAppPath()`：Electron 传 `app.getAppPath()`，TUI 传 `process.cwd()`
      - 返回 `{ mainPrompt: string, subPrompt: string }`（替代原 module-level `cachedMainPrompt`/`cachedSubPrompt`）
    - `buildPromptBlocks(options)` — 构建首消息 prompt blocks（原 lines 60-84）
      - Options: `{ moduleName, userText, graph, prompts, sessionPrompted }`
      - `sessionPrompted` 从 Set 参数化（不创建自己的 Set）
      - **统一 key 为 `moduleName`**（原 Electron 用法，覆盖 AgentRouter 的 `sessionId` 用法）
  - 首消息逻辑：
    - 检查 `sessionPrompted.has(moduleName)` → 如果首次：add 到 set + 注入 system prompt + module context
    - 非首次：只追加 userText
  - ContentBlock 类型从 `@agentclientprotocol/sdk` 导入

  **Must NOT do**:
  - 不引入 message dedup（dedup 在 T4 单独处理，属于不同的关注点）
  - 不修改 prompt 内容（system prompt 字符串、module.md body 前缀 `# Module:` 保持不变）
  - 不修改 `sessionPrompted` Set 的生命周期（由调用方管理）

  **Recommended Agent Profile**:
  - **Category**: `quick` — 纯函数 + 文件 I/O，逻辑简单
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T1, T3, T4)
  - **Parallel Group**: Wave 1
  - **Blocks**: T8 (AgentOrchestrator 使用 buildPromptBlocks), T11 (AgentRouter 使用)
  - **Blocked By**: None

  **References**:
  - `electron/main.ts:51-58` — loadSystemPrompts 源码（fs.readFileSync，warn 处理缺失文件）
  - `electron/main.ts:60-84` — buildPromptBlocks 源码（isFirst check → system prompt → module context → userText）
  - `config/mainagentprompt.md` — 主 agent 系统提示文件
  - `config/subagentprompt.md` — 子 agent 系统提示文件
  - `src/agents/AgentRouter.ts:39-46` — loadPrompts 对比参考（__dirname 路径解析 — 替换为 basePath 参数）
  - `src/agents/AgentRouter.ts:87-120` — sendToAgent 对比参考（sessionId-keyed sessionPrompted — 改为 moduleName-keyed）

  **Acceptance Criteria**:
  - [ ] `loadSystemPrompts(basePath)` 返回 `{ mainPrompt, subPrompt }`（至少一个非空字符串）
  - [ ] 文件缺失时返回空字符串 `''`（不抛异常）
  - [ ] `buildPromptBlocks({ moduleName: 'main', ... })` 首次调用注入 system prompt + module context
  - [ ] `buildPromptBlocks(...)` 再次调用（moduleName 已在 sessionPrompted 中）不注入 system prompt
  - [ ] `npx tsc --noEmit` 零 PromptBuilder.ts 相关错误

  **QA Scenarios**:

  ```
  Scenario: loadSystemPrompts reads actual project files
    Tool: Bash
    Steps:
      1. Run bun repl script importing loadSystemPrompts
      2. Call with basePath = process.cwd()
      3. Assert mainPrompt.length > 0 (config/mainagentprompt.md exists)
      4. Assert subPrompt.length > 0 (config/subagentprompt.md exists)
    Expected Result: Both prompts loaded from config/
    Evidence: .sisyphus/evidence/task-2-load-prompts.txt

  Scenario: buildPromptBlocks first vs second call
    Tool: Bash (bun repl)
    Steps:
      1. Create empty sessionPrompted Set
      2. Call buildPromptBlocks({ moduleName: 'test', userText: 'hello', ... }) first time
      3. Assert blocks.length >= 2 (system prompt + userText)
      4. Call again with same moduleName
      5. Assert blocks.length === 1 (only userText, no system prompt)
    Expected Result: First call injects context; second call skips it
    Evidence: .sisyphus/evidence/task-2-prompt-blocks.txt
  ```

  **Commit**: NO (groups with Wave 1)

- [x] 3. **McpServerBuilder.ts — graph 文件序列化**

  **What to do**:
  - 创建 `src/agents/McpServerBuilder.ts`
  - 从 `electron/main.ts:206-216` 提取 `writeMcpGraphFile` 函数：
    - `writeMcpGraphFile(graph: ModuleGraphType, tempDir?: string): string`
    - 将 Map 转换为对象：`Object.fromEntries(graph.nodes)`
    - **文件名加 PID 后缀**避免并发冲突：`mcp-graph-${process.pid}.json`
    - 默认写入 `os.tmpdir()`，可通过 `tempDir` 参数覆盖
    - 使用 `fs.writeFileSync`
  - 日志：写入成功后 log.info 输出文件路径

  **Must NOT do**:
  - 不在此任务中实现 `buildMcpServers`（T7 完成）
  - 不修改 graph 序列化格式（保持 `{ root, nodes }` 结构）
  - 不使用异步 I/O — 保持与原 `writeFileSync` 一致

  **Recommended Agent Profile**:
  - **Category**: `quick` — 纯函数，单一文件 I/O
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T1, T2, T4)
  - **Parallel Group**: Wave 1
  - **Blocks**: T7 (buildMcpServers 需要 graph 文件路径)
  - **Blocked By**: None

  **References**:
  - `electron/main.ts:206-216` — writeMcpGraphFile 源码（Map→Object 转换、JSON.stringify、writeFileSync）
  - `src/types/module.ts:38-41` — ModuleGraphType（root + nodes: Map）
  - `os.tmpdir()` — Node.js os 模块（临时目录）

  **Acceptance Criteria**:
  - [ ] `writeMcpGraphFile(graph)` 返回有效文件路径
  - [ ] 文件名包含 PID：`/tmp/mcp-graph-{pid}.json`
  - [ ] 文件内容为合法 JSON，`JSON.parse` 后可重建 `{ root, nodes }` 对象
  - [ ] `npx tsc --noEmit` 零 McpServerBuilder.ts 相关错误

  **QA Scenarios**:

  ```
  Scenario: writeMcpGraphFile creates valid JSON
    Tool: Bash
    Steps:
      1. Create a mock ModuleGraph with 1 node
      2. Call writeMcpGraphFile(graph)
      3. Read the returned file path
      4. JSON.parse the file content
      5. Assert parsed.root === graph.root
      6. Assert Object.keys(parsed.nodes).length === 1
    Expected Result: File written, valid JSON, PID in filename
    Evidence: .sisyphus/evidence/task-3-graph-file.txt
  ```

  **Commit**: NO (groups with Wave 1)

- [x] 4. **Dedup + sessionPrompted — 提取到 PromptBuilder**

  **What to do**:
  - 在 `src/agents/PromptBuilder.ts` 中新增两个导出：
    - `dedupMessage(lastSent, moduleName, text, windowMs?): boolean` — 从 `electron/main.ts:38,626-633` 提取去重逻辑。返回 `true`=重复应忽略，默认窗口 3000ms。非重复时自动更新 Map。
    - `createSessionPrompted(): Set<string>` — 工厂函数，返回空的 moduleName-keyed Set
  - 直接编辑 T2 创建的 `PromptBuilder.ts` 追加代码

  **Must NOT do**: 不修改去重窗口逻辑；不在 PromptBuilder 中创建自己的 sessionPrompted Set

  **Recommended Agent Profile**: `quick` — 两个独立纯函数

  **QA Scenarios**: dedupMessage 首次返回 false，1 秒内再次返回 true；不同文本不被标记重复

- [x] 5. **WorkspaceIsolator.ts — git clone + workspace 复制**

  **What to do**:
  - 在 `src/agents/WorkspaceIsolator.ts` 中新增两个方法（依赖 T1 的函数）：
    - `resolveGitCodeSource(codeSource, gitCacheDir)` — 从 `electron/main.ts:319-349` 提取
      - 参数化 `currentCodeSource` → `codeSource`
      - 参数化 module-level `gitCacheDir` → 参数（Map 实例，由调用方管理生命周期）
      - 保持动态 `import('simple-git')` 不变
      - clone 逻辑：检查 cache → 如果在则 pull → 否则 clone
      - 返回 cachePath（字符串）或 `''`（非 git 类型）
    - `prepareModuleWorkspace(node, options)` — 从 `electron/main.ts:351-423` 提取
      - Options: `{ workspaceRoot, codeSource, graph, gitCacheDir, onLog? }`
      - 内部调用 `codeSourcePathForModule`、`resolveGitCodeSource`（同文件内调用）
      - 保持原有逻辑：resolve source dir → ensure dest dir → collect subModulePaths → copy（filter: node_modules/.git/子模块）
      - 复制失败时回退到 `node.absolutePath`（不抛异常）
  - `fs-extra` (`fse`) 是 electron 的依赖 → 共享模块需要确认 `fs-extra` 在 `package.json` 的 dependencies 中（而非仅 devDependencies）
  - 如 `fs-extra` 不可用，使用 `fs/promises` + `fs` 替代 `fse.ensureDir` 和 `fse.copy`

  **Must NOT do**:
  - 不修改 git clone/pull 的重试逻辑
  - 不修改 copy filter（node_modules/.git/子模块路径排除规则）
  - 不改变 `prepareModuleWorkspace` 的错误处理策略（失败时返回 node.absolutePath，不抛异常）

  **Recommended Agent Profile**:
  - **Category**: `deep` — 复杂的异步文件操作 + git 集成，多层 failover 逻辑
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO — 依赖 T1 的 workspacePathForModule 和 codeSourcePathForModule
  - **Parallel Group**: Wave 2
  - **Blocks**: T8 (AgentOrchestrator), T12 (TUI AgentService)
  - **Blocked By**: T1 (WorkspaceIsolator 基础函数)

  **References**:
  - `electron/main.ts:319-349` — resolveGitCodeSource 源码（gitCacheDir Map、clone/pull、cacheKey 计算）
  - `electron/main.ts:351-423` — prepareModuleWorkspace 源码（完整复制逻辑、subModulePaths 收集、filter 函数）
  - `src/agents/WorkspaceIsolator.ts` (T1 产物) — workspacePathForModule, codeSourcePathForModule 已存在
  - `src/types/module.ts:28-36` — ModuleGraphNode（children[], relativePath, absolutePath）
  - `package.json` — 确认 `fs-extra` 是否在 dependencies 中

  **Acceptance Criteria**:
  - [ ] `resolveGitCodeSource({ type: 'git', url: '...', branch: 'main' }, new Map())` 返回路径字符串
  - [ ] `resolveGitCodeSource({ type: 'local', path: '...' }, new Map())` 返回 `''`
  - [ ] `prepareModuleWorkspace(node, options)` 返回 workspace 目录路径
  - [ ] 复制时排除 node_modules 和 .git
  - [ ] 复制失败时返回 `node.absolutePath`
  - [ ] `npx tsc --noEmit` 零新增 WorkspaceIsolator 错误

  **QA Scenarios**:

  ```
  Scenario: prepareModuleWorkspace local codeSource
    Tool: Bash
    Preconditions: Test project with module.md and a .git directory
    Steps:
      1. Create mock node with relativePath='.', children=[]
      2. Set up temp workspaceRoot and codeSource { type: 'local', path: 'test-project' }
      3. Call prepareModuleWorkspace(node, options)
      4. Assert: dest directory exists
      5. Assert: dest directory does NOT contain .git subdirectory
      6. Assert: dest directory does NOT contain node_modules
    Expected Result: Workspace created without .git/node_modules
    Evidence: .sisyphus/evidence/task-5-workspace.txt
  ```

  **Commit**: NO (groups with Wave 2)

- [x] 6. **WorkspaceIsolator.ts — subModuleDirs 解析**

  **What to do**:
  - 在 `src/agents/WorkspaceIsolator.ts` 中新增 `getSubModuleDirs` 方法：
    - 从 `electron/main.ts:286-292` 提取
    - `getSubModuleDirs(node, graph, workspacePathForModuleFn)` — 参数化依赖
    - 实现：`node.children.map(name → graph.nodes.get(name)).filter().map(c → workspacePathForModuleFn(c))`
    - 当 `graph` 为 null 时返回 `[]`（不抛异常）
    - `workspacePathForModuleFn` 是一个回调：接收 ModuleGraphNode，返回 string（调用方注入实际函数）

  **Must NOT do**:
  - 不在此任务中创建 `workspacePathForModule` 实例 — 注入回调
  - 不处理 null children（`node.children` 类型安全由 TypeScript 保证）

  **Recommended Agent Profile**:
  - **Category**: `quick` — 一个 map/filter/map 链，纯函数
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T5, T7)
  - **Parallel Group**: Wave 2
  - **Blocks**: T8 (AgentOrchestrator), T12 (TUI AgentService)
  - **Blocked By**: T1 (workspacePathForModule 存在)

  **References**:
  - `electron/main.ts:286-292` — getSubModuleDirs 源码（children → nodes.get → workspacePathForModule）
  - `src/agents/WorkspaceIsolator.ts` — workspacePathForModule（T1 已创建）

  **Acceptance Criteria**:
  - [ ] `getSubModuleDirs(node, graph, fn)` 返回 `string[]`（子模块绝对路径列表）
  - [ ] graph 为 null 时返回 `[]`
  - [ ] `npx tsc --noEmit` 零新增错误

  **QA Scenarios**:

  ```
  Scenario: getSubModuleDirs with 2 children
    Tool: Bash (bun repl)
    Steps:
      1. Create mock graph with root node + 2 children
      2. Mock workspacePathForModuleFn to return '/workspace/{name}'
      3. Call getSubModuleDirs(rootNode, graph, fn)
      4. Assert: result === ['/workspace/child1', '/workspace/child2']
    Expected Result: Two resolved paths returned
    Evidence: .sisyphus/evidence/task-6-subdirs.txt
  ```

  **Commit**: NO (groups with Wave 2)

- [x] 7. **McpServerBuilder.ts — MCP server 配置构建**

  **What to do**:
  - 在 `src/agents/McpServerBuilder.ts` 中新增 `buildMcpServers` 函数：
    - 从 `electron/main.ts:425-464` 提取
    - `buildMcpServers(options): McpServer[]`
    - Options: `{ moduleName, basePath, backendPort, graphFile, nodeBin? }`
    - `basePath` 替换 `app.getAppPath()`：Electron 传 `app.getAppPath()`，TUI 传 `process.cwd()`
    - `nodeBin` 默认 `'node'`，可从 `process.execPath` 传入以支持 Windows
    - MCP server bundle 路径：`path.join(basePath, 'dist', 'mcp-server.cjs')`
    - 条件检查：
      1. `backendPort` 未就绪 → warn + 返回 `[]`
      2. `graphFile` 未就绪 → warn + 返回 `[]`
      3. server bundle 不存在 → warn + 返回 `[]`
    - 构建 args：`[serverPath, '--graph-file', graphFile, '--backend-url', backendUrl, '--module-name', moduleName]`
    - env 格式：`Array<{name: string, value: string}>`（ACP Zod 要求，非 Record）
    - 返回类型 `McpServer[]`（从 `@agentclientprotocol/sdk` 导入）

  **Must NOT do**:
  - 不改变 server 路径拼接逻辑
  - 不改变 MCP server args 格式
  - 不调用 `app.getAppPath()` — 全部通过 `basePath` 参数

  **Recommended Agent Profile**:
  - **Category**: `quick` — 纯字符串构建 + 条件检查
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T5, T6)
  - **Parallel Group**: Wave 2
  - **Blocks**: T8 (AgentOrchestrator), T10 (electron/main.ts), T12 (TUI AgentService)
  - **Blocked By**: T3 (writeMcpGraphFile 存在)

  **References**:
  - `electron/main.ts:425-464` — buildMcpServers 源码（条件检查、args 构建、McpServer 类型）
  - `src/agents/McpServerBuilder.ts` — writeMcpGraphFile（T3 已创建）
  - `dist/mcp-server.cjs` — MCP server bundle 位置验证
  - `AGENTS.md:16` — "McpServerStdio env format: Must be Array<{name: string, value: string}>" — 关键约束

  **Acceptance Criteria**:
  - [ ] `buildMcpServers({ moduleName: 'main', basePath: '/app', backendPort: 3000, graphFile: '/tmp/mcp-graph.json' })` 返回包含 1 个 McpServer 的数组
  - [ ] `backendPort` 为 0 时返回 `[]`（warn 日志）
  - [ ] `graphFile` 为空时返回 `[]`（warn 日志）
  - [ ] args 按顺序：[serverPath, '--graph-file', graphFile, '--backend-url', backendUrl, '--module-name', moduleName]
  - [ ] env 类型为 `Array<{name: string, value: string}>`
  - [ ] `npx tsc --noEmit` 零新增错误

  **QA Scenarios**:

  ```
  Scenario: buildMcpServers with all conditions met
    Tool: Bash (bun repl)
    Preconditions: dist/mcp-server.cjs exists
    Steps:
      1. Import buildMcpServers
      2. Call with valid options
      3. Assert: returns array with 1 element
      4. Assert: element.command === 'node'
      5. Assert: element.args includes '--graph-file' and '--backend-url' and '--module-name'
      6. Assert: element.env is Array type
    Expected Result: Properly configured McpServer returned
    Evidence: .sisyphus/evidence/task-7-mcp-server.txt
  ```

  **Commit**: NO (groups with Wave 2)

- [x] 8. **AgentOrchestrator.ts — 统一 agent 启动流程**

  **What to do**:
  - 创建 `src/agents/AgentOrchestrator.ts`，合并 `electron/main.ts` 中两处重复的启动逻辑
  - 核心方法 `startAgent(options)` 完整流水线：
    1. resolveAgentConfig → 2. workspace.prepareModuleWorkspace → 3. workspace.getSubModuleDirs → 4. launcher.launch(config, name, cwd, logger, { subModuleDirs }) **5参数调用** → 5. 设置 onSessionUpdate → 6. mcpServerBuilder.buildMcpServers → 7. connection.newSession({ cwd, mcpServers }) → 8. sessionPrompted.delete(moduleName)
  - 添加 `pendingStarts: Map<string, Promise>` 防止并发重复启动（双重检查）
  - `stopAll()` 清理所有 agent 进程 + pending

  **Must NOT do**: 不处理 IPC（留 electron/main.ts）；不处理 TUI 消息路由（留 AgentRouter）

  **Recommended Agent Profile**: `deep` — 跨模块编排 + 依赖注入 + 并发控制
  **Blocks**: T10, T12 | **Blocked By**: T5-T7

  **References**: `electron/main.ts:557-620` (agent:start), `electron/main.ts:218-275` (ensureModuleAgentRunning), `src/agents/AgentLauncher.ts:29` (launch 5参数)

  **Acceptance Criteria**: launcher.launch 收到 5 参数（含 { subModuleDirs }）；并发同模块启动只执行一次

  **QA Scenarios**:
  ```
  Scenario: startAgent passes 5 args to launcher
    Tool: Bash (bun repl) — mock launcher, verify launch call args
    Expected: 5th arg is { subModuleDirs: [...] }, newSession receives mcpServers
    Evidence: .sisyphus/evidence/task-8-start-agent.txt
  ```

  **Commit**: NO

- [x] 9. **McpBackend.ts — HTTP 后端 + 跨模块调度**

  **What to do**:
  - 创建 `src/agents/McpBackend.ts`，McpBackendServer 类
  - Constructor 注入回调：getAgentEntry, startAgent, sendCrossContext, buildPromptBlocks
  - `start(): Promise<number>` — 启动 http.createServer，绑定 127.0.0.1:0，幂等
  - `handleRequest(req, res)` — POST 路由：查找/启动 target agent → 构建 prompt → connection.prompt → 捕获 streaming → 返回结果
  - `stop(): Promise<void>` — 关闭服务器

  **Must NOT do**: 不引用 electron/BrowserWindow/ipcMain — 全部回调注入

  **Recommended Agent Profile**: `deep` — HTTP 服务器 + 依赖注入 + streaming 捕获
  **Blocks**: T10 | **Blocked By**: T7

  **References**: `electron/main.ts:92-204` (startMcpBackend), `electron/main.ts:86-90` (sendCrossContext)

  **Acceptance Criteria**: start() 返回端口；幂等；POST 返回 200/404/405/500 正确；stop() 清理

  **QA Scenarios**:
  ```
  Scenario: McpBackend starts + handles cross-module POST
    Tool: Bash (curl) — start server, POST {"targetModule":"test","task":"hello"}, assert 200
    Evidence: .sisyphus/evidence/task-9-backend.txt
  ```

  **Commit**: NO

- [x] 10. **Refactor electron/main.ts — 替换内联函数为共享模块导入**

  **What to do**:
  - 删除 11 个内联函数，替换为 5 个共享模块的导入和调用
  - 合并 `agent:start` + `ensureModuleAgentRunning` → `AgentOrchestrator.startAgent()`
  - `startMcpBackend()` → `McpBackendServer` 实例
  - `agent:send` 使用 `dedupMessage()` 替代内联去重
  - 状态变量清理：删除 cachedMainPrompt/cachedSubPrompt/gitCacheDir

  **Must NOT do**: 不修改 electron/renderer/ 和 electron/preload.ts；IPC 接口不变

  **Recommended Agent Profile**: `deep` — 大规模重构主进程
  **Blocks**: T13-T15 | **Blocked By**: T8, T9

  **References**: `electron/main.ts:1-753` (全部), `AgentOrchestrator.ts` (T8), `McpBackend.ts` (T9)

  **Acceptance Criteria**: 11 个函数已替换；`agent:start` 使用 Orchestrator；`npm run build:electron` 全部通过

  **QA Scenarios**:
  ```
  Scenario: Full electron build passes
    Tool: Bash — npm run build:electron
    Expected: All 5 sub-builds succeed, zero errors
    Evidence: .sisyphus/evidence/task-10-build.txt
  ```

  **Commit**: NO

- [x] 11. **Refactor AgentRouter.ts — 使用共享 PromptBuilder**

  **What to do**:
  - `sendToAgent()` 替换内联 prompt 构建为 `promptBuilder.buildPromptBlocks()`
  - `sessionPrompted` key 从 `sessionId` 改为 `moduleName`
  - 删除 `loadPrompts()` 和 `getSystemPrompt()`（如果仅被 sendToAgent 使用）

  **Must NOT do**: 不修改 routeMessage、cancelAgent

  **Recommended Agent Profile**: `quick` — 替换 prompt 构建调用
  **Blocks**: T13 | **Blocked By**: T2

  **References**: `src/agents/AgentRouter.ts:39-51,87-120`

  **Acceptance Criteria**: sendToAgent 使用 buildPromptBlocks；sessionPrompted key=moduleName

  **QA Scenarios**:
  ```
  Scenario: Type-check passes after AgentRouter refactor
    Tool: Bash — npx tsc --noEmit | grep AgentRouter
    Expected: Zero errors
    Evidence: .sisyphus/evidence/task-11-agent-router.txt
  ```

  **Commit**: NO

- [x] 12. **Refactor TUI AgentService.ts + AgentManager.ts — subModuleDirs + workspace**

  **What to do**:
  - AgentManager.startMainAgent/startModuleAgent 新增可选参数 `subModuleDirs?: string[]`（默认 `[]`）
  - 传 5 参数给 `launcher.launch()`：`launcher.launch(config, name, cwd, logger, { subModuleDirs })`
  - AgentService 的 startModuleAgent 调用 `getSubModuleDirs(node, graph, fn)` 并传入
  - AgentService.init 中创建 McpServerBuilder 实例，传非空 mcpServers 给 AgentManager

  **Must NOT do**: 不在 TUI 实现 workspace 隔离（文件复制是 GUI 特性）；保持 node.absolutePath 作为 cwd

  **Recommended Agent Profile**: `unspecified-high` — 跨文件参数传递
  **Blocks**: T14 | **Blocked By**: T5-T7

  **References**: `src/agents/AgentManager.ts:32-90` (两个 start 方法), `src/tui/services/AgentService.ts:39-143`

  **Acceptance Criteria**: launcher.launch 传 5 参数；subModuleDirs 默认 []；mcpServers 非空

  **QA Scenarios**:
  ```
  Scenario: AgentManager passes subModuleDirs to launcher
    Tool: Bash (bun repl) — mock launcher, verify 5th arg
    Expected: { subModuleDirs: [...] } in launch call
    Evidence: .sisyphus/evidence/task-12-submoduledirs.txt
  ```

  **Commit**: NO

- [x] 13. **Full Build + Type-Check 验证**

  **What to do**:
  - 运行 `npx tsc --noEmit` 确保所有 src/ 无类型错误
  - 运行 `npm run build:electron` 确保所有构建目标成功
  - 任何错误 → 列出文件:行号，不直接修改

  **Recommended Agent Profile**: `quick` — 运行构建命令并报告
  **Blocks**: T14, T15 | **Blocked By**: T10, T11, T12

  **Acceptance Criteria**: tsc 零新增错误；build:electron 全部 5 个子构建成功

  **QA Scenarios**:
  ```
  Scenario: Full build verification
    Tool: Bash
    Steps:
      1. npx tsc --noEmit 2>&1 | tee .sisyphus/evidence/task-13-tsc.txt
      2. npm run build:electron 2>&1 | tee .sisyphus/evidence/task-13-build.txt
    Expected: Both pass, zero errors
    Evidence: .sisyphus/evidence/task-13-tsc.txt, .sisyphus/evidence/task-13-build.txt
  ```

  **Commit**: NO

- [x] 14. **TUI 冒烟测试**

  **What to do**:
  - 使用 interactive_bash (tmux) 启动 TUI：
    `bun run --cwd src/tui ../cli/tui-entry.ts --project ../..`
  - 验证：TUI 启动无崩溃、状态栏显示 agent status
  - 输入 `/list` → 验证模块列表输出
  - 输入 `/tree` → 验证树形图输出（含状态指示符）
  - 输入普通消息 → 验证 agent 流式响应
  - Ctrl+C → 验证优雅退出

  **Recommended Agent Profile**: `unspecified-high` + 如需可加载 playwright skill
  **Blocks**: None | **Blocked By**: T13

  **Acceptance Criteria**: TUI 启动；/list /tree 命令正常；消息发送→agent 响应；Ctrl+C 退出

  **QA Scenarios**:
  ```
  Scenario: TUI full smoke test
    Tool: interactive_bash (tmux)
    Steps: launch → /list → /tree → send message → Ctrl+C
    Expected: All commands work, no crash, agent responds
    Evidence: .sisyphus/evidence/task-14-tui-smoke.txt
  ```

  **Commit**: NO

- [x] 15. **Electron diff 回归审查**

  **What to do**:
  - 审查 `electron/main.ts` 的 git diff，逐行对比变更
  - 重点检查：IPC handler 参数格式是否变化、agent:send/agent:start 返回值结构是否一致
  - 检查任何删除的函数是否在其他文件中有引用（lsp_find_references）

  **Recommended Agent Profile**: `unspecified-high` — 代码审查
  **Blocks**: None | **Blocked By**: T13

  **Acceptance Criteria**: 零 IPC 接口破坏性变更；零未预期的函数删除；所有回调注入正确

  **QA Scenarios**:
  ```
  Scenario: Git diff review
    Tool: Bash
    Steps:
      1. git diff electron/main.ts → review for IPC changes
      2. lsp_find_references on deleted function names → ensure no stale refs
    Expected: No breaking IPC changes, no orphaned refs
    Evidence: .sisyphus/evidence/task-15-diff-review.txt
  ```

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [x] F1. **Plan Compliance Audit** — `oracle` — APPROVE
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read files). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high` — APPROVE
  Run `npx tsc --noEmit` + `npm run build:electron`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` — APPROVE
  Launch TUI via tmux. Execute `/list`, `/tree`, send message. Verify agent startup includes subModuleDirs in launcher call (check logs). For Electron: verify `npm run build:electron` produces working binary.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep` — APPROVE
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1 (T1-T4)**: `refactor(agents): extract WorkspaceIsolator, PromptBuilder, McpServerBuilder base functions` — 4 new files
- **Wave 2 (T5-T7)**: `refactor(agents): add workspace isolation, subModuleDirs, MCP server builder` — 2 files updated
- **Wave 3 (T8-T9)**: `feat(agents): add AgentOrchestrator and McpBackend shared modules` — 2 new files
- **Wave 4 (T10-T12)**: `refactor: integrate shared modules into electron + TUI paths` — 3-4 files updated
- **Wave 5 (T13-T15)**: `verify: build, TUI smoke test, electron diff review` — evidence files only

---

## Success Criteria

### Verification Commands
```bash
npx tsc --noEmit         # Expected: zero NEW errors (pre-existing JSX errors acceptable)
npm run build:electron   # Expected: all 5 sub-builds succeed
```

### Final Checklist
- [ ] AgentManager.startMainAgent/startModuleAgent 传 5 参数给 launcher.launch （含 { subModuleDirs }）
- [ ] AgentManager 传非空 mcpServers 给 newSession
- [ ] electron/main.ts 的 11 个内联函数已替换为共享模块导入
- [ ] `agent:start` + `ensureModuleAgentRunning` 合并为 AgentOrchestrator.startAgent
- [ ] AgentRouter.sendToAgent 使用共享 PromptBuilder
- [ ] sessionPrompted 统一 key 为 moduleName
- [ ] MCP backend 可被 Electron 和 TUI 独立启动
- [ ] `npm run build:electron` 通过，零回归
- [ ] `npx tsc --noEmit` 零新增类型错误
- [ ] 所有 "Must NOT Have" 未被违反

