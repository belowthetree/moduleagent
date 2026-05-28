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

- **Electron path** (primary): `src/main/index.ts` does agent management inline via `AgentOrchestrator`/`McpBackendServer`. Renderer is Vue 3 SFC components with Pinia state management and Element Plus UI library. Used by the real app.
- **CLI path** (secondary): `src/agents/AgentManager.ts` + `src/agents/AgentRouter.ts` + `src/cli/`. Used by `module-agent serve` / `tui`.

They share `AgentLauncher`, `ModuleScanner`, `ModuleGraph`, and the protocol layer. But agent lifecycle management is duplicated. When changing one path, check if the other needs the same change.

`docs/DEVELOPMENT.md` claims CLI was removed — this is **stale**. `src/cli/` still exists and is actively built via `pnpm run build:cli`.

### Renderer architecture (Vue 3)

- **Views**: `SetupView.vue` (project config), `MainView.vue` (main workspace: left sidebar + drawer-selected tree/roles + central chat panel)
- **Key components**: `SVGTree.vue` (interactive module tree), `LeftSidebar.vue` (tab bar), `NodeDetailPanel.vue` (inline module detail + chat), `RolePanel.vue` (role agent cards), `RoleConfigDialog.vue` (role create/edit), `ContextCards.vue` (chat history, supports module/role context types), `ChatInput.vue`, `SettingsDialog.vue`, `ThemeToggle.vue`
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

## Project config

`.module-agent.json` at the **user's project root** (not this repo's root) configures the agent command, args, exclusions, and project root. Schema in `src/config/schema.ts`. Note: the repo's own `.module-agent.json` is a sample for self-hosting.

### Config fields

| Field | Purpose |
|-------|---------|
| `agents.default.command` / `args` | Agent executable and arguments |
| `agents.modules` | Per-module agent command overrides |
| `exclude` | Directory/pattern list to skip during module scanning |
| `projectPath` | Root project directory |
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
| `src/core/` | ModuleScanner, ModuleGraph, ModuleParser, Logger, PathUtils |
| `src/agents/AgentLauncher.ts` | Spawns agent subprocess, wraps in ACP ClientSideConnection |
| `src/agents/AgentOrchestrator.ts` | Module agent lifecycle orchestrator |
| `src/agents/RoleAgentManager.ts` | Role agent lifecycle manager (parallel to AgentOrchestrator) |
| `src/agents/RoleWorkspace.ts` | Role workspace preparation |
| `src/protocol/acp/` | ACP connection + FsHandler + TerminalHandler |
| `src/protocol/mcp/` | MCPServer + RoleMCPServer + CommunicationBus + server entries |
| `src/config/` | ConfigLoader, schema (Zod), defaults |
| `config/` | System prompt markdown files (mainagent, subagent, roleagent) |
| `dist/mcp-server.cjs` | MCP server bundle for module agents |
| `dist/mcp-role-server.cjs` | MCP server bundle for role agents |

### Runtime directories (created under user's project root)

| Directory | Purpose |
|-----------|---------|
| `.module-agent/` | All runtime data for a project |
| `.module-agent/module/` | Module `.md` files — the definitive location for all module documentation |
| `.module-agent/workspace/` | Isolated runtime copies of source code for agent execution |
| `.module-agent/workspace/workrole/` | Role agent workspaces (copies of visible module dirs) |
| `.module-agent/context/` | Agent conversation context storage |
| `.module-agent.json` | Project configuration file |

## Build details

- **Renderer**: `electron-vite` (Vite + Vue plugin) → `out/renderer/`
- **Main**: `electron-vite` → CJS to `out/main/`, externals: `electron`, `fs-extra`, `gray-matter`, `marked`, `simple-git`, `zod`, `@agentclientprotocol/sdk`, etc.
- **Preload**: `electron-vite` → CJS to `out/preload/`, external: `electron`
- **MCP server (module agents)**: `esbuild` → self-contained CJS bundle → `dist/mcp-server.cjs`
- **MCP server (role agents)**: `esbuild` → self-contained CJS bundle → `dist/mcp-role-server.cjs`
- **CLI**: `esbuild` → CJS bundle → `dist/cli.cjs`
- Output files in `out/` and `dist/` are gitignored
