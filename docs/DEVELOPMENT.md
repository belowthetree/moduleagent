# ModuleAgent — 开发文档

> 最后更新: 2026-05-05

## 1. 项目概述

**ModuleAgent** 是一个基于 Electron 的模块化 Agent 编排工具。以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的 Agent 子进程，通过 ACP 协议（`@agentclientprotocol/sdk`）通信，通过 MCP 协议（`@modelcontextprotocol/sdk`）提供跨模块通信能力。

### 实际技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 运行时 | Electron | GUI 桌面应用 |
| 语言 | TypeScript 5.7 | 强类型 |
| 构建 | electron-vite (Vue 3 renderer) + esbuild (MCP server/CLI) | electron-vite 整合渲染/主进程/预加载构建，esbuild 单独打包 MCP/CLI |
| UI | Vue 3 + Element Plus + Pinia | SFC 组件 + 状态管理 + UI 库 |
| ACP 协议 | `@agentclientprotocol/sdk` v0.20 | Zed Industries 官方 SDK |
| MCP 协议 | `@modelcontextprotocol/sdk` v1.29 | 官方 MCP SDK |
| 模块解析 | gray-matter + marked | 解析 module.md |
| 校验 | zod v3 | 运行时类型校验 |
| Agent | opencode / claude | 外部 Agent 应用 |

### 与旧文档的差异

项目方案和 DESIGN.md 描述的是 CLI + Ink 方案（Phase 1 设计），**实际实现是 Electron GUI 方案（Vue 3）**。CLI 路径（`src/cli/`）作为次级路径保留，仍在 `npm run build:cli` 时构建。

---

## 2. 目录结构

