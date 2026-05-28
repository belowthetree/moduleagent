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

## Quick Start

### Prerequisites

- Node.js >= 20
- An ACP-compatible Agent client (e.g., [opencode](https://github.com/opencode-ai/opencode) or Claude CLI)

### Installation & Running

```bash
# Clone the repository
git clone <repo-url>
cd ModuleAgent

# Install dependencies
pnpm install

# Development mode (Vite HMR with hot reload)
pnpm run dev

# Build and launch production app
pnpm run electron
```

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

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed configuration reference.

## Architecture Overview

```
Renderer (Vue 3 + Element Plus)     ← UI, module tree, chat panels
    ↕ Electron IPC
Main Process (Electron)              ← Agent orchestration, MCP routing, state
    ↕ ACP Protocol (stdio)
Agent Subprocesses                   ← LLM inference, file operations
    ↕ MCP Protocol (stdio)
MCP Server                           ← Cross-module communication bus
```

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| Renderer | Vue 3 + Pinia + Element Plus | Module tree visualization, chat UI, state management |
| Main Process | Electron + TypeScript | Agent lifecycle management, IPC handling, MCP HTTP backend |
| Agent Layer | opencode / Claude (ACP) | LLM reasoning, file operations, terminal commands |

For a detailed architecture analysis, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project Structure

```
src/
├── main/          Electron main process, IPC handlers
├── preload/       contextBridge API bridge
├── renderer/      Vue 3 renderer (views, components, stores)
├── agents/        Agent orchestration (launch, isolation, state, prompts)
├── protocol/      ACP connection + MCP servers + communication bus
├── core/          Module scanning, parsing, graph building, path utilities
├── config/        Configuration loading, Zod validation, defaults
├── cli/           CLI path (secondary, for serve/tui)
└── types/         Shared type definitions
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
├── context/           ← Conversation history persistence
└── .module-agent.json ← Project configuration
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

## Build

```bash
pnpm run typecheck         # Type checking
pnpm run test              # Unit tests
pnpm run test:e2e          # E2E tests
pnpm run build:electron    # Full production build
pnpm run dev               # Development mode (hot reload)
```

## License

[GNU General Public License v3.0](LICENSE)
