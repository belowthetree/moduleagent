# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & verify

```bash
pnpm run dev              # Dev mode with Vite HMR (renderer + main + preload with hot reload)
pnpm run build:electron   # Full production build: electron-vite + MCP server + CLI
pnpm run electron         # Build then launch Electron app
pnpm run typecheck        # Type-check only (no emit)
pnpm run test             # Vitest unit/component tests
pnpm run test:e2e         # Playwright end-to-end tests
```

Type-check (`pnpm run typecheck`) is the primary guardrail. No linter or formatter configured.

## Architecture: unified Core layer with UI bridges

The codebase has been refactored into a layered architecture:

- **Core layer** (`src/core/`): `ModuleAgentCore` is the unified entry point for all agent orchestration. It composes `ModuleAgentSubsystem` (module agent lifecycle: scan → graph → agent → MCP) and `RoleAgentSubsystem` (role agent lifecycle). Core is 100% UI-agnostic — no Electron, Vue, SolidJS, or TUI dependencies.
- **Bridge layer**: Thin adapters that connect Core to UI frameworks:
  - `src/main/bridge.ts` — `ElectronBridge` (228行编排层): 持有 `HandlerContext`，委托 11 个领域 handler 注册 IPC
  - `src/main/handlers/` — 领域 IPC handler 模块: `agentHandlers`, `roleHandlers`, `workflowHandlers`, `knowledgeHandlers`, `projectHandlers`, `configHandlers`, `contextHandlers`, `migrationHandlers`, `dialogHandlers`, `workspaceDiffHandlers`
  - `src/main/handlers/HandlerContext.ts` — 所有 handler 共享的上下文接口（14 字段 + 2 方法）
  - `src/main/handlers/sendPipeline.ts` — `agent:send` / `role:send` 共享的锁→流→保存管道
  - `src/protocol/IpcChannels.ts` — 全部 52 个 IPC 通道名的集中常量注册表
  - `src/tui/bridge.ts` — `TuiBridge`: translates CoreCallbacks → SolidJS signals
  - 两座桥接均实现 `IAgentBridge` 接口（定义于 `CoreTypes.ts`）
- **UI layer**: Pure presentation
  - Electron: `src/main/index.ts` (window creation only), Vue 3 renderer in `src/renderer/src/`
  - TUI: `src/tui/renderer.tsx` (OpenTUI startup), SolidJS components in `src/tui/components/`
- **Underlying modules** (shared by all layers): `src/agents/`, `src/protocol/`, `src/config/`, `src/context/`, `src/types/`

The old duplication between `AgentOrchestrator` (Electron) and `AgentManager`/`AgentRouter` (CLI/TUI) has been eliminated. Both paths now share the same `ModuleAgentCore` instance via their respective bridges.

Communication pattern: Core exposes `CoreCallbacks` interface (callback injection). Bridges implement callbacks and translate them to framework-specific signals. Core has zero knowledge of IPC, SolidJS, Vue, or any transport mechanism.

### Renderer architecture (Vue 3)

- **Views**: `SetupView.vue` (project config), `MainView.vue` (main workspace with left sidebar + module tree drawer + role agent drawer + central chat panel)
- **Key components**: `SVGTree.vue` (interactive module dependency graph), `LeftSidebar.vue` (tab bar: tree / roles), `NodeDetailPanel.vue` (inline module detail + chat), `RolePanel.vue` (role agent cards), `RoleConfigDialog.vue` (role create/edit dialog), `ContextCards.vue` (chat history), `ChatInput.vue` (message input), `SettingsDialog.vue`, `ThemeToggle.vue`
- **State management**: Pinia stores in `src/renderer/src/stores/` — `configStore`, `projectStore`, `agentStore` (includes role agent state)
- **UI library**: Element Plus for dialogs, buttons, forms, notifications
- **Routing**: Vue Router with setup and main workspace routes

## Critical gotchas

