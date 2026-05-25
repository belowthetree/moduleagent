# ModuleAgent 架构分析

> 最后更新: 2026-05

## 1. 系统概述

ModuleAgent 是一个**模块化 Agent 编排框架**，以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的 Agent 子进程。通过 **ACP 协议**（`@agentclientprotocol/sdk`）通信，通过 **MCP 协议**（`@modelcontextprotocol/sdk`）提供跨模块通信能力。

### 核心能力

- **模块化扫描**：递归扫描 `module.md` 构建模块依赖树
- **独立 Agent 编排**：每个模块对应一个独立的 Agent 子进程
- **跨模块协作**：Agent 之间通过 MCP 工具互相调用/查询
- **角色 Agent**：跨模块的职责化 Agent（文档、架构审查等）
- **工作空间隔离**：为每个 Agent 创建隔离的源码副本

---

## 2. 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 桌面壳 | Tauri 2 (Rust) | 窗口管理、原生 API、Sidecar 进程启动 |
| 后端 | Node.js + TypeScript (Sidecar) | HTTP/SSE 服务器、Agent 编排 |
| 前端 | Vue 3 + Element Plus + Pinia | SFC 组件 + 状态管理 + UI 库 |
| 构建 | Vite (前端) + esbuild (Sidecar) | Vite 构建 Vue 前端，esbuild 构建后端 bundle |
| ACP 协议 | `@agentclientprotocol/sdk` v0.20 | Zed Industries 官方 SDK |
| MCP 协议 | `@modelcontextprotocol/sdk` | 官方 MCP SDK |
| 模块解析 | gray-matter + marked | 解析 module.md |
| 校验 | zod | 运行时类型校验 |
| Agent | opencode / claude | 外部 ACP 兼容 Agent 应用 |

---

## 3. 架构分层

```
┌──────────────────────────────────────────────────────────────────┐
│                       Tauri Desktop Shell (Rust)                  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                     WebView (Vue 3)                        │   │
│  │                                                           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │  SetupView   │  │  MainView    │  │ SettingsDialog │  │   │
│  │  │  (项目配置)   │  │  (工作台)     │  │  (设置对话框)   │  │   │
│  │  └──────────────┘  └──────┬───────┘  └────────────────┘  │   │
│  │                           │                               │   │
│  │  ┌────────────────────────┴───────────────────────────┐   │   │
│  │  │                Pinia Stores                        │   │   │
│  │  │  configStore  │  projectStore  │  agentStore       │   │   │
│  │  └────────────────────────┬───────────────────────────┘   │   │
│  │                           │                                │   │
│  │  ┌────────────────────────┴───────────────────────────┐   │   │
│  │  │           HTTP API Client (fetch + SSE)             │   │   │
│  │  │   POST /api/project/scan  ·  POST /api/agent/send   │   │   │
│  │  │   GET  /api/stream (SSE)  ·  POST /api/config/save  │   │   │
│  │  └────────────────────────┬───────────────────────────┘   │   │
│  └───────────────────────────┼───────────────────────────────┘   │
│                              │ HTTP + SSE (127.0.0.1:随机端口)    │
│  ┌───────────────────────────┼───────────────────────────────┐   │
│  │              Node.js Sidecar (src-backend/)               │   │
│  │                                                           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │   HTTP/SSE   │  │  ModuleAgent │  │ AgentState-    │  │   │
│  │  │   Server     │  │  Core        │  │ Manager        │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └────────────────┘  │   │
│  │         │                 │                               │   │
│  │  ┌──────┴─────────────────┴──────────────────────────┐   │   │
│  │  │              Agent Orchestration                   │   │   │
│  │  │  AgentLauncher · McpBackend · RoleAgentManager     │   │   │
│  │  │  PromptBuilder · WorkspaceIsolator                 │   │   │
│  │  └────────────────────────┬──────────────────────────┘   │   │
│  └───────────────────────────┼───────────────────────────────┘   │
└──────────────────────────────┼───────────────────────────────────┘
                               │ ACP (stdio)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Agent 子进程层 (ACP 协议)                      │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  Agent A     │  │  Agent B     │  │  Agent C     │            │
│  │  (模块 A)    │  │  (模块 B)    │  │  (模块 C)    │            │
│  │  opencode    │  │  opencode    │  │  opencode    │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │ MCP stdio       │ MCP stdio       │ MCP stdio          │
│  ┌──────┴─────────────────┴─────────────────┴──────────────┐    │
│  │              MCP Server 子进程                            │    │
│  │  (dist-backend/mcp-server.cjs)                          │    │
│  │  工具: module_list, module_call, module_query,           │    │
│  │        create_module                                     │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐                               │
│  │ 角色 Agent X │  │ 角色 Agent Y │  ← opencode/claude            │
│  │ (role MCP)   │  │ (role MCP)   │                               │
│  └──────────────┘  └──────────────┘                               │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 进程模型

```
┌──────────────────────────┐      HTTP/SSE      ┌──────────────────┐
│    Tauri Main Process    │◄───────────────────►│  Vue 3 WebView   │
│    (Rust)                │                     │  (前端 UI)       │
│                          │                     │                  │
│  ┌────────────────────┐  │                     │  fetch() + SSE   │
│  │ Sidecar Launcher   │──┼── spawn ────────────┼──► Node.js       │
│  │  start_sidecar()   │  │                     │    Sidecar       │
│  └────────────────────┘  │                     │                  │
│                          │                     │ 127.0.0.1:port   │
│  ┌────────────────────┐  │                     └──────────────────┘
│  │ Tauri Plugins      │  │
│  │  dialog / shell/fs │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

