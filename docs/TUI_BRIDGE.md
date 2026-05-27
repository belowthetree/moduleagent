# TuiBridge — TUI 桥接层

> 文件：`src/tui/bridge.ts` | 类：`TuiBridge`

## 概述

`TuiBridge` 是 TUI（终端用户界面）模式下连接 Core 层和 SolidJS UI 的桥接适配器。与 `ElectronBridge` 不同，它不涉及 IPC，而是直接将 `CoreCallbacks` 翻译为 SolidJS 信号更新。

## 架构位置

```
┌─────────────────────────────────┐
│  TUI Renderer (SolidJS)         │
│  ┌───────────────────────────┐  │
│  │ tuiState.messages()       │  │  ← SolidJS signals
│  │ tuiState.status()         │  │
│  └───────────────────────────┘  │
├─────────────────────────────────┤
│  TuiBridge                      │
│  ┌───────────────────────────┐  │
│  │ ModuleAgentCore           │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## 核心设计

### CoreCallbacks → SolidJS Signals

```typescript
const callbacks: CoreCallbacks = {
  onStreamChunk: (_moduleName, text) => {
    // 追加到当前最后一条消息
    const msgs = tuiState.messages();
    const updated = [...msgs];
    updated[msgs.length - 1] = { ...lastMsg, content: lastMsg.content + text };
    tuiState.setMessages(updated);
  },
  onStreamComplete: (_moduleName) => {
    // 更新时间戳
    tuiState.setMessages(updated);
    this.setStatus('idle');
  },
  onStreamError: (_moduleName, error) => {
    this.setStatus('error');
    tuiState.setMessages([...msgs, { role: 'system', content: `Error: ${error}` }]);
  },
  onStatusChange: (status) => {
    this.setStatus(status);
  },
  onMessage: (message) => {
    tuiState.setMessages([...msgs, message]);
  },
};
```

### tuiState 信号

`TuiBridge` 通过 `src/tui/state.ts` 中的 SolidJS signals 驱动 UI：

```typescript
// tuiState
{
  messages: Signal<ChatMessage[]>,
  status: Signal<AgentStatus>,
  modules: Signal<string[]>,
  // ...
}
```

### 与 ElectronBridge 的差异

| 特性 | ElectronBridge | TuiBridge |
|------|---------------|-----------|
| 通信机制 | Electron IPC (`ipcMain.handle`) | 直接函数调用 |
| 状态管理 | Pinia stores (Vue 3) | SolidJS signals |
| 流式累加 | AgentStateManager | 直接追加字符串 |
| MCP 后端 | McpBackendServer (HTTP) | 不需要（CLI 路径用 AgentRouter） |
| ExperienceSummarizer | 自动触发 | 自动触发 |
| 配置加载 | cosimconfig + ConfigLoader | 直接文件读取 |

### TUI 特有功能

- **模块自动加载**：`loadedModules` Set 跟踪已加载模块
- **仓库根目录发现**：`findRepoRoot()` 向上查找 `package.json`
