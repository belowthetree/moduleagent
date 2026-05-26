# 开发指南

> 构建、运行、调试 ModuleAgent。

## 环境要求

- **Rust** (stable, latest)
- **Node.js** 20+
- **npm** 9+
- **Tauri CLI**: `@tauri-apps/cli` v2
- **系统库**:
  - Windows: Microsoft Visual C++ Build Tools
  - Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev` 等
  - macOS: Xcode Command Line Tools

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（Tauri 桌面应用）
npm run tauri:dev

# 仅前端（Vite dev server，无后端）
npm run dev:renderer
```

## 构建

```bash
# 前端构建（Vite → dist-renderer/）
npm run build:renderer

# 后端构建（Cargo）
npm run build:backend

# 完整构建（前端 + 后端）
npm run build

# Tauri 生产构建（桌面应用）
npm run tauri:build
```

## 命令参考

| 命令 | 功能 |
|------|------|
| `npm run dev:renderer` | 前端 Vite 开发服务器（端口 5173） |
| `npm run dev` | Web 模式（仅前端，无后端） |
| `npm run tauri:dev` | Tauri 开发模式（Vite HMR + Tauri 窗口） |
| `npm run tauri:build` | Tauri 生产构建 |
| `npm run build:renderer` | 前端生产构建 |
| `npm run build:backend` | Rust 后端构建 |
| `npm run build` | 前端 + 后端构建 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | Vitest 单元测试 |

## 项目结构

```
ModuleAgent/
├── src-tauri/             # Rust 后端（Tauri）
│   ├── src/
│   │   ├── lib.rs         # 入口、命令注册
│   │   ├── state.rs       # AppState
│   │   ├── commands.rs    # 33 个 IPC 命令
│   │   ├── agent/         # Agent 生命周期
│   │   ├── acp/           # ACP 协议
│   │   ├── config/        # 配置系统
│   │   ├── module/        # 模块扫描
│   │   ├── role/          # 角色系统
│   │   ├── workflow/      # 工作流
│   │   ├── mcp/           # MCP 工具
│   │   └── util/          # 工具库
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # Vue 3 前端
├── config/                 # Agent 提示词、知识库
├── docs/                   # 文档
├── package.json
└── vite.config.ts
```

## 关键注意事项

### Windows 路径处理

- 调用 Agent 前对 CWD 做 `replace('\\', '/')` 规范化
- Windows 上非完整路径的命令自动包装 `cmd.exe /c <cmd> <args>` 以继承 PATH

### 日志

- 输出到 `<cwd>/logs/module-agent.log`
- 终端 stderr 显示 WARN 及以上级别
- 使用 `log` + `log4rs`

### 配置数据源

- `.module-agent.json` 为唯一配置数据源
- `localStorage` 仅保存 `lastProject`（上次项目路径）
- `config_get`/`config_save` 优先使用请求中的 `projectRoot`

### 模块扫描

- `.module-agent` 目录只扫描 `module/` 子目录
- 排除规则跳过 `node_modules`、`.git`、`dist`、`target` 等

### Agent 会话错误处理

- 未知变体（如 `usage_update`）被跳过，不中断会话
- 仅 I/O 错误（连接断开）终止会话

### 角色 Agent

- 角色不再包含独立 Agent 配置，统一使用项目主配置
- 默认角色"模块生成角色"在角色列表为空时自动注入

## 日志示例

```
08:30:01 [INFO] ModuleAgent 应用启动
08:30:01 [INFO] 应用状态初始化完成
08:30:02 [INFO] 正在启动 Agent [AgentConfig { command: "opencode", ... }]...
08:30:03 [INFO] Agent [X] 会话已创建: ses_xxx
08:30:05 [INFO] Agent [X] 会话完成，停止原因: EndTurn
```

## 测试

```bash
npm run test        # 运行测试
npm run test:watch  # 监听模式
npm run typecheck   # 类型检查
cargo check --manifest-path src-tauri/Cargo.toml  # Rust 检查
```
