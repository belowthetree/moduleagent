# ModuleAgent 设计方案

## 1. 项目概述

**ModuleAgent** 是一个模块化 Agent 编排框架。它以 `module.md` 为项目模块描述文件，将项目按模块组织，为每个模块创建独立的工作空间和对应的 Agent，主 Agent 负责承接用户对话并分发任务。充当 **ACP Client** 角色，以子进程方式启动和管理现有 Agent 应用（Claude CLI、CodeBuddy 等），通过 ACP 协议通信；通过 MCP 协议为模块 Agent 提供跨模块通信能力。

### 目标

- 以模块方式组织 Agent 进行工作
- 支持模块代码从 Git 仓库或本地路径拉取
- 支持自动扫描目录生成 module.md
- 用现有 Agent 应用作为模块 Agent，避免重复实现
- 以单可执行文件交付

---

## 2. 总体架构

```
                          ┌──────────────────────────────────┐
                          │        ModuleAgent (本项目)        │
                          │                                  │
  用户 ◀──▶ CLI (ink) ───▶│  ┌──────────┐  ┌──────────────┐ │
                          │  │ ACPClient │  │  MCPServer   │ │
                          │  │ (主Agent)  │  │ (模块间工具)  │ │
                          │  └─────┬─────┘  └──────┬───────┘ │
                          │        │ ACP             │ MCP    │
                          │  ┌─────┴─────────────────┴──────┐ │
                          │  │       AgentManager           │ │
                          │  │  ┌──────┐ ┌──────┐ ┌──────┐ │ │
                          │  │  │AgentA│ │AgentB│ │AgentC│ │ │
                          │  │  └──────┘ └──────┘ └──────┘ │ │
                          │  └──────────────────────────────┘ │
                          │                                  │
                          │  ┌──────────────┐ ┌────────────┐ │
                          │  │ ModuleGraph  │ │WorkspaceMgr│ │
                          │  └──────────────┘ └────────────┘ │
                          └──────────────────────────────────┘
                                   │ ACP (JSON-RPC/stdio)
                          ┌────────┴────────┐
                          ▼                 ▼
                   ┌────────────┐   ┌────────────┐
                   │ Claude CLI │   │ CodeBuddy  │  (现有 Agent 应用)
                   └────────────┘   └────────────┘
```

- **ModuleAgent** 不自己实现 Agent，而是作为编排中间件
- 通过 **ACP 协议** (JSON-RPC 2.0 over stdio) 与现有 Agent 应用通信
- 通过 **MCP 协议** 为模块 Agent 提供跨模块调用工具
- 模块文件**自动归属**（目录内非子模块的文件自动属于该模块）

---

## 3. 技术栈

| 类别 | 选型 | 版本 | 说明 |
|------|------|------|------|
| 语言 | TypeScript | 5.x | 强类型，Node.js 生态 |
| 运行时 | Node.js | 18+ LTS | 稳定的子进程和流处理 |
| 打包 | `bun build --compile` | latest | 单文件可执行，Windows 优先 |
| CLI 框架 | `commander` | ^12 | 命令解析 |
| CLI UI | `ink` | ^5 | React 渲染终端，组件化 |
| JSON-RPC | `vscode-jsonrpc` | ^9 | 成熟稳定的 JSON-RPC 实现 |
| MCP SDK | `@modelcontextprotocol/sdk` | ^1 | 官方 MCP Node.js SDK |
| 模块解析 | `gray-matter` | latest | 解析 YAML frontmatter |
| Markdown | `marked` | latest | 解析 Markdown 正文 |
| Git | `simple-git` | ^3 | Git clone/pull |
| 校验 | `zod` | ^3 | 运行时类型校验 |
| 文件 | `fs-extra` | ^11 | 增强 fs 操作 |

---

## 4. 目录结构

