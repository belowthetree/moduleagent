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
1. 环境变量 `MODULE_AGENT_DEV=1`（或 `=true`）
2. 命令行参数 `--dev`

### 项目配置目录（推荐）

```typescript
getProjectConfigDir(projectRoot: string): string
// → <projectRoot>/.module-agent/config/
```

所有 prompt 文件和 knowledge 子目录存放在项目本地，跟随项目走。（`getUserConfigRoot()` 已标记 @deprecated。）

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

首次运行时，将应用捆绑的 `.md` prompt 文件（含 `knowledge/` 子目录）和 `.module-agent.json` 模板复制到项目 `.module-agent/config/` 与项目根目录（跳过已存在的文件）。dev 模式下跳过复制。

### cosmiconfig 探索器

```typescript
export const configExplorer = cosmiconfig('module-agent', {
  searchPlaces: [
    '.module-agent.json',
    '.module-agentrc',
    '.module-agentrc.json',
    '.module-agentrc.yaml',
    '.module-agentrc.yml',
    'module-agent.config.js',
    'module-agent.config.cjs',
  ],
});
```

从给定目录向上搜索上述文件，`.module-agent.json` 优先级最高。

---

## ConfigLoader — 配置加载器

`src/config/ConfigLoader.ts`

### 配置加载流程

```
ConfigLoader.loadWithStatus(projectRoot) → { config, error? }
  │
  ├─ configExplorer.search(projectRoot) → 发现配置文件
  │
  ├─ 未找到 → 返回 { config: DEFAULT_WORKSPACE_CONFIG }
  │
  ├─ WorkspaceConfigSchema.safeParse(raw)
  │   ├─ 成功 → 返回 { config: 解析后的 WorkspaceConfig }
  │   │        （projectPath 与配置文件所在目录不一致时打警告）
  │   └─ 失败 → 记录逐条 zod issue 错误日志，
  │             返回 { config: DEFAULT_WORKSPACE_CONFIG, error: 可读详情 }
  │             （不再静默吞错，上游可提示"配置无效，正使用默认值"）
  │
  └─ 搜索异常 → 同样回落默认配置并携带 error
```

`ConfigLoader.load(projectRoot)` 是 `loadWithStatus` 的便捷包装，仅返回 `config`。

### getDefaultConfig(workspace)

从 `workspace.configs` 数组中按 `workspace.defaultConfig` 名称匹配激活的配置条目，未匹配时返回第一个条目或 `DEFAULT_CONFIG_ENTRY`。

### 写盘与更新

- `ConfigLoader.save(projectRoot, config)`：**先经 zod 校验再写盘**，校验失败抛错不写入。
- `ConfigLoader.loadOrCreate(projectRoot)`：无配置文件时以 `DEFAULT_WORKSPACE_CONFIG` 创建。
- `ConfigLoader.upsertEntry(projectRoot, entry, setAsDefault?)`：更新/追加单个配置条目。

### Electron config:save

主进程 `config:save` IPC（`src/main/handlers/configHandlers.ts`）同样**先过 `WorkspaceConfigSchema` 校验再写盘**：失败返回 `{ success: false, error }` 且不更新任何运行时状态；成功返回 `{ success: true }`。

---

## Schema — Zod 校验

`src/config/schema.ts`

### 核心 Schema

| Schema | 对应类型 | 说明 |
|--------|---------|------|
| `AgentConfigSchema` | `AgentConfig` | Agent LLM 配置（见下） |
| `ProjectConfigSchema` | `ProjectConfig` | 单条项目配置（agents + exclude + projectPath + truncation/compaction 等） |
| `ConfigEntrySchema` | `ConfigEntry` | 带名称的配置条目（extends ProjectConfigSchema） |
| `RoleAgentConfigSchema` | `RoleAgentConfig` | 角色 Agent 的 LLM 配置 |
| `RoleConfigSchema` | `RoleConfig` | 角色 Agent 配置（name + description + visibleModulePaths + knowledgeRefs） |
| `WorkspaceConfigSchema` | `WorkspaceConfig` | 顶层工作区配置（configs 数组 + defaultConfig + roles） |
| `StepFrontmatterSchema` | `StepDefinition` | 工作流步骤定义（STEP.md 的 frontmatter） |

### AgentConfig 字段

