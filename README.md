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

## 安装

### 桌面应用（GUI）

从 [GitHub Releases](https://github.com/belowthetree/module-agent/releases) 下载安装包：

| 平台 | 包类型 |
|------|--------|
| Windows | `.exe` (portable) / `.exe` (NSIS 安装程序) |
| macOS | `.dmg` |
| Linux | `.AppImage` / `.deb` |

Windows 用户推荐使用 NSIS 安装程序，安装后会在开始菜单和桌面创建快捷方式。

### CLI 命令行

```bash
pnpm add -g @belowthetree/module-agent
```

安装后即可在终端使用 `module-agent` 命令：

```bash
module-agent serve    # 持久化 stdio 模式
module-agent config   # 交互式配置向导
```

> **注意：** `module-agent tui` 终端 UI 仍在开发中，推荐使用[桌面应用（GUI）](#桌面应用gui)获得完整功能。

## 开发

### 前置条件

- Node.js >= 20
- 支持 ACP 协议的 Agent 客户端（如 [opencode](https://github.com/opencode-ai/opencode) 或 Claude CLI）

### 启动开发环境

```bash
# 克隆项目
git clone https://github.com/belowthetree/module-agent.git
cd module-agent

# 安装依赖
pnpm install

# 开发模式启动（Vite HMR 热重载）
pnpm run dev

# 生产构建并启动
pnpm run electron
```

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

详细配置说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 架构概览

```
Renderer (Vue 3 + Element Plus)     ← 用户界面、模块树、对话面板
    ↕ Electron IPC
Main Process (Electron)              ← Agent 编排、MCP 路由、状态管理
    ↕ ACP 协议 (stdio)
Agent 子进程                         ← LLM 推理、代码操作
    ↕ MCP 协议 (stdio)
MCP Server                           ← 跨模块通信总线
```

| 层 | 技术 | 职责 |
|----|------|------|
| 渲染进程 | Vue 3 + Pinia + Element Plus | 模块树可视化、对话交互、状态管理 |
| 主进程 | Electron + TypeScript | Agent 生命周期编排、IPC 处理、MCP HTTP 后端 |
| Agent 层 | opencode / Claude (ACP) | LLM 推理、文件操作、终端命令执行 |

详细架构分析见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```
src/
├── main/          Electron 主进程入口、IPC 处理器
├── preload/       contextBridge API 桥接
├── renderer/      Vue 3 渲染进程（视图、组件、Store）
├── agents/        Agent 编排（启动、隔离、状态、提示构建）
├── protocol/      ACP 连接 + MCP 服务端 + 通信总线
├── core/          模块扫描、解析、图构建、路径工具
├── config/        配置加载、Zod 校验、默认值
├── cli/           CLI 路径（次级，用于 serve/tui）
└── types/         全局类型定义
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
├── context/           ← 对话上下文持久化
└── .module-agent.json ← 项目配置
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

## 构建

```bash
pnpm run typecheck         # 类型检查
pnpm run test              # 单元测试
pnpm run test:e2e          # E2E 测试
pnpm run build:electron    # 完整生产构建
pnpm run dev               # 开发模式（热重载）
```

**本地打包**：

```bash
pnpm run dist:win         # 仅构建 Windows 包
pnpm run dist:mac         # 仅构建 macOS 包
pnpm run dist:linux       # 仅构建 Linux 包
pnpm run dist             # 构建当前平台
```

打包产物输出到 `release/` 目录。

## 许可

[GNU General Public License v3.0](LICENSE)
