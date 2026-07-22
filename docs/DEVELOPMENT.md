# ModuleAgent — 开发文档

> 最后更新: 2026-07-22

## 1. 项目概述

**ModuleAgent** 是一个基于 Electron 的模块化 Agent 编排框架。以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的**进程内 Agent 内核**（`Agent` → `KernelFactory` → `AgentKernel` → `AgentLoop`，基于 ai-sdk v7 `generateText` 循环），通过内核内置工具（文件、搜索、命令、git、跨模块调用）完成工作，跨模块通信经 `CrossModuleRouter` 在进程内路由。**没有 ACP / 外部 agent 子进程**。

### 实际技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 运行时 | Electron | GUI 桌面应用 |
| 语言 | TypeScript 5.7 | 强类型 |
| 构建 | electron-vite (main + preload + renderer) + esbuild (CLI) | electron-vite 整合三端构建，esbuild 单独打包 CLI |
| UI | Vue 3 + Element Plus + Pinia | SFC 组件 + 状态管理 + UI 库 |
| Agent 内核 | ai-sdk v7（`ai` + `@ai-sdk/anthropic|openai|google|deepseek`） | 进程内 `generateText` 循环，无外部 agent 进程 |
| TUI | `@opentui/core` / `solid` / `keymap`（SolidJS） | 终端 UI，需 Bun 运行 |
| 模块解析 | gray-matter + marked | 解析 module.md |
| 校验 | zod v4 | 运行时类型校验 |

### 与旧文档的差异

项目方案和 DESIGN.md 描述的是 CLI + Ink 方案（Phase 1 设计），**实际实现是 Electron GUI 方案（Vue 3）**。CLI/TUI 路径（`src/cli/` + `src/tui/`）作为次级路径保留，与 Electron 路径共享同一套 Core 子系统（`src/core/ModuleAgentCore`）与 agent 内核（`src/agents/`）。

---

## 2. 目录结构

