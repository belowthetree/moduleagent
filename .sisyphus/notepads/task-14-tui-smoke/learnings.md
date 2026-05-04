# Task 14 TUI Smoke Test - Learnings

## Patterns
- TUI launched via `bun run --cwd src/tui ../cli/tui-entry.ts --project ../..`
- tmux + capture-pane works for capturing TUI output in CI/test environments
- TUI uses Chinese locale messages - decode escape sequences to find meaningful content

## Successful approaches
- Used tmux new-session with tee to capture raw output to file
- Extracted readable content from ANSI escape-heavy raw output by searching for known patterns (module names, status messages)

## Agent startup flow verified
- Status transitions: `agent: loading` → `agent: idle`
- Module list shows all 12 modules from project graph
- Tree view uses ◌ (idle) and ● (active) status indicators
- Agent launch failure is graceful: "❌ 发送失败: Failed to start agent 'agent-cli'" - expected when no binary present
