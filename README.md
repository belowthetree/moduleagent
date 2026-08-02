# ModuleAgent

**模块化 Agent 编排框架** — 以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块运行独立的 Agent，并支持模块间自主协作。

## 核心特性

- **基于模块的 Agent 架构** — 每个模块拥有独立的 Agent，聚焦自身职责
- **内置 Agent 内核** — 基于 ai-sdk 的进程内 LLM 循环，无需外部 Agent 子进程；内置文件读写、编辑、搜索、命令执行、Git 等工具
- **多模型支持** — Anthropic / OpenAI / DeepSeek / Google，以及自定义 OpenAI 兼容端点
- **跨模块协作** — 模块 Agent 通过 `module_call` / `module_query` 相互调用与查询，带环检测、跳数限制与超时保护
- **角色 Agent** — 跨模块的职责化 Agent，可定义可见模块范围，适用于架构审查、文档管理等场景
- **上下文优化** — snip（旧工具结果截断）→ 在线压缩 → 尾部截断三级管线，移除内容自动归档
- **交互式模块树** — SVG 渲染的模块依赖图，支持折叠/展开和节点选择
- **工作空间隔离** — 工作流步骤在独立的源码副本中执行，互不干扰
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
module-agent list        # 列出项目所有模块
module-agent get <name>  # 查看模块详情
module-agent serve       # 持久化 stdio NDJSON 模式
module-agent config      # 交互式配置向导
```

> **注意：** `module-agent tui` 终端 UI 需要 [Bun](https://bun.sh) 运行时且仍在开发中，推荐使用[桌面应用（GUI）](#桌面应用gui)获得完整功能。

## 开发

### 前置条件

- Node.js >= 20
- pnpm
- 一个 LLM 提供商的 API Key（Anthropic / OpenAI / DeepSeek / Google 任选其一）

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
      "provider": "anthropic",
      "apiKey": "sk-...",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "exclude": ["node_modules", ".git", "dist"],
  "projectPath": "."
}
```

详细配置说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 架构概览

```
Renderer (Vue 3 + Element Plus)      ← 用户界面、模块树、对话面板
    ↕ Electron IPC
Main Process (Electron)               ← Agent 生命周期编排、IPC、跨模块路由
    ↕ 进程内调用（无子进程）
Agent 内核 (AgentLoop)                ← ai-sdk generateText 循环、内置工具、上下文管线
    ↕ ai-sdk Provider
LLM 服务                              ← Anthropic / OpenAI / DeepSeek / Google
```

| 层 | 技术 | 职责 |
|----|------|------|
| 渲染进程 | Vue 3 + Pinia + Element Plus | 模块树可视化、对话交互、状态管理 |
| 主进程 | Electron + TypeScript | Agent 生命周期编排、IPC 处理、跨模块调用路由 |
| Agent 层 | 内置内核（ai-sdk） | LLM 推理循环、内置工具执行、上下文优化（snip/压缩/截断） |

详细架构分析见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```
src/
├── main/          Electron 主进程入口、IPC 处理器、Agent 生命周期
├── preload/       contextBridge API 桥接
├── renderer/      Vue 3 渲染进程（视图、组件、Pinia Store）
├── agents/        内置 Agent 内核（AgentLoop、工具、跨模块路由、提示构建）
├── core/          模块扫描、解析、图构建、路径工具、日志
├── config/        配置加载、Zod 校验、默认值
├── protocol/      IPC 通道定义
├── cli/           CLI 入口（list/get/serve/config/tui）
├── tui/           终端 UI（OpenTUI，需 Bun 运行时）
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
├── workspace/         ← 工作流步骤的隔离源码副本
├── context/           ← 对话上下文持久化
└── archives/          ← 上下文管线移除内容的归档
.module-agent.json     ← 项目配置（位于项目根目录）
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
        "default": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
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
