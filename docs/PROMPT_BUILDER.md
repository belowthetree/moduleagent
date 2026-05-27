# PromptBuilder & McpServerBuilder — 提示构建与 MCP 配置

> 文件：`src/agents/PromptBuilder.ts`, `src/agents/McpServerBuilder.ts`

---

## PromptBuilder — 提示构建器

### 概述

`PromptBuilder` 负责构建发送给 Agent 的提示内容，包括系统提示注入、模块上下文、修改规范、经验记录以及消息去重。

### loadSystemPrompts(configDir)

从配置目录加载系统提示文件：

```
config/knowledge/
├── mainagentprompt.md    → 根模块 Agent 系统提示
└── subagentprompt.md     → 子模块 Agent 系统提示
```

返回 `{ mainPrompt, subPrompt }`，文件缺失时返回空字符串并记录警告。

### buildPromptBlocks(options)

构建 ACP `ContentBlock[]`，是消息发送的核心：

```typescript
buildPromptBlocks({
  moduleName, userText, graph, prompts, sessionPrompted
})
```

**首次消息**（`sessionPrompted` 未包含该模块名）：

1. **系统提示**：根模块用 `mainPrompt`，子模块用 `subPrompt`
2. **模块上下文**：`module.md` 的 body 内容
3. **修改规范**：从 `<modulePath>/patterns.md` 加载
4. **近期经验**：从 `<modulePath>/experience.md` 加载最近 3 条
5. **用户消息**

**后续消息**：仅包含用户消息。

### dedupMessage(lastSent, moduleName, text)

3 秒内的相同消息去重，防止重复提交：

```typescript
const last = lastSent.get(moduleName);
if (last && last.text === text && Date.now() - last.time < 3000) {
  return true;  // 重复消息，忽略
}
lastSent.set(moduleName, { text, time: Date.now() });
return false;
```

### 辅助函数

| 函数 | 说明 |
|------|------|
| `loadPatternsBlock(modulePath)` | 加载 `patterns.md` 内容 |
| `loadExperienceBlock(modulePath)` | 加载 `experience.md` 最近 3 条经验 |
| `loadKnowledgeBlock(knowledgeRefs, configDir)` | 加载角色 Agent 的 knowledgeRefs 文件 |

---

## McpServerBuilder — MCP 服务器配置构建器

### writeMcpGraphFile(graph, tempDir?)

将模块图序列化为临时 JSON 文件，供 MCP Server 子进程读取：

```typescript
writeMcpGraphFile(graph: ModuleGraphType, tempDir?: string): string
```

输出路径：`<tmpdir>/mcp-graph-<pid>.json`

`ModuleGraph.nodes`（`Map`）被转换为普通对象（`Object.fromEntries(map)`）以实现 JSON 序列化。

### buildMcpServers(options)

构建 MCP Server 的 stdio 配置，用于注入到 Agent 的 ACP `newSession` 请求：

```typescript
buildMcpServers({
  moduleName, basePath, backendPort, graphFile, nodeBin
}): McpServerStdio[]
```

生成的配置：

```typescript
[{
  name: 'module-agent',
  command: 'node',           // 或 nodeBin
  args: [
    'dist/mcp-server.cjs',   // 模块 MCP Server bundle
    '--graph-file', graphFile,
    '--module-name', moduleName,
    '--backend-url', `http://127.0.0.1:${backendPort}`,  // 可选，用于跨模块调用
  ],
  env: [],
}]
```

**容错**：
- 如果 `graphFile` 未生成 → 返回空数组
- 如果 `dist/mcp-server.cjs` 不存在 → 警告并返回空数组

---

## Prompt 注入流程全景

```
用户发送 "帮我修复 src/core 的 bug"
  │
  ├─ buildPromptBlocks({ moduleName: 'core', userText, ... })
  │
  ├─ 首次消息？→ 是
  │   └─ 注入：
  │       ├─ subagentprompt.md           "你是 ModuleAgent 的子模块助手..."
  │       ├─ module.md body              "# core — 核心模块..."
  │       ├─ patterns.md                 "# 修改规范 — 禁止修改 public API..."
  │       └─ experience.md (最近3条)     "上次修复: 避免在构造函数中做 IO..."
  │
  └─ 最后追加用户消息 → "帮我修复 src/core 的 bug"
```
