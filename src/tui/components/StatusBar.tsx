// ---------------------------------------------------------------------------
// tui/components/StatusBar.tsx — TUI 状态栏组件
// 显示 Agent 状态、活动计数、信息提示
// ---------------------------------------------------------------------------

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

  const barText = createMemo(() => {
    const target = tuiState.currentTarget();
    const agent = tuiState.currentAgent();
    const counts = tuiState.activeCounts();
    const label = TYPE_LABEL[target] || target;
    const cwd = tuiState.agentCwd() || tuiState.workingDir() || '';

    // 左侧：agent 状态
    let left = `${label}：${agent} | ${tuiState.agentStatus()}`;
    left += ` | M:${counts.modules}`;
    if (counts.roles > 0) left += ` R:${counts.roles}`;
    if (counts.workflows > 0) left += ` W:${counts.workflows}`;

    // diff 进度
    if (tuiState.diffLoading()) {
      left += ` | ⏳ diff`;
    }

    if (!cwd) return left;

    // 右侧：cwd 路径，截断以适应宽度
    const width = renderer?.width ?? 80;
    const pad = 3; // 左右间最小间距
    const cjkWidth = (s: string) => { let w = 0; for (const c of s) w += /[\u4e00-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1; return w; };
    const leftW = cjkWidth(left);
    const maxPathLen = Math.max(10, width - leftW - pad);

    let path = cwd;
    if (path.length > maxPathLen) {
      path = '…' + path.slice(path.length - maxPathLen + 1);
    }

    const spaces = ' '.repeat(Math.max(1, width - leftW - cjkWidth(path)));
    return left + spaces + path;
  });

  return (
    <box flexDirection="row" height={1} padding={0}>
      <text fg="#777777" dim>{barText()}</text>
    </box>
  );
}