```
ModuleAgent/
├── src/
│   ├── main/
│   │   └── index.ts                 # Electron 主进程 — Agent IPC、MCP 后端、窗口管理
│   ├── preload/
│   │   └── index.ts                 # contextBridge API (d.ts 类型在 src/types/preload.ts)
│   ├── renderer/
│   │   ├── index.html               # Vite 入口 HTML
│   │   └── src/
│   │       ├── main.ts              # Vue 3 入口 — createApp + router + pinia
│   │       ├── App.vue              # 根组件
│   │       ├── router/
│   │       │   └── index.ts         # Vue Router（setup → main）
│   │       ├── views/
│   │       │   ├── SetupView.vue    # 设置页面（首次使用）
│   │       │   └── MainView.vue     # 主界面（模块树 + Agent 对话）
│   │       ├── components/
│   │       │   ├── SVGTree.vue      # 交互式 SVG 模块树
│   │       │   ├── DrawerPanel.vue  # 模块详情抽屉
│   │       │   ├── StreamArea.vue   # 流式 Agent 输出
│   │       │   ├── ContextCards.vue # 对话历史卡片
│   │       │   ├── ChatInput.vue    # 消息输入框
│   │       │   ├── SettingsDialog.vue # 设置对话框
│   │       │   ├── MessageModal.vue # 消息详情弹窗
│   │       │   └── ThemeToggle.vue  # 主题切换
│   │       ├── stores/
│   │       │   ├── agent.ts         # Pinia — Agent 状态、流式、对话上下文
│   │       │   ├── config.ts        # Pinia — 项目配置
│   │       │   └── project.ts       # Pinia — 模块树
│   │       ├── composables/
│   │       │   ├── useModuleAgent.ts # moduleAgent API 封装
│   │       │   └── useTheme.ts      # 主题管理
│   │       └── __mocks__/
│   │           └── moduleAgent.ts   # 测试 mock
│   ├── agents/
│   │   ├── AgentLauncher.ts         # 启动 Agent 子进程，建立 ClientSideConnection
│   │   ├── AgentManager.ts          # 管理 Agent 生命周期（CLI 路径使用）
│   │   ├── AgentRouter.ts           # 消息路由（CLI 路径使用）
│   │   ├── AgentOrchestrator.ts     # Electron 路径 Agent 编排
│   │   ├── McpBackend.ts            # MCP HTTP 后端
│   │   ├── McpServerBuilder.ts      # MCP Server 配置构建
│   │   ├── PromptBuilder.ts         # 系统提示 + 模块上下文构建
│   │   └── WorkspaceIsolator.ts     # 工作区隔离
│   ├── protocol/
│   │   ├── acp/
│   │   │   ├── connection.ts        # createAgentConnection — spawn + ndJsonStream
│   │   │   └── handlers/
│   │   │       ├── fs.ts            # FsHandler — 工作区限制的文件读写
│   │   │       └── terminal.ts      # TerminalHandler — 终端子进程管理
│   │   ├── mcp/
│   │   │   ├── MCPServer.ts         # MCP Server（暴露 3 个工具）
│   │   │   ├── CommunicationBus.ts  # 消息路由总线
│   │   │   └── server-entry.ts      # MCP Server 独立入口（由 Agent 子进程启动）
│   │   └── index.ts                 # 统一导出
│   ├── core/
│   │   ├── ModuleScanner.ts         # 递归扫描 module.md
│   │   ├── ModuleParser.ts          # 解析 frontmatter + markdown
│   │   ├── ModuleGraph.ts           # 构建模块树（邻接表）
│   │   ├── ModuleGenerator.ts       # 自动生成 module.md
│   │   ├── ExclusionRules.ts        # 内置排除规则
│   │   ├── Logger.ts                # 日志系统
│   │   └── PathUtils.ts             # 跨平台路径处理
│   ├── config/
│   │   ├── ConfigLoader.ts          # 加载 .module-agent.json
│   │   ├── defaults.ts              # 默认配置
│   │   └── schema.ts                # Zod schema
│   ├── cli/
│   │   └── index.ts                 # CLI 入口（`module-agent serve` / `tui`）
│   └── types/
│       ├── module.ts                # ModuleDefinition, ModuleGraphNode 等
│       └── preload.ts               # ChatMsg, TreeNode, AgentStreamData 等
├── out/                             # electron-vite 构建输出
│   ├── main/
│   │   └── index.cjs               # 主进程 CJS bundle
│   ├── preload/
│   │   └── index.cjs               # 预加载 CJS bundle
│   └── renderer/                   # 渲染进程 (Vite 产物)
├── dist/
│   ├── mcp-server.cjs               # MCP Server 打包产物（自包含）
│   └── cli.cjs                      # CLI 打包产物（自包含）
├── config/
│   ├── mainagentprompt.md           # 主 Agent 系统提示
│   └── subagentprompt.md            # 子 Agent 系统提示
├── electron.vite.config.ts          # electron-vite 配置（main + preload + renderer）
├── electron-builder.yml             # electron-builder 打包配置
├── vitest.config.ts                 # Vitest 测试配置
├── playwright.config.ts             # Playwright e2e 测试配置
├── test_acp.ts                      # ACP SDK 独立测试脚本
├── package.json
├── tsconfig.json
├── tsconfig.node.json               # 主进程/preload TS 配置
└── tsconfig.web.json                # 渲染进程 TS 配置
```

### 已删除/废弃的文件
- `src/protocol/acp/Transport.ts` — 替换为 SDK 的 `ndJsonStream`
- `src/protocol/acp/ACPClient.ts` — 替换为 SDK 的 `ClientSideConnection`
- `src/protocol/acp/ACPSession.ts` — 不再需要
- `src/protocol/acp/types.ts` — 替换为 SDK 的 schema 类型
- `electron/main.ts`, `electron/preload.ts`, `electron/renderer/` — 迁移到 `src/main/`、`src/preload/`、`src/renderer/`，旧目录保留构建产物
- `electron/renderer.ts` — 替换为 Vue 3 SFC 组件（`src/renderer/src/components/`）

---

## 3. 核心架构

### 3.1 Agent 通信 (ACP)

```
Electron Main Process
  └─ createAgentConnection()           # connection.ts
       ├─ spawn(agentCmd, agentArgs)    # 启动 Agent 子进程
       ├─ Readable.toWeb / Writable.toWeb  # stdio → Web Stream
       ├─ ndJsonStream(writable, readable) # 创建 Stream
       └─ ClientSideConnection(clientFactory, stream)  # SDK 连接

AgentLauncher.launch()                 # AgentLauncher.ts
  ├─ 构建 Client 实现（权限、文件系统、终端、流式更新）
  ├─ connection.initialize()
  └─ 返回 { connection, process, name, cwd, onSessionUpdate }
```