```
ModuleAgent/
├── bin/
│   └── module-agent.ts              # 入口，由 bun 编译为 exe
├── src/
│   ├── cli/
│   │   ├── main.ts                  # CLI 主入口 (commander)
│   │   ├── commands/
│   │   │   ├── init.ts              # module-agent init    — 自动生成 module.md
│   │   │   ├── scan.ts              # module-agent scan    — 扫描校验模块
│   │   │   ├── serve.ts             # module-agent serve   — 启动编排服务
│   │   │   ├── tree.ts              # module-agent tree    — 树形展示
│   │   │   └── workspace.ts         # module-agent workspace — 管理
│   │   └── views/
│   │       ├── ModuleTreeView.tsx   # Ink 模块树组件
│   │       ├── ChatView.tsx         # Ink 对话界面
│   │       └── StatusBar.tsx        # Ink 状态栏
│   │
│   ├── core/
│   │   ├── ModuleScanner.ts         # 递归扫描目录，发现 module.md
│   │   ├── ModuleParser.ts          # 解析 module.md (frontmatter + markdown)
│   │   ├── ModuleGraph.ts           # 内存模块树 (邻接表)
│   │   ├── ModuleGenerator.ts      # 自动推断并生成 module.md
│   │   └── ExclusionRules.ts       # 内置排除规则
│   │
│   ├── workspace/
│   │   ├── WorkspaceManager.ts      # ~/.module-agent/workspaces/<hash>/
│   │   ├── ModuleSyncer.ts          # 同步模块文件到工作区
│   │   ├── GitModuleSource.ts       # Git clone/pull
│   │   └── LocalModuleSource.ts     # 本地路径硬链接/复制
│   │
│   ├── protocol/
│   │   ├── acp/
│   │   │   ├── ACPClient.ts         # JSON-RPC Client (连接 Agent 子进程)
│   │   │   ├── ACPSession.ts        # 单个会话生命周期管理
│   │   │   ├── Transport.ts         # stdio 传输 (stdin/stdout 消息帧)
│   │   │   ├── handlers/
│   │   │   │   ├── fs.ts            # fs/read_text_file, fs/write_text_file
│   │   │   │   ├── terminal.ts      # terminal/create, output, wait, kill, release
│   │   │   │   └── auth.ts          # authenticate (可选)
│   │   │   └── types.ts             # ACP 消息完整类型定义
│   │   └── mcp/
│   │       ├── MCPServer.ts         # MCP Server (stdio 传输)
│   │       ├── tools/
│   │       │   ├── ModuleCallTool.ts     # 调用其他模块执行任务
│   │       │   ├── ModuleQueryTool.ts    # 查询其他模块信息
│   │       │   ├── ModuleListTool.ts     # 列出所有可用模块
│   │       │   └── FileAccessTool.ts     # 跨模块文件访问
│   │       └── CommunicationBus.ts      # 模块间消息路由
│   │
│   ├── agents/
│   │   ├── AgentManager.ts          # 统一管理所有 Agent 进程
│   │   ├── AgentLauncher.ts         # spawn 子进程，建立 ACP 连接
│   │   └── AgentRouter.ts           # 根据任务类型/模块路由到对应 Agent
│   │
│   ├── config/
│   │   ├── ConfigLoader.ts          # 加载 .module-agent.json
│   │   ├── defaults.ts              # 默认配置
│   │   └── schema.ts                # zod schema
│   │
│   └── types/
│       ├── module.ts                # ModuleDefinition, ModuleGraphNode
│       ├── agent.ts                 # AgentConfig, AgentInfo
│       └── protocol.ts              # 协议通用类型
│
├── DESIGN.md                        # 本文件
├── package.json
├── tsconfig.json
└── build.ts                         # bun 打包脚本
```

---

## 5. 配置文件

### 5.1 项目配置 `.module-agent.json`

位于项目根目录，统一配置 Agent 应用和项目参数：

```json
{
  "agents": {
    "default": {
      "command": "claude",
      "args": ["--acp", "--dangerously-skip-permissions"]
    },
    "modules": {
      "backend": {
        "command": "codebuddy",
        "args": ["--acp"]
      }
    }
  },
  "exclude": ["docs", "test", "*.config.ts"],
  "workspace": {
    "path": "~/.module-agent/workspaces"
  }
}
```

**字段说明**：

- `agents.default`: 默认的 Agent 应用配置，所有未单独配置的模块使用
- `agents.modules`: 按模块名指定特定 Agent 应用配置
- `exclude`: 额外排除的文件/目录 glob 模式（叠加内置排除列表）
- `workspace.path`: 工作目录根路径，默认 `~/.module-agent/workspaces`

### 5.2 内置排除规则

默认排除以下目录和文件：

