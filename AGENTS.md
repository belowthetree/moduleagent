# AGENTS.md

This file provides guidance to AI coding assistants when working in this repository.

## Build & verify

```bash
npm run dev:renderer       # Frontend-only Vite dev server (port 5173)
npm run dev                # Web mode: frontend + backend Sidecar (no desktop shell)
npm run tauri:dev          # Tauri dev mode: Vite HMR + Tauri window + Sidecar
npm run tauri:build        # Production Tauri build (frontend + Sidecar + Rust)
npm run build:backend      # Build Sidecar bundles (esbuild): server.cjs + MCP servers
npm run build:renderer     # Build frontend (Vite → dist-renderer/)
npm run typecheck          # Type-check only (no emit)
npm run test               # Vitest unit/component tests
```

Type-check (`npm run typecheck`) is the primary guardrail. No linter or formatter configured.

## Architecture: Tauri + Node.js Sidecar + Vue 3

The codebase has a **three-layer architecture**:

- **Desktop shell** (`src-tauri/`): Tauri 2 (Rust) — window management, native APIs (dialog/shell/fs), Sidecar process launch
- **Backend** (`src-backend/`): Node.js HTTP/SSE server — Agent orchestration, module scanning, MCP routing, config management. Runs as a **Sidecar** subprocess spawned by Tauri.
- **Frontend** (`src-renderer/`): Vue 3 SFC + Pinia + Element Plus — UI components, state management, module tree visualization

Communication between frontend and backend uses **HTTP + SSE** (replacing old Electron IPC):
- Frontend → Backend: `fetch()` POST requests with JSON body
- Backend → Frontend: SSE (Server-Sent Events) on `/api/stream` for streaming updates

Sidecar startup flow:
1. Tauri `setup()` spawns `node dist-backend/server.cjs`
2. Sidecar writes `READY:<port>` to stdout
3. Tauri reads the port, stores it in app state
4. Frontend invokes `get_sidecar_port` Tauri command, then connects via HTTP + SSE

### Process model

```
┌──────────────────────┐     HTTP + SSE     ┌──────────────────────┐
│   Tauri (Rust)       │◄──────────────────►│  Vue 3 WebView       │
│   Window + API       │                    │  (frontend UI)       │
│          │           │                    │                      │
│    spawn │           │                    │  fetch() + SSE       │
│          ▼           │                    │                      │
│   Node.js Sidecar    │◄───────────────────┘                      │
│   (src-backend/)     │   127.0.0.1:port                          │
└──────────────────────┘                                          │
         │ ACP stdio                                               │
         ▼                                                         │
   Agent subprocesses (opencode/claude)                            │
         │ MCP stdio                                               │
         ▼                                                         │
   MCP Server subprocesses                                         │
```

### Key layers

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Desktop | `src-tauri/` | Window, native APIs, Sidecar lifecycle |
| Backend | `src-backend/server.ts` + `src-backend/agents/`, `core/`, `protocol/` | HTTP/SSE API, agent lifecycle, module graph, MCP routing |
| Frontend | `src-renderer/` | Vue components, Pinia stores, router |
| Config | `src-backend/config/` | ConfigLoader, Zod schema, defaults |
| Protocol | `src-backend/protocol/` | ACP connection + MCP servers + tools |

## Critical gotchas

