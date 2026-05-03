# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install                           # Install dependencies
npm run build:electron                # Build all (renderer + main + preload + MCP server)
npm run electron                      # Build and launch Electron app
npx tsc --noEmit                      # Type-check only
npm run build:mcp-server              # Build MCP server bundle (dist/mcp-server.cjs) separately
npm run build:renderer                # Build renderer only
npm run build:main                    # Build main process only
```

`npm run dist` packages the app with electron-builder (Windows portable).

## Architecture Overview

ModuleAgent is an **Electron desktop app** that orchestrates external Agent CLI tools (Claude CLI, opencode, CodeBuddy) as child processes, one per module. It scans a project's `module.md` files to build a module tree, then spawns an Agent subprocess for each module, communicating via the **ACP protocol** (`@agentclientprotocol/sdk`). Cross-module communication happens through an **MCP server** that each Agent connects to.

### Key layers

**Electron main process** (`electron/main.ts`) — the central orchestrator. Handles IPC from the renderer, starts/stops Agent subprocesses, manages the MCP backend HTTP server, and coordinates cross-module calls. All Agent lifecycle logic lives here.

**Renderer** (`electron/renderer/`) — vanilla TypeScript UI (no framework). Renders an SVG module tree, a detail drawer with streaming Agent output, and a setup screen. Communicates with main via `contextBridge` API (`window.moduleAgent`).

**Preload** (`electron/preload.ts`) — exposes a typed API object via `contextBridge.exposeInMainWorld`. Defines all IPC channel signatures.

**Core** (`src/core/`) — module discovery and analysis:
- `ModuleScanner` — recursively walks directories finding `module.md` files, skipping builtin exclusions (node_modules, .git, dist, etc.)
- `ModuleParser` — parses `module.md` frontmatter (gray-matter) and markdown body (marked)
- `ModuleGraph` — builds an adjacency-list tree from scanned descriptors; root module (at project root) is required
- `ModuleGenerator` — auto-generates `module.md` content from directory structure
- `Logger` — file-based logger writing to `logs/` directory

**Agents** (`src/agents/`):
- `AgentLauncher` — spawns an Agent subprocess, wraps it in an ACP `ClientSideConnection`, auto-approves permissions, wires up FsHandler and TerminalHandler
- `AgentManager` — maps agent lifecycle; used by the non-Electron code paths (some TUI/CLI usage)
- `AgentRouter` — routes messages to the right module Agent by keyword match (`@modulename`), file path match, or defaults to main

**Protocol** (`src/protocol/`):
- `acp/connection.ts` — `createAgentConnection()`: spawns the Agent process, converts stdio to Web Streams, wraps in `ndJsonStream` + `ClientSideConnection`
- `acp/handlers/fs.ts` — `FsHandler`: workspace-restricted file read/write; enforces that paths stay within the module's allowed directories (own workspace + submodule dirs)
- `acp/handlers/terminal.ts` — `TerminalHandler`: manages terminal subprocesses for Agent tool calls
- `mcp/MCPServer.ts` — MCP server exposing `module_list`, `module_call`, `module_query`, `create_module` tools via stdio transport
- `mcp/CommunicationBus.ts` — routes cross-module messages; enforces access control (parent/child/sibling only); persists graph to JSON file

**CLI** (`src/cli/`) — standalone CLI (not the Electron path). Commands: `list`, `get`, `serve` (NDJSON stdio protocol), `tui` (interactive terminal UI).

### Data flow

1. User selects project directory in setup screen → `project:scan` IPC
2. Main process: `ModuleScanner.scan()` → `ModuleGraph.build()` → writes MCP graph file → starts HTTP backend
3. User clicks a module → `agent:start` IPC → `AgentLauncher.launch()` spawns Agent subprocess
4. Agent subprocess connects back to MCP server (configured via `newSession({ mcpServers })`)
5. User sends message → `agent:send` IPC → `connection.prompt()` with system prompt + module context + user text
6. Streaming updates flow: `sessionUpdate` → main → `agent:stream` IPC → renderer

### Critical details

- **Windows paths must be normalized**: `cwd.replace(/\\/g, '/')` before passing to Agent subprocesses — otherwise path resolution fails
- **MCP server bundle** (`dist/mcp-server.cjs`) path uses `app.getAppPath()`, not user project root
- **Map serialization**: when writing module graph to JSON for MCP server, `Map` must be converted to plain object; deserialized with `new Map(Object.entries(...))`
- **`McpServerStdio`** requires both `name` and `env` fields (Zod validation); `env` is `Array<{name, value}>` not `Record<string, string>`
- **Stream chunk structure**: `agent_thought_chunk` (thinking, gray italic), `agent_message_chunk` (reply text), `tool_call` (orange highlight) — content is nested at `notification.update.content.text`
- **First message per session** injects system prompt (`config/mainagentprompt.md` or `config/subagentprompt.md`) + module context (module.md body); subsequent messages are user text only
- **Cross-module calls** flow: Agent A → MCP tool `module_call` → MCP server → HTTP POST → Electron backend → Agent B's `connection.prompt()`

### Configuration

`.module-agent.json` at project root controls Agent command, args, exclude patterns, workspace path, and code source (git/local). Schema validated by Zod in `src/config/schema.ts`. Defaults in `src/config/defaults.ts` use `opencode acp`.

### Two code paths

The codebase has parallel implementations for Electron (primary) and CLI (secondary). `AgentManager` and `AgentRouter` in `src/agents/` are used by the CLI/TUI path; the Electron main process has its own inline agent management. The `DEVELOPMENT.md` docs note this as a known issue to consolidate.
