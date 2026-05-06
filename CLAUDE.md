# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & verify

```bash
npm run dev               # Dev mode with Vite HMR (renderer + main + preload with hot reload)
npm run build:electron    # Full production build: electron-vite + MCP server + CLI
npm run electron          # Build then launch Electron app
npm run typecheck         # Type-check only (no emit)
npm run test              # Vitest unit/component tests
npm run test:e2e          # Playwright end-to-end tests
```

Type-check (`npm run typecheck`) is the primary guardrail. No linter or formatter configured.

## Architecture: two parallel code paths

The codebase has **two parallel implementations** for the same concepts:

- **Electron path** (primary): `src/main/index.ts` does agent management inline via `AgentOrchestrator`/`McpBackendServer`. Renderer is Vue 3 SFC components with Pinia state management and Element Plus UI library. Used by the real app.
- **CLI path** (secondary): `src/agents/AgentManager.ts` + `src/agents/AgentRouter.ts` + `src/cli/`. Used by `module-agent serve` / `tui`.

They share `AgentLauncher`, `ModuleScanner`, `ModuleGraph`, and the protocol layer. But agent lifecycle management is duplicated. When changing one path, check if the other needs the same change.

`docs/DEVELOPMENT.md` claims CLI was removed — this is **stale**. `src/cli/` still exists and is actively built via `npm run build:cli`.

### Renderer architecture (Vue 3)

- **Views**: `SetupView.vue` (project config), `MainView.vue` (main workspace with module tree + agent chat)
- **Key components**: `SVGTree.vue` (interactive module dependency graph), `DrawerPanel.vue` (side drawer), `StreamArea.vue` (streaming agent output), `ChatInput.vue` (message input), `ContextCards.vue` (module context cards), `SettingsDialog.vue`, `ThemeToggle.vue`, `MessageModal.vue`
- **State management**: Pinia stores in `src/renderer/src/stores/` — `configStore`, `projectStore`, `agentStore`
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
| `exclude` | Directory/pattern list to skip during module scanning |
| `projectPath` | Root project directory. `.module-agent/module/` and `.module-agent/workspace/` are auto-created here |

When changing the schema, update both `src/config/schema.ts` (Zod) and `src/config/defaults.ts` (TypeScript interface + `DEFAULT_CONFIG`). Then ensure all config consumers are updated:
- `src/tui/services/AgentService.ts` (TUI path)
- `src/main/index.ts` `config:save` / `config:get` / `project:scan` (Electron path)
- `src/cli/commands/setup.ts` (CLI interactive setup)

## Key directories

| Directory | Purpose |
|-----------|---------|
| `src/main/index.ts` | Electron main process — all IPC, agent lifecycle, MCP backend |
| `src/renderer/src/` | Vue 3 renderer — views, components, Pinia stores, router |
| `src/preload/index.ts` | `contextBridge` API (`window.moduleAgent`) |
| `src/core/` | ModuleScanner, ModuleGraph, ModuleParser, Logger, PathUtils |
| `src/agents/AgentLauncher.ts` | Spawns agent subprocess, wraps in ACP ClientSideConnection |
| `src/protocol/acp/` | ACP connection + FsHandler + TerminalHandler |
| `src/protocol/mcp/` | MCP server + CommunicationBus + server-entry.ts |
| `src/config/` | ConfigLoader, schema (Zod), defaults |
| `config/` | System prompt markdown files |
| `dist/mcp-server.cjs` | Self-contained MCP server bundle (spawned by agents) |

## Build details

- **Renderer**: `electron-vite` (Vite + Vue plugin) → `out/renderer/`
- **Main**: `electron-vite` → CJS to `out/main/`, externals: `electron`, `fs-extra`, `gray-matter`, `marked`, `simple-git`, `zod`, `@agentclientprotocol/sdk`, etc.
- **Preload**: `electron-vite` → CJS to `out/preload/`, external: `electron`
- **MCP server**: `esbuild` → self-contained CJS bundle (all deps inlined) → `dist/mcp-server.cjs`
- **CLI**: `esbuild` → CJS bundle → `dist/cli.cjs`
- Output files in `out/` and `dist/` are gitignored
