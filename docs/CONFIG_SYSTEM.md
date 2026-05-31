# 配置系统 — ConfigPaths / ConfigLoader / Schema / Defaults

> 文件：`src/core/ConfigPaths.ts`, `src/config/ConfigLoader.ts`, `src/config/schema.ts`, `src/config/defaults.ts`

---

## 配置系统概述

配置系统负责 `.module-agent.json` 的发现、加载、校验和默认值管理。使用 `cosmiconfig` 进行配置文件发现，`zod` 进行运行时校验。

---

## ConfigPaths — 配置路径管理

`src/core/ConfigPaths.ts`

### 开发模式检测

```typescript
isDev(): boolean
```

检测条件：
1. 环境变量 `MODULE_AGENT_DEV=1`
2. 命令行参数 `--dev`

### 项目配置目录（推荐）

```typescript
getProjectConfigDir(projectRoot: string): string
// → <projectRoot>/.module-agent/config/
```

所有 prompt 文件和 knowledge 子目录存放在项目本地，跟随项目走。

### Prompt 配置目录

```typescript
getPromptConfigDir(basePath: string, projectRoot?: string): string
```

- **开发模式**：`<basePath>/config/`（代码仓库中的 config/）
- **生产模式**：`<projectRoot>/.module-agent/config/`（项目本地）

### 配置文件初始化

```typescript
ensureConfigFiles(bundledConfigDir: string, projectRoot: string): void
```

首次运行时，将应用捆绑的 `.md` prompt 文件和 `.module-agent.json` 从代码仓库复制到项目 `.module-agent/config/` 目录（跳过已存在的文件）。dev 模式下跳过复制。

### cosmiconfig 探索器

```typescript
export const configExplorer = cosmiconfig('module-agent', {
  searchPlaces: ['.module-agent.json', '.module-agent.yaml'],
});
```

支持 `.module-agent.json` 和 `.module-agent.yaml` 两种格式，从当前目录向上搜索。

---

## ConfigLoader — 配置加载器

`src/config/ConfigLoader.ts`

### 配置加载流程

```
ConfigLoader.load(projectRoot)
  │
  ├─ configExplorer.search(projectRoot) → 发现配置文件
  │
  ├─ 未找到 → 返回 DEFAULT_WORKSPACE_CONFIG
  │
  ├─ WorkspaceConfigSchema.safeParse(raw)
  │   ├─ 成功 → 返回解析后的 WorkspaceConfig
  │   └─ 失败 → 警告 + 返回 DEFAULT_WORKSPACE_CONFIG
  │
  └─ getDefaultConfig(workspace)
      → 根据 workspace.defaultConfig 字段选择激活的配置条目
```

### getDefaultConfig(workspace)

从 `workspace.configs` 数组中按 `workspace.defaultConfig` 名称匹配激活的配置条目，未匹配时返回第一个条目或 `DEFAULT_CONFIG_ENTRY`。

---

## Schema — Zod 校验

`src/config/schema.ts`

### 核心 Schema

| Schema | 对应类型 | 说明 |
|--------|---------|------|
| `AgentConfigSchema` | `AgentConfig` | Agent 命令、参数、模型、mode 配置 |
| `ProjectConfigSchema` | `ProjectConfig` | 单条项目配置（agents + exclude + projectPath） |
| `ConfigEntrySchema` | `ConfigEntry` | 带名称的配置条目（extends ProjectConfigSchema） |
| `RoleConfigSchema` | `RoleConfig` | 角色 Agent 配置（name + description + visibleModulePaths） |
| `WorkspaceConfigSchema` | `WorkspaceConfig` | 顶层工作区配置（configs 数组 + defaultConfig + roles） |
| `StepFrontmatterSchema` | `StepDefinition` | 工作流步骤定义（STEP.md 的 frontmatter） |

### .module-agent.json 完整结构

```json
{
  "configs": [{
    "name": "default",
    "agents": {
      "default": { "command": "opencode", "args": ["acp"], "model": "gpt-4", "defaultMode": "ask" },
      "modules": {
        "backend": { "command": "codebuddy", "args": ["--acp"] }
      }
    },
    "exclude": ["docs", "test"],
    "projectPath": "."
  }],
  "defaultConfig": "default",
  "roles": [{
    "name": "architect",
    "description": "架构审查",
    "visibleModulePaths": ["src/core"],
    "agents": { "default": { "command": "opencode", "args": ["acp"] } },
    "knowledgeRefs": [{ "filename": "ARCHITECTURE.md", "name": "架构文档" }]
  }]
}
```

---

## Defaults — 默认值

`src/config/defaults.ts`

### DEFAULT_CONFIG_ENTRY

```typescript
{
  name: 'default',
  agents: { default: { command: 'opencode', args: ['acp'] } },
  exclude: [],
  projectPath: '.',
}
```

### DEFAULT_MODULE_GEN_ROLE

内置的"模块生成角色"，负责根据项目需求生成新模块，对所有模块具有可见性。

### DEFAULT_WORKSPACE_CONFIG

包含 `DEFAULT_CONFIG_ENTRY` 和 `DEFAULT_MODULE_GEN_ROLE` 的完整默认配置。
