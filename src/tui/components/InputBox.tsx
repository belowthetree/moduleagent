import { createEffect, onCleanup, untrack } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { defaultLogger } from "../../core/Logger.js";
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

  // Auto show/hide command palette whenever input is non-empty
  createEffect(() => {
    const val = tuiState.inputValue();
    defaultLogger.info(`[InputBox] createEffect value: ${val}`);
    if (val.length > 0) {
      tuiState.setShowCommands(true);
    } else {
      tuiState.setShowCommands(false);
    }
  });

  useKeyboard((key) => {
    if (tuiState.agentStatus() === "streaming") return;

    defaultLogger.info(`[InputBox] key: ${key.name} seq: ${key.sequence} val: "${tuiState.inputValue()}"`);

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

    // Backspace: manually update inputValue since OpenTUI's onChange may not fire
    if (key.name === "backspace") {
      const val = tuiState.inputValue();
      if (val.length > 0) {
        tuiState.setInputValue(val.slice(0, -1));
        renderer.requestRender();
      }
      key.preventDefault();
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

    // Printable characters: manually append to inputValue since OpenTUI's onChange never fires
    if (key.name.length === 1 && !key.ctrl) {
      const val = tuiState.inputValue();
      tuiState.setInputValue(val + key.name);
      renderer.requestRender();
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
          defaultLogger.info(`[InputBox] onChange: "${value}"`);
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