```
ModuleAgent/
├── src/
│   ├── main/
│   │   ├── index.ts                 # Electron 主进程 — 窗口/生命周期/日志，创建 ElectronBridge
│   │   ├── bridge.ts                # ElectronBridge — IPC 编排层
│   │   └── handlers/                # 8 个领域 handler（37 个 IPC 通道）+ fileNameSanitize
│   ├── preload/
│   │   └── index.ts                 # contextBridge API (类型在 src/types/shared.ts)
│   ├── renderer/
│   │   ├── index.html               # Vite 入口 HTML
│   │   └── src/
│   │       ├── main.ts              # Vue 3 入口 — createApp + router + pinia
│   │       ├── App.vue              # 根组件
│   │       ├── router/index.ts      # Vue Router（setup → main）
│   │       ├── views/
│   │       │   ├── SetupView.vue    # 设置页面（首次使用）
│   │       │   └── MainView.vue     # 主界面（左侧栏 + 抽屉 + 中央对话区）
│   │       ├── components/
│   │       │   ├── SVGTree.vue      # 交互式 SVG 模块树
│   │       │   ├── LeftSidebar.vue  # 左侧页签栏（节点树 / 角色 / 知识 / 工作流）
│   │       │   ├── NodeDetailPanel.vue # 模块详情 + 对话面板（主区域）
│   │       │   ├── RolePanel.vue    # 角色 Agent 卡片列表
│   │       │   ├── RoleConfigDialog.vue # 角色配置对话框
│   │       │   ├── KnowledgePanel.vue / KnowledgeEditDialog.vue   # 知识库
│   │       │   ├── WorkflowPanel.vue / WorkflowEditDialog.vue / StepEditDialog.vue # 工作流
│   │       │   ├── DrawerPanel.vue  # [废弃] 旧版右侧抽屉面板
│   │       │   ├── ContextCards.vue # 对话历史卡片
│   │       │   ├── ChatInput.vue    # 消息输入框
│   │       │   ├── SettingsDialog.vue / MessageModal.vue / ThemeToggle.vue
│   │       ├── stores/              # Pinia: agent / config / project / knowledge / workflow
│   │       ├── composables/         # useModuleAgent / useTheme
│   │       └── __mocks__/           # 测试 mock
│   ├── agents/                      # 进程内 agent 内核（双路径共享）
│   │   ├── Agent.ts                 # Agent 生命周期（状态机 + busy 队列，ALS 快照传播）
│   │   ├── KernelFactory.ts         # 创建 AgentKernel（provider/env 解析、Windows 路径规范化）
│   │   ├── StreamAccumulator.ts     # 流式累加器（reply/thinking/tools/timeline）
│   │   ├── kernel/                  # AgentKernel / AgentLoop（generateText 循环 + snip/compact/truncate 管道）
│   │   │   ├── Sandbox.ts           # 沙箱（realpath 包含校验，防 symlink/junction 逃逸）
│   │   │   ├── ProviderResolver.ts  # 四个内置 provider + custom 端点解析
│   │   │   └── tools/               # 内置工具：file_*, search, list_files, execute_command,
│   │   │                            #   git_operations, module_call/query/list, module_context_*
│   │   ├── lifecycle/               # RoleAgentManager / WorkflowManager / WorkflowWorkspace
│   │   ├── mcp/                     # CrossModuleRouter（跨模块路由）/ CallChain / McpBackend / McpServerBuilder
│   │   └── prompts/                 # PromptBuilder（Tier-1 摘要、系统提示加载）
│   ├── core/                        # 共享 Core 层
│   │   ├── ModuleAgentCore.ts       # 双路径统一编排（initAll 一次性装配）
│   │   ├── ModuleAgentSubsystem.ts  # 模块 Agent 子系统
│   │   ├── RoleAgentSubsystem.ts / WorkflowSubsystem.ts / WorkflowScanner.ts
│   │   ├── ModuleScanner.ts / ModuleParser.ts / ModuleGraph.ts / ModuleGenerator.ts
│   │   ├── ExperienceSummarizer.ts / PostSendHooks.ts / RetryPolicy.ts
│   │   ├── Logger.ts / PathUtils.ts / TokenEstimator.ts / ExclusionRules.ts
│   │   ├── ConfigPaths.ts / CoreTypes.ts / AgentSubsystemUtils.ts（SendGuard）
│   ├── config/
│   │   ├── ConfigLoader.ts          # 加载 .module-agent.json（loadWithStatus 暴露校验错误）
│   │   ├── defaults.ts / schema.ts  # 默认配置 + Zod schema
│   ├── protocol/
│   │   └── IpcChannels.ts           # 全部 IPC 通道名的单一事实来源
│   ├── cli/
│   │   ├── index.ts                 # CLI 入口（list/get/serve/tui/config）
│   │   ├── commands/                # list / get / serve / setup
│   │   └── utils/                   # project-root 发现 / JSON 输出
│   ├── tui/                         # OpenTUI (SolidJS) 终端界面
│   │   ├── bridge.ts                # TuiBridge — 三子系统管理 + 流式路由
│   │   ├── renderer.tsx / App.tsx / state.ts / commands.ts / TuiSessionStore.ts
│   │   └── components/              # ContextArea / InputBox / StatusBar / CommandPalette /
│   │                                #   SetupWizard / ModuleTree / ExperiencePanel / QuickPanel / RolePanel
│   └── types/
│       ├── module.ts                # ModuleDefinition, ModuleGraphNode 等
│       └── shared.ts                # ChatMsg, TreeNode, AgentStreamData 等
├── out/                             # electron-vite 构建输出（main/preload/renderer，gitignored）
├── dist/
│   └── cli.cjs                      # CLI 打包产物（自包含，gitignored）
├── config/
│   └── knowledge/                   # 系统提示与知识文件
│       ├── mainagentprompt.md       # 主 Agent 系统提示
│       ├── subagentprompt.md        # 子 Agent 系统提示
│       ├── roleagentprompt.md       # 角色 Agent 系统提示
│       ├── summarizerprompt.md      # 经验总结提示
│       └── MODULE_FORMAT.md         # 模块格式规范
├── electron.vite.config.ts          # electron-vite 配置（main + preload + renderer）
├── electron-builder.yml             # electron-builder 打包配置
├── vitest.config.ts                 # Vitest 测试配置
├── playwright.config.ts             # Playwright e2e 测试配置
├── package.json
├── tsconfig.json
├── tsconfig.node.json               # 主进程/preload TS 配置
└── tsconfig.web.json                # 渲染进程 TS 配置
```

