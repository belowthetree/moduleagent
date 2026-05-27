# Module.md 文件规范

`module.md` 是 ModuleAgent 的**模块描述文件**，每个模块目录下放置一个。它定义模块的元信息和子模块结构，但**不包含模块的源代码** — 项目路径在 `.module-agent.json` 的 `projectPath` 字段中统一配置。

## 核心概念

ModuleAgent 中涉及项目目录及其自动创建的子目录，职责分离：

```
项目目录 (projectRoot)
─────────────────────────
存放 module.md 和项目源码
定义模块层级结构
代码即项目源码本身
自动创建 .module-agent/ 子目录管理扫描与隔离

projectRoot/
├── module.md
├── agent-cli/
│   └── acp/module.md
├── server/module.md
├── .module-agent/
│   ├── module/           ← 模块扫描目录
│   └── workspace/        ← Agent 工作空间
└── ...
```

- **项目目录**：存放 `module.md` 文件和项目源码，Agent 在此目录下工作。
- **`.module-agent/` 子目录**：自动创建。`module/` 为模块扫描入口，`workspace/` 为 Agent 隔离工作空间。子模块代码被物理隔离复制到 `.module-agent/workspace/<相对路径>/` 下。

## 文件位置

模块以树形结构组织，每个目录可以包含一个 `module.md`：

```
project-root/
├── module.md              # 根模块（主 Agent 负责）
├── server/
│   ├── module.md          # server 模块
│   ├── api/
│   │   └── module.md      # api 子模块
│   ├── models/
│   │   └── module.md      # models 子模块
│   └── services/
│       └── module.md      # services 子模块
├── frontend/
│   ├── module.md          # frontend 模块
│   ├── components/
│   │   └── module.md      # components 子模块
│   └── pages/
│       └── module.md      # pages 子模块
└── shared/
    └── module.md          # shared 模块
```

包含 `module.md` 的目录即被识别为一个模块，模块名和层级关系由文件系统中的目录位置决定。

## 文件格式

`module.md` 由两部分组成：**YAML 前置元数据**（frontmatter）和 **Markdown 正文**。

### 前置元数据（frontmatter）

使用 `---` 包裹的 YAML 块，必须位于文件开头：

```yaml
---
name: server
description: 后端 API 服务，基于 Express + TypeScript，提供 RESTful 接口
submodules:
  - name: api
    path: api
    description: API 路由和控制层，定义所有 REST 端点
  - name: models
    path: models
    description: 数据模型和 ORM 映射定义
  - name: services
    path: services
    description: 核心业务逻辑服务层
---
```

#### 字段说明

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 是 | string | 模块名称，用于 Agent 识别和跨模块通信 |
| `description` | 是 | string | 模块的简要描述，显示在模块树和 `module_list` 中 |
| `submodules` | 否 | array | 子模块列表，每个子模块包含 `name`、`path`、`description` |

**子模块字段：**

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 是 | string | 子模块名称 |
| `path` | 是 | string | 子模块路径，相对于父模块目录，同时也是 Agent 工作目录的子路径 |
| `description` | 否 | string | 子模块描述 |

> **重要**：子模块必须在 frontmatter 中显式声明其路径。`path` 字段决定了子模块的工作目录位置，`name` 用于跨模块通信。

### Markdown 正文

前置元数据之后是标准的 Markdown 内容，系统会从中提取模块说明。

#### 模块说明

第一个二级标题（`## `）为 "模块说明" 或 "Description" 时，其后的第一个段落会被提取为模块描述文本，在 Agent 首次消息中随系统提示词一起注入。

```markdown
## 模块说明

基于 Express.js 的 RESTful API 服务，使用 TypeScript 编写。包含 JWT 认证、请求验证、文件上传等功能。
```

## 完整示例

### 根模块（主 Agent 负责）

```markdown
---
name: my-app
description: 企业级全栈 Web 应用，包含后端 API、前端界面和数据库管理
submodules:
  - name: server
    path: server
    description: 后端 API 服务，提供 RESTful 接口和业务逻辑
  - name: frontend
    path: frontend
    description: 前端 React 应用，用户界面和交互
  - name: database
    path: database
    description: 数据库管理，包含迁移脚本和种子数据
  - name: shared
    path: shared
    description: 共享工具库和类型定义
---

# 企业全栈应用

## 模块说明

一个完整的企业级 Web 应用，采用模块化架构设计。后端使用 Express + TypeScript，前端基于 React + Next.js。
```

