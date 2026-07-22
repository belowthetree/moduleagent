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

## 日志目录

- **默认**：`Logger.defaultDir`（经 `Logger.setDefaultDir()` 设置）或 `<cwd>/logs`
- **Electron 主进程**：`app.whenReady()` 后调用
  `defaultLogger.configure(path.join(app.getPath('userData'), 'logs'), LogLevel.INFO)`
  —— 日志固定落在 userData 下，打包后不依赖 cwd，避免日志散落
- **退出流程**：`window-all-closed` 时顺序执行
  `await bridge.cleanup()`（内部 `await core.dispose()`，等待进行中的 context 保存完成）
  → `await defaultLogger.close()` → `app.quit()`

## 文件策略

日志文件按日期自动分片，存放在配置的 `dir` 目录下：

```
logs/
├── module-agent-2026-05-07.log
├── module-agent-2026-05-08.log
└── ...
```

格式：`[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [调用位置] message`

其中 `[调用位置]` 由 `getCaller()` 从调用栈自动提取（跳过 Logger 自身帧），项目内文件显示为 `src/...:行号` 短路径。

## 核心方法

| 方法 | 级别 | 说明 |
|------|------|------|
| `debug(msg)` | DEBUG | 调试信息 |
| `info(msg, detail?)` | INFO | 常规信息，可选详情 |
| `warn(msg)` | WARN | 警告信息 |
| `error(msg)` | ERROR | 错误信息 |
| `rpc(dir, method, detail?)` | DEBUG | RPC 通信日志（→ 发送 / ← 接收） |
| `rpcError(method, error)` | ERROR | RPC 错误日志 |
| `session(sessionId, event, detail?)` | INFO | 会话事件日志（sessionId 截断为前 8 位） |
| `close()` | - | 关闭文件流（退出流程中 await 调用） |
| `configure(dir, level)` | - | 运行时重配置日志目录和级别（会先关闭旧流） |

## 使用方式

```typescript
import { defaultLogger } from './Logger.js';

defaultLogger.info('ModuleScanner: found 5 modules');
defaultLogger.error('Failed to load config: file not found');
defaultLogger.rpc('send', 'session/prompt', '512 chars');
defaultLogger.session(sessionId, 'created', 'cwd=/workspace/core');
```

## 敏感信息保护（调用侧约定）

`Logger` 本身不做内容过滤，敏感信息保护在**日志调用侧**完成：

- `ModuleAgentSubsystem` 的 `tool_call` 通知日志经 `formatNotificationForLog()` 序列化：
  - **敏感键脱敏**：参数键名匹配 `api[-_]?key|token|secret|password`（不区分大小写）时，值替换为 `***`（递归处理，限深 3 层）
  - **长度截断**：序列化结果超过 500 字符时截断并追加 `…`（工具输入可能含文件内容/密钥，避免完整写入日志）
- `RoleAgentSubsystem` 的 `tool_call` 输入日志截断为 200 字符

## 设计要点

- **单例模式**：`defaultLogger` 是全局共享实例，可通过 `Logger.setDefaultDir()` 设置默认日志目录
- **容错降级**：`writeSync()` 失败时回退 `fs.appendFileSync` 直写，再失败回退 `process.stderr.write()`
- **跨天切换**：检测到日期变化时自动关闭旧文件流，创建新文件
- **同步写入**：`writeSync()` 保证日志不丢失，避免异步竞争