### 已删除/废弃的文件（2026-07 清理）

- ACP 子进程层：`src/protocol/acp/`、`AgentLauncher`、`createAgentConnection`、opencode/claude 外部 agent 接入
- `src/context/`（ContextManager/FileStore，无生产引用）；`src/agents/prompts/system.ts`、`prompts/context.ts`（并入 PromptBuilder）
- `src/main/handlers/migrationHandlers.ts` 及 `agent:stop` / `agent:isRunning` / `agent:getRunning` / `migrate:*` IPC 通道
- `WorkspaceDiffPanel.vue`、`ProjectChatModal.vue`（workspace diff 主进程从未实现 handler）
- MCP Server 独立 bundle（`dist/mcp-server.cjs` / `mcp-role-server.cjs`）：内核工具进程内运行，不再需要
- 依赖：jq、`@agentclientprotocol/sdk`、`@modelcontextprotocol/server`、`@cfworker/json-schema`、simple-git
- `test_acp.ts`、`test/infrastructure/FauxAcpAgent.ts`

---

## 3. 核心架构

### 3.1 Agent 内核（进程内）

```
Agent (src/agents/Agent.ts)              # 生命周期状态机 + busy 队列（AsyncLocalStorage 快照传播）
  └─ KernelFactory.create()              # 解析 provider/apiKey/baseUrl（env 回落）+ cwd 正斜杠规范化
       └─ AgentKernel                    # 系统提示、工具装配、通知转发
            └─ AgentLoop                 # ai-sdk generateText 循环（保留完整多轮 ModelMessage[] 历史）
                 ├─ 内置工具（file_read/write/edit, search, list_files,
                 │   execute_command, git_operations,
                 │   module_call/query/list, module_context_read_*）
                 └─ 上下文管道：snip(60%, 零 LLM) → compact(70%, fastModel 摘要) → truncate(80%, tail-token-budget)
                      （丢弃内容归档到 .module-agent/archives/<module>/*.jsonl）
```

关键点：
- 系统提示（mainagent/subagent/roleagent）经 `Agent.start({ systemPrompt })` 以独立 `system` 角色消息注入（前缀缓存锚定），**不混入首条 user 消息**
- `maxTokens` → `maxOutputTokens`、`temperature` 已接入 `generateText`
- LLM 调用外层重试以 `stepsCompleted === 0` 为门禁（避免重放 file_write 等有副作用的工具）

### 3.2 跨模块通信

```
Agent A（内核）
  └─ module_call / module_query 工具（kernel/tools/mcp-bridge.ts）
       └─ CrossModuleRouter.routeCall（src/agents/mcp/）
            ├─ 目标模块未启动则自动 startAgent（@module 路由：精确匹配优先，模糊命中给可见提示）
            ├─ 经目标 Agent.send 队列（不触碰目标的用户流累积器）
            ├─ 调用链经 AsyncLocalStorage 传播（含 busy 队列）：环检测 + maxHops(默认 3)
            │   + wait-for 死锁检测（Map<string,Set<string>> 多边）
            │   + crossModule.timeoutMs(默认 120s) 经 AbortSignal 真正取消排队/在途调用
            └─ 跨模块上下文经 SessionStore.appendCrossContext(module, request, response) 独立落盘
```

### 3.3 流式输出流程

```
AgentLoop 流式通知
  → AgentKernel.onNotification
  → ModuleAgentSubsystem（StreamAccumulator 累加 reply/thinking/tools/timeline/sections）
  → Electron 路径: ModuleAgentCoreOptions.onSessionUpdate
       → webContents.send('agent:stream', { moduleName, update, data, reply, thinking, tools, timeline, sections })
       → renderer agentStore (Pinia) 响应式更新
  → TUI 路径: CoreCallbacks.onStreamChunk
       → TuiSessionStore.appendChunk → SolidJS signals
```

