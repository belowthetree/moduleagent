import { For } from "solid-js";
import { tuiState } from "../state.js";

function roleIcon(role: string): string {
  switch (role) {
    case "user":
      return "👤 ";
    case "agent":
      return "🤖 ";
    case "system":
      return "ℹ️ ";
    default:
      return "";
  }
}

function roleFg(role: string): string | undefined {
  switch (role) {
    case "user":
      return "#5CFF5C";
    case "agent":
      return undefined;
    case "system":
      return "#888888";
    default:
      return undefined;
  }
}

export default function ContextArea() {
  return (
    <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
      <box flexDirection="column">
        <For each={tuiState.messages()}>
          {(msg) => (
            <box flexDirection="column" padding={1}>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={roleFg(msg.role)}>
                  {roleIcon(msg.role)}
                  {msg.content}
                </text>
                <text fg="#666666">{msg.time}</text>
              </box>
            </box>
          )}
        </For>
      </box>
    </scrollbox>
  );
}
