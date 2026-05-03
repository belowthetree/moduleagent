#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR"

cd "$ROOT"

MODE="${1:-}"
PROJECT="${2:-}"

usage() {
    cat <<EOF
ModuleAgent Launcher

Usage:
  module-agent.sh                    Launch GUI (default)
  module-agent.sh tui [project]      Start TUI mode
  module-agent.sh list [project]     List all modules (JSON)
  module-agent.sh get <name> [project] Get module details (JSON)
  module-agent.sh serve [project]    Stdio NDJSON server

If project-path is omitted, current directory is used.
EOF
    exit 0
}

gui() {
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install --silent || exit 1
    fi

    echo "Building and launching ModuleAgent GUI..."
    npm run build:electron --silent || exit 1

    if [ -f "$ROOT/node_modules/electron/dist/electron" ]; then
        "$ROOT/node_modules/electron/dist/electron" "$ROOT"
    else
        echo "Electron binary not found. Run: node node_modules/electron/install.js"
        exit 1
    fi
}

tui() {
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install --silent || exit 1
    fi

    if ! command -v bun &> /dev/null; then
        echo "Error: Bun is required for TUI mode. Install it from https://bun.sh"
        exit 1
    fi

    if [ -z "$PROJECT" ]; then
        echo "Starting TUI - auto-detecting project..."
        echo
        bun run --cwd "$ROOT/src/tui" "$ROOT/src/cli/tui-entry.ts"
    else
        echo "Starting TUI - project: $PROJECT..."
        echo
        bun run --cwd "$ROOT/src/tui" "$ROOT/src/cli/tui-entry.ts" --project "$PROJECT"
    fi
}

cli() {
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install --silent || exit 1
    fi

    npm run build:cli --silent || exit 1

    if [ "$MODE" = "get" ]; then
        MODULE_NAME="${2:-}"
        PROJ="${3:-}"
        if [ -z "$PROJ" ]; then
            node "$ROOT/dist/cli.cjs" get "$MODULE_NAME"
        else
            node "$ROOT/dist/cli.cjs" get "$MODULE_NAME" --project "$PROJ"
        fi
    else
        if [ -z "$PROJECT" ]; then
            node "$ROOT/dist/cli.cjs" "$MODE"
        else
            node "$ROOT/dist/cli.cjs" "$MODE" --project "$PROJECT"
        fi
    fi
}

case "$MODE" in
    --help|-h) usage ;;
    tui) tui ;;
    list|get|serve) cli ;;
    "") gui ;;
    *) echo "Unknown option: $MODE"; usage ;;
esac
