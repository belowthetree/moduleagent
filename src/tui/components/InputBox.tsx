import { useKeyboard, useRenderer } from "@opentui/solid";
import { tuiState } from "../state.js";

export default function InputBox(props: {
  onSend: (text: string) => void;
  onCommand: (text: string) => void;
}) {
  const renderer = useRenderer();

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

    // Backspace: dismiss command palette when only "/" remains
    if (key.name === "backspace") {
      if (val === "/") {
        tuiState.setShowCommands(false);
      }
      return;
    }
  });

  const isStreaming = () => tuiState.agentStatus() === "streaming";

  return (
    <box flexDirection="row" height={1} padding={0}>
      <input
        placeholder="输入消息 (输入 / 查看命令)..."
        width="100%"
        value={tuiState.inputValue()}
        focused={!isStreaming()}
        opacity={isStreaming() ? 0.5 : 1}
        onChange={(value: string) => {
          if (tuiState.agentStatus() !== "streaming") {
            tuiState.setInputValue(value);
          }
        }}
      />
    </box>
  );
}
