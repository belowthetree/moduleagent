# AGENTS.md

AI 编程助手的代码库指导。

## 构建与验证

```bash
npm run dev:renderer       # 前端 Vite dev server（端口 5173）
npm run dev                # Web 模式（仅前端）
npm run tauri:dev          # Tauri dev 模式（Vite HMR + Tauri 窗口）
npm run tauri:build        # 生产构建
npm run build:backend      # Rust 后端构建（cargo build）
npm run build:renderer     # 前端构建（Vite）
npm run typecheck          # TypeScript 类型检查
npm run test               # Vitest 测试
```

## 架构：Tauri 2 + Rust 后端 + Vue 3

### 进程模型

```
┌──────────────────────┐  Tauri IPC    ┌──────────────────────┐
│   Tauri (Rust)       │◄──────────────►│  Vue 3 WebView       │
│   Window + 后端逻辑   │  invoke/listen │  (前端 UI)           │
│          │           │                │                      │
│    spawn │           │                │                      │
│          ▼           │                │                      │
│   Agent 子进程        │                │                      │
│   (opencode/claude)  │                │                      │
│    ACP stdio         │                │                      │
└──────────────────────┘                └──────────────────────┘
```

后端逻辑全部在 Rust（`src-tauri/src/`）中运行，无需 Node.js Sidecar。

### 分层

| 层 | 位置 | 职责 |
|----|------|------|
| 前端 UI | `src/` | Vue 3 组件、Pinia stores、路由 |
| Tauri 命令 | `src-tauri/src/commands.rs` | 33 个 IPC 命令入口 |
| Agent 系统 | `src-tauri/src/agent/` | AgentLauncher、AgentManager、StreamAccumulator |
| ACP 协议 | `src-tauri/src/acp/` | NDJSON 传输、客户端实现 |
| 模块系统 | `src-tauri/src/module/` | 扫描、解析、图谱构建 |
| 配置 | `src-tauri/src/config/` | Schema、默认值、加载器 |
| 角色 | `src-tauri/src/role/` | 角色 Agent 管理、工作空间 |
| 工具 | `src-tauri/src/util/` | 错误、文件操作、日志、路径 |

## 关键注意事项

- **Windows PATH**：非完整路径命令自动包装 `cmd.exe /c`（见 `agent/launcher.rs`）
- **配置数据源**：`.module-agent.json` 为唯一数据源，`localStorage` 仅存 `lastProject`
- **模块扫描**：`.module-agent` 目录只扫描 `module/` 子目录
- **会话错误**：未知变体（如 `usage_update`）被跳过，不中断会话
- **角色 Agent**：不包含独立 Agent 配置，统一使用项目主配置
- **日志系统**：`log` + `log4rs`，输出到 `logs/` 目录
- **前端通信**：`window.__TAURI__.core.invoke()` + `listen()`，非 HTTP/SSE

## 项目配置

`.module-agent.json` 在用户项目根目录配置。Schema 在 `src-tauri/src/config/schema.rs`。

### 配置字段

| 字段 | 说明 |
|------|------|
| `agents.default.command` / `args` | Agent 命令和参数 |
| `exclude` | 扫描排除的目录/模式 |
| `projectPath` | 项目根目录 |
| `roles` | 角色 Agent 配置（名称、描述、可见模块路径、知识引用） |
| `summarization.enabled` | 自动文档更新开关 |

## 主要目录

| 目录 | 说明 |
|------|------|
| `src-tauri/` | Tauri Rust 后端 |
| `src/` | Vue 3 前端 |
| `config/` | 系统提示词 + 知识库 |
| `docs/` | 文档 |

### 运行时目录（用户项目根目录下）

| 目录 | 说明 |
|------|------|
| `.module-agent/` | 所有运行时数据 |
| `.module-agent/module/` | 模块 `.md` 文件 |
| `.module-agent/workspace/workrole/` | 角色工作空间 |
| `.module-agent/context/` | Agent 对话上下文 |
| `.module-agent/knowledge/` | 知识库文件 |
| `.module-agent.json` | 项目配置文件 |

## 构建产物

- 前端：`dist-renderer/`（Vite）
- 后端：Cargo target 目录
- `dist-renderer/` 和 `src-tauri/target/` 在 gitignore 中
