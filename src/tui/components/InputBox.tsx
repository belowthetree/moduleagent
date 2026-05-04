import { createEffect, onCleanup, untrack } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { tuiState } from "../state.js";

export default function InputBox(props: {
  onSend: (text: string) => void;
  onCommand: (text: string) => void;
}) {
  const renderer = useRenderer();
  let inputEl: unknown = null;

  // Auto re-focus input when focus moves elsewhere (safety net for programmatic focus changes)
  createEffect(() => {
    const handler = (current: unknown) => {
      if (untrack(() => tuiState.agentStatus()) === "streaming") return;
      if (current !== inputEl && inputEl) {
        (inputEl as { focus?: () => void }).focus?.();
      }
    };
    renderer.on("focused_renderable", handler);
    onCleanup(() => renderer.off("focused_renderable", handler));
  });

  useKeyboard((key) => {
    if (tuiState.agentStatus() === "streaming") return;

    const val = tuiState.inputValue();

    // Enter: submit message or command
    if (key.name === "return" || key.name === "enter") {
      if (val.startsWith("/")) {
        props.onCommand(val);
      } else if (val.trim()) {
        props.onSend(val);
      }
      tuiState.setInputValue("");
      tuiState.setShowCommands(false);
      key.preventDefault();
      return;
    }

    // Typing "/" triggers command palette
    if (key.name === "/" || key.sequence === "/") {
      tuiState.setShowCommands(true);
      return;
    }

    // Escape: dismiss command palette and clear input
    if (key.name === "escape") {
      tuiState.setShowCommands(false);
      tuiState.setInputValue("");
      key.preventDefault();
      return;
    }

    // Tab: prevent literal tab insertion when command palette is showing
    if (key.name === "tab" && tuiState.showCommands()) {
      key.preventDefault();
      return;
    }
  });

  const isStreaming = () => tuiState.agentStatus() === "streaming";

  return (
    <box flexDirection="row" height={1} padding={0}>
      <input
        ref={(el: unknown) => { inputEl = el; }}
        placeholder="输入消息 (输入 / 查看命令)..."
        width="100%"
        value={tuiState.inputValue()}
        focused={!isStreaming()}
        opacity={isStreaming() ? 0.5 : 1}
        onChange={(value: string) => {
          if (tuiState.agentStatus() !== "streaming") {
            tuiState.setInputValue(value);
            if (!value.startsWith("/")) {
              tuiState.setShowCommands(false);
            }
            renderer.requestRender();
          }
        }}
      />
    </box>
  );
}