- **Windows path normalization**: Always call `cwd.replace(/\\/g, '/')` before passing cwd to Agent subprocesses. Already done in `AgentLauncher.launch()`.
- **Windows absolute paths on WSL/Linux**: `path.resolve('E:\\foo\\bar')` on Linux does NOT recognize the drive letter as absolute — it treats the whole thing as relative and prepends `cwd`. Use `normalizeCodeSourcePath()` from `src/core/PathUtils.ts` to convert `E:\foo\bar` → `/mnt/e/foo/bar` when `process.platform !== 'win32'`.
- **CSP in main process**: Content Security Policy is set in `src/main/index.ts` via `session.defaultSession.webRequest.onHeadersReceived()`, NOT in HTML `<meta>` tags. For dev mode (Vite HMR), the CSP must allow `ws://` and inline scripts for HMR to function.
- **`@` alias paths**: In renderer (Vue components), `@` resolves to `src/renderer/src/`. In main process, `@` resolves to `src/`. These are configured separately in `electron.vite.config.ts`.
- **McpServerStdio env format**: Must be `Array<{name: string, value: string}>`, NOT `Record<string, string>`. Zod validation in the SDK rejects record types.
- **Stream chunk content path**: Content is at `notification.update.content.text`, not `notification.update.text`.
- **Map serialization**: Module graph uses `Map`. When serializing to JSON (for MCP graph file), convert to object with `Object.fromEntries(map)`. Deserialize with `new Map(Object.entries(obj))`.
- **MCP server bundle path**: Use `app.getAppPath()` (Electron app root), NOT the user's project root. The bundle lives at `dist/mcp-server.cjs` relative to this repo.
- **First message per session** injects system prompt (`config/mainagentprompt.md` or `config/subagentprompt.md`) + module context. Subsequent messages skip this. Tracked via `sessionPrompted` Set.

## Config resolution (dev vs production)

### Dev mode

Activated by `module-agent.bat dev` or `module-agent.sh dev` (sets `MODULE_AGENT_DEV=1`). Also auto-detected when running under `electron-vite dev` (`app.isPackaged === false`).

- **Prompt files** (`config/*.md`): read from `{repo}/config/`
- **Project config** (`.module-agent.json`): discovered via `cosmiconfig` searching upward from cwd

### Production mode

When `MODULE_AGENT_DEV` is not set and the app is packaged.

- **Prompt files**: read from `{env-paths config}/config/` — e.g. `~/.config/module-agent/config/` on Linux
- **Project config**: discovered via `cosmiconfig` searching upward from cwd; global preset at `{env-paths config}/.module-agent.json` serves as fallback
- **First run**: `ensureConfigFiles()` in `src/core/ConfigPaths.ts` copies bundled `.md` files and `.module-agent.json` from the app bundle to the user config directory (skipping existing files)

### Platform-specific config directories (via `env-paths`)

| Platform | Config root |
|----------|-------------|
| Linux | `~/.config/module-agent/` |
| macOS | `~/Library/Application Support/module-agent/` |
| Windows | `%APPDATA%/module-agent/Config/` |

### Key files

- `src/core/ConfigPaths.ts` — `isDev()`, `getPromptConfigDir()`, `ensureConfigFiles()`, `configExplorer` (cosmiconfig)
- `src/config/ConfigLoader.ts` — uses `configExplorer` from ConfigPaths to discover `.module-agent.json`
- `src/agents/PromptBuilder.ts` — `loadSystemPrompts(configDir)` reads `.md` files from resolved `configDir`

## Project config

`.module-agent.json` at the **user's project root** (not this repo's root) configures the agent command, args, exclusions, and project root. Schema in `src/config/schema.ts`. Note: the repo's own `.module-agent.json` is a sample for self-hosting.

### Config fields

| Field | Purpose |
|-------|---------|
| `agents.default.command` / `args` | Agent executable and arguments |
| `agents.modules` | Per-module agent command overrides |
| `exclude` | Directory/pattern list to skip during module scanning |
| `projectPath` | Root project directory. `.module-agent/module/` and `.module-agent/workspace/` are auto-created here |
| `roles` | Array of role agent configs (`name`, `description`, `visibleModulePaths`, `agents.default`) |

When changing the schema, update both `src/config/schema.ts` (Zod) and `src/config/defaults.ts` (TypeScript interface + `DEFAULT_CONFIG`). Then ensure all config consumers are updated:
- `src/core/ModuleAgentSubsystem.ts` (unified config loading)
- `src/main/bridge.ts` `config:save` / `config:get` / `project:scan` (Electron path)
- `src/tui/bridge.ts` + `src/tui/config.ts` (TUI path)
- `src/cli/commands/setup.ts` (CLI interactive setup)

## Key directories

