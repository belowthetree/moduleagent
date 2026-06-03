// ---------------------------------------------------------------------------
// tui/components/DiffPanel.tsx — TUI 差异详情面板组件
// 树状展示文件变更，Enter 查看详情，Tab 切换预览
// ---------------------------------------------------------------------------

import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { tuiState } from "../state.js";
import { defaultLogger } from "../../core/Logger.js";

const STATUS_ICON: Record<string, string> = { added: "+", modified: "~", deleted: "-" };
const STATUS_COLOR: Record<string, string> = { added: "#5CFF5C", modified: "#5BADFF", deleted: "#FF5555" };

// ── 左右对比 diff 对齐 ──

type DiffLine = { text: string; type: "same" | "added" | "removed" };

function alignDiffLines(oldLines: string[], newLines: string[]): { left: DiffLine[]; right: DiffLine[] } {
  // 限制行数避免 O(n²) 太慢
  const MAX = 200;
  const o = oldLines.slice(0, MAX);
  const n = newLines.slice(0, MAX);
  const m = o.length;
  const k = n.length;

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(k + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= k; j++) {
      dp[i]![j] = o[i - 1] === n[j - 1]
        ? dp[i - 1]![j - 1]! + 1
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  // 回溯
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let i = m, j = k;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && o[i - 1] === n[j - 1]) {
      left.unshift({ text: o[i - 1]!, type: "same" });
      right.unshift({ text: n[j - 1]!, type: "same" });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      left.unshift({ text: "", type: "same" }); // 占位
      right.unshift({ text: n[j - 1]!, type: "added" });
      j--;
    } else {
      left.unshift({ text: o[i - 1]!, type: "removed" });
      right.unshift({ text: "", type: "same" }); // 占位
      i--;
    }
  }

  return { left, right };
}

// ── 树节点 ──
interface TreeNode {
  name: string; path: string; status?: string;
  children: TreeNode[]; depth: number; expanded: boolean;
}

function buildTree(files: { relativePath: string; status: string }[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], depth: 0, expanded: true };
  for (const f of files) {
    const parts = f.relativePath.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const fullPath = parts.slice(0, i + 1).join('/');
      let child = node.children.find(c => c.name === part);
      if (!child) {
        child = { name: part, path: fullPath, status: i === parts.length - 1 ? f.status : undefined, children: [], depth: node.depth + 1, expanded: true };
        node.children.push(child);
      }
      node = child;
    }
  }
  return root;
}

function flattenTree(node: TreeNode): { node: TreeNode; isFile: boolean }[] {
  const result: { node: TreeNode; isFile: boolean }[] = [];
  if (node.name !== '') result.push({ node, isFile: node.children.length === 0 });
  if (node.expanded) for (const child of node.children) result.push(...flattenTree(child));
  return result;
}

