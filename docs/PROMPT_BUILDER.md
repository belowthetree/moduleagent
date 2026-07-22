# PromptBuilder & McpServerBuilder — 提示构建与模块图序列化

> 文件：`src/agents/prompts/PromptBuilder.ts`, `src/agents/mcp/McpServerBuilder.ts`

---

## PromptBuilder — 提示构建器

### 概述

`PromptBuilder` 负责构建发送给 Agent 的提示内容，包括系统提示加载、模块上下文（含渐进式披露）、修改规范、经验记录以及消息去重。旧的 `prompts/system.ts`、`prompts/context.ts` 已删除，`loadSystemPrompts` 现位于本文件。

### loadSystemPrompts(configDir)

从配置目录加载系统提示文件：

```
config/knowledge/
├── mainagentprompt.md    → 根模块 Agent 系统提示
└── subagentprompt.md     → 子模块 Agent 系统提示
```

返回 `{ mainPrompt, subPrompt }`，文件缺失时返回空字符串并记录警告。

> **注入方式**：系统提示**不**进入消息块，而是由 `Agent.start({ systemPrompt })` 以独立 system 角色消息注入内核（前缀缓存锚定）。工作流步骤 Agent 同样经此路径注入（`WorkflowSubsystem` 加载 `subagentprompt.md` → `WorkflowManager.startStepAgent` → `Agent.start({ systemPrompt })`）；角色 Agent 的 `roleagentprompt.md` 由 `RoleAgentManager` 以同法注入。

### buildPromptBlocks(options)

构建 `PromptBlock[]`，是消息发送的核心：

```typescript
buildPromptBlocks({
  moduleName, userText, graph, prompts, sessionPrompted,
  cwd?,                      // 非根模块首条消息注入 "当前工作目录" 提示
  progressiveDisclosure?,    // 默认 true，仅非根模块生效
})
```

**首次消息**（`sessionPrompted` 未包含该模块名）：

1. **cwd 提示**（非根模块且传入 cwd 时）：`当前工作目录: <cwd>`
2. **模块上下文**：`module.md` 的 body 内容
   - 渐进式披露开启（默认）且非根模块：仅注入 **Tier-1 摘要**（正文截断至 2000 字符 + `module_context_read_patterns/full/experience` 工具按需获取指引）
   - 根模块或渐进式披露关闭：注入完整正文
3. **修改规范 / 近期经验**：仅渐进式披露**关闭**时，从 `<modulePath>/patterns.md`、`experience.md`（最近 3 条）加载
4. **用户消息**

> 系统提示（mainagent/subagent prompt）不在此处注入——已通过 `Agent.start` 的 `systemPrompt` 参数以独立 system 角色注入，避免重复（前缀缓存锚定）。

**后续消息**：仅包含用户消息。

### dedupMessage(lastSent, moduleName, text, windowMs = 3000)

时间窗口内（默认 3 秒）的相同消息去重，防止重复提交：

```typescript
const last = lastSent.get(moduleName);
if (last && last.text === text && now - last.time < windowMs) {
  return true;  // 重复消息，忽略
}
lastSent.set(moduleName, { text, time: now });
return false;
```

### 辅助函数

| 函数 | 说明 |
|------|------|
| `loadPatternsBlock(moduleDir)` | 加载 `patterns.md` 内容（仅渐进式披露关闭时使用） |
| `loadExperienceBlock(moduleDir)` | 加载 `experience.md` 最近 3 条经验（同上） |
| `createSessionPrompted()` | 工厂函数，返回空的 `Set<string>` 用于跟踪已提示会话（Electron/TUI 各自持有） |

> 角色 Agent 的 `knowledgeRefs` 知识块不再由 PromptBuilder 构建（`loadKnowledgeBlock` 已移除），改由 `RoleAgentSubsystem._buildKnowledgeBlock()` 经 `resolveKnowledgePath()` 解析 `<projectPath>/.module-agent/knowledge/` 与 `~/.module-agent/config/knowledge/` 后注入首条消息。

---

## McpServerBuilder — 模块图文件序列化

### writeMcpGraphFile(graph, tempDir?)

将模块图序列化为临时 JSON 文件：

```typescript
writeMcpGraphFile(graph: ModuleGraphType, tempDir?: string): string
```

输出路径：`<tmpdir>/mcp-graph-<pid>.json`

`ModuleGraph.nodes`（`Map`）被转换为普通对象以实现 JSON 序列化。

> **现状**：ACP 时代的 `buildMcpServers()`（向 Agent session 注入 MCP Server 子进程配置）已随 ACP 层一并删除——内核工具在 AgentLoop 进程内运行，无独立 MCP Server bundle。`writeMcpGraphFile` 目前由主进程模块生成流程（`projectHandlers`）使用：启动临时 Agent 生成 module.md 前把现有模块图落盘供其读取，完成后清理。

---

## Prompt 注入流程全景

```
Agent.start({ systemPrompt: subagentprompt.md })   ← 独立 system 角色（前缀缓存锚定）
  │
用户发送 "帮我修复 src/core 的 bug"
  │
  ├─ buildPromptBlocks({ moduleName: 'core', userText, cwd, progressiveDisclosure: true })
  │
  ├─ 首次消息？→ 是
  │   └─ 注入：
  │       ├─ 当前工作目录提示        "当前工作目录: /path/to/project/core"
  │       └─ Tier-1 摘要            "# Module: core ...（截断至 2000 字符）
  │                                  + module_context_read_* 工具按需获取指引"
  │       （progressiveDisclosure 关闭时改为：module.md 全量正文
  │         + patterns.md + experience.md 最近 3 条）
  │
  └─ 最后追加用户消息 → "帮我修复 src/core 的 bug"
```
