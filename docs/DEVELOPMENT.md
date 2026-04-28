# ModuleAgent — 开发文档

> 最后更新: 2026-04-28

## 1. 项目概述

**ModuleAgent** 是一个基于 Electron 的模块化 Agent 编排工具。以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的 Agent 子进程，通过 ACP 协议（`@agentclientprotocol/sdk`）通信，通过 MCP 协议（`@modelcontextprotocol/sdk`）提供跨模块通信能力。

### 实际技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 运行时 | Electron | GUI 桌面应用 |
| 语言 | TypeScript 5.7 | 强类型 |
| 打包 | esbuild | 分别打包 renderer、main、preload |
| ACP 协议 | `@agentclientprotocol/sdk` v0.20 | Zed Industries 官方 SDK |
| MCP 协议 | `@modelcontextprotocol/sdk` v1.29 | 官方 MCP SDK |
| 模块解析 | gray-matter + marked | 解析 module.md |
| 校验 | zod v3 | 运行时类型校验 |
| Agent | opencode / claude | 外部 Agent 应用 |

### 与旧文档的差异

项目方案和 DESIGN.md 描述的是 CLI + Ink 方案（Phase 1 设计），**实际实现是 Electron GUI 方案**。CLI 相关代码已于早期迭代中移除，改为纯 GUI。

---

## 2. 目录结构

```
ModuleAgent/
├── electron/
│   ├── main.ts              # Electron 主进程 — Agent IPC、MCP 后端、窗口管理
│   ├── preload.ts           # contextBridge API
│   ├── renderer/
│   │   ├── index.html       # 主页面
│   │   ├── renderer.ts      # 渲染进程 — 模块树、对话、流式输出
│   │   └── style.css        # 全部样式
│   ├── main.cjs             # esbuild 构建产物
│   ├── preload.cjs
│   └── renderer.js
├── src/
│   ├── agents/
│   │   ├── AgentLauncher.ts # 启动 Agent 子进程，建立 ClientSideConnection
│   │   ├── AgentManager.ts  # 管理 Agent 生命周期（Electron 路径未使用）
│   │   └── AgentRouter.ts   # 消息路由（Electron 路径未使用）
│   ├── protocol/
│   │   ├── acp/
│   │   │   ├── connection.ts        # createAgentConnection — spawn + ndJsonStream
│   │   │   └── handlers/
│   │   │       ├── fs.ts            # FsHandler — 工作区限制的文件读写
│   │   │       └── terminal.ts      # TerminalHandler — 终端子进程管理
│   │   ├── mcp/
│   │   │   ├── MCPServer.ts         # MCP Server（暴露 4 个工具）
│   │   │   ├── CommunicationBus.ts  # 消息路由总线
│   │   │   └── server-entry.ts      # MCP Server 独立入口（由 Agent 子进程启动）
│   │   └── index.ts                 # 统一导出
│   ├── core/
│   │   ├── ModuleScanner.ts         # 递归扫描 module.md
│   │   ├── ModuleParser.ts          # 解析 frontmatter + markdown
│   │   ├── ModuleGraph.ts           # 构建模块树（邻接表）
│   │   ├── ModuleGenerator.ts       # 自动生成 module.md
│   │   ├── ExclusionRules.ts        # 内置排除规则
│   │   └── Logger.ts                # 日志系统
│   ├── config/
│   │   ├── ConfigLoader.ts          # 加载 .module-agent.json
│   │   ├── defaults.ts              # 默认配置
│   │   └── schema.ts                # Zod schema
│   └── types/
│       └── module.ts                # ModuleDefinition, ModuleGraphNode 等
├── dist/
│   └── mcp-server.cjs               # MCP Server 打包产物（563KB，自包含）
├── mainagentprompt.md               # 主 Agent 系统提示
├── subagentprompt.md                # 子 Agent 系统提示
├── test_acp.ts                      # ACP SDK 独立测试脚本
├── package.json
└── tsconfig.json
```