| Directory | Purpose |
|-----------|---------|
| `src/core/ModuleAgentCore.ts` | **Unified entry point** — composes ModuleAgentSubsystem + RoleAgentSubsystem. CoreCallbacks-based API for bridge layers. |
| `src/core/ModuleAgentSubsystem.ts` | Module agent lifecycle: init (scan+graph+MCP), start, send, cancel, routing. Merges old AgentOrchestrator + AgentManager + AgentRouter. |
| `src/core/RoleAgentSubsystem.ts` | Role agent lifecycle wrapper around RoleAgentManager. |
| `src/core/CoreTypes.ts` | `CoreCallbacks`, `CoreStatus`, `CoreMessage`, `InitResult`, `AgentInfo` — shared interfaces. |
| `src/core/` (other) | ModuleScanner, ModuleGraph, ModuleParser, ModuleGenerator, Logger, PathUtils, ExclusionRules |
| `src/main/index.ts` | Electron main process — window creation only. All agent logic delegated to `ElectronBridge`. |
| `src/main/bridge.ts` | **ElectronBridge** (228行) — 编排层，持有 HandlerContext 并委托给 11 个领域 handler。实现 IAgentBridge 接口。 |
| `src/main/handlers/` | **IPC handler 模块** — 每个领域一个文件，导出 `registerXxxHandlers(ctx)` 函数：agent/role/workflow/knowledge/project/config/context/migration/dialog/workspaceDiff |
| `src/main/handlers/HandlerContext.ts` | 共享上下文接口 — core, mainWindow, stateManager, diffCache, prompts, logger, summarizer, locks 等 |
| `src/main/handlers/sendPipeline.ts` | **共享 send 管道** — `agent:send` 与 `role:send` 的公共锁→流→保存逻辑提取为 `executeSendPipeline()` |
| `src/protocol/IpcChannels.ts` | **IPC 通道常量注册表** — 52 个 invoke/push 通道名集中定义；bridge.ts 和 preload 都必须引用此类常量 |
| `src/core/WorkspaceDiff.ts` | **工作区 Diff 引擎** — analyze / unifiedDiff / apply / discardWorkspace |
| `src/tui/bridge.ts` | **TuiBridge** — connects `ModuleAgentCore` to TUI SolidJS state via CoreCallbacks. Implements IAgentBridge. |
| `src/tui/renderer.tsx` | TUI entry point — creates TuiBridge, wires `globalThis.__tui*` hooks. |
| `src/renderer/src/` | Vue 3 renderer — views, components, Pinia stores, router |
| `src/preload/index.ts` | `contextBridge` API (`window.moduleAgent`) |
| `src/agents/AgentLauncher.ts` | Spawns agent subprocess, wraps in ACP ClientSideConnection |
| `src/agents/RoleAgentManager.ts` | Role agent lifecycle manager (used by RoleAgentSubsystem) |
| `src/agents/RoleWorkspace.ts` | Role workspace preparation: copies visible modules into `workrole/<name>/` |
| `src/agents/PromptBuilder.ts` | System prompt loading + ContentBlock building + dedup |
| `src/agents/McpServerBuilder.ts` | MCP server config building + graph file writing |
| `src/agents/WorkspaceIsolator.ts` | Module workspace isolation: prepare, resolve paths, sub-module discovery |
| `src/agents/McpBackend.ts` | MCP HTTP backend server for cross-module agent communication |
| `src/agents/AgentStateManager.ts` | Stream accumulation (reply/thinking/tools) + context file persistence |
| `src/protocol/acp/` | ACP connection + FsHandler + TerminalHandler |
| `src/protocol/mcp/` | MCP server (module agents) + RoleMCPServer (role agents) + CommunicationBus + server-entry |
| `src/config/` | ConfigLoader, schema (Zod), defaults |
| `src/context/` | ContextManager (in-memory cache) + FileStore (JSON persistence) |
| `config/` | System prompt markdown files: `mainagentprompt.md`, `subagentprompt.md`, `roleagentprompt.md` |
| `dist/mcp-server.cjs` | Self-contained MCP server bundle (module agents) |
| `dist/mcp-role-server.cjs` | Self-contained MCP server bundle (role agents) |

## Build details

- **Renderer**: `electron-vite` (Vite + Vue plugin) → `out/renderer/`
- **Main**: `electron-vite` → CJS to `out/main/`, externals: `electron`, `fs-extra`, `gray-matter`, `marked`, `simple-git`, `zod`, `@agentclientprotocol/sdk`, etc.
- **Preload**: `electron-vite` → CJS to `out/preload/`, external: `electron`
- **MCP server (module agents)**: `esbuild` → self-contained CJS bundle (all deps inlined) → `dist/mcp-server.cjs`
- **MCP server (role agents)**: `esbuild` → self-contained CJS bundle → `dist/mcp-role-server.cjs`
- **CLI**: `esbuild` → CJS bundle → `dist/cli.cjs`
- Output files in `out/` and `dist/` are gitignored
