# AGENTS.md

This file provides guidance to AI coding assistants when working in this repository.

## Build & verify

```bash
npm run build:electron   # Full build: renderer + main + preload + MCP server + CLI
npm run electron          # Build then launch Electron app
npx tsc --noEmit          # Type-check only (only validation — no linter or tests exist)
```

No `npm test`, no linter, no formatter. Type-check is the sole guardrail.

## Architecture: two parallel code paths

The codebase has **two parallel implementations** for the same concepts:

- **Electron path** (primary): `electron/main.ts` does agent management inline. Used by the real app.
- **CLI path** (secondary): `src/agents/AgentManager.ts` + `src/agents/AgentRouter.ts` + `src/cli/`. Used by `module-agent serve` / `tui`.

They share `AgentLauncher`, `ModuleScanner`, `ModuleGraph`, and the protocol layer. But agent lifecycle management is duplicated. When changing one path, check if the other needs the same change.

`docs/DEVELOPMENT.md` claims CLI was removed — this is **stale**. `src/cli/` still exists and is actively built via `npm run build:cli`.

## Critical gotchas

- **Windows path normalization**: Always call `cwd.replace(/\\/g, '/')` before passing cwd to Agent subprocesses. Already done in `AgentLauncher.launch()`.
- **Windows absolute paths on WSL/Linux**: `path.resolve('E:\\foo\\bar')` on Linux does NOT recognize the drive letter as absolute — it treats the whole thing as relative and prepends `cwd`. Use `normalizeCodeSourcePath()` from `src/core/PathUtils.ts` to convert `E:\foo\bar` → `/mnt/e/foo/bar` when `process.platform !== 'win32'`.
- **McpServerStdio env format**: Must be `Array<{name: string, value: string}>`, NOT `Record<string, string>`. Zod validation in the SDK rejects record types.
- **Stream chunk content path**: Content is at `notification.update.content.text`, not `notification.update.text`.
- **Map serialization**: Module graph uses `Map`. When serializing to JSON (for MCP graph file), convert to object with `Object.fromEntries(map)`. Deserialize with `new Map(Object.entries(obj))`.
- **MCP server bundle path**: Use `app.getAppPath()` (Electron app root), NOT the user's project root. The bundle lives at `dist/mcp-server.cjs` relative to this repo.
- **First message per session** injects system prompt (`config/mainagentprompt.md` or `config/subagentprompt.md`) + module context. Subsequent messages skip this. Tracked via `sessionPrompted` Set.

## Project config

`.module-agent.json` at the **user's project root** (not this repo's root) configures agent command, args, exclusions, workspace path, code source, and module discovery path. Schema in `src/config/schema.ts`. Note: the repo's own `.module-agent.json` is a sample for self-hosting.

### Config fields

| Field | Purpose |
|-------|---------|
| `agents.default.command` / `args` | Agent executable and arguments |
| `exclude` | Directory/pattern list to skip during module scanning |
| `workspace.path` | Where isolated workspace copies are created (Electron path) |
| `codeSource.type` / `path` | Source code location for workspace isolation (`local` or `git`) |
| `modulesPath` | **Module folder** — additional directory scanned for `module.md` files. Distinct from `codeSource.path` (which is for source isolation). When empty, falls back to `codeSource.path` for backward compatibility. |

When changing the schema, update both `src/config/schema.ts` (Zod) and `src/config/defaults.ts` (TypeScript interface + `DEFAULT_CONFIG`). Then ensure all three config consumers are updated:
- `src/tui/services/AgentService.ts` (TUI path)
- `electron/main.ts` `config:save` / `config:get` / `project:scan` (Electron path)
- `src/cli/commands/setup.ts` (CLI interactive setup)

## Key directories

| Directory | Purpose |
|-----------|---------|
| `electron/main.ts` | Electron main process — all IPC, agent lifecycle, MCP backend |
| `electron/renderer/` | Vanilla TypeScript UI (no framework) |
| `electron/preload.ts` | `contextBridge` API (`window.moduleAgent`) |
| `src/core/` | ModuleScanner, ModuleGraph, ModuleParser, Logger, PathUtils |
| `src/agents/AgentLauncher.ts` | Spawns agent subprocess, wraps in ACP ClientSideConnection |
| `src/protocol/acp/` | ACP connection + FsHandler + TerminalHandler |
| `src/protocol/mcp/` | MCP server + CommunicationBus + server-entry.ts |
| `src/config/` | ConfigLoader, schema (Zod), defaults |
| `config/` | System prompt markdown files |
| `dist/mcp-server.cjs` | Self-contained MCP server bundle (spawned by agents) |

## Build details

- **Renderer**: `esbuild` → IIFE for browser (`electron/renderer/renderer.js`)
- **Main**: `esbuild` → CJS, externals: `electron`, `fs-extra`, `gray-matter`, `marked`, `simple-git`, `zod`, `@agentclientprotocol/sdk`, etc.
- **Preload**: `esbuild` → CJS, external: `electron`
- **MCP server**: `esbuild` → self-contained CJS bundle (all deps inlined)
- Output files are gitignored (`.cjs`, `.js`, `.js.map` in electron/ and src/)
