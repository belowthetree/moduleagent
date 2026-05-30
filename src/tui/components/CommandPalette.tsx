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
  { name: "/mode", description: "切换 agent 模式" },
  { name: "/role", description: "角色 Agent 管理 (list/start/stop/cancel)" },
  { name: "/workflow", description: "工作流管理 (list/run/status/cancel)" },
  { name: "/status", description: "显示子系统运行状态" },
  { name: "/thought", description: "切换思考内容可见性" },
  { name: "/save", description: "保存当前对话" },
  { name: "/load", description: "加载历史对话" },
  { name: "/setup", description: "重新配置项目" },
  { name: "/clear", description: "清空当前 agent 上下文" },
  { name: "/clearAll", description: "清理所有 agent 上下文及历史记录" },
  { name: "/help", description: "显示帮助" },
  { name: "/quit", description: "退出 TUI" },
];

export default function CommandPalette() {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let scrollEl: { scrollTo?: (y: number) => void } | null = null;

  const filterText = createMemo(() => {
    const value = tuiState.inputValue();
    // 去掉前导 "/"，否则使用原始值
    return value.startsWith("/") ? value.slice(1) : value;
  });

  const filteredCommands = createMemo(() => {
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
        tuiState.setInputValue(cmds[selectedIndex()].name);
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