### 3.2 跨模块通信 (MCP)

```
Agent A (子进程)
  └─ 收到 mcpServers 配置 → spawn: node dist/mcp-server.cjs --graph-file xxx --backend-url xxx

MCP Server (独立子进程)
  ├─ 通过 stdio 与 Agent 通信（MCP 协议）
  ├─ module_list    → 从 graph 文件读取，直接返回
  └─ module_call    → HTTP POST → Electron 后端 → 路由到目标 Agent

Electron MCP 后端 (HTTP, 127.0.0.1:随机端口)
  ├─ 接收 module_call / module_query
  ├─ 自动启动目标 Agent（若未运行）
  ├─ 向目标 Agent 发送 prompt
  ├─ 收集流式响应
  └─ 返回结果给 MCP Server
```

### 3.3 流式输出流程

```
Agent 子进程 → session/update 通知
  └─ ClientSideConnection → Client.sessionUpdate()
       └─ launched.onSessionUpdate()
            └─ mainWindow.webContents.send('agent:stream', {...})
                 └─ renderer: onAgentStream()
                      ├─ agent_thought_chunk → appendThinking()（灰色斜体）
                      ├─ agent_message_chunk → appendStream()（正常文本）
                      └─ tool_call → appendToolCall()（橙色高亮）
```

---

## 4. 关键接口

### 4.1 ClientSideConnection (SDK)

```typescript
// 发送给 Agent
connection.initialize(params: InitializeRequest): Promise<InitializeResponse>
connection.newSession(params: NewSessionRequest): Promise<NewSessionResponse>
connection.prompt(params: PromptRequest): Promise<PromptResponse>
connection.cancel(params: CancelNotification): Promise<void>

// Client 接口（处理 Agent 发来的请求）
interface Client {
  requestPermission(params): Promise<RequestPermissionResponse>
  sessionUpdate(params): Promise<void>           // 流式更新
  readTextFile?(params): Promise<ReadTextFileResponse>
  writeTextFile?(params): Promise<WriteTextFileResponse>
  createTerminal?(params): Promise<CreateTerminalResponse>
  terminalOutput?(params): Promise<TerminalOutputResponse>
  waitForTerminalExit?(params): Promise<WaitForTerminalExitResponse>
  killTerminal?(params): Promise<KillTerminalResponse>
  releaseTerminal?(params): Promise<ReleaseTerminalResponse>
}
```

### 4.2 MCPServer 工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `module_list` | 无 | 列出所有模块及描述 |
| `module_call` | targetModule, task, context? | 向目标模块发任务 |
| `module_query` | targetModule, query | 查询目标模块 |

### 4.3 IPC 通道 (Electron)

| 通道 | 方向 | 说明 |
|------|------|------|
| `project:scan` | Renderer → Main | 扫描项目，返回模块树 |
| `project:getTree` | Renderer → Main | 获取当前模块树 |
| `agent:start` | Renderer → Main | 启动模块 Agent |
| `agent:send` | Renderer → Main | 发送消息 |
| `agent:cancel` | Renderer → Main | 取消当前请求 |
| `agent:stop` | Renderer → Main | 停止 Agent |
| `agent:isRunning` | Renderer → Main | 检查 Agent 状态 |
| `agent:stream` | Main → Renderer | 流式更新推送 |
| `dialog:selectDir` | Renderer → Main | 打开目录选择对话框 |

### 4.4 Preload API (window.moduleAgent)

```typescript
interface ModuleAgentApi {
  selectDir(title): Promise<string | null>
  scanProject(projectRoot, workspaceRoot): Promise<ScanResult>
  getTree(): Promise<TreeNode | null>
  startAgent(moduleName, cmd, args, cwd): Promise<{ sessionId?, error? }>
  sendMessage(moduleName, text): Promise<{ stopReason?, error? }>
  cancelAgent(moduleName): Promise<{}>
  stopAgent(moduleName): Promise<{}>
  isAgentRunning(moduleName): Promise<boolean>
  onAgentStream(callback): () => void
}
```

---

## 5. 渲染进程 UI 结构