- **Windows path normalization**: Always call `cwd.replace(/\\/g, '/')` before passing cwd to Agent subprocesses. Already done in `AgentLauncher.launch()`.
- **Windows absolute paths on WSL/Linux**: `path.resolve('E:\\foo\\bar')` on Linux does NOT recognize the drive letter as absolute — it treats the whole thing as relative and prepends `cwd`. Use `normalizeCodeSourcePath()` from `src-backend/core/PathUtils.ts` to convert `E:\foo\bar` → `/mnt/e/foo/bar` when `process.platform !== 'win32'`.
- **Sidecar env format for MCP servers**: Must be `Array<{name: string, value: string}>`, NOT `Record<string, string>`. Zod validation in the SDK rejects record types.
- **Stream chunk content path**: Content is at `notification.update.content.text`, not `notification.update.text`.
- **Map serialization**: Module graph uses `Map`. When serializing to JSON (for MCP graph file), convert to object with `Object.fromEntries(map)`. Deserialize with `new Map(Object.entries(obj))`.
- **MCP server bundle path**: Use Tauri's resource directory (or `dist-backend/` relative to project root), NOT the user's project root. The bundle lives at `dist-backend/mcp-server.cjs`.
- **First message per session** injects system prompt (`config/mainagentprompt.md` or `config/subagentprompt.md`) + module context. Subsequent messages skip this. Tracked via `sessionPrompted` Set.
- **SSE vs IPC**: The old Electron architecture used `ipcRenderer.invoke` / `ipcMain.handle` for requests and `webContents.send` for streaming. The new Tauri architecture uses `fetch()` for requests and `EventSource` (SSE) for streaming. Frontend code in `src-renderer/composables/useApi.ts` wraps this.

## Project config

`.module-agent.json` at the **user's project root** (not this repo's root) configures the agent command, args, exclusions, and project root. Schema in `src-backend/config/schema.ts`. Note: the repo's own `.module-agent.json` is a sample for self-hosting.

### Config fields

| Field | Purpose |
|-------|---------|
| `agents.default.command` / `args` | Agent executable and arguments |
| `agents.modules` | Per-module agent command overrides |
| `exclude` | Directory/pattern list to skip during module scanning |
| `projectPath` | Root project directory |
| `roles` | Array of role agent configs (name, description, visibleModulePaths, agents.default) |

When changing the schema, update both `src-backend/config/schema.ts` (Zod) and `src-backend/config/defaults.ts` (TypeScript interface + `DEFAULT_CONFIG`). Then ensure all config consumers are updated:
- `src-backend/server.ts` (Sidecar API — config:save / config:get / project:scan)
- `src-renderer/composables/useApi.ts` (frontend API layer)

## Key directories

| Directory | Purpose |
|-----------|---------|
| `src-tauri/` | Tauri Rust backend — window, Sidecar launcher, native plugins |
| `src-backend/server.ts` | HTTP/SSE server entry — all API routes, agent lifecycle, MCP backend, role agent lifecycle |
| `src-backend/agents/` | AgentLauncher, AgentStateManager, McpBackend, McpServerBuilder, PromptBuilder, RoleAgentManager, RoleWorkspace, WorkflowManager, WorkspaceIsolator |
| `src-backend/config/` | ConfigLoader, schema (Zod), defaults |
| `src-backend/core/` | ModuleScanner, ModuleGraph, ModuleParser, ModuleGenerator, ModuleAgentCore, Logger, PathUtils, ConfigPaths, ExclusionRules, ExperienceSummarizer |
| `src-backend/protocol/acp/` | ACP connection + FsHandler + TerminalHandler |
| `src-backend/protocol/mcp/` | MCPServer + RoleMCPServer + CommunicationBus + server entries |
| `src-renderer/` | Vue 3 frontend — views, components, Pinia stores, router |
| `config/` | System prompt markdown files (mainagent, subagent, roleagent) |
| `dist-backend/` | Sidecar build output: server.cjs, mcp-server.cjs, mcp-role-server.cjs |

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

- **Frontend (renderer)**: Vite + Vue plugin → `dist-renderer/` (static files)
- **Sidecar backend**: esbuild → self-contained CJS bundles → `dist-backend/server.cjs`, `dist-backend/mcp-server.cjs`, `dist-backend/mcp-role-server.cjs`
- **Tauri desktop**: Cargo build → native executable (embeds `dist-renderer/` + bundles `dist-backend/` + `config/` as resources)
- Output files in `dist-backend/`, `dist-renderer/`, and `src-tauri/target/` are gitignored