---

## 4. 关键接口

### 4.1 Agent API（`src/agents/Agent.ts`）

```typescript
// 启动（静态工厂）
Agent.start({
  name, config, cwd, launcher, logger,
  systemPrompt?,           // 独立 system 角色消息注入
  sandbox?, onNotification?, onQueue?, onSystemMessage?,
  truncation?, compaction?, archiveDir?,
}): Promise<Agent>

agent.send(blocks, { signal? }): Promise<SendResult>  // 经 busy 队列串行执行；Error 状态入队串行化
agent.cancel(): Promise<void>   // abort 在途调用，以 Canceled reject 全部排队项，agent 可复用
agent.stop(): void              // 停止内核
agent.clearContext(): Promise<string>   // 清空历史，返回新 sessionId
agent.setConfigOption(key, value): Promise<boolean>   // 内核模式恒 false（如实记录）
agent.sessionId: string
agent.sessionResult: { sessionId: string }
```

### 4.2 内核内置工具（`src/agents/kernel/tools/`）

| 工具 | 说明 |
|------|------|
| `file_read` / `file_write` / `file_edit` | 沙箱内文件读写编辑 |
| `search` / `list_files` | 内容搜索 / 目录列举 |
| `execute_command` | 执行 shell 命令（**默认禁用**；env 白名单——PATH/SystemRoot 等必要项，不再透传含 API key 的 process.env 全量） |
| `git_operations` | git 只读/常用操作（operation 白名单 + args 校验：拒绝 `--output`、危险 flag、绝对路径、`..`，失败码 `invalid_args`） |
| `module_list` / `module_call` / `module_query` | 跨模块调用（经 CrossModuleRouter） |
| `module_context_read_*` | 按需读取模块完整文档（渐进式披露） |

所有文件类工具经 `AgentSandbox` 校验：realpath 包含检查，symlink/junction 逃逸已堵。

### 4.3 IPC 通道（Electron，常量见 `src/protocol/IpcChannels.ts`）

**模块 Agent 通道**：

| 通道 | 方向 | 说明 |
|------|------|------|
| `project:scan` | Renderer → Main | `core.initAll()` 一次性装配 + `core.getGraph()` 返回模块树 |
| `project:getTree` | Renderer → Main | 获取当前模块树 |
| `project:generateModules` | Renderer → Main | 临时内核 Agent 自动生成 module.md |
| `agent:start` | Renderer → Main | 启动模块 Agent |
| `agent:send` | Renderer → Main | 发送消息给模块 Agent |
| `agent:cancel` | Renderer → Main | 取消当前请求（agent 可复用），返回已累积内容 |
| `agent:stream` | Main → Renderer | 流式更新推送 |
| `agent:status` | Main → Renderer | Agent 状态变化推送 |
| `agent:cross-context` | Main → Renderer | 跨模块通信推送 |
| `config:save` / `config:get` | Renderer → Main | 读写项目配置（save 先过 zod 校验） |
| `context:get` / `context:clear` / `context:clearAll` | Renderer → Main | 对话上下文持久化 |
| `dialog:selectDir` | Renderer → Main | 打开目录选择对话框 |

已删除：`agent:stop`、`agent:isRunning`、`agent:getRunning`、`migrate:check`、`migrate:data`。

**角色 Agent 通道**（10 个 + 2 个 push）：`role:list` / `save` / `delete` / `start` / `send` / `cancel` / `stop` / `isRunning` / `getContext` / `clearContext`；push：`role:stream` / `role:status`。

**工作流通道**（10 个）：`workflow:list` / `load` / `create` / `delete` / `stepSave` / `stepDelete` / `stepAdd` / `execute` / `cancel` / `status`。

**知识通道**（5 个）：`knowledge:list` / `read` / `save` / `create` / `delete`。

knowledge / workflow 的文件名输入统一经 `fileNameSanitize.ts` 消毒防路径穿越。

