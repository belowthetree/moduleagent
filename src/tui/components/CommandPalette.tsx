import { createSignal, createMemo, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { tuiState } from "../state.js";

interface CommandItem {
  name: string;
  description: string;
}

const COMMANDS: CommandItem[] = [
  { name: "/list", description: "列出所有模块" },
  { name: "/tree", description: "显示模块树形结构及状态" },
  { name: "/rescan", description: "重新扫描项目模块" },
  { name: "/get", description: "查看模块详情" },
  { name: "/module", description: "切换模块" },
  { name: "/mode", description: "查看/切换 agent 模式" },
  { name: "/role", description: "角色 Agent 管理 (list/start/stop/cancel)" },
  { name: "/workflow", description: "工作流管理 (list/run/status/cancel)" },
  { name: "/status", description: "显示子系统运行状态" },
  { name: "/thought", description: "切换思考内容可见性" },
  { name: "/save", description: "保存当前对话" },
  { name: "/load", description: "加载历史对话" },
  { name: "/setup", description: "重新配置项目" },
  { name: "/clear", description: "清空当前 agent 上下文" },
  { name: "/clearAll", description: "清理所有 agent 上下文及历史记录" },
  { name: "/diff", description: "工作区变更查看/写回/丢弃" },
  { name: "/help", description: "显示帮助" },
  { name: "/quit", description: "退出 TUI" },
];

// 子命令定义：当用户输入 "/cmd " 时显示的选项
const SUB_COMMANDS: Record<string, CommandItem[]> = {
  "/mode": [], // 动态填充
  "/role": [
    { name: "/role list", description: "列出所有角色" },
    { name: "/role start", description: "启动角色" },
    { name: "/role stop", description: "停止角色" },
    { name: "/role cancel", description: "取消当前操作" },
  ],
  "/workflow": [
    { name: "/workflow list", description: "列出工作流" },
    { name: "/workflow run", description: "执行工作流" },
    { name: "/workflow status", description: "工作流状态" },
    { name: "/workflow cancel", description: "取消工作流" },
  ],
  "/diff": [
    { name: "/diff apply", description: "写回所有变更" },
    { name: "/diff discard", description: "丢弃所有变更" },
  ],
};

export default function CommandPalette() {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let scrollEl: { scrollTo?: (y: number) => void } | null = null;

  const filterText = createMemo(() => {
    const value = tuiState.inputValue();
    return value.startsWith("/") ? value.slice(1) : value;
  });

  // 检测是否已选择命令 + 空格，需要展示子命令
  const subCommandParent = createMemo((): string | null => {
    const value = tuiState.inputValue();
    if (!value.startsWith("/")) return null;
    const spaceIdx = value.indexOf(' ');
    if (spaceIdx < 2) return null; // 没有空格或只有 "/ "
    const cmdName = value.slice(0, spaceIdx);
    return cmdName in SUB_COMMANDS ? cmdName : null;
  });

  const filteredCommands = createMemo(() => {
    const value = tuiState.inputValue();
    const parent = subCommandParent();
    if (parent) {
      // 子命令模式：动态获取 /mode 的子命令
      if (parent === '/mode') {
        const service = (globalThis as any).__tuiAgentService;
        const modes = service?.getAgentModes?.() ?? [];
        return modes.map((m: any) => ({
          name: `/mode ${m.value}`,
          description: m.name + (m.current ? ' (current)' : ''),
        }));
      }
      const subs = SUB_COMMANDS[parent] || [];
      const afterSpace = value.slice(value.indexOf(' ') + 1).toLowerCase();
      if (!afterSpace) return subs;
      return subs.filter(s => s.name.toLowerCase().includes(afterSpace));
    }

    const filter = filterText();
    if (!filter) return COMMANDS;
    return COMMANDS.filter((cmd) =>
      cmd.name.toLowerCase().startsWith("/" + filter.toLowerCase())
    );
  });

  const noMatch = createMemo(() => filteredCommands().length === 0);

  useKeyboard((key: KeyEvent) => {
    if (tuiState.screen() !== 'chat') return;
    if (!tuiState.showCommands()) return;

    const cmds = filteredCommands();
    const max = cmds.length - 1;

    if (key.name === "up") {
      setSelectedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : max;
        scrollEl?.scrollTo?.(Math.max(0, next - 2));
        return next;
      });
      key.preventDefault();
    } else if (key.name === "down") {
      setSelectedIndex((prev) => {
        const next = prev < max ? prev + 1 : 0;
        scrollEl?.scrollTo?.(Math.max(0, next - 2));
        return next;
      });
      key.preventDefault();
    } else if (key.name === "enter" || key.name === "return" || key.name === "tab") {
      if (cmds.length > 0 && cmds[selectedIndex()]) {
        const selName = cmds[selectedIndex()].name;
        const parent = subCommandParent();
        if (parent) {
          // 子命令模式：保留已输入的 "/mode " 前缀
          const value = tuiState.inputValue();
          const spaceIdx = value.indexOf(' ');
          const prefix = value.slice(0, spaceIdx + 1);
          tuiState.setInputValue(prefix + selName.slice(parent.length + 1));
        } else {
          tuiState.setInputValue(selName);
        }
        tuiState.setShowCommands(false);
      }
      key.preventDefault();
    } else if (key.name === "escape") {
      tuiState.setShowCommands(false);
      tuiState.setInputValue("");
      key.preventDefault();
    }
  });

  // 将 visible + cmds + selectedIndex 合并为一个 memo，确保任一变化都重建列表
  const renderedList = createMemo(() => {
    if (!tuiState.showCommands()) return null;
    const cmds = filteredCommands();
    if (cmds.length === 0) {
      return (
        <box height={1} padding={0}>
          <text fg="#888888">  无匹配命令</text>
        </box>
      );
    }
    const sel = selectedIndex();
    return (
      <scrollbox ref={(el: any) => { scrollEl = el; }} flexGrow={1} stickyScroll={false}>
        {cmds.map((cmd, i) => (
          <box
            flexDirection="row"
            height={1}
            padding={0}
            backgroundColor={i === sel ? "#44475a" : "transparent"}
          >
            <text fg={i === sel ? "#ffffff" : "#f8f8f2"}>
              {" "}{cmd.name}{"  "}{cmd.description}
            </text>
          </box>
        ))}
      </scrollbox>
    );
  });

  return (
    <Show when={tuiState.showCommands()}>
      <box
        flexDirection="column"
        position="absolute"
        bottom={6}
        width="100%"
        maxHeight={8}
        backgroundColor="#1e1e2e"
        borderStyle="single"
        padding={0}
      >
        {renderedList()}
      </box>
    </Show>
  );
}
