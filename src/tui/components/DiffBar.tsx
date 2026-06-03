// ---------------------------------------------------------------------------
// tui/components/DiffBar.tsx — TUI 差异状态栏组件
// 显示文件差异概览行（新增/删除/修改统计）
// ---------------------------------------------------------------------------

import { useRenderer } from "@opentui/solid";
import { tuiState } from "../state.js";

const STATUS_ICON: Record<string, string> = {
  added: "+",
  modified: "~",
  deleted: "-",
};

export default function DiffBar() {
  const renderer = useRenderer();
  const termWidth = () => renderer?.width ?? 80;
  const diff = () => tuiState.diffPrompt();
  const rule = () => "─".repeat(Math.max(termWidth() - 2, 20));

  return (
    <box flexDirection="column" flexShrink={0} padding={0}>
      <text fg="#FFD700" height={1}>{rule()}</text>
      <box
        flexDirection="column"
        padding={0}
        backgroundColor="#2d2416"
        borderStyle="rounded"
        borderColor="#FFD700"
      >
        <box flexDirection="row" justifyContent="space-between" padding={0}>
          <text fg="#FFD700">
            ⚡ Workspace changed: {diff()!.files.length} files
          </text>
          <text fg="#888888">Ctrl+P to review</text>
        </box>
        {/* 文件列表 */}
        <box flexDirection="column" padding={0}>
          {diff()!.files.slice(0, 10).map((f) => (
            <text fg="#CCCCCC">
              {"  "}{STATUS_ICON[f.status] || " "} {f.relativePath}
            </text>
          ))}
          {diff()!.files.length > 10 ? (
            <text fg="#888888">  ... and {diff()!.files.length - 10} more</text>
          ) : null}
        </box>
        {/* 操作键 */}
        <box flexDirection="row" padding={0}>
          <text fg="#5CFF5C"> [Y] 接受全部</text>
          <text fg="#5BADFF">    [R] 查看变更</text>
          <text fg="#FF5555">    [N] 丢弃全部</text>
        </box>
      </box>
      <text fg="#FFD700" height={1}>{rule()}</text>
    </box>
  );
}