### 4.4 Preload API（window.moduleAgent）

```typescript
interface ModuleAgentApi {
  selectDir(title): Promise<string | null>
  scanProject(projectRoot): Promise<ScanResult>
  generateModules(projectRoot): Promise<{ success: boolean; count: number; error?: string }>
  getTree(): Promise<TreeNode | null>
  startAgent(moduleName, cmd, args, cwd): Promise<{ sessionId?, error? }>  // cmd/args 兼容保留，内核忽略
  sendMessage(moduleName, text, cwd?): Promise<{ result?: { reply, thinking, tools, stopReason }, error? }>
  cancelAgent(moduleName): Promise<{ accumulated? }>
  onAgentStream / onAgentStatus / onCrossContext   // 均返回取消订阅函数
  saveAgentConfig / getAgentConfig
  getContext / clearContext / clearAllContexts
  // 角色 × 12、知识 × 5、工作流 × 10（详见 src/preload/index.ts）
}
```

---

## 5. 渲染进程 UI 结构

```
SetupView.vue: 设置页面（首次使用）
  ├─ Element Plus 表单控件（provider / API Key / 模型 / 项目目录）
  └─ 开始扫描按钮

MainView.vue: 主界面
  ├─ 工具栏（扫描 / 清空 / 设置 / 主题切换）
  ├─ LeftSidebar.vue: 左侧页签栏（48px）
  │   ├─ 节点树页签 → 树抽屉（SVGTree.vue）
  │   ├─ 角色 Agent 页签 → 角色抽屉（RolePanel.vue）
  │   ├─ 知识页签 → KnowledgePanel.vue
  │   └─ 工作流页签 → WorkflowPanel.vue
  └─ 主区域（始终可见）
      ├─ NodeDetailPanel.vue: 选中节点时 — 模块信息 + ContextCards + ChatInput
      ├─ 角色详情（选中角色时）: 角色信息 + ContextCards(contextType='role') + ChatInput
      └─ 占位提示（未选中时）

  ├─ SettingsDialog.vue: 设置对话框
  ├─ RoleConfigDialog.vue: 角色配置对话框（名称/描述/可见模块路径多选/provider/模型等）
  └─ ThemeToggle.vue: 暗色/亮色主题切换
```

**交互逻辑**：
- 点击左侧页签 → 抽屉从左侧滑出（点击相同页签或遮罩层关闭）
- 在树中选择节点 → 抽屉关闭，主区域显示节点详情和对话
- 选中节点和选中角色互斥（选一个会清除另一个）
- 抽屉宽度可拖拽调节，上次宽度保存到 localStorage (`sideDrawerWidth`)

### ChatMsg 数据结构

```typescript
interface ChatMsg {
  id: string
  role: 'user' | 'agent' | 'cross' | 'tool' | 'system'
  content: string        // 回复文本
  thinking: string       // 思考文本（内核 reasoning）
  tools?: string
  timeline?: TimelineEvent[]
  time: string
  status: 'sent' | 'pending' | 'thinking' | 'executing' | 'completed' | 'error' | 'interrupted'
  moduleName: string
  agentCmd?: string
  sessionId?: string
  crossDirection?: 'sent' | 'received'  // cross 消息方向
  crossModule?: string                  // 跨模块通信的对端模块
  crossPhase?: 'request' | 'response'
}
```

---

## 6. 构建与运行

```bash
# 安装依赖
pnpm install

# 开发模式（Vite HMR，渲染进程 + 主进程 + preload 热重载）
pnpm run dev

# 类型检查（无 emit）— 当前 0 错误，首要门禁
pnpm run typecheck

# 单元/组件测试（Vitest，25 文件 158 用例）
pnpm run test

# E2E 测试（Playwright，需先 pnpm exec playwright install chromium）
pnpm run test:e2e

# 生产构建（electron-vite + CLI）
pnpm run build:electron

# 构建并启动 Electron 应用
pnpm run electron

# 打包为可分发格式
pnpm run dist
```

### 构建工具分工

