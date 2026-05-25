# ModuleAgent — 开发文档

> 最后更新: 2026-05

## 1. 项目概述

**ModuleAgent** 是一个基于 **Tauri + Vue 3 + Node.js Sidecar** 的模块化 Agent 编排工具。以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的 Agent 子进程，通过 ACP 协议（`@agentclientprotocol/sdk`）通信，通过 MCP 协议（`@modelcontextprotocol/sdk`）提供跨模块通信能力。

### 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 桌面壳 | Tauri 2 (Rust) | 窗口管理、原生 API、Sidecar 进程启动 |
| 后端 | Node.js + TypeScript (Sidecar) | HTTP/SSE 服务器、Agent 编排 |
| 前端 | Vue 3 + Element Plus + Pinia | SFC 组件 + 状态管理 + UI 库 |
| 构建 | Vite (前端) + esbuild (Sidecar) + Cargo (Tauri) | 三项独立构建 |
| ACP 协议 | `@agentclientprotocol/sdk` v0.20 | Zed Industries 官方 SDK |
| MCP 协议 | `@modelcontextprotocol/sdk` | 官方 MCP SDK |
| 模块解析 | gray-matter + marked | 解析 module.md |
| 校验 | zod | 运行时类型校验 |
| 测试 | Vitest | 单元/组件测试 |

---

## 2. 目录结构