| 字段 | 状态 | 说明 |
|------|------|------|
| `provider` / `apiKey` / `baseUrl` | 生效 | LLM 连接配置，端到端透传到内核 |
| `model` / `fastModel` | 生效 | 主模型 / 快速模型（compaction 摘要等用） |
| `maxTokens` | 生效 | 映射为 `generateText` 的 maxOutputTokens（默认 4096） |
| `contextWindow` | 生效 | 上下文窗口，用于截断/精简阈值计算 |
| `defaultMode` | 生效 | 仅内存配置，`setDefaultMode` 更新后新启动的 Agent 使用 |
| ~~`command` / `args`~~ | **废弃** | ACP 子进程时代字段，内核模式忽略；schema 保留仅为向后兼容 |
| ~~`normalModel` / `autoSwitchModel`~~ | **已删除** | 已从 schema 移除 |

另外 `sessionRound` 字段仍被 schema 接受、仍出现在 `DEFAULT_CONFIG_ENTRY` 中，但相关管道已全部删除，**无任何消费者**（残留兼容字段）。

### .module-agent.json 完整结构

```json
{
  "configs": [{
    "name": "default",
    "agents": {
      "default": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
      "modules": {
        "backend": { "provider": "openai", "model": "gpt-4o", "maxTokens": 8192 }
      }
    },
    "exclude": ["docs", "test"],
    "projectPath": ".",
    "truncation": { "truncateRatio": 0.8, "snipRatio": 0.6 },
    "compaction": { "enabled": true },
    "crossModule": { "maxHops": 3, "timeoutMs": 120000 },
    "contextHistoryLimit": 200,
    "progressiveDisclosure": true
  }],
  "defaultConfig": "default",
  "roles": [{
    "name": "architect",
    "description": "架构审查",
    "visibleModulePaths": ["src/core"],
    "agents": { "default": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" } },
    "knowledgeRefs": [{ "filename": "ARCHITECTURE.md", "name": "架构文档" }]
  }]
}
```

角色级 `agents.default` 支持 `provider` / `apiKey` / `baseUrl` / `model` / `fastModel` / `contextWindow`，已端到端生效（`RoleAgentConfigSchema`，`command` 变可选且被忽略）。

---

## Defaults — 默认值

`src/config/defaults.ts`

### DEFAULT_CONFIG_ENTRY

```typescript
{
  name: 'default',
  agents: {
    default: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    },
  },
  exclude: [],
  projectPath: '.',
  sessionRound: 1,                 // 残留字段，无消费者
  summarization: { enabled: false },
}
```

### DEFAULT_MODULE_GEN_ROLE

内置的"模块生成角色"，负责根据项目需求生成新模块，对所有模块具有可见性，`knowledgeRefs` 引用 `MODULE_FORMAT.md`。

### DEFAULT_WORKSPACE_CONFIG

包含 `DEFAULT_CONFIG_ENTRY` 和 `DEFAULT_MODULE_GEN_ROLE` 的完整默认配置。

---

## 连接配置解析 — KernelFactory.resolveConnectionConfig

`src/agents/KernelFactory.ts`

Agent 启动时按以下规则解析最终连接配置（纯函数，可单测）：

1. **apiKey**：显式配置优先；未配置时按 env 回落顺序取第一个存在的 key：
   `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `GOOGLE_API_KEY` → `DEEPSEEK_API_KEY` → `DASHSCOPE_API_KEY`
2. **provider**：显式配置优先；否则**按命中的 env key 推断**（避免拿着 OPENAI key 配 anthropic）：
   - `ANTHROPIC_API_KEY` → `anthropic`，`OPENAI_API_KEY` → `openai`，`GOOGLE_API_KEY` → `google`，`DEEPSEEK_API_KEY` → `deepseek`
   - `DASHSCOPE_API_KEY` → `custom` + 默认端点 `https://dashscope.aliyuncs.com/compatible-mode/v1`（DashScope 无专用 provider 分支，走 OpenAI 兼容端点）
   - 均未命中 → `anthropic`
3. **baseUrl**：显式配置 > `API_BASE_URL` env > 默认值。**默认值仅 anthropic 场景设置**（`https://api.anthropic.com`）及上述 env 推断场景（如 DashScope）；显式指定其他 provider 时交给 `ProviderResolver`（四个内置 provider 均在 baseUrl 非空时透传 baseURL）。
4. **model**：显式配置 > `claude-sonnet-4-20250514`。

内核创建时 `maxTokens` 默认 4096、`temperature` 固定 0.7，均接入 `generateText`。

---

## CLI setup

`src/cli/commands/setup.ts` 交互式向导：

- **不再引导输入 `command`/`args`**（内核模式无此概念）；仅引导项目路径，总结打印 `model (provider)`。
- 根模块 `module.md` 自动生成为 `<projectRoot>/.module-agent/module/module.md`（经 `ModuleGenerator`）。
- 配置以 `configs` 数组 + `defaultConfig` 的新格式写入 `.module-agent.json`。
