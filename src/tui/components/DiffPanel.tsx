import { createSignal } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { tuiState } from "../state.js";

const STATUS_ICON: Record<string, string> = {
  added: "+",
  modified: "~",
  deleted: "-",
};

const STATUS_COLOR: Record<string, string> = {
  added: "#5CFF5C",
  modified: "#5BADFF",
  deleted: "#FF5555",
};

export default function DiffPanel() {
  const renderer = useRenderer();
  const termWidth = () => renderer?.width ?? 80;
  const termHeight = () => renderer?.height ?? 24;

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [viewingFile, setViewingFile] = createSignal<string | null>(null);
  const [diffHunks, setDiffHunks] = createSignal<string>("");

  const diff = () => tuiState.diffPrompt();
  const files = () => diff()?.files ?? [];
  const moduleName = () => diff()?.moduleName ?? "";

  const service = () => (globalThis as any).__tuiAgentService;

  function viewFile(filePath: string) {
    setViewingFile(filePath);
    const svc = service();
    if (svc?.getWorkspaceDiffFile) {
      const hunks = svc.getWorkspaceDiffFile(moduleName(), filePath);
      setDiffHunks(hunks ?? "(no diff data)");
    }
  }

  function backToList() {
    setViewingFile(null);
    setDiffHunks("");
  }

  useKeyboard((key: KeyEvent) => {
    if (!tuiState.showDiffPanel()) return;

    const fileList = files();
    const max = fileList.length - 1;

    if (viewingFile()) {
      // 详情视图
      if (key.name === "escape" || key.name === "q") {
        backToList();
        key.preventDefault();
        return;
      }
      if (key.name === "a") {
        const svc = service();
        svc?.applyWorkspaceDiff?.(moduleName(), [viewingFile()!]).then(() => {
          // 刷新：如果指定文件全部应用，可能 diff 为空
          const updated = svc?.getWorkspaceDiff?.(moduleName());
          if (!updated || updated.files.length === 0) {
            tuiState.setShowDiffPanel(false);
            return;
          }
          setSelectedIndex(0);
          backToList();
        }).catch(() => {});
        key.preventDefault();
        return;
      }
      if (key.name === "d") {
        // 丢弃单个文件 — 暂时不支持单独丢弃（WorkspaceDiff.discardWorkspace 是全量）
        key.preventDefault();
        return;
      }
      // 上下翻 diff
      if (key.name === "up" || key.name === "down") {
        const idx = fileList.findIndex(f => f.relativePath === viewingFile());
        if (idx >= 0) {
          const next = key.name === "up" ? Math.max(0, idx - 1) : Math.min(max, idx + 1);
          viewFile(fileList[next].relativePath);
          setSelectedIndex(next);
        }
        key.preventDefault();
        return;
      }
      return;
    }

    // 列表视图
    if (key.name === "escape" || key.name === "q") {
      tuiState.setShowDiffPanel(false);
      key.preventDefault();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex(Math.max(0, selectedIndex() - 1));
      key.preventDefault();
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex(Math.min(max, selectedIndex() + 1));
      key.preventDefault();
    }
    if (key.name === "enter" || key.name === "return") {
      const f = fileList[selectedIndex()];
      if (f) viewFile(f.relativePath);
      key.preventDefault();
    }
    if (key.name === "a") {
      const f = fileList[selectedIndex()];
      if (f) {
        const svc = service();
        svc?.applyWorkspaceDiff?.(moduleName(), [f.relativePath]).then(() => {
          const updated = svc?.getWorkspaceDiff?.(moduleName());
          if (!updated || updated.files.length === 0) {
            tuiState.setShowDiffPanel(false);
            return;
          }
          setSelectedIndex(Math.min(selectedIndex(), (updated.files?.length ?? 1) - 1));
        }).catch(() => {});
      }
      key.preventDefault();
    }
    if (key.name === "A" || (key.shift && key.name === "a")) {
      const svc = service();
      svc?.applyWorkspaceDiff?.(moduleName()).then(() => {
        tuiState.setShowDiffPanel(false);
      }).catch(() => {});
      key.preventDefault();
    }
    if (key.name === "D" || (key.shift && key.name === "d")) {
      const svc = service();
      svc?.discardWorkspaceDiff?.(moduleName()).then(() => {
        tuiState.setShowDiffPanel(false);
      }).catch(() => {});
      key.preventDefault();
    }
  });

  // 详情视图
  if (viewingFile()) {
    const hunks = diffHunks();
    const lines = hunks.split("\n");
    const maxLines = termHeight() - 6;

    return (
      <box flexDirection="column" width="100%" height="100%" padding={0}>
        <box flexDirection="row" justifyContent="space-between" padding={0} height={1}>
          <text fg="#5BADFF">{viewingFile()}</text>
          <text fg="#888888">
            {selectedIndex() + 1}/{files().length}  [←] back  [a]ccept
          </text>
        </box>
        <scrollbox flexGrow={1} stickyScroll={false}>
          {lines.slice(0, maxLines).map((line) => {
            let fg = "#CCCCCC";
            if (line.startsWith("+") && !line.startsWith("+++")) fg = "#5CFF5C";
            else if (line.startsWith("-") && !line.startsWith("---")) fg = "#FF5555";
            else if (line.startsWith("@@")) fg = "#5BADFF";
            return <text fg={fg}>{line}</text>;
          })}
        </scrollbox>
        <text fg="#888888" height={1}>
          [a]ccept  [d]iscard  [↑↓] prev/next  [←] back
        </text>
      </box>
    );
  }

  // 列表视图
  return (
    <box flexDirection="column" width="100%" height="100%" padding={0}>
      <box flexDirection="row" justifyContent="space-between" padding={0} height={1}>
        <text fg="#FFD700">Diff ── {moduleName()}</text>
        <text fg="#888888">{files().length} files</text>
      </box>
      <scrollbox flexGrow={1} stickyScroll={false}>
        {files().map((f, i) => {
          const sel = i === selectedIndex();
          return (
            <box
              flexDirection="row"
              height={1}
              padding={0}
              backgroundColor={sel ? "#44475a" : "transparent"}
            >
              <text fg={sel ? "#ffffff" : STATUS_COLOR[f.status] || "#CCCCCC"}>
                {sel ? ">" : " "} {STATUS_ICON[f.status] || " "} {f.relativePath}
              </text>
            </box>
          );
        })}
      </scrollbox>
      <text fg="#888888" height={1}>
        [a]ccept  [d]iscard  [A]ll accept  [D]iscard all  [q]uit
      </text>
    </box>
  );
}