**进程间通信矩阵**：

| 源 → 目标 | 协议/机制 | 数据格式 |
|-----------|-----------|----------|
| WebView → Sidecar | HTTP POST (fetch) | JSON |
| Sidecar → WebView | SSE (text/event-stream) | JSON 事件 |
| Sidecar → Agent | ACP (ClientSideConnection via stdio) | JSON-RPC |
| Agent → Sidecar | ACP (sessionUpdate 等) | JSON-RPC |
| Agent → MCP Server | MCP Stdio | JSON-RPC (MCP) |
| MCP Server → Sidecar | HTTP POST (`127.0.0.1:port`) | JSON |

### 3.2 与旧 Electron 架构的关键差异

| 方面 | Electron（旧） | Tauri + Sidecar（新） |
|------|---------------|----------------------|
| 桌面壳 | Electron (Chromium + Node) | Tauri (Rust + WebView2/WKWebView) |
| 进程间通信 | Electron IPC (`ipcMain.handle`/`ipcRenderer.invoke`) | HTTP + SSE (`fetch`/`EventSource`) |
| 后端 | Electron 主进程内联 | 独立 Node.js Sidecar 子进程 |
| 前端构建 | electron-vite (三进程构建) | Vite (单前端构建) |
| 预加载脚本 | contextBridge (`preload/index.ts`) | 无（直接 HTTP 调用） |
| 流式推送 | IPC `webContents.send` | SSE `/api/stream` |
| 原生 API | Electron `dialog` / `shell` | Tauri 插件 (`dialog`/`shell`/`fs`) |
| 打包 | electron-builder | Tauri bundler (内置) |

---

## 4. Sidecar 架构

### 4.1 概述

Node.js Sidecar (`src-backend/server.ts`) 是系统的核心后端，替代了旧 Electron 架构中的主进程。它是一个**独立的 HTTP + SSE 服务器**，由 Tauri 在应用启动时作为子进程启动。

### 4.2 启动流程

