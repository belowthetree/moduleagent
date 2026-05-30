import { createMemo } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { tuiState } from "../state.js";

const TYPE_LABEL: Record<string, string> = {
  module: '模块',
  role: '角色',
  workflow: '工作流',
};

export default function StatusBar() {
  const renderer = useRenderer();

  const statusText = createMemo(() => {
    const target = tuiState.currentTarget();
    const agent = tuiState.currentAgent();
    const counts = tuiState.activeCounts();
    const label = TYPE_LABEL[target] || target;
    let text = `${label}：${agent} | ${tuiState.agentStatus()}`;
    text += ` | M:${counts.modules}`;
    if (counts.roles > 0) text += ` R:${counts.roles}`;
    if (counts.workflows > 0) text += ` W:${counts.workflows}`;
    return text;
  });

  const pathText = createMemo(() => {
    const cwd = tuiState.agentCwd() || tuiState.workingDir();
    if (!cwd) return '';

    const width = renderer?.width ?? 80;
    const statusLen = statusText().length;
    const maxPathLen = Math.max(10, width - statusLen - 2);

    if (cwd.length <= maxPathLen) return cwd;
    return '…' + cwd.slice(cwd.length - maxPathLen + 1);
  });

  return (
    <box flexDirection="row" justifyContent="space-between" height={1} padding={0}>
      <text fg="#777777" dim>{statusText()}</text>
      <text fg="#777777" dim>{pathText()}</text>
    </box>
  );
}