**electron-vite**（`pnpm run build:electron` 的第一步）:
- 主进程 (`src/main/`) → `out/main/index.cjs`（CJS，external: electron, fs-extra, gray-matter, marked, zod, path, url, esbuild）
- 预加载 (`src/preload/`) → `out/preload/index.cjs`（CJS，external: electron）
- 渲染进程 (`src/renderer/`) → `out/renderer/`（Vite 产物，含 Vue 3 SFC 编译）
- 配置在 `electron.vite.config.ts` 中统一管理

**esbuild**（第二步 `build:cli`）:
- `dist/cli.cjs`（自包含 CJS，external: `@opentui/core`, `@opentui/solid`, `@opentui/keymap`）

MCP Server 独立 bundle 已取消：内核工具进程内运行，无 `build:mcp-server` / `build:mcp-role-server` 步骤。

`pnpm run dev` 时 electron-vite 以 Vite HMR 模式运行，渲染进程和主进程均支持热重载，无需手动重启。

---

## 7. 会话初始化流程

```
1. 用户点击模块 → 主区域显示节点详情
2. 发送消息 → agent:send（agent 未启动时先 agent:start）
3. core.modules.startAgent(moduleName)
   ├─ resolveAgentConfig（模块级 agents.modules 覆盖 > agents.default）
   ├─ PromptBuilder 构建系统提示（根模块 mainagentprompt.md / 子模块 subagentprompt.md）
   └─ Agent.start({ systemPrompt, sandbox, truncation, compaction, ... })
        └─ KernelFactory.create()（cwd.replace(/\\/g,'/')）→ AgentKernel → AgentLoop
4. core.modules.sendMessage(text, moduleName)
   ├─ 首条消息：progressiveDisclosure 开启时仅注入 Tier-1 模块摘要
   │   （完整文档由 agent 经 module_context_read_* 工具按需获取）
   ├─ SendGuard 互斥 → Agent.send 队列
   ├─ 流式快照推送 agent:stream + SessionStore 持久化
   └─ PostSendHook → ExperienceSummarizer（超过阈值时总结对话经验）
```

---

## 8. 角色 Agent

### 8.1 概述

角色 Agent 是一种特殊的 Agent，拥有特定职责和对特定模块路径的可见性。角色 Agent 以项目根为 cwd 运行，通过 `AgentSandbox` 将可见范围限制在 `visibleModulePaths`（不再复制工作区），主要用途是文档管理和跨模块分析。角色级 `provider` / `apiKey` / `baseUrl` / `model` / `fastModel` / `contextWindow` 端到端生效。

### 8.2 与模块 Agent 的区别

| 特性 | 模块 Agent | 角色 Agent |
|------|-----------|-----------|
| 工作目录 | 模块源码目录（根模块为 `.module-agent/module/`） | 项目根（`projectPath`） |
| 可见范围 | 本模块沙箱 | Sandbox allowed = visibleModulePaths（空则整个项目根） |
| 系统提示 | mainagentprompt.md / subagentprompt.md | roleagentprompt.md |
| 生命周期管理 | ModuleAgentSubsystem | RoleAgentSubsystem / RoleAgentManager |
| 上下文 key | `<moduleName>` | `workrole:<roleName>` |

### 8.3 配置格式

`.module-agent.json` 中的 `roles` 字段：

```json
{
  "roles": [
    {
      "name": "architect",
      "description": "架构审查 Agent",
      "visibleModulePaths": ["src/core", "src/agents"],
      "agents": {
        "default": {
          "provider": "anthropic",
          "model": "claude-sonnet-4-20250514",
          "apiKey": "sk-..."
        }
      }
    }
  ]
}
```

`agents.default` 支持 `provider` / `apiKey` / `baseUrl` / `model` / `fastModel` / `contextWindow`；`command` / `args` 为 ACP 时代兼容保留（可选），内核模式忽略。

### 8.4 启动流程