| 目录 | 说明 |
|------|------|
| `node_modules` | Node.js 依赖 |
| `.git` | Git 仓库 |
| `dist` | 构建输出 |
| `build` | 构建输出 |
| `__pycache__` | Python 缓存 |
| `.next` | Next.js 构建 |
| `coverage` | 测试覆盖率 |
| `.turbo` | Turborepo 缓存 |

---

## 6. module.md 格式

采用 **Frontmatter + Markdown** 格式：

```markdown
---
name: server
description: 后端服务模块，负责 API、数据库、认证
source:
  type: git
  url: https://github.com/example/server.git
  branch: main
tools:
  - name: run_migration
    description: 执行数据库迁移
  - name: run_tests
    description: 运行后端测试套件
  - name: deploy
    description: 部署到测试环境
---

# 后端服务

## 模块说明

提供 RESTful API，使用 Express + PostgreSQL，支持 JWT 认证...

## 子模块

- `api/` - API 路由层
- `models/` - 数据模型
- `services/` - 业务逻辑层
```

### 6.1 Frontmatter 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 模块名称 |
| `description` | string | 是 | 简要描述 |
| `source` | SourceConfig | 否 | 源码来源，类型 `git` 或 `local` |
| `source.type` | "git" \| "local" | 否 | 来源类型 |
| `source.url` | string | 否 | Git 仓库地址 |
| `source.branch` | string | 否 | Git 分支，默认 main |
| `source.path` | string | 否 | 本地路径 |
| `tools` | ToolDef[] | 否 | 模块暴露的 MCP 工具列表 |
| `tools[].name` | string | 是 | 工具名称 |
| `tools[].description` | string | 是 | 工具描述 |

### 6.2 Markdown 正文

| 章节 | 说明 |
|------|------|
| `# 模块标题` | 一级标题为模块名称 |
| `## 模块说明` | 详细说明模块作用、涉及的功能 |
| `## 子模块` | 用列表列出子模块，格式 `- \`path/\` - 描述` |

### 6.3 文件归属规则

- 模块目录下所有文件/目录**自动归属**于该模块
- 子模块（在 module.md 中声明的）排除在外
- 内置排除规则中的目录/文件排除在外
- `.module-agent.json` 中自定义排除规则中的文件/目录排除在外

---

## 7. 核心模块设计

### 7.1 ModuleScanner

递归扫描项目目录，发现所有 `module.md` 文件，建立模块的物理位置到逻辑模块的映射。

```
输入: 项目根路径
输出: ModuleDescriptor[] (路径 + 原始内容)
流程:
  1. 从根目录开始递归
  2. 跳过排除列表中的目录
  3. 发现 module.md → 记录该目录为模块根
  4. 子目录继续递归
```

### 7.2 ModuleParser

解析单个 `module.md` 文件，提取结构化数据。

```
输入: module.md 文件路径/内容
输出: ModuleDefinition (结构化数据)
流程:
  1. gray-matter 解析 frontmatter
  2. 校验必填字段 (name, description)
  3. marked 解析 markdown 正文
  4. 从 markdown 提取子模块列表和相对路径
  5. 返回完整 ModuleDefinition
```

### 7.3 ModuleGraph

内存中的模块树结构，使用邻接表表达父子关系。

```typescript
interface ModuleGraphNode {
  name: string;
  path: string;
  workspacePath: string;
  parent: string | null;
  children: string[];
  definition: ModuleDefinition;
}

class ModuleGraph {
  nodes: Map<string, ModuleGraphNode>;
  root: string;
  // 添加节点、查询父子关系、遍历子树等
}
```

### 7.4 ModuleGenerator

自动扫描目录并生成 `module.md`。

```
输入: 目录路径
输出: module.md 内容字符串
流程:
  1. 获取目录名作为 name
  2. 扫描子目录，排除已知排除项
  3. 检测 git 仓库，自动获取 remote url 作为 source
  4. 检测已知框架 (package.json → Node.js, Cargo.toml → Rust 等)
  5. 推断模块描述
  6. 生成子模块列表
  7. 拼装 frontmatter + markdown 正文
```

---

## 8. ACP 协议实现

基于 [ACP 协议文档](./ACP协议文档.md)，实现客户端侧。

### 8.1 协议生命周期