```
Tauri App 启动
  │
  ├─ app.setup()
  │    ├─ start_sidecar(app)         # Rust 代码
  │    │    ├─ 查找 dist-backend/server.cjs
  │    │    ├─ spawn("node", ["dist-backend/server.cjs"])
  │    │    ├─ 读取 stdout 的 "READY:<port>" 行
  │    │    └─ 返回 port
  │    │
  │    └─ app.manage(Mutex<SidecarState>)
  │         └─ 保存 port 到 Tauri 状态
  │
  ├─ WebView 加载 Vue 前端
  │    ├─ Vue app 启动
  │    ├─ useApi() 调用 get_sidecar_port() (Tauri command)
  │    ├─ 连接 SSE /api/stream
  │    └─ 通过 HTTP 调用后端 API
  │
  └─ 就绪
```

### 4.3 API 路由

Sidecar 服务器提供以下 HTTP API 端点：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/stream` | GET | SSE 流式事件推送 |
| `/api/project/scan` | POST | 扫描项目模块 |
| `/api/project/tree` | GET | 获取模块树 |
| `/api/project/generate` | POST | 自动生成模块 |
| `/api/agent/start` | POST | 启动模块 Agent |
| `/api/agent/send` | POST | 发送消息给模块 Agent |
| `/api/agent/cancel` | POST | 取消当前请求 |
| `/api/agent/stop` | POST | 停止模块 Agent |
| `/api/agent/running` | GET | 获取所有运行中的 Agent |
| `/api/config/get` | GET | 读取配置 |
| `/api/config/save` | POST | 保存配置 |
| `/api/context/:name` | GET/DELETE | 读写对话上下文 |
| `/api/roles` | GET/POST | 角色列表/保存 |
| `/api/roles/:name` | DELETE | 删除角色 |
| `/api/roles/:name/start` | POST | 启动角色 Agent |
| `/api/roles/:name/send` | POST | 发送消息给角色 Agent |
| `/api/knowledge` | GET/POST/DELETE | 知识管理 |
| `/api/workflows` | GET/POST | 工作流管理 |
| `/api/workflows/:name/execute` | POST | 执行工作流 |

### 4.4 SSE 事件

| 事件 | 负载 | 触发时机 |
|------|------|----------|
| `agent-stream` | `{moduleName, update, reply?, thinking?, tools?}` | Agent 流式输出 |
| `agent-status` | `{name, status}` | Agent 状态变化 |
| `cross-context` | `{moduleName, crossModule, direction, phase}` | 跨模块通信 |

---

## 5. 模块系统

### 5.1 模块定义 (`module.md`)

每个模块由一个 `module.md` 文件定义，使用 YAML frontmatter + Markdown body：

```markdown
---
name: core
description: 核心模块
submodules:
  - name: utils
    path: ./utils
    description: 工具模块
---

# core

## 模块说明
...
```

### 5.2 扫描流程

```
用户项目根目录
  └── .module-agent/
       ├── module/                    # 所有 module.md 存放于此
       │   ├── module.md              # 根模块
       │   ├── src/
       │   │   ├── module.md
       │   │   ├── core/
       │   │   │   └── module.md
       │   │   └── utils/
       │   │       └── module.md
       │   └── config/
       │       └── module.md
       ├── workspace/                 # 隔离工作空间
       │   ├── src/core/              # 模块 A 的源码副本
       │   ├── src/utils/             # 模块 B 的源码副本
       │   └── workrole/              # 角色 Agent 工作空间
       │       └── architect/
       └── context/                   # 对话上下文存储