### 已删除的文件
- `src/protocol/acp/Transport.ts` — 替换为 SDK 的 `ndJsonStream`
- `src/protocol/acp/ACPClient.ts` — 替换为 SDK 的 `ClientSideConnection`
- `src/protocol/acp/ACPSession.ts` — 不再需要
- `src/protocol/acp/types.ts` — 替换为 SDK 的 schema 类型
- `src/cli/` — 整个 CLI 模块已移除

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
  ├─ file_access    → 通过 fs-extra 直接读写
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
| `file_access` | module, filePath, operation(read/write), content? | 跨模块文件操作 |

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
setup-screen: 设置页面（首次使用）
  ├─ agent-cmd-input    Agent 命令（默认 opencode）
  ├─ agent-args-input   参数（默认 acp）
  ├─ workspace-input    工作目录
  ├─ project-input      模块目录
  └─ btn-start          开始扫描

main-screen: 主界面
  ├─ tree-panel: SVG 模块树
  ├─ drawer: 模块详情抽屉
  │   ├─ 模块信息（路径、来源、子模块数）
  │   ├─ stream-area: 流式输出区域
  │   │   ├─ stream-thinking  灰色斜体（思考）
  │   │   ├─ stream-tool      橙色高亮（工具调用）
  │   │   └─ stream-content   正常文本（回复）
  │   ├─ btn-cancel-stream: 取消按钮（流式输出时显示）
  │   └─ ctx-bottom: 对话上下文
  │       ├─ ctx-cards: 历史消息卡片
  │       │   ├─ 思考标签（灰色）
  │       │   ├─ 工具标签（橙色）
  │       │   └─ 回复预览
  │       ├─ ctx-paginator: 分页
  │       └─ ctx-chat: 输入框 + 发送按钮
  └─ modal-overlay: 消息详情弹窗
      ├─ 思考过程 section
      ├─ 工具调用 section
      └─ 回复 section
```

### ChatMsg 数据结构

```typescript
interface ChatMsg {
  id: string
  role: 'user' | 'agent'
  content: string        // 回复文本 (agent_message_chunk)
  thinking: string       // 思考文本 (agent_thought_chunk)
  tools: string          // 工具调用信息
  time: string
  status: 'sent' | 'pending' | 'thinking' | 'executing' | 'completed' | 'error'
  moduleName: string
  agentCmd: string
}
```

---

## 6. 构建与运行

```bash
# 安装依赖
npm install

# 构建全部（renderer + main + preload + mcp-server）
npm run build:electron

# 启动
npm run electron

# 类型检查
npx tsc --noEmit

# 独立测试 ACP SDK 通信
npx tsx test_acp.ts [workspace_dir]

# 单独构建
npm run build:renderer      # renderer.js
npm run build:main          # main.cjs
npm run build:preload        # preload.cjs
npm run build:mcp-server    # dist/mcp-server.cjs
```

### esbuild 外部依赖

`build:main` 将以下包标记为 external（不在 bundle 中）：
`electron`, `fs-extra`, `gray-matter`, `marked`, `simple-git`, `zod`, `path`, `url`, `esbuild`, `@agentclientprotocol/sdk`

`build:mcp-server` 打包所有依赖为自包含 CJS 文件（563KB），Agent 直接用 `node dist/mcp-server.cjs` 启动。

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

### 路径处理
- Windows 路径必须转为正斜杠 `/`，否则 Agent 解析失败
- `AgentLauncher.launch()` 入口处自动 `cwd.replace(/\\/g, '/')`
- `newSession()` 调用应使用 `launched.cwd` 而非原始 cwd

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
- [ ] MCP Server 的 `file_access` 路径校验需要加强
- [ ] AgentManager/AgentRouter 与 Electron 路径整合（目前两套并行代码）
- [ ] 模块代码同步到工作区（WorkspaceManager 未实现）
- [ ] 生产构建（electron-builder 打包）
- [ ] Mac/Linux 平台测试
