# 角色 Agent 系统

> 跨模块的职责化 Agent：管理角色配置、启动/停止角色 Agent、工作空间隔离。

## 文件

| 文件 | 职责 |
|------|------|
| `role/manager.rs` | 角色 Agent 生命周期管理 |
| `role/workspace.rs` | 角色工作空间目录的创建与清理 |

## 概念

角色 Agent 是一种跨模块的 Agent，具有特定的职责范围：
- **可见模块路径**：限制 Agent 能访问的模块目录
- **关联知识**：引用的知识库文档（如 Module.md 规范）
- **独立工作空间**：每个角色在 `.module-agent/workspace/workrole/<name>/` 下运行

角色 Agent **不包含独立的 Agent 命令配置**——统一使用项目主 Agent 配置。

## RoleConfig

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

## 默认角色

系统内置一个默认角色"模块生成角色"，用于首次扫描后自动生成 `module.md` 文件。

当 `roles_list` 返回空列表时自动注入此角色。角色使用项目主 Agent 配置启动。

## 生命周期

### 启动

```
前端 role_start 命令
  → ConfigLoader::load() → 查找角色
  → 取主 AgentConfig
  → RoleAgentManager::start()
    → RoleWorkspace::create() → 创建 .module-agent/workspace/workrole/<name>/
    → AgentManager::start_agent(name, agent_config, workspace)
    → 记录到 active_roles
```

### 发送消息

```
前端 sendRoleMessage(name, text)
  → role_send 命令
  → RoleAgentManager::send(name, text)
  → AgentManager::send_message(name, text, project_root)
  → 返回 Accumulator.reply
```

### 停止

```
前端 stopRoleAgent(name)
  → role_stop 命令
  → AgentManager::stop_agent(name) → 取消令牌
  → RoleWorkspace::remove() → 删除工作空间目录
```

## 模块生成流程

点击"调用 Agent 生成模块"按钮的完整流程：

```
generateModules()
  → fetchRoles() → 查找"模块生成角色"
  → selectRoleAgentAndStart()
    → 检查 Agent 是否已运行
    → 未运行 → startAgent(agentCmd, agentArgs, cwd)
    → 设置 selectedRoleAgent
  → sendRoleMessage(角色名, 模块生成提示词)
  → Agent 扫描项目并生成 module.md 到 .module-agent/module/
```

错误处理：
- 角色未找到 → 提示"未找到模块生成角色"
- Agent 启动失败 → 在聊天中显示具体错误
- 消息发送失败 → 显示"通信错误: <原因>"

## 工作空间

```
.module-agent/workspace/workrole/<角色名>/
├── (项目文件的隔离副本)
```

`RoleWorkspace::create()` 创建目录，`RoleWorkspace::remove()` 在停止时清理。

## 关键日志

```
[INFO] 启动角色 Agent [模块生成角色]，工作空间: .module-agent/workspace/workrole/...
[INFO] 向角色 Agent [模块生成角色] 发送消息 (123 字符)
[INFO] 停止角色 Agent [模块生成角色]
```
