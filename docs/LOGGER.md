# Logger — 日志系统

> 文件：`src/core/Logger.ts` | 类：`Logger`

## 概述

`Logger` 提供按日期分文件的日志记录系统，支持分级输出、RPC 跟踪和会话日志。

## 日志级别

```typescript
enum LogLevel {
  DEBUG = 0,  // 调试信息（最详细）
  INFO  = 1,  // 常规操作信息
  WARN  = 2,  // 警告
  ERROR = 3,  // 错误
}
```

## 文件策略

日志文件按日期自动分片，存放在配置的 `dir` 目录下：

```
logs/
├── module-agent-2026-05-07.log
├── module-agent-2026-05-08.log
└── ...
```

格式：`[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] message`

## 核心方法

| 方法 | 级别 | 说明 |
|------|------|------|
| `debug(msg)` | DEBUG | 调试信息 |
| `info(msg, detail?)` | INFO | 常规信息，可选详情 |
| `warn(msg)` | WARN | 警告信息 |
| `error(msg)` | ERROR | 错误信息 |
| `rpc(dir, method, detail?)` | DEBUG | RPC 通信日志（→ 发送 / ← 接收） |
| `rpcError(method, error)` | ERROR | RPC 错误日志 |
| `session(sessionId, event, detail?)` | INFO | ACP 会话事件日志 |
| `close()` | - | 关闭文件流 |
| `configure(dir, level)` | - | 运行时重配置日志目录和级别 |

## 使用方式

```typescript
import { defaultLogger } from './Logger.js';

defaultLogger.info('ModuleScanner: found 5 modules');
defaultLogger.error('Failed to load config: file not found');
defaultLogger.rpc('send', 'session/prompt', '512 chars');
defaultLogger.session(sessionId, 'created', 'cwd=/workspace/core');
```

## 设计要点

- **单例模式**：`defaultLogger` 是全局共享实例，可通过 `Logger.setDefaultDir()` 设置默认日志目录
- **容错降级**：文件写入失败时自动回退到 `process.stderr.write()`
- **跨天切换**：检测到日期变化时自动关闭旧文件流，创建新文件
- **同步写入**：`writeSync()` 保证日志不丢失，避免异步竞争