```
SetupView.vue: 设置页面（首次使用）
  ├─ Element Plus 表单控件（agent 命令、参数、工作目录、模块目录、代码源）
  └─ 开始扫描按钮

MainView.vue: 主界面
  ├─ SVGTree.vue: 交互式 SVG 模块依赖图（缩放/拖拽/折叠）
  ├─ DrawerPanel.vue: 模块详情抽屉（Element Plus Drawer）
  │   ├─ 模块信息（路径、来源、子模块数）
  │   ├─ StreamArea.vue: 流式 Agent 输出
  │   │   ├─ 思考内容（灰色斜体，agent_thought_chunk）
  │   │   ├─ 工具调用（橙色高亮，tool_call）
  │   │   └─ 回复文本（正常文本，agent_message_chunk）
  │   ├─ 取消按钮（流式输出时显示）
  │   └─ 对话上下文区域
  │       ├─ ContextCards.vue: 历史消息卡片（分页）
  │       │   ├─ 思考标签（灰色）
  │       │   ├─ 工具标签（橙色）
  │       │   ├─ 跨模块消息标签（蓝色，'cross' 角色）
  │       │   └─ 回复预览
  │       └─ ChatInput.vue: 输入框 + 发送按钮
  ├─ SettingsDialog.vue: 设置对话框（Element Plus Dialog）
  ├─ MessageModal.vue: 消息详情弹窗（Element Plus Dialog）
  │   ├─ 思考过程 section
  │   ├─ 工具调用 section
  │   └─ 回复 section
  └─ ThemeToggle.vue: 暗色/亮色主题切换
```

### ChatMsg 数据结构

```typescript
interface ChatMsg {
  id: string
  role: 'user' | 'agent' | 'cross'   // 'cross' = 跨模块通信消息
  content: string        // 回复文本 (agent_message_chunk)
  thinking: string       // 思考文本 (agent_thought_chunk)
  tools: string          // 工具调用信息
  time: string
  status: 'sent' | 'pending' | 'thinking' | 'executing' | 'completed' | 'error' | 'interrupted'
  moduleName: string
  agentCmd: string
  crossDirection?: 'sent' | 'received'  // cross 消息方向
  crossModule?: string                  // 跨模块通信的目标模块
}
```

---

## 6. 构建与运行

```bash
# 安装依赖
npm install

# 开发模式（Vite HMR，渲染进程 + 主进程 + preload 热重载）
npm run dev

# 类型检查（无 emit）
npm run typecheck

# 单元/组件测试（Vitest）
npm run test

# E2E 测试（Playwright）
npm run test:e2e

# 生产构建（electron-vite + MCP server + CLI）
npm run build:electron

# 构建并启动 Electron 应用
npm run electron

# 打包为可分发格式
npm run dist

# 独立测试 ACP SDK 通信
npx tsx test_acp.ts [workspace_dir]
```

### 构建工具分工

**electron-vite** (`npm run build:electron` 的第一步):
- 主进程 (`src/main/`) → `out/main/index.cjs`（CJS，external: electron, fs-extra, gray-matter, marked, simple-git, zod, @agentclientprotocol/sdk）
- 预加载 (`src/preload/`) → `out/preload/index.cjs`（CJS，external: electron）
- 渲染进程 (`src/renderer/`) → `out/renderer/`（Vite 产物，含 Vue 3 SFC 编译）
- 配置在 `electron.vite.config.ts` 中统一管理

