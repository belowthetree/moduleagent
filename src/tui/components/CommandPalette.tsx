import { createSignal, createMemo, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { tuiState } from "../state.js";

interface CommandItem {
  name: string;
  description: string;
}

const COMMANDS: CommandItem[] = [
  { name: "/list", description: "列出所有模块" },
  { name: "/get", description: "查看模块详情" },
  { name: "/mode", description: "切换 agent 模式" },
  { name: "/clear", description: "清空上下文" },
  { name: "/help", description: "显示帮助" },
  { name: "/quit", description: "退出 TUI" },
];

export default function CommandPalette() {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const filterText = createMemo(() => {
    const value = tuiState.inputValue();
    if (value.startsWith("/")) {
      return value.slice(1);
    }
    return "";
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
    if (!tuiState.showCommands()) return;

    const cmds = filteredCommands();
    const max = cmds.length - 1;

    if (key.name === "up") {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : max));
      key.preventDefault();
    } else if (key.name === "down") {
      setSelectedIndex((prev) => (prev < max ? prev + 1 : 0));
      key.preventDefault();
    } else if (key.name === "enter" || key.name === "return") {
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

  return (
    <Show when={tuiState.showCommands()}>
      <box
        flexDirection="column"
        position="absolute"
        bottom={3}
        width="100%"
        maxHeight={8}
        backgroundColor="#1e1e2e"
        borderStyle="single"
        padding={0}
      >
        <Show
          when={!noMatch()}
          fallback={
            <box height={1} padding={0}>
              <text fg="#888888">  无匹配命令</text>
            </box>
          }
        >
          <For each={filteredCommands()}>
            {(cmd, index) => (
              <box
                flexDirection="row"
                height={1}
                padding={0}
                backgroundColor={index() === selectedIndex() ? "#44475a" : "transparent"}
              >
                <text fg={index() === selectedIndex() ? "#ffffff" : "#f8f8f2"}>
                  {" "}{cmd.name}{"  "}{cmd.description}
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  );
}
