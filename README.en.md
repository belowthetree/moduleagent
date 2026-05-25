# ModuleAgent

**Modular Agent Orchestration Framework** — Organize your project into modules using `module.md` files, launch independent Agent subprocesses for each module, and enable cross-module collaboration via the MCP protocol.

## Key Features

- **Module-based Agent Architecture** — Each module has its own dedicated Agent process focused on its specific responsibilities
- **ACP Protocol Communication** — Bidirectional communication with Agent subprocesses via `@agentclientprotocol/sdk`
- **Cross-module Collaboration** — Agents can call and query each other using the MCP protocol (`@modelcontextprotocol/sdk`)
- **Role Agents** — Cross-cutting specialized Agents with configurable module visibility, ideal for architecture review, documentation, and other cross-module tasks
- **Interactive Module Tree** — SVG-rendered module dependency graph with collapsible nodes and selection
- **Workspace Isolation** — Each Agent gets an isolated copy of its source code, preventing interference
- **Streaming Conversations** — Real-time display of Agent thinking, tool calls, and responses
- **Automatic Module Generation** — Analyze source directories and auto-generate `module.md` files via Agent

## Prerequisites

- Node.js >= 20
- Rust toolchain (for Tauri builds, optional)
- An ACP-compatible Agent client (e.g., [opencode](https://github.com/opencode-ai/opencode) or Claude CLI)

## Quick Start

### Desktop App (Tauri)

```bash
# Clone the repository
git clone https://github.com/belowthetree/module-agent.git
cd module-agent

# Install dependencies
npm install

# Development mode (Vite HMR + Tauri window + Node.js sidecar backend)
npm run tauri:dev

# Production build
npm run tauri:build
```

### Web Mode (frontend + backend only, no desktop shell)

```bash
npm run dev
```

After starting, the Vite dev server runs at `http://localhost:5173` and the backend API runs on a random port (communicated via SSE).

### Configuration

Create `.module-agent.json` in your project root:

```json
{
  "agents": {
    "default": {
      "command": "opencode",
      "args": ["acp"]
    }
  },
  "exclude": ["node_modules", ".git", "dist"],
  "projectPath": "."
}
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Tauri (Rust)                      │
│  ┌───────────────────────────────────────────────┐  │
│  │               WebView (Vue 3)                  │  │
│  │  SetupView / MainView / SVGTree / ChatInput    │  │
│  │  Pinia stores · Element Plus · Vue Router      │  │
│  │  ┌─────────────────────────────────────────┐   │  │
│  │  │  HTTP + SSE → http://127.0.0.1:{port}   │   │  │
│  │  └─────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────┘  │
│                          ↕                           │
│  ┌───────────────────────────────────────────────┐  │
│  │          Node.js Sidecar (src-backend/)        │  │
│  │  HTTP/SSE Server · Agent Orchestration         │  │
│  │  ModuleScanner · ModuleGraph · ConfigLoader    │  │
│  │  McpBackend · RoleAgentManager                 │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│               Agent Layer (ACP Protocol)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │           │
│  │ (ModuleA)│  │ (ModuleB)│  │ (ModuleC)│           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │                │
│  ┌────┴──────────────┴──────────────┴────┐           │
│  │  MCP Server Subprocess (stdio)         │           │
│  │  (dist-backend/mcp-server.cjs)         │           │
│  └────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| Desktop Shell | Tauri (Rust) | Window management, native APIs (file dialogs), Sidecar process management |
| Frontend | Vue 3 + Pinia + Element Plus | Module tree visualization, chat UI, state management |
| Backend | Node.js (Sidecar) | Agent lifecycle management, HTTP/SSE API, MCP routing |
| Agent Layer | opencode / Claude (ACP) | LLM reasoning, file operations, terminal commands |

For a detailed architecture analysis, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project Structure

```
ModuleAgent/
├── src-tauri/                     # Tauri Rust backend
│   ├── src/lib.rs                 # Tauri app logic, Sidecar launcher
│   └── tauri.conf.json            # Tauri configuration
├── src-backend/                   # Node.js Sidecar backend
│   ├── server.ts                  # HTTP/SSE server entry
│   ├── agents/                    # Agent orchestration (launch, state, prompt building)
│   ├── config/                    # Config loading, Zod validation
│   ├── core/                      # Module scanning, parsing, graph building, path utilities
│   ├── protocol/                  # ACP connection + MCP servers
│   └── types/                     # Type definitions
├── src-renderer/                  # Vue 3 frontend
│   ├── views/                     # SetupView, MainView
│   ├── components/                # SVGTree, ChatInput, RolePanel, etc.
│   ├── stores/                    # Pinia state management
│   └── router/                    # Vue Router
├── config/                        # Agent system prompts
│   ├── mainagentprompt.md
│   ├── subagentprompt.md
│   └── roleagentprompt.md
├── dist-backend/                  # Sidecar build output
└── dist-renderer/                 # Frontend build output
```

## Module System

Modules are defined by `module.md` files with YAML frontmatter (name, description, submodule references) and Markdown body (API docs, dependencies, architecture notes).

```
.module-agent/
├── module/            ← All module.md files live here
│   ├── module.md      ← Root module
│   ├── src/
│   │   └── core/
│   │       └── module.md
│   └── config/
│       └── module.md
├── workspace/         ← Isolated workspace copies (Agent runtime)
├── workrole/          ← Role Agent workspaces
└── context/           ← Conversation history persistence
```

## Role Agents

Role Agents are cross-cutting specialized Agents that can access multiple modules' source code. Useful for documentation, architecture review, and other cross-module tasks.

```json
{
  "roles": [
    {
      "name": "architect",
      "description": "Architecture review agent",
      "visibleModulePaths": ["src/core", "src/agents"],
      "agents": {
        "default": { "command": "opencode", "args": ["acp"] }
      }
    }
  ]
}
```

## Development Commands

```bash
npm run tauri:dev          # Tauri dev mode (Vite HMR + desktop window + Sidecar)
npm run tauri:build        # Tauri production build
npm run dev                # Web dev mode (frontend + Sidecar only, no desktop shell)
npm run dev:renderer       # Frontend-only Vite dev server
npm run typecheck          # Type checking (tsc --noEmit)
npm run test               # Unit tests (Vitest)
npm run build:backend      # Build Sidecar (esbuild)
npm run build:renderer     # Build frontend (Vite)
```

## License

[GNU General Public License v3.0](LICENSE)