**esbuild** (后续步骤):
- `build:mcp-server` → `dist/mcp-server.cjs`（自包含 CJS，Agent 直接 `node dist/mcp-server.cjs` 启动）
- `build:cli` → `dist/cli.cjs`（自包含 CJS，external: @opentui/*）

`npm run dev` 时 electron-vite 以 Vite HMR 模式运行，渲染进程和主进程均支持热重载，无需手动重启。

---

## 7. 会话初始化流程

```
1. 用户点击模块 → openDrawer()
2. 发送消息 → sendContextMsg()
3. startAgent(moduleName, cmd, args, cwd)
   ├─ AgentLauncher.launch() → spawn + ClientSideConnection + initialize
   ├─ 设置 onSessionUpdate → 转发流式内容到渲染进程
   └─ newSession({ cwd, mcpServers })
        ├─ mcpServers = buildMcpServers()
        │   └─ [{ name, command: 'node', args: [serverPath, ...], env: [] }]
        └─ 返回 sessionId
4. sendMessage(moduleName, text) → connection.prompt()
   ├─ buildPromptBlocks() 构建提示块
   │   ├─ 首次消息: 系统提示 (mainagentprompt.md / subagentprompt.md)
   │   │              + 模块上下文 (module.md body)
   │   │              + 用户消息
   │   └─ 后续消息: 仅用户消息
   └─ 返回 stopReason → finishStream() → 保存到 ChatMsg
```

---

## 8. 已知问题与注意事项

### 构建与工具链
- **electron-vite**: 渲染进程（Vue 3）用 Vite 打包，主进程和 preload 用 esbuild。三者在 `electron.vite.config.ts` 统一配置。
- **模块别名**: 渲染进程中 `@` → `src/renderer/src/`，主进程中 `@` → `src/`。两者在 `electron.vite.config.ts` 中分别配置。
- **多 tsconfig**: `tsconfig.json`（根，含所有路径引用）、`tsconfig.node.json`（主进程/preload）、`tsconfig.web.json`（渲染进程）。
- **Vite HMR**: `npm run dev` 时渲染进程 HMR 自动替换 Vue 组件，主进程和 preload 的改动用 electron-vite 的 watch 模式重建并重载窗口。
- **CSP 管理**: Content Security Policy 在 `src/main/index.ts` 中通过 `session.defaultSession.webRequest.onHeadersReceived()` 设置，**不在 HTML `<meta>` 标签**。开发模式下必须允许 `ws://` 和 inline scripts 以支持 Vite HMR。
- **`app.getAppPath()`**: MCP Server 和 CLI bundle 路径在 `package.json` 的 `files` 数组中必须包含，`electron-builder` 打包时确保这些文件被打入 asar。

### 路径处理
- Windows 路径必须转为正斜杠 `/`，否则 Agent 解析失败
- `AgentLauncher.launch()` 入口处自动 `cwd.replace(/\\/g, '/')`
- `newSession()` 调用应使用 `launched.cwd` 而非原始 cwd
- **WSL/Linux 上的 Windows 绝对路径**: `path.resolve('E:\\foo\\bar')` 在 Linux 上不识别盘符，会将整个路径当作相对路径并拼到 cwd。使用 `normalizeCodeSourcePath()` 将 `E:\foo\bar` 转换为 `/mnt/e/foo/bar`（仅在 `process.platform !== 'win32'` 时转换）。

### SDK 类型陷阱
- `SessionUpdate.text` 不存在，正确路径是 `content.text`（`content` 是 `ContentBlock`）
- `McpServerStdio` 的 `name` 和 `env` 都是必填字段（Zod 验证）
- `env` 类型是 `Array<{name, value}>` 而非 `Record<string, string>`

### MCP Server
- 模块图序列化时 `Map` 会变成普通对象，反序列化后需手动 `new Map(Object.entries(...))`
- `startMcpBackend()` 是异步的（`server.listen`），必须 `await`
- MCP Server bundle 路径使用 `app.getAppPath()`，而非 `currentProjectRoot`（用户项目目录）

### 流式输出
- opencode 用 `agent_thought_chunk` 发思考内容，`agent_message_chunk` 发回复
- 两者结构相同：`{ content: { type: 'text', text: '...' } }`
- 取消按钮通过 `connection.cancel({ sessionId })` 发送 ACP 取消通知

### 上下文持久化
- 对话历史以 `ctx_<moduleName>` 键存入 localStorage
- `saveContext()` 在消息发送/回复完成后自动调用
- `loadContext()` 在抽屉打开时自动恢复

---

## 9. 待完成

- [ ] `module_call` 的 HTTP 后端需要处理超时和大响应
- [ ] AgentManager/AgentRouter 与 Electron 路径整合（目前两套并行代码，Electron 用 AgentOrchestrator，CLI 用 AgentManager/AgentRouter）
- [ ] 模块代码同步到工作区（WorkspaceIsolator 已实现 workspace 目录隔离，但模块源码自动同步待完善）
- [x] 生产构建基础配置（electron-builder.yml + `npm run dist`）
- [ ] Mac/Linux 平台测试
- [ ] 集成测试覆盖（Vitest 单元/组件测试 + Playwright e2e 框架已搭好，用例待扩充）
