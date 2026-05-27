# ModuleAgent — 系统架构

> 最后更新: 2026-05

## 1. 概述

ModuleAgent 是一个**模块化 Agent 编排框架**。以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的 Agent 子进程。通过 **ACP 协议**（`agent-client-protocol`）通信，通过 **MCP 协议**（`rmcp`）提供跨模块通信能力。

### 核心能力

- **模块扫描**：递归扫描项目目录，解析 `module.md` 构建模块依赖树
- **Agent 编排**：每个模块对应一个独立的 Agent 子进程（opencode/claude-code 等）
- **跨模块协作**：Agent 之间通过 MCP 工具互相调用/查询
- **角色 Agent**：跨模块的职责化 Agent（模块生成、文档维护等）
- **工作空间隔离**：为角色 Agent 创建隔离的工作空间副本

---

## 2. 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 桌面壳 | Tauri 2 (Rust) | 窗口管理、原生 API、Agent 子进程管理 |
| 后端 | Rust (`src-tauri/src/`) | Agent 编排、模块扫描、ACP/MCP 协议、配置管理 |
| 前端 | Vue 3 + Element Plus + Pinia | SFC 组件、状态管理、模块树可视化 |
| 构建 | Vite (前端) + Cargo (Rust) | 前端 Vite 构建、后端 Cargo 编译 |
| ACP 协议 | `agent-client-protocol` 0.12 | Agent 通信协议 |
| MCP 桥接 | `agent-client-protocol-rmcp` 0.11 | rmcp → ACP session MCP server 桥接 |
| MCP 协议 | `rmcp` 1.x | 跨模块 MCP 工具路由 |
| 日志 | `log` + `log4rs` | 文件日志到 `logs/` 目录 |

---

## 3. 进程模型

```
┌──────────────────────────────────────────────────┐
│                 Tauri (Rust)                      │
│  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  WebView     │  │  Rust Backend              │ │
│  │  (Vue 3)     │◄─┤  • Agent 生命周期管理      │ │
│  │              │  │  • 模块扫描与图谱          │ │
│  │  invoke() ───┼──┤  • ACP/MCP 协议            │ │
│  │  listen() ◄──┼──┤  • 配置管理                 │ │
│  └──────────────┘  └──────────┬────────────────┘ │
│                               │ spawn            │
│                    ┌──────────▼────────────────┐ │
│                    │  Agent 子进程 (opencode)    │ │
│                    │  • ACP stdio 通信          │ │
│                    │  • MCP 工具调用            │ │
│                    └───────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

- **前端 ↔ 后端**：Tauri IPC（`invoke()` 调用命令，`listen()` 接收事件）
- **后端 ↔ Agent**：ACP 协议（JSON-RPC 2.0 over stdio NDJSON）
- **Agent ↔ MCP**：MCP 协议（rmcp 内置工具路由）

---

## 4. 分层结构

| 层 | 位置 | 职责 |
|----|------|------|
| 前端 UI | `src/` | Vue 3 组件、Pinia stores、路由 |
| Tauri 命令 | `src-tauri/src/commands.rs` | 33 个 IPC 命令，前端调用的入口 |
| Agent 系统 | `src-tauri/src/agent/` | Agent 启动、会话管理、流式累积 |
| ACP 协议 | `src-tauri/src/acp/` | NDJSON 传输、消息类型、客户端实现 |
| MCP 工具 | `src-tauri/src/mcp/` | 跨模块调用、模块查询工具 |
| 模块系统 | `src-tauri/src/module/` | 目录扫描、module.md 解析、图谱构建 |
| 配置系统 | `src-tauri/src/config/` | schema 定义、默认值、文件加载/保存 |
| 角色系统 | `src-tauri/src/role/` | 角色 Agent 管理、工作空间隔离 |
| 工作流 | `src-tauri/src/workflow/` | 多步骤工作流执行 |
| 工具库 | `src-tauri/src/util/` | 错误类型、文件操作、路径规范化、日志 |

---

## 5. 关键数据流

### 模块扫描流

```
前端 scanProject() → project_scan 命令
  → scanner::scan() → 递归遍历目录
  → ModuleParser::parse() → 解析 module.md frontmatter
  → ModuleGraph::build() → 构建名称→节点映射
  → 存入 state.module_graph
  → 返回 root + nodes + moduleCount
```

### Agent 消息流

```
前端 sendMessage() → agent_send 命令
  → AgentManager::send_message()
  → 获取 per-agent SendLock
  → PromptBuilder::build() → 构建提示词
  → connection.build_session(cwd)
      .with_mcp_server(mcp_server)   ← 注入 MCP 工具（module_call 等）
      .block_task()
      .start_session()
  → session.send_prompt() → 发送到 Agent
  → loop { session.read_update() }
    → StreamAccumulator::process_dispatch()
    → 实时 emit stream 事件到前端（含完整累积态）
  → 返回累积结果 (reply, thinking, tools)
```

### 角色 Agent 启动流

```
前端 startRoleAgent() → role_start 命令
  → ConfigLoader::load() → 读取 .module-agent.json
  → 查找角色配置，取主 AgentConfig
  → RoleAgentManager::start()
    → RoleWorkspace::create() → 创建工作空间目录
    → AgentManager::start_agent() → 启动 Agent 子进程
```

---

## 6. 目录结构

```
ModuleAgent/
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   ├── lib.rs               # 入口、命令注册、日志初始化
│   │   ├── state.rs             # AppState 全局状态
│   │   ├── commands.rs          # 33 个 Tauri IPC 命令
│   │   ├── acp/                 # ACP 协议（连接、传输、类型）
│   │   ├── agent/               # Agent 生命周期管理
│   │   ├── config/              # 配置 schema、加载、默认值
│   │   ├── mcp/                 # MCP 工具（模块调用、查询）
│   │   ├── module/              # 模块扫描、解析、图谱
│   │   ├── role/                # 角色 Agent 管理
│   │   ├── workflow/            # 工作流执行
│   │   └── util/                # 工具（错误、文件、日志、路径）
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                          # Vue 3 前端
│   ├── main.ts                   # 应用入口、config 初始化
│   ├── components/               # UI 组件
│   ├── composables/              # useApi、useTheme 等
│   ├── stores/                   # Pinia 状态管理
│   ├── types/                    # TypeScript 类型定义
│   ├── views/                    # 页面视图
│   └── styles/                   # CSS 样式
├── config/                       # Agent 提示词、知识库
│   ├── knowledge/
│   │   └── MODULE_FORMAT.md
│   ├── mainagentprompt.md
│   ├── subagentprompt.md
│   └── roleagentprompt.md
├── docs/                         # 文档
└── .module-agent.json            # 项目配置（示例）
```
