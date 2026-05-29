import { createMemo, createSignal } from "solid-js";
import { useRenderer, useKeyboard } from "@opentui/solid";
import { defaultLogger } from "../../core/Logger.js";
import type { ModuleGraph, ModuleGraphNode } from "../../types/module.js";

// ── 状态指示 ──

// ── 状态指示 ──

const STATUS_SYMBOL: Record<string, string> = {
  idle:     "●",
  streaming:"▶",
  error:    "✗",
  loading:  "◌",
};

const STATUS_COLOR: Record<string, string> = {
  idle:     "#00FF00",
  streaming:"#FFFF00",
  error:    "#FF0000",
  loading:  "#888888",
};

// ── 扁平化树节点 ──

interface TreeNode {
  name: string;
  relativePath: string;
  description: string;
  status: string;
  isCurrent: boolean;
  depth: number;
  connector: string;   // 前缀连接线
}

function flattenTree(
  graph: ModuleGraph,
  currentAgent: string,
  moduleStatuses: Map<string, string>,
  loadedModules: Set<string>,
): TreeNode[] {
  const visited = new Set<string>();
  const result: TreeNode[] = [];

  function walk(nodeName: string, prefix: string, depth: number, isLast: boolean) {
    if (visited.has(nodeName)) return;
    visited.add(nodeName);

    const node = graph.nodes.get(nodeName);
    if (!node) return;

    const isCurrent = nodeName === currentAgent;
    const rawStatus = isCurrent
      ? (moduleStatuses.get(nodeName) || 'idle')
      : loadedModules.has(nodeName)
        ? 'idle'
        : 'loading';

    const connector = depth === 0 ? '' : (isLast ? '└── ' : '├── ');
    const childPrefix = depth === 0 ? '' : (isLast ? '    ' : '│   ');

    result.push({
      name: node.name,
      relativePath: node.relativePath || '.',
      description: (node.definition?.frontmatter as any)?.description || '',
      status: rawStatus,
      isCurrent,
      depth,
      connector: prefix + connector,
    });

    const children = node.children || [];
    const validChildren = children.filter(c => graph.nodes.has(c) && !visited.has(c));

    validChildren.forEach((childName, i) => {
      walk(childName, prefix + childPrefix, depth + 1, i === validChildren.length - 1);
    });
  }

  if (graph.root && graph.nodes.has(graph.root)) {
    walk(graph.root, '', 0, true);
  }

  return result;
}

// ── Props ──

interface ModuleTreeProps {
  graph: ModuleGraph | null;
  moduleStatuses: Map<string, string>;
  loadedModules: Set<string>;
  currentAgent: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}

export default function ModuleTree(props: ModuleTreeProps) {
  const renderer = useRenderer();
  const termWidth = () => (renderer?.width ?? 80) - 4;

  const nodes = createMemo(() => {
    if (!props.graph) return [];
    return flattenTree(props.graph, props.currentAgent, props.moduleStatuses, props.loadedModules);
  });

  const [selectedIdx, setSelectedIdx] = createSignal(0);
  let scrollEl: { scrollTo?: (y: number) => void } | null = null;

  useKeyboard((key) => {
    const list = nodes();
    if (list.length === 0) return;

    if (key.name === 'up') {
      setSelectedIdx(prev => {
        const next = prev > 0 ? prev - 1 : list.length - 1;
        scrollEl?.scrollTo?.(Math.max(0, next - 3));
        return next;
      });
      key.preventDefault();
    } else if (key.name === 'down') {
      setSelectedIdx(prev => {
        const next = prev < list.length - 1 ? prev + 1 : 0;
        scrollEl?.scrollTo?.(Math.max(0, next - 3));
        return next;
      });
      key.preventDefault();
    } else if (key.name === 'left') {
      // 跳到父节点（最近的上一个 depth 更小的节点）
      setSelectedIdx(prev => {
        const cur = list[prev];
        if (!cur) return prev;
        for (let i = prev - 1; i >= 0; i--) {
          if (list[i]!.depth < cur.depth) {
            scrollEl?.scrollTo?.(Math.max(0, i - 3));
            return i;
          }
        }
        return prev; // 已是顶层，不变
      });
      key.preventDefault();
    } else if (key.name === 'right') {
      // 跳到第一个子节点；无子节点则跳到下一个兄弟
      setSelectedIdx(prev => {
        const cur = list[prev];
        if (!cur) return prev;
        // 找子节点：下一个 depth 更大的节点
        for (let i = prev + 1; i < list.length; i++) {
          if (list[i]!.depth > cur.depth) {
            scrollEl?.scrollTo?.(Math.max(0, i - 3));
            return i;
          }
          if (list[i]!.depth <= cur.depth) break; // 没有子节点，退出
        }
        // 无子节点：选下一个兄弟
        if (prev < list.length - 1) {
          scrollEl?.scrollTo?.(Math.max(0, prev + 1 - 3));
          return prev + 1;
        }
        return prev;
      });
      key.preventDefault();
    } else if (key.name === 'return') {
      const node = list[selectedIdx()];
      if (node) props.onSelect(node.name);
      key.preventDefault();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0d1117">
      <box
        flexDirection="row"
        justifyContent="space-between"
        height={1}
        padding={0}
        backgroundColor="#161b22"
        focused={true}
      >
        <text fg="#58a6ff"> 模块树 </text>
        <text fg="#888888" dim>↑↓←→ 导航  Enter 切换  Esc 关闭</text>
      </box>
      {/*
        隐藏 input：OpenTUI 的键盘事件路由依赖聚焦的 input 元素。
        没有 input 聚焦时方向键不会被派发到 useKeyboard 处理器。
        此 input 不可见，仅用于接收键盘事件。
      */}
      <input
        width={0}
        height={0}
        visible={false}
        value=""
        keyBindings={[]}
      />
      <scrollbox ref={(el: any) => { scrollEl = el; }} flexGrow={1}>
        <box flexDirection="column">
          {(() => {
            const list = nodes();
            const sel = selectedIdx();
            return list.map((node, i) => {
              const isSelected = i === sel;
              const statusIcon = STATUS_SYMBOL[node.status] || '◌';
              const statusFg = STATUS_COLOR[node.status] || '#888888';
              const nameFg = node.isCurrent ? '#58a6ff' : '#c9d1d9';
              const descMax = Math.max(10, termWidth() - node.connector.length - node.name.length - 8);
              const desc = node.description.length > descMax
                ? node.description.slice(0, descMax - 1) + '…'
                : node.description;

              return (
                <box flexDirection="column" padding={0}>
                  <box
                    flexDirection="row"
                    height={1}
                    padding={0}
                    backgroundColor={isSelected ? '#1a2538' : 'transparent'}
                  >
                    <text fg={isSelected ? '#58a6ff' : '#555555'}>{isSelected ? '→ ' : '  '}</text>
                    <text fg="#555555">{node.connector}</text>
                    <text fg={statusFg}>{statusIcon} </text>
                    <text fg={nameFg} bold={node.isCurrent}>{node.name}</text>
                    <text fg="#888888" dim>{desc ? ` — ${desc}` : ''}</text>
                  </box>
                </box>
              );
            });
          })()}
        </box>
      </scrollbox>
    </box>
  );
}
