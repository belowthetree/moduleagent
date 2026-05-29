import { createMemo } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { tuiState } from "../state.js";
import type { AgentStatus } from "../types.js";

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#00FF00",
  streaming: "#FFFF00",
  error: "#FF0000",
  disconnected: "#888888",
  loading: "#888888",
};

export default function StatusBar() {
  const renderer = useRenderer();

  const statusColor = createMemo(() => {
    return STATUS_COLORS[tuiState.agentStatus()] ?? "#888888";
  });

  const TYPE_LABEL: Record<string, string> = {
    module: '模块',
    role: '角色',
    workflow: '工作流',
  };

  const statusText = createMemo(() => {
    const target = tuiState.currentTarget();
    const agent = tuiState.currentAgent();
    const counts = tuiState.activeCounts();
    const label = TYPE_LABEL[target] || target;
    let text = `${label}：${agent}: ${tuiState.agentStatus()} |`;
    text += ` M:${counts.modules}`;
    if (counts.roles > 0) text += ` R:${counts.roles}`;
    if (counts.workflows > 0) text += ` W:${counts.workflows}`;
    text += ' |';
    return text;
  });

  const pathText = createMemo(() => {
    const cwd = tuiState.workingDir();
    if (!cwd) return "";

    const width = renderer?.width;
    const statusLen = statusText().length;
    const maxPathLen = width ? Math.max(0, width - statusLen - 1) : cwd.length;

    if (cwd.length <= maxPathLen || !width) {
      return cwd;
    }
    return "..." + cwd.slice(cwd.length - maxPathLen + 3);
  });

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      height={1}
      padding={0}
      backgroundColor="#1a1a2e"
    >
      <text fg={statusColor()}>{statusText()}</text>
      <text>{pathText()}</text>
    </box>
  );
}
