# ModuleAgent

**Modular Agent Orchestration Framework** — Organize your project into modules using `module.md` files, run an independent Agent for each module, and enable autonomous cross-module collaboration.

## Key Features

- **Module-based Agent Architecture** — Each module has its own dedicated Agent focused on its specific responsibilities
- **Built-in Agent Kernel** — In-process LLM loop powered by ai-sdk, no external Agent subprocess required; ships with file read/write/edit, search, command execution, Git, and other built-in tools
- **Multi-provider Support** — Anthropic / OpenAI / DeepSeek / Google, plus custom OpenAI-compatible endpoints
- **Cross-module Collaboration** — Module Agents call and query each other via `module_call` / `module_query`, with cycle detection, hop limits, and timeout protection
- **Role Agents** — Cross-cutting specialized Agents with configurable module visibility, ideal for architecture review, documentation, and other cross-module tasks
- **Context Optimization** — Three-stage pipeline (snip stale tool results → online compaction → tail truncation), with removed content automatically archived
- **Interactive Module Tree** — SVG-rendered module dependency graph with collapsible nodes and selection
- **Workspace Isolation** — Workflow steps execute in isolated copies of the source code, preventing interference
- **Streaming Conversations** — Real-time display of Agent thinking, tool calls, and responses
- **Automatic Module Generation** — Analyze source directories and auto-generate `module.md` files via Agent

## Installation

### Desktop App (GUI)

Download installers from [GitHub Releases](https://github.com/belowthetree/module-agent/releases):

| Platform | Package |
|----------|---------|
| Windows | `.exe` (portable) / `.exe` (NSIS installer) |
| macOS | `.dmg` |
| Linux | `.AppImage` / `.deb` |

On Windows, the NSIS installer is recommended — it creates Start Menu and desktop shortcuts.

### CLI

```bash
pnpm add -g @belowthetree/module-agent
```

Then use the `module-agent` command in your terminal:

```bash
module-agent list        # List all modules in the project
module-agent get <name>  # Show detailed information for a module
module-agent serve       # Persistent stdio NDJSON mode
module-agent config      # Interactive setup wizard
```

> **Note:** `module-agent tui` requires the [Bun](https://bun.sh) runtime and is still under development. Use the [desktop app](#desktop-app-gui) for the full feature set.

## Development

### Prerequisites

- Node.js >= 20
- pnpm
- An API key from any supported LLM provider (Anthropic / OpenAI / DeepSeek / Google)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/belowthetree/module-agent.git
cd module-agent

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
      "provider": "anthropic",
      "apiKey": "sk-...",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "exclude": ["node_modules", ".git", "dist"],
  "projectPath": "."
}
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the detailed configuration reference.

## Architecture Overview

```
Renderer (Vue 3 + Element Plus)      ← UI, module tree, chat panels
    ↕ Electron IPC
Main Process (Electron)               ← Agent lifecycle orchestration, IPC, cross-module routing
    ↕ In-process calls (no subprocess)
Agent Kernel (AgentLoop)              ← ai-sdk generateText loop, built-in tools, context pipeline
    ↕ ai-sdk Provider
LLM Services                          ← Anthropic / OpenAI / DeepSeek / Google
```

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| Renderer | Vue 3 + Pinia + Element Plus | Module tree visualization, chat UI, state management |
| Main Process | Electron + TypeScript | Agent lifecycle management, IPC handling, cross-module call routing |
| Agent Layer | Built-in kernel (ai-sdk) | LLM reasoning loop, built-in tool execution, context optimization (snip/compact/truncate) |

For a detailed architecture analysis, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project Structure

```
src/
├── main/          Electron main process, IPC handlers, Agent lifecycle
├── preload/       contextBridge API bridge
├── renderer/      Vue 3 renderer (views, components, Pinia stores)
├── agents/        Built-in Agent kernel (AgentLoop, tools, cross-module router, prompts)
├── core/          Module scanning, parsing, graph building, path utilities, logging
├── config/        Configuration loading, Zod validation, defaults
├── protocol/      IPC channel definitions
├── cli/           CLI entry (list/get/serve/config/tui)
├── tui/           Terminal UI (OpenTUI, requires Bun runtime)
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
├── workspace/         ← Isolated source copies for workflow steps
├── context/           ← Conversation history persistence
└── archives/          ← Archive of content dropped by the context pipeline
.module-agent.json     ← Project configuration (at project root)
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
        "default": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
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

**Local packaging**:

```bash
pnpm run dist:win          # Build Windows packages only
pnpm run dist:mac          # Build macOS packages only
pnpm run dist:linux        # Build Linux packages only
pnpm run dist              # Build for the current platform
```

Packaged artifacts are output to the `release/` directory.

## License

[GNU General Public License v3.0](LICENSE)
