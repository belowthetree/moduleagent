# AGENTS.md

This file provides guidance to AI coding assistants when working in this repository.

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

## Architecture: two parallel code paths

The codebase has **two parallel implementations** for the same concepts:

- **Electron path** (primary): `src/main/index.ts` + `src/core/ModuleAgentCore.ts` orchestrates subsystems (`ModuleAgentSubsystem` / `RoleAgentSubsystem` / `WorkflowSubsystem`). Renderer is Vue 3 SFC components with Pinia state management and Element Plus UI library. Used by the real app.
- **CLI/TUI path** (secondary): `src/cli/` + `src/tui/`. Used by `module-agent serve` / `tui`.

Both paths share the same **in-process agent kernel** (`src/agents/`): `Agent` (lifecycle + busy queue) → `KernelFactory` → `AgentKernel` → `AgentLoop` (ai-sdk `generateText` loop). There is **no ACP / external agent subprocess** — agents are in-process LLM loops with built-in tools.

### Renderer architecture (Vue 3)

- **Views**: `SetupView.vue` (project config), `MainView.vue` (main workspace: left sidebar + drawer-selected tree/roles + central chat panel)
- **Key components**: `SVGTree.vue` (interactive module tree), `LeftSidebar.vue` (tab bar), `NodeDetailPanel.vue` (inline module detail + chat), `RolePanel.vue` (role agent cards), `RoleConfigDialog.vue` (role create/edit), `ContextCards.vue` (chat history, supports module/role context types), `ChatInput.vue`, `SettingsDialog.vue`, `ThemeToggle.vue`
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
- `src/tui/services/AgentService.ts` (TUI path)
- `src/main/index.ts` `config:save` / `config:get` / `project:scan` (Electron path)
- `src/cli/commands/setup.ts` (CLI interactive setup)

## Key directories

| Directory | Purpose |
|-----------|---------|
| `src/main/index.ts` | Electron main process — all IPC, agent lifecycle, MCP backend, role agent lifecycle |
| `src/renderer/src/` | Vue 3 renderer — views, components, Pinia stores, router |
| `src/preload/index.ts` | `contextBridge` API (`window.moduleAgent`) |
| `src/core/` | ModuleScanner, ModuleGraph, ModuleParser, Logger, PathUtils, TokenEstimator, RetryPolicy |
| `src/agents/Agent.ts` | Agent lifecycle (state machine + busy queue with ALS snapshot propagation) |
| `src/agents/KernelFactory.ts` | Spawns AgentKernel instances (in-process, no subprocess) |
| `src/agents/kernel/` | AgentLoop (ai-sdk generateText + snip/compact/truncate pipeline), tools, Sandbox, ProviderResolver |
| `src/agents/lifecycle/` | RoleAgentManager, WorkflowManager, WorkflowWorkspace |
| `src/agents/mcp/` | CrossModuleRouter (inter-module call routing + chain governance), CallChain, McpServerBuilder |
| `src/agents/prompts/` | PromptBuilder (Tier-1 summary injection, experience/patterns loading) |
| `src/agents/kernel/tools/` | Built-in tools: file_read, file_write, file_edit, search, list_files, execute_command, git_operations, module_call/query/list, module_context_read_* |
| `src/config/` | ConfigLoader, schema (Zod), defaults |
| `config/knowledge/` | System prompt markdown files (mainagent, subagent, roleagent) |

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