```
ModuleAgent/
├── src-tauri/                      # Tauri Rust 后端
│   ├── src/
│   │   ├── lib.rs                  # 应用逻辑、Sidecar 启动
│   │   └── main.rs                 # Tauri 入口
│   └── tauri.conf.json             # Tauri 配置（窗口、CSP、资源）
│
├── src-backend/                    # Node.js Sidecar 后端
│   ├── server.ts                   # HTTP/SSE 服务器入口
│   ├── agents/
│   │   ├── AgentLauncher.ts        # 启动 Agent 子进程 + ACP 连接
│   │   ├── AgentStateManager.ts    # Agent 状态/上下文持久化
│   │   ├── McpBackend.ts           # MCP HTTP 后端
│   │   ├── McpServerBuilder.ts     # MCP Server 配置构建
│   │   ├── PromptBuilder.ts        # 系统提示 + 模块上下文构建
│   │   ├── RoleAgentManager.ts     # 角色 Agent 生命周期管理
│   │   ├── RoleWorkspace.ts        # 角色 Agent 工作空间准备
│   │   ├── WorkflowManager.ts      # 工作流管理
│   │   ├── WorkflowWorkspace.ts    # 工作流工作空间
│   │   └── WorkspaceIsolator.ts    # 模块工作区隔离
│   ├── config/
│   │   ├── ConfigLoader.ts         # 加载 .module-agent.json
│   │   ├── defaults.ts             # 默认配置
│   │   └── schema.ts               # Zod schema
│   ├── core/
│   │   ├── ConfigPaths.ts          # 配置路径
│   │   ├── CoreTypes.ts            # 核心类型
│   │   ├── ExclusionRules.ts       # 内置排除规则
│   │   ├── ExperienceSummarizer.ts # 对话摘要
│   │   ├── Logger.ts               # 日志系统
│   │   ├── ModuleAgentCore.ts      # 核心编排入口
│   │   ├── ModuleAgentSubsystem.ts # 模块 Agent 子系统
│   │   ├── ModuleGenerator.ts      # 自动生成 module.md
│   │   ├── ModuleGraph.ts          # 构建模块树
│   │   ├── ModuleParser.ts         # 解析 frontmatter + markdown
│   │   ├── ModuleScanner.ts        # 递归扫描 module.md
│   │   ├── PathUtils.ts            # 跨平台路径处理
│   │   ├── RoleAgentSubsystem.ts   # 角色 Agent 子系统
│   │   ├── WorkflowScanner.ts      # 工作流扫描
│   │   └── WorkflowSubsystem.ts    # 工作流子系统
│   ├── protocol/
│   │   ├── acp/
│   │   │   ├── connection.ts       # createAgentConnection
│   │   │   └── handlers/           # FsHandler, TerminalHandler
│   │   ├── mcp/
│   │   │   ├── CommunicationBus.ts # 跨模块通信总线
│   │   │   ├── MCPServer.ts        # 模块 Agent MCP Server
│   │   │   ├── RoleMCPServer.ts    # 角色 Agent MCP Server
│   │   │   ├── server-entry.ts     # 模块 MCP Server 入口
│   │   │   ├── role-server-entry.ts# 角色 MCP Server 入口
│   │   │   └── tools/              # MCP 工具定义
│   │   └── index.ts
│   └── types/
│       ├── module.ts               # 模块类型定义
│       └── preload.ts              # 前后端共享类型
│
├── src-renderer/                   # Vue 3 前端
│   ├── main.ts                     # Vue 入口
│   ├── App.vue                     # 根组件
│   ├── views/
│   │   ├── SetupView.vue           # 设置页面（首次使用）
│   │   └── MainView.vue            # 主界面
│   ├── components/
│   │   ├── SVGTree.vue             # 交互式 SVG 模块树
│   │   ├── LeftSidebar.vue         # 左侧页签栏
│   │   ├── NodeDetailPanel.vue     # 模块详情 + 对话面板
│   │   ├── RolePanel.vue           # 角色 Agent 卡片列表
│   │   ├── RoleConfigDialog.vue    # 角色配置对话框
│   │   ├── ContextCards.vue        # 对话历史卡片
│   │   ├── ChatInput.vue           # 消息输入框
│   │   ├── SettingsDialog.vue      # 设置对话框
│   │   ├── KnowledgePanel.vue      # 知识管理面板
│   │   ├── KnowledgeEditDialog.vue # 知识编辑对话框
│   │   ├── WorkflowPanel.vue       # 工作流面板
│   │   ├── WorkflowEditDialog.vue  # 工作流编辑对话框
│   │   ├── StepEditDialog.vue      # 工作流步骤编辑
│   │   ├── DrawerPanel.vue         # 左侧抽屉
│   │   ├── MessageModal.vue        # 消息详情弹窗
│   │   ├── ProjectChatModal.vue    # 项目对话弹窗
│   │   └── ThemeToggle.vue         # 主题切换
│   ├── stores/
│   │   ├── agent.ts                # Pinia — Agent 状态
│   │   ├── config.ts               # Pinia — 项目配置
│   │   ├── project.ts              # Pinia — 模块树
│   │   ├── knowledge.ts            # Pinia — 知识管理
│   │   └── workflow.ts             # Pinia — 工作流
│   ├── composables/
│   │   ├── useApi.ts               # HTTP + SSE API 封装
│   │   ├── useModuleAgent.ts       # 旧的 IPC API 封装（Electron 兼容）
│   │   └── useTheme.ts             # 主题管理
│   ├── router/
│   │   └── index.ts                # Vue Router
│   ├── types/
│   │   └── preload.ts              # 前端类型定义
│   └── styles/
│       └── wabi-sabi.css           # 全局样式
│
├── config/                         # Agent 系统提示词
│   ├── mainagentprompt.md          # 主 Agent 系统提示
│   ├── subagentprompt.md           # 子 Agent 系统提示
│   ├── roleagentprompt.md          # 角色 Agent 系统提示
│   └── MODULE_FORMAT.md            # 模块格式规范
│
├── dist-backend/                   # Sidecar 构建产物
│   ├── server.cjs                  # HTTP/SSE 服务器
│   ├── mcp-server.cjs              # 模块 Agent MCP Server
│   └── mcp-role-server.cjs         # 角色 Agent MCP Server
│
├── dist-renderer/                  # 前端构建产物
│
├── backup/                         # 旧 Electron 架构备份
│
├── index.html                      # Vite 入口 HTML
├── vite.config.ts                  # Vite 配置
├── tsconfig.json                   # TypeScript 配置
├── vitest.config.ts                # Vitest 测试配置
├── package.json
└── .gitignore
```

---

## 3. 核心架构

### 3.1 三层架构

```
┌──────────────────────────────────────────────────────────────┐
│  前端 (Vue 3) — src-renderer/                                 │
│  Vue 3 + Element Plus + Pinia                                │
│  HTTP fetch() + SSE EventSource → Sidecar                    │
├──────────────────────────────────────────────────────────────┤
│  后端 (Node.js Sidecar) — src-backend/                       │
│  HTTP/SSE 服务器                                              │
│  Agent 编排 · 模块扫描 · MCP 路由                             │
├──────────────────────────────────────────────────────────────┤
│  桌面壳 (Tauri Rust) — src-tauri/                             │
│  窗口管理 · Sidecar 启动 · 原生 API                           │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Sidecar 通信

前端与后端的通信通过 **HTTP + SSE** 实现，取代了旧 Electron 架构中的 IPC：

```
前端 → 后端: HTTP POST (JSON body)
  例如: POST /api/agent/send { moduleName, text }

