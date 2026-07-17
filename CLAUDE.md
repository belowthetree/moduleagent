# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & verify

```bash
pnpm run dev              # Dev mode with Vite HMR (renderer + main + preload with hot reload)
pnpm run build:electron   # Full production build: electron-vite + CLI
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
  - `src/main/bridge.ts` — `ElectronBridge`: holds `HandlerContext`, delegates to 11 domain handlers
  - `src/main/handlers/` — domain IPC handler modules: `agentHandlers`, `roleHandlers`, `workflowHandlers`, `knowledgeHandlers`, `projectHandlers`, `configHandlers`, `contextHandlers`, `migrationHandlers`, `dialogHandlers`, `workspaceDiffHandlers`
  - `src/main/handlers/HandlerContext.ts` — shared context interface (14 fields + 2 methods)
  - `src/main/handlers/sendPipeline.ts` — `agent:send` / `role:send` shared lock→stream→save pipeline
  - `src/protocol/IpcChannels.ts` — 52 IPC channel names centralized constant registry
  - `src/tui/bridge.ts` — `TuiBridge`: translates CoreCallbacks → SolidJS signals
  - Both bridges implement `IAgentBridge` interface (defined in `CoreTypes.ts`)
- **UI layer**: Pure presentation
  - Electron: `src/main/index.ts` (window creation only), Vue 3 renderer in `src/renderer/src/`
  - TUI: `src/tui/renderer.tsx` (OpenTUI startup), SolidJS components in `src/tui/components/`
- **Agent kernel**: In-process LLM loop — `Agent` (lifecycle + busy queue) → `KernelFactory` → `AgentKernel` → `AgentLoop` (ai-sdk `generateText`). No ACP/MCP subprocesses.

The old duplication between `AgentOrchestrator` (Electron) and `AgentManager`/`AgentRouter` (CLI/TUI) has been eliminated. Both paths now share the same `ModuleAgentCore` instance via their respective bridges.

Communication pattern: Core exposes `CoreCallbacks` interface (callback injection). Bridges implement callbacks and translate them to framework-specific signals. Core has zero knowledge of IPC, SolidJS, Vue, or any transport mechanism.

### Renderer architecture (Vue 3)

- **Views**: `SetupView.vue` (project config), `MainView.vue` (main workspace with left sidebar + module tree drawer + role agent drawer + central chat panel)
- **Key components**: `SVGTree.vue` (interactive module dependency graph), `LeftSidebar.vue` (tab bar: tree / roles), `NodeDetailPanel.vue` (inline module detail + chat), `RolePanel.vue` (role agent cards), `RoleConfigDialog.vue` (role create/edit dialog), `ContextCards.vue` (chat history), `ChatInput.vue` (message input), `SettingsDialog.vue`, `ThemeToggle.vue`
- **State management**: Pinia stores in `src/renderer/src/stores/` — `configStore`, `projectStore`, `agentStore` (includes role agent state)
- **UI library**: Element Plus for dialogs, buttons, forms, notifications
- **Routing**: Vue Router with setup and main workspace routes

## Critical gotchas

- **Windows path normalization**: Always call `cwd.replace(/\\/g, '/')` before passing cwd to kernels. Done in `KernelFactory.create()`.
- **Windows absolute paths on WSL/Linux**: `path.resolve('E:\\foo\\bar')` on Linux does NOT recognize the drive letter as absolute — it treats the whole thing as relative and prepends `cwd`. Use `normalizeCodeSourcePath()` from `src/core/PathUtils.ts` to convert `E:\foo\bar` → `/mnt/e/foo/bar` when `process.platform !== 'win32'`.
- **CSP in main process**: Content Security Policy is set in `src/main/index.ts` via `session.defaultSession.webRequest.onHeadersReceived()`, NOT in HTML `<meta>` tags. For dev mode (Vite HMR), the CSP must allow `ws://` and inline scripts for HMR to function.
- **`@` alias paths**: In renderer (Vue components), `@` resolves to `src/renderer/src/`. In main process, `@` resolves to `src/`. These are configured separately in `electron.vite.config.ts`.
- **Map serialization**: Module graph uses `Map`. When serializing to JSON, convert to object with `Object.fromEntries(map)`. Deserialize with `new Map(Object.entries(obj))`.
- **System prompt vs first message**: System prompts (mainagent/subagent/roleagent) are injected as a **separate `system` role message** via `Agent.start({ systemPrompt })` (prefix-cache pinning) — do NOT also inject them into the first user message. The first user message carries module context only (Tier-1 summary when `progressiveDisclosure` is on). Tracked via `sessionPrompted` Set.
- **Context pipeline in AgentLoop.send()**: ordered as **snip (60%, zero-LLM) → compact (70%, fastModel summary) → truncate (80%, tail-token-budget)**. Dropped content is archived to `.module-agent/archives/<module>/*.jsonl` via `ArchiveWriter`.
- **Cross-module calls**: `module_call`/`module_query` route through `CrossModuleRouter.routeCall` → `Agent.send` queue (never `kernel.send` directly — that re-enters `AgentLoop.messages`). Call chain propagates via `AsyncLocalStorage` (`src/agents/mcp/CallChain.ts`), including across the Agent busy queue via `AsyncLocalStorage.snapshot()`. Cycle detection + `crossModule.maxHops` (default 3) + wait-for deadlock detection + `crossModule.timeoutMs` (default 120s).
- **LLM retry safety**: outer retry of `generateText` is gated on `stepsCompleted === 0` — retrying after a completed step would re-execute side-effect tools (`file_write` etc.).
- **Config plumbing gap class of bug**: new AgentLoop features need plumbing through the full chain `schema.ts → defaults.ts → ModuleAgentSubsystem.resolveAgentConfig/_startAgentInternal → Agent.start → KernelFactory.create → AgentKernel → AgentLoopConfig`. Missing any link silently disables the feature.

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
- `src/agents/prompts/system.ts` — `loadSystemPrompts(configDir)` reads `.md` files from resolved `configDir`