### 子模块

```markdown
---
name: server
description: 后端 API 服务，基于 Express + TypeScript
submodules:
  - name: api
    path: api
    description: API 路由和控制层
  - name: models
    path: models
    description: 数据模型和 ORM 映射
  - name: services
    path: services
    description: 核心业务逻辑服务层
---

# 后端 API 服务

## 模块说明

基于 Express.js 的 RESTful API 服务，使用 TypeScript 编写。采用分层架构设计。
```

### 叶子模块（无子模块）

```markdown
---
name: api
description: API 路由和控制层，定义了所有 REST 端点
---

# API 路由层

## 模块说明

定义所有 REST API 端点，包括路由定义、请求验证中间件、响应格式化和错误处理。
```

## 解析流程

1. `ModuleScanner` 从项目根目录递归扫描所有 `module.md` 文件
2. `ModuleParser.parseFile()` 对每个文件：
   - 使用 `gray-matter` 解析 frontmatter（`name`、`description`、`submodules`）
   - 子模块优先从 frontmatter 读取，若无则回退到解析 Markdown 正文中的 `## 子模块` 列表（兼容旧格式）
   - 使用 `marked` 解析 Markdown，提取 `## 模块说明` 段落
3. `ModuleGraph.build()` 将所有模块描述符构建为树形图
4. 运行时，Agent 首次消息中自动注入对应模块的 `module.md` 正文
5. Agent 的 cwd 根据 frontmatter 中声明的 `path` 字段（即模块目录的相对路径）确定

## 项目路径配置

项目路径在 `.module-agent.json` 中通过 `projectPath` 字段配置：

```json
{
  "projectPath": ".",
  "agents": { ... }
}
```

系统自动在项目根目录下创建 `.module-agent/module/` 和 `.module-agent/workspace/` 子目录。每个模块的代码路径由「项目根目录 + 模块相对路径」组合而成。

> **重要**：`projectPath` 必须配置为项目根目录，否则模块扫描和隔离功能无法正常工作。

### 路径示例

```
projectPath = /path/to/project

模块树:
  server/     → 源码路径: /path/to/project/server/
  frontend/   → 源码路径: /path/to/project/frontend/
  shared/     → 源码路径: /path/to/project/shared/
```

### 自动创建的目录

| 目录 | 用途 |
|---|---|
| `projectPath/.module-agent/module/` | 模块扫描入口，ModuleScanner 在此发现 `module.md` |
| `projectPath/.module-agent/workspace/` | Agent 隔离工作空间，模块代码被复制到此运行 |

## 工作区隔离

当配置了 `projectPath` 后，每次 Agent 启动时会自动执行以下流程：

### 隔离流程

```
1. 计算源码路径:  <projectPath>/<模块相对路径>/
2. 计算目标路径:  <projectPath>/.module-agent/workspace/<模块相对路径>/
   （根模块使用模块名作为子目录）
3. 复制源码到目标路径（过滤 node_modules、.git）
4. 在目标路径启动 Agent
```

Agent 的工作目录由模块的相对路径决定，该路径与父模块 frontmatter 中声明的 `submodules[].path` 一致。

### 目录结构

```
<projectPath>/.module-agent/workspace/
├── config/
│   ├── mainagentprompt.md  # 主 Agent 系统提示词
│   └── subagentprompt.md   # 子 Agent 系统提示词
├── my-app/                # 根模块（使用模块名）
│   ├── src/...
│   ├── server/
│   └── frontend/
├── server/                # 子模块（使用相对路径）
│   ├── src/...            # ← 从项目源码复制
│   └── api/
│       └── src/...
└── frontend/              # 子模块（使用相对路径）
    ├── src/...            # ← 从项目源码复制
    └── components/
        └── src/...
```

### 隔离规则

| Agent 角色 | 工作目录 | 可见范围 |
|---|---|---|
| 主 Agent（根模块） | `.module-agent/workspace/<模块名>/` | 可见所有子模块文件夹，用于协调调度 |
| 子 Agent | `.module-agent/workspace/<相对路径>/` | 仅可见自己模块的文件 |

### 错误处理

| 场景 | 行为 |
|---|---|
| `projectPath` 未配置 | 打印 `no project path configured, skipping isolation` 警告，跳过复制 |
| 源码目录不存在 | 复制失败，回退到模块描述文件所在目录 |
| `.module-agent/workspace/` 不存在 | 自动创建 |
| 复制成功 | Agent 在隔离的工作目录中启动 |
