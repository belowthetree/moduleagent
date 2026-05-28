# MCPServer & RoleMCPServer — MCP 服务端

> 文件：`src/protocol/mcp/MCPServer.ts`, `src/protocol/mcp/RoleMCPServer.ts`

---

## MCPServer — 模块 Agent MCP 服务器

**类**：`MCPServer`

### 概述

`MCPServer` 是运行在 Agent 子进程内的 MCP 服务器，通过 **stdio 传输**与 Agent 通信。它向 Agent 暴露 4 个工具，支持模块列表查询、跨模块调用、模块查询和模块创建。

### 架构

```
Agent 子进程（如 opencode）
  │ ACP session/new 中注入 mcpServers 配置
  │ Agent 自动启动: node dist/mcp-server.cjs --graph-file ... --module-name ... --backend-url ...
  ▼
MCP Server 子进程（stdio 传输）
  ├─ module_list    → 直接读取 graph 文件
  ├─ module_call    → HTTP POST → McpBackendServer → 目标 Agent
  ├─ module_query   → HTTP POST → McpBackendServer → 目标 Agent
  └─ create_module  → 直接调用 ModuleGenerator
```

### 注册的工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `module_list` | （无） | 列出当前模块可访问的所有模块及其描述 |
| `module_call` | `targetModule`, `goal`, `background`, `expectedOutput`, `constraints` | 向目标模块发送结构化任务请求 |
| `module_query` | `targetModule`, `query`, `background` | 向目标模块查询信息 |
| `create_module` | `name`, `parentPath?`, `description?` | 创建新模块并生成 `module.md` |

### module_call 参数详解

```typescript
{
  targetModule: string;      // 目标模块名称
  goal: string;              // 任务目标（具体、可执行）
  background: string;        // 背景说明（为什么需要、在整体目标中的位置）
  expectedOutput: string;    // 预期输出格式和内容
  constraints: string;       // 约束条件（禁止做的事情、范围限定）
}
```

这些参数被组装为结构化的 Prompt 文本发送给目标 Agent。

### 构建与部署

- **构建**：`pnpm run build:mcp-server` → `dist/mcp-server.cjs`
- **运行**：`node dist/mcp-server.cjs --graph-file <path> --module-name <name> [--backend-url <url>]`
- **注入**：由 `McpServerBuilder.buildMcpServers()` 构建配置，通过 ACP `newSession` 的 `mcpServers` 参数注入

---

## RoleMCPServer — 角色 Agent MCP 服务器

**类**：`RoleMCPServer`

### 概述

`RoleMCPServer` 是角色 Agent 专用的 MCP 服务器，提供受限的文件读写工具。与 `MCPServer` 的关键区别是**没有**模块间通信工具。

### 注册的工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `workrole_read_file` | `path`（相对路径） | 读取工作空间中的文件 |
| `workrole_write_file` | `path`（相对路径）, `content` | 写入文件到工作空间 |

### 安全机制

所有路径操作经过 `resolvePath()` 验证：

```typescript
private resolvePath(filePath: string): string {
  const resolved = path.resolve(this.workspaceRoot, filePath);
  if (!resolved.startsWith(this.workspaceRoot + path.sep) && resolved !== this.workspaceRoot) {
    throw new Error(`Access denied: path is outside workspace`);
  }
  return resolved;
}
```

### 构建与部署

- **构建**：`pnpm run build:mcp-role-server` → `dist/mcp-role-server.cjs`
- **运行**：`node dist/mcp-role-server.cjs --workspace <path>`

---

## 两种 MCP Server 对比

| 特性 | MCPServer | RoleMCPServer |
|------|-----------|---------------|
| 使用对象 | 模块 Agent | 角色 Agent、工作流步骤 Agent |
| 工具数量 | 4 个 | 2 个 |
| 跨模块通信 | 支持（`module_call`, `module_query`） | 不支持 |
| 文件操作 | 不提供（由 ACP FsHandler 处理） | 提供（`workrole_read_file`, `workrole_write_file`） |
| 构建产物 | `dist/mcp-server.cjs` | `dist/mcp-role-server.cjs` |
| 入口文件 | `server-entry.ts` | `role-server-entry.ts` |