```
RoleAgentManager.startRoleAgent(role)
  → resolveRoleConfig（透传角色级 provider/apiKey/baseUrl/model/fastModel/contextWindow）
  → AgentSandbox({ allowed: visibleModulePaths.map(resolve) })（空则 [projectPath]）
  → Agent.start({ name: `workrole:<name>`, cwd: projectPath, systemPrompt: roleagentprompt.md,
                  truncation, compaction, sandbox, ... })
  → 失败重试一次（指数退避）
```

### 8.5 角色 Agent IPC 流

```
Renderer                              Main Process
  ├─ role:save ──────────────────────→ 写入 .module-agent.json roles 数组
  ├─ role:delete ────────────────────→ 删除角色
  ├─ role:start ─────────────────────→ core.roles.startRole(roleName)
  ├─ role:send ──────────────────────→ core.roles.sendMessage(roleName, text)
  ├─ role:cancel ────────────────────→ 取消在途请求（agent 可复用）
  ├─ role:stop ─────────────────────→ core.roles.stopRole(roleName)
  ├─ role:getContext ────────────────→ SessionStore.loadContext("workrole:<name>")
  ├─ role:clearContext ──────────────→ 清持久化 + 运行中 agent 内存历史 + sessionPrompted
  ← role:stream ────────────────────── 流式更新推送
  ← role:status ────────────────────── 状态变化推送
```

---

## 9. 已知问题与注意事项

### 构建与工具链
- **electron-vite**: 渲染进程（Vue 3）用 Vite 打包，主进程和 preload 用 esbuild。三者在 `electron.vite.config.ts` 统一配置。
- **模块别名**: 渲染进程中 `@` → `src/renderer/src/`，主进程中 `@` → `src/`。两者在 `electron.vite.config.ts` 中分别配置。
- **多 tsconfig**: `tsconfig.json`（根，含所有路径引用）、`tsconfig.node.json`（主进程/preload）、`tsconfig.web.json`（渲染进程）。
- **Vite HMR**: `pnpm run dev` 时渲染进程 HMR 自动替换 Vue 组件，主进程和 preload 的改动用 electron-vite 的 watch 模式重建并重载窗口。
- **CSP 未配置**: 当前没有设置任何 Content Security Policy（既无 `onHeadersReceived` 也无 HTML `<meta>`）。渲染层只加载本地内容（dev 模式 Vite HMR 用 `ws://` + inline scripts）。如要添加，在主进程 `session.defaultSession.webRequest.onHeadersReceived()` 设置，并记得放行 dev 模式的 `ws://` 与 inline scripts。
- **日志**: 主进程日志目录为 `app.getPath('userData')/logs`；退出流程 `await bridge.cleanup()` → `defaultLogger.close()` → `app.quit()`。

### 路径处理
- Windows 路径必须转为正斜杠 `/`，否则内核/工具解析失败；`KernelFactory.create()` 入口处自动 `cwd.replace(/\\/g, '/')`
- **WSL/Linux 上的 Windows 绝对路径**: `path.resolve('E:\\foo\\bar')` 在 Linux 上不识别盘符，会将整个路径当作相对路径并拼到 cwd。使用 `normalizeCodeSourcePath()` 将 `E:\foo\bar` 转换为 `/mnt/e/foo/bar`（仅在 `process.platform !== 'win32'` 时转换）。
- 模块标识语义：模块名 = 相对 `.module-agent/module/` 根的路径，分隔符恒为 `/`（Windows 已规范化）；仅根模块用 frontmatter name。

### 内核模式注意
- **配置管道 gap**：新增 AgentLoop 特性必须贯通全链 `schema.ts → defaults.ts → ModuleAgentSubsystem.resolveAgentConfig/_startAgentInternal → Agent.start → KernelFactory.create → AgentKernel → AgentLoopConfig`，缺一环则功能静默失效。
- **系统提示注入**：经 `Agent.start({ systemPrompt })` 独立 system 消息注入（`sessionPrompted` 集合追踪），不要再拼进首条 user 消息。
- **env 解析**：`KernelFactory.resolveConnectionConfig` 按 ANTHROPIC→OPENAI→GOOGLE→DEEPSEEK→DASHSCOPE 顺序回落 env key 并推断 provider（DASHSCOPE→custom + dashscope 兼容端点）；`baseUrl` 默认值仅 anthropic 场景。

