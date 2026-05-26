# 配置系统

> `.module-agent.json` 的 schema 定义、默认值、加载与保存。

## 文件

| 文件 | 职责 |
|------|------|
| `config/schema.rs` | Serde 类型定义，完整 schema |
| `config/defaults.rs` | 默认值：Agent 配置、项目配置、默认角色 |
| `config/loader.rs` | 配置文件的读取、验证、写入 |

## 配置文件位置

`.module-agent.json` 位于项目根目录。

## Schema 结构

```rust
WorkspaceConfig {
    configs: Vec<ConfigEntry>,     // 命名配置（通常只有一个 "default"）
    default_config: String,        // 默认配置名称
    roles: Option<Vec<RoleConfig>>, // 角色列表
}
```

### AgentConfig

```json
{
  "command": "opencode",
  "args": ["acp"],
  "fastModel": null,
  "normalModel": null,
  "autoSwitchModel": null
}
```

### ProjectConfig

```json
{
  "agents": { "default": { ... } },
  "exclude": ["node_modules", ".git", "dist"],
  "projectPath": "/path/to/project",
  "summarization": { "enabled": true }
}
```

### RoleConfig

```json
{
  "name": "模块生成角色",
  "description": "负责根据项目需求生成新模块...",
  "visibleModulePaths": [],
  "knowledgeRefs": [
    { "filename": "MODULE_FORMAT.md", "name": "Module.md 文件规范" }
  ]
}
```

角色不再包含独立的 Agent 配置——所有角色统一使用项目主 Agent 配置。

## 默认值

### default_agent_config()

```
command: "npx"
args: ["-y", "@zed-industries/claude-code-acp@latest"]
```

### default_module_gen_role()

默认角色"模块生成角色"，关联知识库 `MODULE_FORMAT.md`。

### default_workspace_config()

包含默认项目配置 + 默认模块生成角色。

## 配置加载

```rust
ConfigLoader::new(project_root)
  → load()
    → 检查 .module-agent.json 是否存在
    → 存在：读取 + 反序列化
    → 不存在：返回 default_workspace_config()
  → save(config)
    → 创建父目录
    → 序列化为 JSON
    → atomic_write()（写临时文件 + 重命名）
```

## 前端配置流

```
应用启动：
  loadLastProject() → 从 localStorage 恢复上次项目路径
  loadFromProject() → 调用 config_get 命令读取 .module-agent.json
  ↓
设置对话框：
  v-model → configStore.agentCmd / agentArgs
  保存 → saveToProject() → 调用 config_save 命令
  ↓
配置数据源：
  .module-agent.json 为唯一数据源
  localStorage 仅保存 lastProject 路径
```

## 配置命令

| 命令 | 用途 |
|------|------|
| `config_get` | 读取配置（优先使用请求中的 projectRoot） |
| `config_save` | 保存配置（写入 command、args、projectPath） |

命令使用 `resolve_project_root(body, state)` 确定项目路径：
1. 优先取 `body["projectRoot"]`
2. 回退到 `state.project_root`（由 `project_scan` 设置）
3. 最终回退到 `"."` 当前位置
