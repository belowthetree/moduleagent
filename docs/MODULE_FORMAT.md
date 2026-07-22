# Module.md 文件规范

`module.md` 是 ModuleAgent 的**模块描述文件**，每个模块目录下放置一个。它定义模块的元信息和子模块结构，但**不包含模块的源代码** — 模块描述树集中存放在项目根目录的 `.module-agent/module/` 下，项目源码路径在 `.module-agent.json` 的 `projectPath` 字段中统一配置。

## 核心概念

ModuleAgent 中涉及项目目录及其自动创建的子目录，职责分离：

```
项目目录 (projectRoot)
─────────────────────────
存放项目源码与 .module-agent.json
.module-agent/module/ 下存放模块描述树（module.md），目录结构镜像源码树
代码即项目源码本身

projectRoot/
├── .module-agent.json
├── .module-agent/
│   ├── module/           ← 模块描述树（扫描入口）
│   │   ├── module.md         ← 根模块
│   │   ├── server/module.md
│   │   └── frontend/module.md
│   ├── workspace/        ← 工作流步骤隔离工作空间
│   └── context/          ← 会话上下文持久化
├── server/               ← 项目源码
└── frontend/
```

- **项目目录**：存放项目源码，子模块 Agent 直接在源码目录下工作。
- **`.module-agent/module/`**：自动创建的模块描述树，`ModuleScanner` 的扫描入口。目录结构镜像源码树——例如 `module/server/module.md` 描述 `<projectPath>/server/`。
- **`.module-agent/workspace/`**：工作流步骤执行的隔离工作空间（模块 Agent 不再使用，见「工作目录与沙箱」）。

## 文件位置

模块以树形结构组织，每个目录可以包含一个 `module.md`：

```
<projectRoot>/.module-agent/module/
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

包含 `module.md` 的目录即被识别为一个模块。**模块名 = 相对 `.module-agent/module/` 根的路径，分隔符恒为 `/`**（`path.relative` 在 Windows 产出的反斜杠已统一替换，Windows 模块名同样不含 `\`）。唯一例外是**根模块**（相对路径为 `.`），其名称取 frontmatter 的 `name` 字段。父子关系由 frontmatter 的 `submodules` 声明建立。

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
| `name` | 是 | string | 模块名称。**仅根模块用作模块标识**；非根模块的标识恒为目录相对路径（见「文件位置」），此字段作展示与解析回退用途 |
| `description` | 是 | string | 模块的简要描述，显示在模块树和 `module_list` 中 |
| `submodules` | 否 | array | 子模块列表，每个子模块包含 `name`、`path`、`description` |

**子模块字段：**

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 是 | string | 子模块名称 |
| `path` | 是 | string | 子模块路径，相对于父模块目录，与描述树中的目录位置一致 |
| `description` | 否 | string | 子模块描述 |

> **重要**：子模块必须在 frontmatter 中显式声明其路径。`path` 字段用于在描述树中定位子模块并建立父子关系（`ModuleGraph.findModuleByName` 按「父路径+path → 父路径+name → 全局 name」的顺序解析）。

### Markdown 正文

前置元数据之后是标准的 Markdown 内容，系统会从中提取模块说明。

#### 模块说明

第一个二级标题（`## `）为 "模块说明" 或 "Description" 时，其后的第一个段落会被提取为模块描述文本，在 Agent 首次消息中随模块上下文一起注入。

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

1. `ModuleScanner` 从 `<projectRoot>/.module-agent/module/` 递归扫描所有 `module.md` 文件
2. `ModuleParser.parseFile()` 对每个文件：
   - 使用 `gray-matter` 解析 frontmatter（`name`、`description`、`submodules`）
   - 子模块优先从 frontmatter 读取，若无则回退到解析 Markdown 正文中的 `## 子模块` 列表（兼容旧格式）
   - 使用 `marked` 解析 Markdown，提取 `## 模块说明` 段落
3. `ModuleGraph.build()` 将所有模块描述符构建为树形图（模块名 = 相对路径、`/` 分隔；仅根模块用 frontmatter `name`）
4. 运行时，Agent 首次消息自动注入对应模块的 `module.md` 正文——`progressiveDisclosure` 开启（默认）时非根模块仅注入 Tier-1 摘要，完整文档与 patterns/experience 由模型经 `module_context_read_*` 工具按需获取；系统提示词经 `Agent.start({ systemPrompt })` 以独立 system 角色注入
5. Agent 的 cwd：根模块为 `.module-agent/module/`，子模块为 `<projectPath>/<模块相对路径>/`

## 项目路径配置

项目路径在 `.module-agent.json` 中通过 `projectPath` 字段配置：

```json
{
  "projectPath": ".",
  "agents": { ... }
}
```

系统自动在项目根目录下创建 `.module-agent/module/` 等子目录。每个模块的代码路径由「projectPath + 模块相对路径」组合而成（经 `normalizeCodeSourcePath` 归一化，防非 Windows 平台误解盘符路径）。

> **重要**：`projectPath` 必须配置为项目根目录，否则模块源码定位无法正常工作。

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
| `projectRoot/.module-agent/module/` | 模块描述树，ModuleScanner 在此发现 `module.md` |
| `projectRoot/.module-agent/workspace/` | 工作流步骤执行的隔离工作空间（模块 Agent 不使用） |
| `projectRoot/.module-agent/context/` | Agent 会话上下文持久化 |
| `projectRoot/.module-agent/archives/` | 上下文精简（snip/compact/truncate）丢弃内容的归档 |

## 工作目录与沙箱

模块 Agent **不再物理复制源码**到隔离工作空间（`.module-agent/workspace/` 现仅供工作流步骤执行使用）。每次 Agent 启动时执行以下流程：

### 启动流程

```
1. 计算源码路径: <projectPath>/<模块相对路径>/
   （经 normalizeCodeSourcePath 归一化）
2. 计算 cwd:
   - 根模块: <projectRoot>/.module-agent/module/
   - 子模块: 源码路径本身（直接在真实源码目录工作）
3. 构建 AgentSandbox:
   - 根模块: allowed = [.module-agent/module/]（不可访问项目源码）
   - 子模块: allowed = [自身源码路径]，excluded = [各直接子模块的源码路径]
4. 在 cwd 启动进程内 Agent 内核；
   文件工具经 Sandbox 校验（realpath 包含检查，符号链接/junction 无法逃逸）
```

### 可见范围

| Agent 角色 | 工作目录 | 可见范围 |
|---|---|---|
| 主 Agent（根模块） | `.module-agent/module/` | 仅模块描述树，用于协调调度；不可访问项目源码 |
| 子 Agent | `<projectPath>/<相对路径>/` | 自身模块源码，排除直接子模块的源码目录 |

### 错误处理

| 场景 | 行为 |
|---|---|
| `projectPath` 未配置 | 子模块 cwd 回退到模块描述文件所在目录 |
| 源码目录不存在 | 由 AgentSandbox/文件工具在实际访问时报错，不影响 Agent 启动 |
| `.module-agent/module/` 不存在 | 初始化时自动创建 |