export default function DiffPanel() {
  const renderer = useRenderer();
  const termWidth = () => renderer?.width ?? 80;
  const termHeight = () => renderer?.height ?? 24;

  const diff = () => tuiState.diffPrompt();
  const loading = () => tuiState.diffLoading();
  const files = () => diff()?.files ?? [];
  const moduleName = () => diff()?.moduleName ?? "";
  const service = () => (globalThis as any).__tuiAgentService;

  const tree = createMemo(() => buildTree(files() as { relativePath: string; status: string }[]));
  const flatNodes = createMemo(() => flattenTree(tree()));
  const fileNodes = createMemo(() => flatNodes().filter(f => f.isFile));

  const [sel, setSel] = createSignal<string | null>(null);
  const [viewing, setViewing] = createSignal(false);
  const [splitData, setSplitData] = createSignal<{ oldCode: string; newCode: string; language: string } | null>(null);

  function selectedIndex(): number {
    const s = sel();
    const fn = fileNodes();
    if (!s && fn.length > 0) { setSel(() => fn[0]!.node.path); return 0; }
    return fn.findIndex(f => f.node.path === s);
  }

  function getSelectedFile() {
    const s = sel();
    return files().find((f: { relativePath: string }) => f.relativePath === s) || files()[0];
  }

  function toggleExpand(filePath: string) {
    const expandNode = (n: TreeNode): boolean => {
      if (n.path === filePath && n.children.length > 0) { n.expanded = !n.expanded; return true; }
      return n.children.some(expandNode);
    };
    expandNode(tree());
    setSel(() => filePath);
  }

  onMount(() => {
    const fn = fileNodes();
    if (fn.length > 0) setSel(() => fn[0]!.node.path);

    // ── 注册全局 Tab 处理器，供 renderer.tsx 的原始 keypress 处理器调用 ──
    // <input> 在内部消耗 Tab 进行焦点管理，导致 useKeyboard 永远收不到 Tab。
    // 但 renderer.keyInput.on('keypress') 在 input 处理之前触发，可以截获 Tab。
    // 因此注册一个全局函数，由 renderer.tsx 在收到 Tab 时调用。
    (globalThis as any).__tuiEnterDiffDetail = () => {
      if (!tuiState.showDiffPanel() || viewing()) return;
      const f = getSelectedFile();
      if (f) {
        setViewing(true);
        loadSplitView(f.relativePath);
        renderer?.requestRender();
      }
    };
    onCleanup(() => {
      delete (globalThis as any).__tuiEnterDiffDetail;
    });
  });

  function loadSplitView(filePath: string) {
    const svc = service();
    setSplitData(svc?.getWorkspaceDiffSplit?.(moduleName(), filePath) ?? null);
  }

  function backToTree() {
    setViewing(false);
    setSplitData(null);
  }

  useKeyboard((key: KeyEvent) => {
    if (!tuiState.showDiffPanel()) return;
    defaultLogger.info(`DiffPanel received key: ${key.name} (viewing=${viewing()})`);

    const fn = fileNodes();
    let idx = selectedIndex();
    if (idx === -1 && fn.length > 0) { idx = 0; setSel(() => fn[0]!.node.path); }

    // ── 详情视图 ──
    if (viewing()) {
      if (key.name === "escape" || key.name === "q" || key.name === "tab") {
        backToTree();
        key.preventDefault();
        return;
      }
      if (key.name === "up") {
        const nextIdx = idx > 0 ? idx - 1 : fn.length - 1;
        const nextPath = fn[nextIdx]?.node.path;
        if (nextPath) { setSel(() => nextPath); loadSplitView(nextPath); }
        key.preventDefault();
        return;
      }
      if (key.name === "down") {
        const nextIdx = idx < fn.length - 1 ? idx + 1 : 0;
        const nextPath = fn[nextIdx]?.node.path;
        if (nextPath) { setSel(() => nextPath); loadSplitView(nextPath); }
        key.preventDefault();
        return;
      }
      if (key.name === "a") {
        const svc = service();
        const f = getSelectedFile();
        if (f) {
          svc?.applyWorkspaceDiff?.(moduleName(), [f.relativePath]).then(() => {
            const updated = svc?.getWorkspaceDiff?.(moduleName());
            if (!updated || updated.files.length === 0) { tuiState.setShowDiffPanel(false); return; }
            backToTree();
          }).catch(() => {});
        }
        key.preventDefault();
        return;
      }
      if (key.name === "d") {
        const svc = service();
        const f = getSelectedFile();
        if (f) {
          svc?.discardWorkspaceDiff?.(moduleName(), [f.relativePath]).then(() => {
            const updated = svc?.getWorkspaceDiff?.(moduleName());
            if (!updated || updated.files.length === 0) { tuiState.setShowDiffPanel(false); return; }
            backToTree();
          }).catch(() => {});
        }
        key.preventDefault();
        return;
      }
      return;
    }

    // ── 树视图 ──
    if (key.name === "escape" || key.name === "q") {
      (globalThis as any).__tuiAgentService?._closeDiff?.();
      key.preventDefault();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      const nextIdx = idx > 0 ? idx - 1 : fn.length - 1;
      const nextPath = fn[nextIdx]?.node.path;
      if (nextPath) setSel(() => nextPath);
      key.preventDefault();
      return;
    }
    if (key.name === "down" || key.name === "j") {
      const nextIdx = idx < fn.length - 1 ? idx + 1 : 0;
      const nextPath = fn[nextIdx]?.node.path;
      if (nextPath) setSel(() => nextPath);
      key.preventDefault();
      return;
    }
    if (key.name === "enter" || key.name === "return" || key.name === "tab") {
      const f = getSelectedFile();
      if (f) {
        setViewing(true);
        loadSplitView(f.relativePath);
        renderer?.requestRender();
      }
      key.preventDefault();
      return;
    }
    if (key.name === " ") {
      const s = sel();
      if (s) toggleExpand(s);
      key.preventDefault();
      return;
    }
    if (key.name === "A" || (key.shift && key.name === "a")) {
      service()?.applyWorkspaceDiff?.(moduleName()).then(() => tuiState.setShowDiffPanel(false)).catch(() => {});
      key.preventDefault();
      return;
    }
    if (key.name === "D" || (key.shift && key.name === "d")) {
      service()?.discardWorkspaceDiff?.(moduleName()).then(() => tuiState.setShowDiffPanel(false)).catch(() => {});
      key.preventDefault();
      return;
    }
  });

  if (loading()) {
    return <box flexDirection="column" width="100%" height="100%" alignItems="center" justifyContent="center"><text fg="#FFD700">⏳ 正在分析工作区变更...</text></box>;
  }
  if (files().length === 0) {
    return <box flexDirection="column" width="100%" height="100%" alignItems="center" justifyContent="center"><text fg="#888888">无工作区变更</text><text height={1}> </text><text fg="#555555" dim>按 q 关闭</text></box>;
  }

  // ── Show 模式：与 ExperiencePanel 相同，when=false 时完全不渲染详情视图 ──
  return (
    <Show
      when={viewing()}
      fallback={
        <box flexDirection="column" width="100%" height="100%" padding={0}>
          <input width={0} height={0} visible={false} value="" keyBindings={[]} focused />
          <box flexDirection="row" justifyContent="space-between" padding={0} height={1}>
            <text fg="#FFD700">Diff ── {moduleName()}</text>
            <text fg="#888888">{fileNodes().length} files  [q] quit</text>
          </box>
          <scrollbox flexGrow={1} stickyScroll={false}>
            {(() => {
              const currentSel = sel();
              const fl = flatNodes();
              return fl.map(({ node, isFile }) => {
                const selected = node.path === currentSel;
                const prefix = '  '.repeat(node.depth) + (isFile ? '  ' : node.expanded ? '▾ ' : '▸ ');
                const icon = node.status ? `${STATUS_ICON[node.status]} ` : '';
                return (
                  <box flexDirection="row" height={1} padding={0} backgroundColor={selected ? "#44475a" : "transparent"}>
                    <text fg={isFile ? (STATUS_COLOR[node.status || 'modified'] || "#CCCCCC") : "#888888"}>
                      {selected ? '> ' : '  '}{prefix}{icon}{node.name}
                    </text>
                  </box>
                );
              });
            })()}
          </scrollbox>
          <text fg="#888888" height={1}>
            [↑↓] nav  [Tab/Enter] detail  [Space] fold  [A]ll accept  [D]iscard all  [q] quit
          </text>
        </box>
      }
    >
      {() => (
        <box flexDirection="column" width="100%" height="100%" padding={0}>
          <input width={0} height={0} visible={false} value="" keyBindings={[]} focused />
          <box flexDirection="row" justifyContent="space-between" padding={0} height={1}>
            <text fg="#5BADFF">{getSelectedFile()?.relativePath || ""}</text>
            <text fg="#888888">{selectedIndex() + 1}/{fileNodes().length}  [←/Tab] back  [a]ccept  [d]iscard</text>
          </box>
          <Show when={splitData()} fallback={
            <scrollbox flexGrow={1}><text fg="#888888">  (loading diff data...)</text></scrollbox>
          }>
            {() => {
              const data = splitData()!;
              const { left, right } = alignDiffLines(data.oldCode.split("\n"), data.newCode.split("\n"));
              const halfW = Math.floor(termWidth() / 2) - 1;
              return (
                <box flexDirection="row" flexGrow={1}>
                  {/* 左：源文件（old） */}
                  <box flexDirection="column" flexGrow={1} flexShrink={1} width={halfW}>
                    <text fg="#555555" dim>─── a/{getSelectedFile()?.relativePath || "source"}</text>
                    <scrollbox flexGrow={1}>
                      <box flexDirection="column">
                        {left.map((dl, i) => {
                          const bg = dl.type === "removed" ? "#330000" : "transparent";
                          const fg = dl.type === "removed" ? "#FF7777" : dl.type === "same" && !dl.text ? "#222222" : "#CCCCCC";
                          const prefix = dl.type === "removed" ? "-" : " ";
                          return (
                            <box height={1} padding={0} backgroundColor={bg}>
                              <text fg="#888888" width={5}>{String(i + 1).padStart(4)} </text>
                              <text fg={fg}>{prefix}{dl.text}</text>
                            </box>
                          );
                        })}
                      </box>
                    </scrollbox>
                  </box>
                  {/* 分隔线 */}
                  <text fg="#333333" width={1}>│</text>
                  {/* 右：工作区文件（new） */}
                  <box flexDirection="column" flexGrow={1} flexShrink={1} width={halfW}>
                    <text fg="#555555" dim>+++ b/{getSelectedFile()?.relativePath || "workspace"}</text>
                    <scrollbox flexGrow={1}>
                      <box flexDirection="column">
                        {right.map((dl, i) => {
                          const bg = dl.type === "added" ? "#003300" : "transparent";
                          const fg = dl.type === "added" ? "#77FF77" : dl.type === "same" && !dl.text ? "#222222" : "#CCCCCC";
                          const prefix = dl.type === "added" ? "+" : " ";
                          return (
                            <box height={1} padding={0} backgroundColor={bg}>
                              <text fg="#888888" width={5}>{String(i + 1).padStart(4)} </text>
                              <text fg={fg}>{prefix}{dl.text}</text>
                            </box>
                          );
                        })}
                      </box>
                    </scrollbox>
                  </box>
                </box>
              );
            }}
          </Show>
          <text fg="#888888" height={1}>
            [a]ccept  [d]iscard  [↑↓] prev/next  [←/Tab] back
          </text>
        </box>
      )}
    </Show>
  );
}
