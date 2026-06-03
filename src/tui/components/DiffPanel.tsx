// ---------------------------------------------------------------------------
// tui/components/DiffPanel.tsx — TUI 差异详情面板组件
// 树状展示文件变更，Enter 查看详情，Tab 切换预览
// ---------------------------------------------------------------------------

import { createMemo, createSignal, onMount } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { tuiState } from "../state.js";

const STATUS_ICON: Record<string, string> = { added: "+", modified: "~", deleted: "-" };
const STATUS_COLOR: Record<string, string> = { added: "#5CFF5C", modified: "#5BADFF", deleted: "#FF5555" };

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
  const [hunks, setHunks] = createSignal("");

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
  });

  function loadHunks(filePath: string) {
    const svc = service();
    setHunks(svc?.getWorkspaceDiffFile?.(moduleName(), filePath) ?? "(no diff data)");
  }

  function backToTree() {
    setViewing(false);
    setHunks("");
  }

  useKeyboard((key: KeyEvent) => {
    if (!tuiState.showDiffPanel()) return;

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
        if (nextPath) { setSel(() => nextPath); loadHunks(nextPath); }
        key.preventDefault();
        return;
      }
      if (key.name === "down") {
        const nextIdx = idx < fn.length - 1 ? idx + 1 : 0;
        const nextPath = fn[nextIdx]?.node.path;
        if (nextPath) { setSel(() => nextPath); loadHunks(nextPath); }
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
    if (key.name === "enter" || key.name === "return") {
      const f = getSelectedFile();
      if (f) {
        setViewing(true);
        loadHunks(f.relativePath);
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

  // ── 详情视图（全屏 diff） ──
  if (viewing()) {
    const f = getSelectedFile();
    const fn = fileNodes();
    const idx = selectedIndex();

    return (
      <box flexDirection="column" width="100%" height="100%" padding={0}>
        <input width={0} height={0} visible={false} value="" keyBindings={[]} />
        <box flexDirection="row" justifyContent="space-between" padding={0} height={1}>
          <text fg="#5BADFF">{f?.relativePath || ""}</text>
          <text fg="#888888">{idx + 1}/{fn.length}  [←/Tab] back  [a]ccept  [d]iscard</text>
        </box>
        <scrollbox flexGrow={1} stickyScroll={false}>
          {(() => {
            const lines = hunks().split("\n");
            const maxLines = termHeight() - 5;
            return lines.slice(0, maxLines).map((line) => {
              let fg = "#CCCCCC";
              if (line.startsWith("+") && !line.startsWith("+++")) fg = "#5CFF5C";
              else if (line.startsWith("-") && !line.startsWith("---")) fg = "#FF5555";
              else if (line.startsWith("@@")) fg = "#5BADFF";
              return <box height={1} padding={0}><text fg={fg}>{line}</text></box>;
            });
          })()}
        </scrollbox>
        <text fg="#888888" height={1}>
          [a]ccept  [d]iscard  [↑↓] prev/next  [←/Tab] back
        </text>
      </box>
    );
  }

  // ── 树视图 ──
  const fnCnt = fileNodes().length;

  return (
    <box flexDirection="column" width="100%" height="100%" padding={0}>
      {/* 隐藏 input：OpenTUI 键盘事件路由需要聚焦的 input，否则方向键不会派发到 useKeyboard */}
      <input width={0} height={0} visible={false} value="" keyBindings={[]} />
      <box flexDirection="row" justifyContent="space-between" padding={0} height={1}>
        <text fg="#FFD700">Diff ── {moduleName()}</text>
        <text fg="#888888">{fnCnt} files  [q] quit</text>
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
        [↑↓] nav  [Space] fold  [A]ll accept  [D]iscard all  [q] quit
      </text>
    </box>
  );
}
