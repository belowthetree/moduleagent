# CLI — 命令行接口

> 文件：`src/cli/index.ts` | 入口：`dist/cli.cjs`

## 概述

CLI 是 ModuleAgent 的命令行接口，支持 `list`、`get`、`serve`、`tui`、`config` 五个命令。构建产物为 `dist/cli.cjs`，通过 `package.json` 的 `bin` 字段注册为 `module-agent` 命令。

## 命令参考

```bash
module-agent <command> [options]

Commands:
  list              列出项目中所有模块
  get <name>        显示模块详细信息
  serve             以持久化 stdio NDJSON 模式运行
  tui               交互式终端 UI（需要 Bun）
  config            交互式安装向导，创建/更新 .module-agent.json

Options:
  --project <path>  项目根目录路径（默认从 cwd 自动检测）
  --help, -h        显示帮助
  --version, -v     显示版本
```

---

## 命令详解

### list — 列出模块

```bash
module-agent list [--project <path>]
```

输出项目中所有模块的列表（JSON 格式）。

**实现**：`src/cli/commands/list.ts` — `listModules({ projectRoot })`

### get — 模块详情

```bash
module-agent get <name> [--project <path>]
```

输出指定模块的详细信息，包括 frontmatter、body、子模块列表等。

**实现**：`src/cli/commands/get.ts` — `getModule({ projectRoot, moduleName })`

### serve — stdio 服务模式

```bash
module-agent serve [--project <path>]
```

以持久化 stdio NDJSON 模式运行，通过 stdin/stdout 接收和返回 JSON 消息。这是无头模式，供外部系统集成使用。

**实现**：`src/cli/commands/serve.ts` — `serve({ projectRoot })`

### tui — 交互式终端 UI

```bash
module-agent tui [--project <path>]
```

启动基于 OpenTUI (SolidJS) 的交互式终端界面，提供模块树、对话面板、命令面板等功能。

**实现**：
- Node.js 环境下：检测 `bun` CLI → `spawn('bun', ['run', '--cwd', 'src/tui', '../cli/tui-entry.ts', ...])`
- Bun 环境下：直接 `import('../tui/renderer.js').startTui(root)`

**依赖**：需要 Bun 运行时（`@opentui/solid` 依赖 Bun）

### config — 配置向导

```bash
module-agent config [--project <path>]
```

交互式安装向导，引导用户创建或更新 `.module-agent.json`。

**实现**：`src/cli/commands/setup.ts` — `runSetup(projectFlag)`

向导流程（与 GUI 设置页字段对齐）：

1. 确认项目路径（`.module-agent/module/` 与 `.module-agent/workspace/` 自动创建）
2. 根模块 `module.md` 不存在时，由 `ModuleGenerator` 自动生成到 `<projectRoot>/.module-agent/module/module.md`
3. 以 `configs` 数组格式写入 `.module-agent.json`

内核模式不再需要外部 agent 进程，向导**不再询问 agent 命令/参数**（`agents.default.command/args` 已被内核忽略）。结束时打印总结：项目路径、模块目录、工作目录、模型（provider）。

---

## 构建与分发

```bash
pnpm run build:cli   # esbuild bundle → dist/cli.cjs
```

`dist/cli.cjs` 是自包含 CJS bundle（external: `@opentui/core`, `@opentui/solid`, `@opentui/keymap`）。

通过 `package.json` 的 `bin` 字段安装为全局命令：

```json
{
  "bin": {
    "module-agent": "./dist/cli.cjs"
  }
}
```

---

## 日志

CLI 启动时自动配置日志：

```typescript
defaultLogger.configure('logs', LogLevel.INFO);
```

日志文件输出到 `logs/module-agent-YYYY-MM-DD.log`。