## Project config

`.module-agent.json` at the **user's project root** (not this repo's root) configures the agent command, args, exclusions, and project root. Schema in `src/config/schema.ts`. Note: the repo's own `.module-agent.json` is a sample for self-hosting.

### Config fields

| Field | Purpose |
|-------|---------|
| `agents.default.command` / `args` | Agent executable and arguments |
| `agents.default.model` / `fastModel` / `provider` / `apiKey` / `baseUrl` / `maxTokens` / `contextWindow` | LLM settings (per-module overrides via `agents.modules`) |
| `exclude` | Directory/pattern list to skip during module scanning |
| `projectPath` | Root project directory |
| `truncation` | History truncation: `contextWindow` / `truncateRatio` (0.8) / `tailTokenBudget` (16384) / `minKeepMessages` / `snipRatio` (0.6) |
| `compaction` | Online compaction: `enabled` (requires `fastModel`) / `compactRatio` / `tailTokenBudget` / `minIntervalMs` |
| `crossModule` | Cross-module call limits: `maxHops` (3) / `timeoutMs` (120000) |
| `contextHistoryLimit` | SessionStore per-module persisted message cap (default 200) |
| `progressiveDisclosure` | First-message Tier-1 summary only; full docs via `module_context_*` tools (default true) |
| `roles` | Array of role agent configs (name, description, visibleModulePaths, agents.default) |

When changing the schema, update both `src/config/schema.ts` (Zod) and `src/config/defaults.ts` (TypeScript interface + `DEFAULT_CONFIG`). Then ensure all config consumers are updated:
- `src/core/ModuleAgentSubsystem.ts` (unified config loading)
- `src/main/bridge.ts` `config:save` / `config:get` / `project:scan` (Electron path)
- `src/tui/bridge.ts` + `src/tui/config.ts` (TUI path)
- `src/cli/commands/setup.ts` (CLI interactive setup)

## Key directories