```

**扫描步骤**：

1. `ModuleScanner.scan()` 递归遍历 `.module-agent/module/`
2. 在每个目录中查找 `module.md`，用 `ModuleParser.parseFile()` 解析
3. `ModuleParser` 用 `gray-matter` 解析 frontmatter，`marked` 解析 body
4. `ModuleGraph.build()` 使用 `submodules` 字段构建树形结构（邻接表）
5. 冲突处理：同名模块按 `relativePath` 重命名（`name` → `relativePath`）

### 5.3 模块图的树结构

```
ModuleGraph {
  root: "my-project",
  nodes: Map<string, {
    name: "my-project",
    relativePath: ".",
    parent: null,
    children: ["src", "config"],
    definition: { frontmatter, body, ... }
  }>
}
```

**访问控制规则**（`CommunicationBus.getAccessibleModules`）：
- 根模块可访问所有模块
- 普通模块可访问：自身 + 子模块 + 父模块
- 这一约束在 `module_call` 和 `module_query` 时强制执行

---

## 6. 通信协议

### 6.1 ACP 协议（Agent Communication Protocol）

使用 `@agentclientprotocol/sdk` v0.20，通过 **ClientSideConnection** 实现 Sidecar 与 Agent 子进程的双向通信。

**连接建立流程**（`connection.ts`）：

```
1. spawn(agentCmd, agentArgs)
2. Readable.toWeb(stdout)
3. Writable.toWeb(stdin)
4. ndJsonStream(writable, readable)
5. new ClientSideConnection(clientFactory, stream)
6. connection.initialize({...})
```

**Client 接口**（处理 Agent 发起的请求）：

| 方法 | 用途 |
|------|------|
| `requestPermission` | 自动允许所有权限请求 |
| `sessionUpdate` | 接收流式更新（思考/回复/工具调用） |
| `readTextFile` | 读取工作空间文件（`FsHandler`） |
| `writeTextFile` | 写入工作空间文件（`FsHandler`） |
| `createTerminal` | 创建终端子进程（`TerminalHandler`） |
| `terminalOutput` | 获取终端输出 |
| `waitForTerminalExit` | 等待终端退出 |
| `killTerminal` | 杀死终端进程 |
| `releaseTerminal` | 释放终端连接 |

### 6.2 MCP 协议（Model Context Protocol）

用于 **Agent 之间的跨模块通信**，采用独立子进程部署 MCP Server。

**架构模式**：

```
Agent A (子进程)
  │
  │ MCP Stdio 协议 (node dist-backend/mcp-server.cjs --graph-file ... --backend-url ...)
  │
  ▼
MCP Server 子进程 (dist-backend/mcp-server.cjs)
  │
  │ module_call → HTTP POST http://127.0.0.1:{port}
  │
  ▼
McpBackendServer (Sidecar 内嵌 HTTP 服务器)
  │
  │ → getAgentEntry(targetModule) → 找到目标 Agent 连接
  │ → 向目标 Agent 发送 prompt
  │ → 收集流式响应
  │ → 返回结果给 MCP Server
  │
  ▼
Agent B (目标模块子进程)
```

**MCP 工具**：

| 工具 | 功能 | 路由方式 |
|------|------|----------|
| `module_list` | 列出可访问模块 | 直接读取 graph 文件 |
| `module_call` | 向目标模块发任务 | HTTP → McpBackend → 目标 Agent |
| `module_query` | 查询目标模块 | HTTP → McpBackend → 目标 Agent |
| `create_module` | 新建模块 | 直接调用 ModuleGenerator |

### 6.3 角色 Agent MCP

角色 Agent 使用独立的 MCP Server (`dist-backend/mcp-role-server.cjs`)，提供不同的工具集：

| 工具 | 功能 |
|------|------|
| `workrole_read_file` | 读取工作空间文件（安全路径检查） |
| `workrole_write_file` | 写入工作空间文件（安全路径检查） |

角色 Agent **没有**模块间通信工具（不可调用 `module_call` 等）。

---

## 7. Agent 生命周期

### 7.1 模块 Agent 生命周期

```
startAgent(moduleName)
  │
  ├─ 1. _resolveConfig()
  │       → ConfigLoader.load(.module-agent.json)
  │       → 模块特定配置 > 默认配置
  │
  ├─ 2. graph.nodes.get(moduleName)
  │       → 获取模块节点信息
  │
  ├─ 3. _resolveCwd()
  │       → prepareModuleWorkspace() 复制源码到隔离目录
  │       → 返回隔离工作空间路径
  │
  ├─ 4. getSubModuleDirs()
  │       → 获取子模块工作空间路径（用于 FsHandler 路由）
  │
  ├─ 5. launcher.launch()
  │       → spawn Agent 子进程
  │       → ClientSideConnection.initialize()
  │       → 返回 LaunchedAgent
  │
  ├─ 6. Wire onSessionUpdate callback
  │       → 流式内容通过 SSE 转发到前端
  │
  ├─ 7. buildMcpServers()
  │       → 构建 MCP Server 子进程配置
  │
  ├─ 8. connection.newSession({ cwd, mcpServers })
  │       → Agent 连接 MCP Server
  │       → 返回 sessionId
  │
  ├─ 9. sessionPrompted.delete(moduleName)
  │       → 下次发送消息时注入系统提示
  │
  └─ 10. Store AgentEntry { name, config, launched, sessionId }
