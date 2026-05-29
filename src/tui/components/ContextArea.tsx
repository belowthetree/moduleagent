import { For, createMemo } from "solid-js";
import { tuiState } from "../state.js";
import type { ChatMessage, MessageType } from "../types.js";

// ── 消息类型 → 视觉映射 ──

const TYPE_ICON: Record<MessageType, string> = {
  user:          "👤 ",
  agent_reply:   "🤖 ",
  agent_thought: "💭 ",
  tool_call:     "🔧 ",
  system:        "ℹ️ ",
  cross_context: "🔗 ",
};

const TYPE_FG: Record<MessageType, string | undefined> = {
  user:          "#5CFF5C",
  agent_reply:   undefined,   // 默认前景色
  agent_thought: "#888888",   // 灰色斜体感
  tool_call:     "#FFD700",   // 金色
  system:        "#888888",
  cross_context: "#5BADFF",   // 蓝色
};

const TYPE_LABEL: Record<MessageType, string> = {
  user:          "",
  agent_reply:   "",
  agent_thought: "[思考] ",
  tool_call:     "",
  system:        "",
  cross_context: "[跨模块] ",
};

// ── 过滤后的消息 ──

function filterMessages(msgs: ChatMessage[]): ChatMessage[] {
  const showThought = tuiState.showThought();
  if (showThought) return msgs;
  return msgs.filter(m => m.msgType !== 'agent_thought');
}

export default function ContextArea() {
  const visibleMessages = createMemo(() => filterMessages(tuiState.messages()));

  return (
    <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
      <box flexDirection="column">
        <For each={visibleMessages()}>
          {(msg) => {
            const fg = TYPE_FG[msg.msgType];
            const icon = TYPE_ICON[msg.msgType];
            const label = TYPE_LABEL[msg.msgType];

            return (
              <box flexDirection="column" padding={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={fg}>
                    {icon}{label}{msg.content}
                  </text>
                  <text fg="#666666">{msg.time}</text>
                </box>
              </box>
            );
          }}
        </For>
      </box>
    </scrollbox>
  );
}