后端 → 前端: SSE (text/event-stream)
  例如: event: agent-stream
        data: { moduleName, update, reply, thinking, tools }
```

SSE 连接在 `/api/stream` 端点建立，用于推送 Agent 流式输出、状态变化和跨模块通信事件。

### 3.3 Agent 通信 (ACP)

```
Sidecar 进程
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

### 3.4 跨模块通信 (MCP)

```
Agent A (子进程)
  └─ 收到 mcpServers 配置 → spawn: node dist-backend/mcp-server.cjs

MCP Server (独立子进程)
  ├─ 通过 stdio 与 Agent 通信（MCP 协议）
  ├─ module_list    → 从 graph 文件读取
  └─ module_call    → HTTP POST → Sidecar 后端 → 路由到目标 Agent

Sidecar MCP 后端 (HTTP, 127.0.0.1:随机端口)
  ├─ 接收 module_call / module_query
  ├─ 自动启动目标 Agent（若未运行）
  ├─ 向目标 Agent 发送 prompt
  ├─ 收集流式响应
  └─ 返回结果给 MCP Server
```

---

## 4. 关键接口

### 4.1 Sidecar API

完整的 API 端点列表见 [ARCHITECTURE.md](ARCHITECTURE.md#43-api-路由)。

核心端点：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/project/scan` | POST | 扫描项目模块 |
| `/api/agent/send` | POST | 发送消息给模块 Agent |
| `/api/agent/start` | POST | 启动模块 Agent |
| `/api/agent/cancel` | POST | 取消当前请求 |
| `/api/agent/running` | GET | 获取所有运行中的 Agent |
| `/api/config/get` | GET | 读取配置 |
| `/api/config/save` | POST | 保存配置 |
| `/api/stream` | GET | SSE 事件流 |
| `/api/roles` | GET/POST | 角色管理 |
| `/api/roles/:name/send` | POST | 发送消息给角色 Agent |

### 4.2 SSE 事件

前端通过 `EventSource` 监听以下事件：

```typescript
// Agent 流式输出
eventSource.addEventListener('agent-stream', (e) => {
  const data = JSON.parse(e.data);
  // { moduleName, update: 'agent_message_chunk' | 'agent_thought_chunk' | 'tool_call', ... }
});

// Agent 状态变化
eventSource.addEventListener('agent-status', (e) => {
  const data = JSON.parse(e.data);
  // { name, status: 'idle' | 'streaming' | 'error' }
});

// 跨模块通信
eventSource.addEventListener('cross-context', (e) => {
  const data = JSON.parse(e.data);
  // { moduleName, crossModule, direction, phase, content, time }
});
```

### 4.3 MCP Server 工具

**模块 Agent 工具**（`dist-backend/mcp-server.cjs`）：

| 工具 | 参数 | 说明 |
|------|------|------|
| `module_list` | 无 | 列出所有可访问模块及描述 |
| `module_call` | targetModule, goal, background, expectedOutput, constraints | 向目标模块发任务 |
| `module_query` | targetModule, query, background | 查询目标模块 |
| `create_module` | name, parentPath?, description? | 新建模块 |

**角色 Agent 工具**（`dist-backend/mcp-role-server.cjs`）：

| 工具 | 参数 | 说明 |
|------|------|------|
| `workrole_read_file` | path | 读取工作目录中的文件 |
| `workrole_write_file` | path, content | 写入文件到工作目录 |

### 4.4 前端 API (useApi)

```typescript
// src-renderer/composables/useApi.ts
const api = useApi();

// 扫描项目
const result = await api.scanProject(projectRoot);

// 发送消息
const response = await api.sendMessage(moduleName, text);

// 监听流式事件
api.onAgentStream((data) => { ... });
api.onAgentStatus((data) => { ... });

// 配置
const config = await api.getConfig();
await api.saveConfig({ command, args, projectPath });
```

---

## 5. 渲染进程 UI 结构

```
SetupView.vue: 设置页面（首次使用）
  ├─ Element Plus 表单控件（agent 命令、参数、项目目录）
  └─ 开始扫描按钮

MainView.vue: 主界面
  ├─ 工具栏（扫描 / 清空 / 设置 / 主题切换）
  ├─ LeftSidebar.vue: 左侧页签栏（48px）
  │   ├─ 节点树页签 → 打开树抽屉
  │   └─ 角色 Agent 页签 → 打开角色抽屉
  ├─ 抽屉（从左侧滑出，可拖拽调节宽度）
  │   ├─ 树抽屉（activeTab='tree'）:
  │   │   └─ SVGTree.vue: 交互式 SVG 模块依赖图
  │   └─ 角色抽屉（activeTab='roles'）:
  │       └─ RolePanel.vue: 角色卡片列表 + 添加/编辑/删除
  └─ 主区域
      ├─ NodeDetailPanel.vue: 模块信息 + ContextCards + ChatInput
      ├─ 角色详情: 角色信息 + ContextCards + ChatInput
      └─ 占位提示（未选中时）
```

### ChatMsg 数据结构

```typescript
interface ChatMsg {
  id: string
  role: 'user' | 'agent' | 'cross'
  content: string        // 回复文本
  thinking: string       // 思考文本
  tools: string          // 工具调用信息
  time: string
  status: 'sent' | 'pending' | 'thinking' | 'executing' | 'completed' | 'error' | 'interrupted'
  moduleName: string
  agentCmd: string
  crossDirection?: 'sent' | 'received'
  crossModule?: string
}
```

---

## 6. 构建与运行

```bash
# 安装依赖
npm install

# ── 开发模式 ──

# Tauri 开发模式（Vite HMR + Tauri 桌面窗口 + Sidecar 后端）
npm run tauri:dev

# Web 开发模式（仅前端 + Sidecar，无桌面壳）
npm run dev

# 仅前端 Vite 开发服务器（需手动启动 Sidecar）
npm run dev:renderer

# ── 构建 ──

# 构建前端（Vite）
npm run build:renderer

# 构建 Sidecar 后端（esbuild）
npm run build:backend
# 包含: server.cjs + mcp-server.cjs + mcp-role-server.cjs

# 完整构建（前端 + 后端）
npm run build

# Tauri 生产构建（前端 + 后端 + Rust 编译）
npm run tauri:build

# ── 验证 ──

# 类型检查
npm run typecheck

# 单元/组件测试
npm run test
```

### 构建产物

| 命令 | 产物 | 说明 |
|------|------|------|
| `npm run build:renderer` | `dist-renderer/` | Vue 前端静态文件 |
| `npm run build:sidecar` | `dist-backend/server.cjs` | HTTP/SSE 服务器 |
| `npm run build:mcp-server` | `dist-backend/mcp-server.cjs` | 模块 MCP Server |
| `npm run build:mcp-role-server` | `dist-backend/mcp-role-server.cjs` | 角色 MCP Server |
| `npm run tauri:build` | `src-tauri/target/release/` | 原生桌面应用 |

---

## 7. 会话初始化流程

```
1. 用户打开应用
2. SetupView: 用户选择项目目录、配置 Agent 命令
3. 点击"开始扫描"
4. POST /api/project/scan { projectRoot }
   ├─ ModuleScanner.scan() → ModuleGraph.build()
   ├─ McpBackendServer.start() → 随机端口
   ├─ initRoles() / initWorkflows()
   └─ 返回模块树 { root, nodes }
5. 前端渲染 SVGTree.vue
6. 用户选择模块 → NodeDetailPanel.vue 显示
7. 发送消息 → POST /api/agent/send { moduleName, text }
   ├─ startAgent() (自动启动)
   ├─ connection.prompt()
   └─ SSE agent-stream 推送回复
```

---

## 8. 角色 Agent

### 8.1 概述

角色 Agent 是一种特殊的 Agent，拥有特定职责和对特定模块路径的可见性。

### 8.2 与模块 Agent 的区别

| 特性 | 模块 Agent | 角色 Agent |
|------|-----------|-----------|
| 工作目录 | `.module-agent/workspace/<path>/` | `.module-agent/workspace/workrole/<name>/` |
| 工作空间内容 | 仅本模块源码 | 所有可见模块的副本 |
| MCP 工具 | module_list, module_call, module_query, create_module | workrole_read_file, workrole_write_file |
| 系统提示 | mainagentprompt.md / subagentprompt.md | roleagentprompt.md |
| 上下文 key | `<moduleName>` | `workrole:<roleName>` |

### 8.3 配置格式

```json
{
  "roles": [
    {
      "name": "architect",
      "description": "架构审查 Agent",
      "visibleModulePaths": ["src/core", "src/agents"],
      "agents": {
        "default": { "command": "opencode", "args": ["acp"] }
      }
    }
  ]
}
```

---

## 9. 已知问题与注意事项

### 构建与工具链
- **前端别名**: `@` → `src-renderer/`，在 `vite.config.ts` 和 `tsconfig.json` 中配置
- **Sidecar 构建**: 使用 esbuild 打包为自包含 CJS bundle，所有依赖内联
- **Tauri 资源**: `tauri.conf.json` 的 `bundle.resources` 包含 `dist-backend/*` 和 `config/*`
- **CSP 管理**: 在 `src-tauri/tauri.conf.json` 中配置，不在 HTML meta 标签中

### 路径处理
- Windows 路径必须转为正斜杠 `/`，否则 Agent 解析失败
- `AgentLauncher.launch()` 入口处自动 `cwd.replace(/\\/g, '/')`
- WSL/Linux 上的 Windows 绝对路径：使用 `normalizeCodeSourcePath()` 转换

### SDK 类型陷阱
- `SessionUpdate.text` 不存在，正确路径是 `content.text`
- `McpServerStdio` 的 `env` 类型是 `Array<{name, value}>` 而非 `Record<string, string>`

### MCP Server
- 模块图序列化时 `Map` 会变成普通对象，反序列化后需手动 `new Map(Object.entries(...))`
- MCP Server bundle 路径相对于 `app.getAppPath()` （Tauri 资源目录）而非用户项目目录

### 流式输出
- opencode 用 `agent_thought_chunk` 发思考内容，`agent_message_chunk` 发回复
- 两者结构相同：`{ content: { type: 'text', text: '...' } }`
- Sidecar 通过 SSE 推送流式内容，前端通过 `EventSource` 接收

### 上下文持久化
- 对话历史以 JSON 文件存储在 `.module-agent/context/` 目录
- `saveContext()` 在消息发送/回复完成后自动调用
- 角色 Agent 上下文以 `workrole:<roleName>` 为 key 存储

### 角色 Agent
- 角色 Agent 使用独立的 MCP Server (`dist-backend/mcp-role-server.cjs`)
- `RoleAgentManager` 与模块 Agent 编排并行运行
- 角色工作空间在 `prepareRoleWorkspace()` 中创建，在 `cleanupRoleWorkspace()` 中清理

---

## 10. Tauri 集成要点

### 10.1 Sidecar 启动

Tauri 在 `setup()` 阶段通过 `start_sidecar()` 函数启动 Node.js Sidecar：

```rust
// src-tauri/src/lib.rs
fn start_sidecar(app: &tauri::App) -> u16 {
    let sidecar_js = resource_dir.join("dist-backend").join("server.cjs");
    let mut child = Command::new("node")
        .arg(&script_path)
        .stdout(Stdio::piped())
        .spawn()?;
    // 读取 "READY:<port>" 确认启动完成
}
```

### 10.2 前端获取端口

前端通过 Tauri command 获取 Sidecar 端口：

```typescript
const { invoke } = window.__TAURI__;
const port = await invoke('get_sidecar_port');
```

### 10.3 Tauri 配置

```json
{
  "build": {
    "beforeDevCommand": "npm run dev:renderer",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build:renderer",
    "frontendDist": "../dist-renderer"
  },
  "bundle": {
    "resources": ["../dist-backend/*", "../config/*"]
  }
}
```

---

## 11. 测试

```bash
# 类型检查（主要防护）
npm run typecheck

# 单元/组件测试
npm run test

# 测试监听模式
npm run test:watch
```

### 测试栈
- **Vitest**: 测试运行器
- **happy-dom**: DOM 环境模拟
- **@vue/test-utils**: Vue 组件测试工具

---

## 12. 旧 Electron 代码

旧 Electron 架构的代码已移至 `backup/` 目录，仅供历史参考。迁移后的架构使用 Tauri + Node.js Sidecar + Vue 3，不再依赖 Electron。

主要差异：
- **移除**: `src/main/` (Electron 主进程)、`src/preload/` (contextBridge)、`src/renderer/src/` (旧渲染进程)
- **新增**: `src-tauri/` (Tauri Rust 后端)、`src-renderer/` (独立 Vue 前端)、`src-backend/` (Node.js Sidecar)
- **通信**: Electron IPC → HTTP + SSE
- **构建**: electron-vite → Vite + esbuild + Cargo