### 跨模块通信
- 模块图序列化时 `Map` 会变成普通对象，反序列化后需手动 `new Map(Object.entries(...))`（`writeMcpGraphFile` 用 `Object.fromEntries`）
- `routeCall` 永不直接 `kernel.send`（会重入 AgentLoop.messages），必须经 `Agent.send` 队列

### 流式输出
- 内核 reasoning 内容映射为 `thought`（TUI 折叠显示 / renderer thinking 区），文本回复为 `message`
- 取消通过 `agent.cancel()`：abort 在途调用并以 Canceled reject 排队项，**不销毁 agent**

### 上下文持久化
- 对话历史由 Core 层 `SessionStore` 持久化到 `.module-agent/context/`（每模块上限 200 条 / 5MB）
- 角色 Agent 上下文以 `workrole:<roleName>` 为 key，与模块 Agent 上下文分离
- 跨模块通信上下文经 `appendCrossContext` 独立落盘（只含请求+回复两条），不混入目标模块用户流

### 角色 Agent
- 角色 Agent 与模块 Agent 均为进程内内核，共享 Agent/KernelFactory，沙箱可见范围不同
- 角色 Agent 的 stream/status 事件通过 `role:stream` / `role:status` IPC 通道推送，与模块 Agent 的 `agent:stream` / `agent:status` 分离
- IPC 传输数据前需确保是纯对象（Vue reactive proxy 不能被结构化克隆）

---

## 10. 待完成

- [ ] Mac/Linux 平台测试
- [ ] L3 其余 Vue 组件测试、L4 E2E 扩充（当前仅 1 条 smoke）
- [x] 生产构建基础配置（electron-builder.yml + `pnpm run dist`）
- [x] AgentManager/AgentRouter 与 Electron 路径整合（已由 ModuleAgentCore + 进程内内核统一双路径）
- [x] typecheck 全绿（317→0）、vitest 158 用例全过

---

## 11. 模块文档索引

每个系统模块均有独立文档说明，详见 [ARCHITECTURE.md §15](./ARCHITECTURE.md#15-文档索引)。快速导航：

| 文档 | 说明 |
|------|------|
| [MODULE_AGENT_SUBSYSTEM.md](./MODULE_AGENT_SUBSYSTEM.md) | 模块 Agent 子系统 — 配置加载、Agent 启动、消息发送、跨模块通信 |
| [ROLE_AGENT_SUBSYSTEM.md](./ROLE_AGENT_SUBSYSTEM.md) | 角色 Agent 子系统 — 持续性角色 Agent 生命周期 |
| [WORKFLOW_SUBSYSTEM.md](./WORKFLOW_SUBSYSTEM.md) | 工作流子系统 — 多步骤工作流编排与执行 |
| [MODULE_SYSTEM.md](./MODULE_SYSTEM.md) | 模块系统 — Scanner / Parser / Graph / Generator |
| [CONFIG_SYSTEM.md](./CONFIG_SYSTEM.md) | 配置系统 — ConfigPaths / ConfigLoader / Schema / Defaults |
| [AGENT_LAUNCHER.md](./AGENT_LAUNCHER.md) | Agent 启动器 + 状态管理器 |
| [PROMPT_BUILDER.md](./PROMPT_BUILDER.md) | 提示构建器 + MCP 配置构建器 |
| [MCP_BACKEND.md](./MCP_BACKEND.md) | MCP HTTP 后端 + 通信总线 |
| [MCP_SERVER.md](./MCP_SERVER.md) | MCP 服务端（模块 + 角色） |
| [WORKSPACE_ISOLATOR.md](./WORKSPACE_ISOLATOR.md) | 工作空间隔离 |
| [ELECTRON_BRIDGE.md](./ELECTRON_BRIDGE.md) | Electron IPC 桥接层 |
| [TUI_BRIDGE.md](./TUI_BRIDGE.md) | TUI SolidJS 桥接层 |
| [CLI.md](./CLI.md) | CLI 命令系统 |
