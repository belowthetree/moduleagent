# ContextManager — 对话上下文持久化

> 文件：`src/context/ContextManager.ts`, `src/context/FileStore.ts`

---

## ContextManager — 上下文管理器

**类**：`ContextManager`

### 概述

`ContextManager` 管理模块 Agent 的对话历史，提供带缓存的读写访问。它通过依赖注入的 `ContextStore` 接口与底层存储解耦。

### ContextStore 接口

```typescript
interface ContextStore {
  load(moduleName: string): ChatMsg[];
  save(moduleName: string, msgs: ChatMsg[]): void;
  remove(moduleName: string): void;
  list(): string[];
}
```

### 缓存策略

`ContextManager` 在内存中缓存已加载的上下文，避免重复磁盘读取：

```typescript
private cache = new Map<string, ChatMsg[]>();

getMessages(moduleName: string): ChatMsg[] {
  if (!this.cache.has(moduleName)) {
    this.cache.set(moduleName, this.store.load(moduleName));
  }
  return this.cache.get(moduleName)!;
}
```

### 核心方法

| 方法 | 说明 |
|------|------|
| `getMessages(moduleName)` | 获取对话历史（首次从 store 加载） |
| `addMessage(moduleName, msg)` | 追加消息并立即持久化 |
| `removeMessages(moduleName)` | 清除模块上下文（缓存 + 存储） |
| `clearAll()` | 清除所有上下文 |

### ChatMsg 结构

```typescript
interface ChatMsg {
  id: string;
  role: 'user' | 'agent';
  content: string;
  thinking: string;
  time: string;
  status: string;
  moduleName: string;
  sessionId?: string;
}
```

---

## FileStore — 文件存储实现

**类**：`FileStore implements ContextStore`

### 概述

`FileStore` 是 `ContextStore` 的 JSON 文件实现，将对话历史持久化到 `.module-agent/contexts/` 目录。

### 存储结构

```
.module-agent/contexts/
├── core.json          # 模块 "core" 的对话历史
├── utils.json         # 模块 "utils" 的对话历史
└── ...
```

### 方法

| 方法 | 说明 |
|------|------|
| `load(moduleName)` | 从 `<contextsDir>/<moduleName>.json` 读取 ChatMsg[] |
| `save(moduleName, msgs)` | 序列化为 JSON 写入文件 |
| `remove(moduleName)` | 删除上下文文件 |
| `list()` | 列出所有上下文文件名 |

### 容错

- 文件不存在时 `load()` 返回空数组
- 读取/写入失败时捕获异常，记录日志，不中断流程

---

## 在两个路径中的使用

### Electron 路径

`ElectronBridge` 通过 `AgentStateManager` 使用上下文持久化：
- `AgentStateManager.saveContext()` / `loadContext()` 直接操作 `.module-agent/contexts/` 目录中的 JSON 文件
- 对话完成后自动保存
- drawer 打开时自动加载恢复

### TUI 路径

TUI 路径通过 `ContextManager` + `FileStore` 组合使用：
- `ContextManager` 提供带缓存的访问
- `FileStore` 提供 JSON 文件持久化