```
1. 初始化
   客户端 → Agent: initialize (版本协商 + 能力交换)
   客户端 → Agent: authenticate (若 Agent 要求认证)

2. 会话建立
   客户端 → Agent: session/new (创建新会话，含 cwd + mcpServers)

3. Prompt 回合
   客户端 → Agent: session/prompt (发送用户消息)
   Agent → 客户端: session/update (进度更新通知，可能多次)
   Agent → 客户端: session/request_permission (权限请求)
   客户端 → Agent: session/cancel (取消操作)
   Agent → 客户端: session/prompt 响应 (含 stopReason)
```

### 8.2 ACPClient

负责与单个 Agent 子进程通信。

```typescript
class ACPClient {
  transport: StdioTransport;     // stdio 传输
  connection: MessageConnection; // JSON-RPC 连接
  capabilities: AgentCapabilities;

  initialize(): Promise<void>;
  createSession(cwd: string, mcpServers: MCPServerConfig[]): Promise<string>;
  prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResult>;
  cancelSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  // 客户端方法处理器 (Agent 调用)
  onPermissionRequest(cb: (req) => PermissionOutcome): void;
  onFileRead(cb: (path, line?, limit?) => string): void;
  onFileWrite(cb: (path, content) => void): void;
  onTerminalCreate(cb: (cmd, args, cwd, env?) => TerminalResult): void;
}
```

### 8.3 Transport

基于 `vscode-jsonrpc` 的 `StreamMessageReader` / `StreamMessageWriter`，连接子进程的 stdin/stdout。

---

## 9. MCP 协议实现

### 9.1 MCPServer

作为 MCP Server，向模块 Agent 暴露跨模块通信工具。Agent 通过 ACP session/new 中传入 `mcpServers` 配置来连接。

```typescript
class MCPServer {
  server: Server; // @modelcontextprotocol/sdk Server
  moduleGraph: ModuleGraph;
  communicationBus: CommunicationBus;

  registerTools(): void;
  // 工具列表:
  // - module_call: 调用目标模块执行任务
  // - module_query: 查询目标模块信息
  // - module_list: 列出所有可用模块
  // - file_access: 跨模块文件读写
}
```

### 9.2 模块间通信工具

| 工具名 | 参数 | 说明 |
|--------|------|------|
| `module_call` | `target: string`, `task: string`, `context?: object` | 向目标模块 Agent 发送任务并等待结果 |
| `module_query` | `target: string`, `query: string` | 向目标模块查询信息 |
| `module_list` | 无 | 列出项目所有模块及其描述 |
| `file_access` | `module: string`, `path: string`, `op: "read" \| "write"`, `content?: string` | 跨模块文件访问 |

---

## 10. 工作空间管理

### 10.1 目录结构

```
~/.module-agent/
└── workspaces/
    └── <project-hash>/           # 项目 hash (SHA256 前 12 位)
        ├── main/                 # 主 Agent 工作目录 (项目根目录的符号链接或镜像)
        ├── modules/
        │   ├── frontend/         # 模块 frontend
        │   │   └── (从 git clone 或本地复制)
        │   ├── backend/          # 模块 backend
        │   └── database/         # 模块 database
        └── .module-agent.json    # 项目配置的副本
```

### 10.2 WorkspaceManager

```typescript
class WorkspaceManager {
  basePath: string;    // ~/.module-agent/workspaces
  projectHash: string; // SHA256(projectRoot) 前 12 位

  getWorkspacePath(): string;
  getMainPath(): string;
  getModulePath(moduleName: string): string;
  setupWorkspace(): Promise<void>;
  syncModule(moduleName: string, source: SourceConfig): Promise<void>;
  cleanWorkspace(): Promise<void>;
}
```

### 10.3 代码来源策略

- **git 类型**: `simple-git` clone 到工作区，后续 pull 更新
- **local 类型**: 复制 (或硬链接) 到工作区
- **无 source**: 仅创建目录，Agent 可自行操作

---

## 11. Agent 管理

### 11.1 AgentManager

统一管理所有 Agent 子进程的生命周期。

```typescript
class AgentManager {
  agents: Map<string, AgentProcess>;
  config: ProjectConfig;

  startMainAgent(): Promise<string>;
  startModuleAgent(moduleName: string): Promise<string>;
  stopAgent(agentId: string): Promise<void>;
  stopAll(): Promise<void>;
  getAgent(agentId: string): AgentProcess | undefined;
}
```