```

### 7.2 消息发送流程

```
sendMessage(moduleName, text)
  │
  ├─ 1. sendLock mutex (per-module 串行化)
  ├─ 2. Auto-start Agent 如果未运行
  ├─ 3. buildPromptBlocks()
  │      ├─ 首次消息: 系统提示 + 模块上下文 + 用户消息
  │      └─ 后续消息: 仅用户消息
  ├─ 4. stateManager.startStream() 初始化流累加器
  ├─ 5. connection.prompt() → Agent 开始推理
  ├─ 6. Agent 回复通过 onSessionUpdate → sendSSE() → 前端
  ├─ 7. 处理跨模块通信
  ├─ 8. stateManager.finishStream() 完成累加
  ├─ 9. saveContext() 持久化对话
  └─10. HTTP 200 { reply, thinking, tools, stopReason }
```

### 7.3 流式输出通道

```
Agent 子进程
  │ sessionUpdate 通知 (ACP)
  ▼
ClientSideConnection → Client.sessionUpdate()
  │
  ▼
launched.onSessionUpdate(name, sessionId, notification)
  │
  ▼
sendSSE('agent-stream', { moduleName, update, reply, thinking, tools })
  │
  ▼
前端 Vue: EventSource → api.onAgentStream()
  │
  ▼
agentStore (Pinia) 更新状态
  │ SVGTree.vue / NodeDetailPanel.vue 响应式更新
```

---

## 8. 关键设计模式

### 8.1 累加器模式（AgentStateManager）

流式响应使用 `StreamAccumulator` 累加：

```typescript
StreamAccumulator {
  reply: string;      // agent_message_chunk 累加
  thinking: string;   // agent_thought_chunk 累加
  tools: string;      // tool_call 累加
  timeline: TimelineEvent[];
  finished?: boolean;
}
```

### 8.2 发送锁（Send Lock）

每个模块/角色 Agent 的发送操作使用 `Promise` 串行化：

```typescript
const prevLock = sendLock.get(moduleName);
if (prevLock) await prevLock;

const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
sendLock.set(moduleName, lockPromise);
try { ... } finally { resolveLock(); sendLock.delete(moduleName); }
```

### 8.3 首次消息注入

通过 `sessionPrompted` Set 跟踪：

```typescript
if (!sessionPrompted.has(moduleName)) {
  sessionPrompted.add(moduleName);
  blocks.push(系统提示);
  blocks.push(模块上下文);
}
blocks.push(用户消息);
```

---

## 9. 数据流全景

### 9.1 应用启动时序

```
Tauri App 启动 → WebView 加载 Vue 前端
  │
  ├─ Vue: onMounted()
  │    ├─ useApi() 获取 sidecar 端口
  │    ├─ 连接 SSE /api/stream
  │    ├─ POST /api/project/scan → 扫描模块
  │    │    ├─ ModuleScanner.scan()
  │    │    ├─ ModuleGraph.build()
  │    │    └─ McpBackendServer.start() → 随机端口
  │    ├─ 监听 SSE agent-stream/agent-status
  │    └─ 就绪
