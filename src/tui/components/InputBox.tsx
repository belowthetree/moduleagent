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

  // 焦点移开时自动重聚焦输入框（程序化焦点变化的安全网）
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

  // 仅在输入以 "/" 开头时自动显示/隐藏命令面板
  createEffect(() => {
    const val = tuiState.inputValue();
    defaultLogger.info(`[InputBox] createEffect value: ${val}`);
    if (val.startsWith("/")) {
      tuiState.setShowCommands(true);
    } else {
      tuiState.setShowCommands(false);
    }
  });

  useKeyboard((key) => {
    if (tuiState.agentStatus() === "streaming") return;

    defaultLogger.info(`[InputBox] key: ${key.name} seq: ${key.sequence} val: "${tuiState.inputValue()}"`);

    const val = tuiState.inputValue();

    // 回车：提交消息或命令
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

    // 退格：手动更新 inputValue，因为 OpenTUI 的 onChange 可能不会触发
    if (key.name === "backspace") {
      const val = tuiState.inputValue();
      if (val.length > 0) {
        tuiState.setInputValue(val.slice(0, -1));
        renderer.requestRender();
      }
      key.preventDefault();
      return;
    }

    // Escape：关闭命令面板并清空输入
    if (key.name === "escape") {
      tuiState.setShowCommands(false);
      tuiState.setInputValue("");
      key.preventDefault();
      return;
    }

    // Tab：命令面板显示时阻止插入字面 Tab
    if (key.name === "tab" && tuiState.showCommands()) {
      key.preventDefault();
      return;
    }

    // 可打印字符：手动追加到 inputValue，因 OpenTUI 的 onChange 从不触发
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