| Directory | Purpose |
|-----------|---------|
| `src/core/ModuleAgentCore.ts` | **Unified entry point** — composes ModuleAgentSubsystem + RoleAgentSubsystem. CoreCallbacks-based API for bridge layers. |
| `src/core/ModuleAgentSubsystem.ts` | Module agent lifecycle: init (scan+graph), start, send, cancel, routing |
| `src/core/RoleAgentSubsystem.ts` | Role agent lifecycle wrapper around RoleAgentManager |
| `src/core/CoreTypes.ts` | `CoreCallbacks`, `CoreStatus`, `CoreMessage`, `InitResult`, `AgentInfo` — shared interfaces |
| `src/core/` (other) | ModuleScanner, ModuleGraph, ModuleParser, ModuleGenerator, Logger, PathUtils, TokenEstimator, RetryPolicy, ExclusionRules |
| `src/main/index.ts` | Electron main process — window creation only |
| `src/main/bridge.ts` | **ElectronBridge** — orchestrates IPC handler registration |
| `src/main/handlers/` | **IPC handler modules** — one file per domain: agent/role/workflow/knowledge/project/config/context/migration/dialog/workspaceDiff |
| `src/main/handlers/HandlerContext.ts` | Shared context interface — core, mainWindow, stateManager, diffCache, prompts, logger, summarizer, locks |
| `src/main/handlers/sendPipeline.ts` | **Shared send pipeline** — `agent:send` / `role:send` common lock→stream→save logic |
| `src/protocol/IpcChannels.ts` | **IPC channel constant registry** — 52 invoke/push channel names |
| `src/core/WorkspaceDiff.ts` | **Workspace diff engine** — analyze / unifiedDiff / apply / discardWorkspace |
| `src/tui/bridge.ts` | **TuiBridge** — connects `ModuleAgentCore` to TUI SolidJS state via CoreCallbacks |
| `src/renderer/src/` | Vue 3 renderer — views, components, Pinia stores, router |
| `src/preload/index.ts` | `contextBridge` API (`window.moduleAgent`) |
| `src/agents/Agent.ts` | Agent lifecycle: state machine + busy queue with ALS snapshot propagation |
| `src/agents/KernelFactory.ts` | Spawns AgentKernel instances (in-process, no subprocess) |
| `src/agents/kernel/` | AgentLoop (ai-sdk generateText + snip/compact/truncate pipeline), tools, Sandbox, ProviderResolver |
| `src/agents/lifecycle/` | RoleAgentManager, WorkflowManager, WorkflowWorkspace |
| `src/agents/mcp/` | CrossModuleRouter (inter-module call routing + chain governance), CallChain, McpServerBuilder |
| `src/agents/prompts/` | PromptBuilder (Tier-1 summary injection, experience/patterns loading) |
| `src/agents/kernel/tools/` | Built-in tools: file_read, file_write, file_edit, search, list_files, execute_command, git_operations, module_call/query/list, module_context_read_* |
| `src/config/` | ConfigLoader, schema (Zod), defaults |
| `src/context/` | ContextManager (in-memory cache) + FileStore (JSON persistence) |
| `config/knowledge/` | System prompt markdown files: `mainagentprompt.md`, `subagentprompt.md`, `roleagentprompt.md` |

### Runtime directories (created under user's project root)

| Directory | Purpose |
|-----------|---------|
| `.module-agent/` | All runtime data for a project |
| `.module-agent/module/` | Module `.md` files — the definitive location for all module documentation |
| `.module-agent/workspace/` | Isolated runtime copies of source code for workflow step execution |
| `.module-agent/context/` | Agent conversation context storage (capped: 200 msgs / 5MB per module) |
| `.module-agent/archives/` | Dropped content archives: snip results, compact foldables, truncated messages, context overflow |
| `.module-agent.json` | Project configuration file |

## Build details

- **Renderer**: `electron-vite` (Vite + Vue plugin) → `out/renderer/`
- **Main**: `electron-vite` → CJS to `out/main/`, externals: `electron`, `fs-extra`, `gray-matter`, `marked`, `simple-git`, `zod`, `@agentclientprotocol/sdk`, etc.
- **Preload**: `electron-vite` → CJS to `out/preload/`, external: `electron`
- **CLI**: `esbuild` → CJS bundle → `dist/cli.cjs`
- Output files in `out/` and `dist/` are gitignored
- There are no separate MCP server bundles. Kernel tools run in-process within the AgentLoop.