```

### 9.2 用户发送消息时序

```
用户输入 → ChatInput.vue @send
  │
  ├─ agentStore.sendMessage(moduleName, text)
  │    ├─ 立即 push 用户消息到 contextMap
  │    ├─ POST /api/agent/send { moduleName, text }
  │    │    └─ Sidecar:
  │    │         ├─ sendLock mutex
  │    │         ├─ startAgent() (if needed)
  │    │         ├─ buildPromptBlocks()
  │    │         ├─ stateManager.startStream()
  │    │         ├─ connection.prompt()
  │    │         │    └─ Agent 推理 → sessionUpdate → SSE
  │    │         ├─ stateManager.finishStream()
  │    │         └─ return { reply, thinking, tools }
  │    └─ push agent 消息到 contextMap
  │
  └─ NodeDetailPanel.vue 响应式更新对话
```

---

## 10. 前端架构 (Vue 3)

### 10.1 组件树

```
App.vue
  └─ <router-view>
       ├─ SetupView.vue          — 首次使用的项目配置页
       └─ MainView.vue           — 主工作台
            ├─ LeftSidebar.vue   — 左侧 48px 页签栏
            ├─ DrawerPanel.vue   — 左侧抽屉（树/角色）
            │   ├─ SVGTree.vue   — 交互式 SVG 模块树
            │   └─ RolePanel.vue — 角色 Agent 卡片列表
            ├─ NodeDetailPanel.vue — 模块详情 + 对话面板
            ├─ ContextCards.vue  — 对话历史
            ├─ ChatInput.vue     — 消息输入
            ├─ SettingsDialog.vue — 设置对话框
            └─ RoleConfigDialog.vue — 角色配置
```

### 10.2 API 层 (`useApi.ts`)

前端通过 `useApi` composable 封装所有 HTTP 和 SSE 通信：

```typescript
// 获取 sidecar 端口
const port = await invoke('get_sidecar_port');

// HTTP API
const api = {
  scanProject: (root: string) => POST(`http://127.0.0.1:${port}/api/project/scan`, { projectRoot }),
  sendMessage: (moduleName: string, text: string) => POST(`http://127.0.0.1:${port}/api/agent/send`, { moduleName, text }),
  // ...
};

// SSE 流式事件
const eventSource = new EventSource(`http://127.0.0.1:${port}/api/stream`);
eventSource.addEventListener('agent-stream', (e) => { ... });
eventSource.addEventListener('agent-status', (e) => { ... });
```

---

## 11. 构建架构

### 11.1 构建工具链

- **前端** (Vite): `src-renderer/` → `dist-renderer/` (Vue SFC + TypeScript)
- **Sidecar 后端** (esbuild): `src-backend/` → `dist-backend/` (自包含 CJS bundle)
- **MCP Server** (esbuild): `src-backend/protocol/mcp/server-entry.ts` → `dist-backend/mcp-server.cjs`
- **角色 MCP Server** (esbuild): `src-backend/protocol/mcp/role-server-entry.ts` → `dist-backend/mcp-role-server.cjs`
- **Tauri 桌面壳** (Cargo): `src-tauri/` → 原生可执行文件（内嵌前端产物和 Sidecar）

### 11.2 配置体系

```
.module-agent.json (用户项目根目录)
  │
  ├─ agents.default.command/args    → 默认 Agent 命令
  ├─ agents.modules                 → 模块特定 Agent 覆盖
  ├─ exclude                        → 扫描排除规则
  ├─ projectPath                    → 项目源码根目录
  └─ roles[]                        → 角色 Agent 配置

ConfigLoader 加载流程：
  .module-agent.json → Zod schema 校验 → getDefaultConfig() → ProjectConfig
```

---

## 12. 安全模型

| 层面 | 机制 |
|------|------|
| 文件系统隔离 | `FsHandler` 限制在 `cwd + subModuleDirs` 范围内 |
| 路径穿越防护 | `RoleMCPServer` 做路径前缀检查防止目录穿越 |
| 跨模块访问控制 | `CommunicationBus.checkAccess()` 限制模块间通信为父子关系 |
| CSP | Tauri 配置中的 CSP 策略 (`tauri.conf.json`) |
| Sidecar 绑定 | 只监听 `127.0.0.1`（localhost），不对外暴露 |