### 11.2 AgentLauncher

负责 spawn 子进程并建立 ACP 连接。

```typescript
class AgentLauncher {
  launch(command: string, args: string[], cwd: string): Promise<ACPClient>;
}
```

### 11.3 AgentRouter

根据用户意图或任务内容将请求路由到合适的模块 Agent。

```
输入: 用户消息 / 主Agent的委派请求
输出: 目标 Agent ID 和重写后 Prompt
策略:
  1. 按模块名关键词匹配
  2. 按文件路径所属模块匹配
  3. 默认由主 Agent 处理
```

---

## 12. CLI 命令设计

| 命令 | 参数 | 说明 |
|------|------|------|
| `module-agent init [path]` | `--force` 覆盖已有 | 自动扫描目录生成 module.md 和 .module-agent.json |
| `module-agent scan [path]` | `--strict` 严格模式 | 校验所有 module.md 的完整性和一致性 |
| `module-agent serve [path]` | `--port` 调试端口 | 启动编排服务，拉起主 Agent，进入交互模式 |
| `module-agent tree [path]` | `--detail` 详细信息 | 以树形图展示模块结构 |
| `module-agent workspace [path]` | `setup / clean / status` | 管理持久化工作目录 |
| `module-agent --version` | - | 输出版本号 |
| `module-agent --help` | - | 输出帮助信息 |

---

## 13. 数据流

### 13.1 启动流程

```
module-agent serve --project ./
  → ConfigLoader: 加载 .module-agent.json
  → ModuleScanner: 递归扫描，发现所有 module.md
  → ModuleParser: 解析 frontmatter + markdown，构建 ModuleDefinition[]
  → ModuleGraph: 构建模块树，建立父子关系
  → WorkspaceManager: 在 ~/.module-agent/workspaces/<hash>/ 创建目录
  → ModuleSyncer: 按需 clone/pull 模块代码到工作区
  → AgentManager: 启动主 Agent 子进程
  → ACPClient: initialize → session/new (含 MCP 配置)
  → CLI: 进入交互循环
```

### 13.2 交互流程

```
1. 用户输入消息
2. AgentRouter: 判断归属（主Agent / 某模块Agent）
3. 若主Agent: 通过 ACPClient session/prompt 发送
4. 若模块Agent:
   a. 确保该模块 Agent 已启动 (AgentManager)
   b. 通过 ACPClient session/prompt 发送
5. Agent 通过 session/update 通知流式返回结果
6. CLI 实时渲染 (Ink 组件)
7. 收到 stopReason → 回合结束
```

### 13.3 模块间通信流程

```
1. 模块A Agent 需要调用模块B的功能
2. 模块A Agent 调用 MCPServer 暴露的 module_call 工具
3. CommunicationBus 接收请求
4. 确保模块B Agent 处于活跃状态
5. 向模块B Agent 发送 session/prompt
6. 等待模块B Agent 返回结果
7. 将结果返回给模块A Agent
```

---

## 14. 实施阶段

| 阶段 | 内容 | 产出 | 优先级 |
|------|------|------|--------|
| **P0** | CLI 骨架、ModuleScanner、ModuleParser、ModuleGraph、ModuleGenerator | 能扫描模块、解析 module.md、树形展示 | 高 |
| **P1** | WorkspaceManager、GitModuleSource、LocalModuleSource、ModuleSyncer | 能管理模块代码，持久化工作空间 | 高 |
| **P2** | ACPClient、Transport、ACPSession、MCPServer、CommunicationBus | 能与 Agent 应用通信，提供 MCP 工具 | 中 |
| **P3** | AgentManager、AgentLauncher、AgentRouter、CLI UI (Ink) | 完整交互流程，端到端可用 | 中 |
| **P4** | bun build 配置、Windows 可执行文件测试 | 单文件 exe 交付 | 低 |

---

## 15. 依赖包清单

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "ink": "^5.0.0",
    "react": "^18.0.0",
    "vscode-jsonrpc": "^9.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "gray-matter": "^4.0.0",
    "marked": "^12.0.0",
    "simple-git": "^3.0.0",
    "zod": "^3.0.0",
    "fs-extra": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/fs-extra": "^11.0.0",
    "@types/react": "^18.0.0",
    "bun": "^1.0.0"
  }
}
```
