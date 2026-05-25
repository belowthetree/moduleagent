# ModuleAgent

**模块化 Agent 编排框架** — 以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的 Agent 子进程，并通过 MCP 协议实现模块间自主协作。

## 核心特性

- **基于模块的 Agent 架构** — 每个模块拥有独立的 Agent 进程，聚焦自身职责
- **ACP 协议通信** — 使用 `@agentclientprotocol/sdk` 与 Agent 子进程双向通信
- **跨模块协作** — 通过 MCP 协议（`@modelcontextprotocol/sdk`）实现 Agent 间的调用与查询
- **角色 Agent** — 跨模块的职责化 Agent，可定义可见模块范围，适用于架构审查、文档管理等场景
- **交互式模块树** — SVG 渲染的模块依赖图，支持折叠/展开和节点选择
- **工作空间隔离** — 每个 Agent 拥有独立的源码副本，互不干扰
- **流式对话** — 实时展示 Agent 的思考过程、工具调用和回复内容
- **自动模块生成** — 调用 Agent 分析源码目录，自动生成 `module.md` 文件

## 系统要求

- Node.js >= 20
- Rust 工具链（用于 Tauri 构建，可选）
- 支持 ACP 协议的 Agent 客户端（如 [opencode](https://github.com/opencode-ai/opencode) 或 Claude CLI）

## 快速开始

### 桌面应用（Tauri）

```bash
# 克隆项目
git clone https://github.com/belowthetree/module-agent.git
cd module-agent

# 安装依赖
npm install

# 开发模式（Vite HMR + Tauri 窗口 + Node.js sidecar 后端）
npm run tauri:dev

# 生产构建
npm run tauri:build
```

### Web 模式（仅前端 + 后端，无桌面壳）

```bash
npm run dev
```

启动后，Vite 开发服务器运行在 `http://localhost:5173`，后端 API 运行在随机端口（通过 SSE 通知前端）。

### 配置

在目标项目根目录创建 `.module-agent.json`：

```json
{
  "agents": {
    "default": {
      "command": "opencode",
      "args": ["acp"]
    }
  },
  "exclude": ["node_modules", ".git", "dist"],
  "projectPath": "."
}
```

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    Tauri (Rust)                      │
│  ┌───────────────────────────────────────────────┐  │
│  │               WebView (Vue 3)                  │  │
│  │  SetupView / MainView / SVGTree / ChatInput    │  │
│  │  Pinia stores · Element Plus · Vue Router      │  │
│  │  ┌─────────────────────────────────────────┐   │  │
│  │  │  HTTP + SSE → http://127.0.0.1:{port}   │   │  │
│  │  └─────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────┘  │
│                          ↕                           │
│  ┌───────────────────────────────────────────────┐  │
│  │          Node.js Sidecar (src-backend/)        │  │
│  │  HTTP/SSE Server · Agent Orchestration         │  │
│  │  ModuleScanner · ModuleGraph · ConfigLoader    │  │
│  │  McpBackend · RoleAgentManager                 │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│               Agent 子进程层 (ACP 协议)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │           │
│  │ (模块 A) │  │ (模块 B) │  │ (模块 C) │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │                │
│  ┌────┴──────────────┴──────────────┴────┐           │
│  │  MCP Server 子进程 (stdio)              │           │
│  │  (dist-backend/mcp-server.cjs)         │           │
│  └────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

| 层 | 技术 | 职责 |
|----|------|------|
| 桌面壳 | Tauri (Rust) | 桌面窗口管理、原生 API（文件对话框）、Sidecar 进程管理 |
| 前端 | Vue 3 + Pinia + Element Plus | 模块树可视化、对话交互、状态管理 |
| 后端 | Node.js (Sidecar) | Agent 生命周期编排、HTTP/SSE API、MCP 路由 |
| Agent 层 | opencode / Claude (ACP) | LLM 推理、文件操作、终端命令执行 |

详细架构分析见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```
ModuleAgent/
├── src-tauri/                     # Tauri Rust 后端
│   ├── src/lib.rs                 # Tauri 应用逻辑、Sidecar 启动
│   └── tauri.conf.json            # Tauri 配置
├── src-backend/                   # Node.js Sidecar 后端
│   ├── server.ts                  # HTTP/SSE 服务器入口
│   ├── agents/                    # Agent 编排（启动、状态、提示构建）
│   ├── config/                    # 配置加载、Zod 校验
│   ├── core/                      # 模块扫描、解析、图构建、路径工具
│   ├── protocol/                  # ACP 连接 + MCP 服务端
│   └── types/                     # 类型定义
├── src-renderer/                  # Vue 3 前端
│   ├── views/                     # SetupView, MainView
│   ├── components/                # SVGTree, ChatInput, RolePanel 等
│   ├── stores/                    # Pinia 状态管理
│   └── router/                    # Vue Router 路由
├── config/                        # Agent 系统提示词
│   ├── mainagentprompt.md
│   ├── subagentprompt.md
│   └── roleagentprompt.md
├── dist-backend/                  # Sidecar 构建产物
└── dist-renderer/                 # 前端构建产物
```

## 模块系统

模块由 `module.md` 文件定义，包含 YAML frontmatter（模块名称、描述、子模块引用）和 Markdown body（API、依赖、架构说明）。

```
.module-agent/
├── module/            ← 所有 module.md 存放于此
│   ├── module.md      ← 根模块
│   ├── src/
│   │   └── core/
│   │       └── module.md
│   └── config/
│       └── module.md
├── workspace/         ← 隔离工作空间（Agent 运行时）
├── workrole/          ← 角色 Agent 工作空间
└── context/           ← 对话上下文持久化
```

## 角色 Agent

角色 Agent 是跨模块的职责化 Agent，可查看多个模块的源码，适用于文档管理、架构审查等场景。

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

## 开发命令

```bash
npm run tauri:dev          # Tauri 开发模式（Vite HMR + 桌面窗口 + Sidecar）
npm run tauri:build        # Tauri 生产构建
npm run dev                # Web 开发模式（仅前端 + Sidecar，无桌面壳）
npm run dev:renderer       # 仅前端 Vite 开发服务器
npm run typecheck          # 类型检查（tsc --noEmit）
npm run test               # 单元测试（Vitest）
npm run build:backend      # 构建 Sidecar（esbuild）
npm run build:renderer     # 构建前端（Vite）
```

## 许可

[GNU General Public License v3.0](LICENSE)
