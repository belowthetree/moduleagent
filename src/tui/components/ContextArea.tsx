import { createMemo } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { tuiState } from "../state.js";
import type { ChatMessage, MessageType } from "../types.js";

// ── 消息类型 → 标签 ──

const TYPE_LABEL: Record<MessageType, string> = {
  user:          "",
  agent_reply:   "回复",
  agent_thought: "推理",
  tool_call:     "工具",
  system:        "",
  cross_context: "",
};

const TYPE_FG: Record<MessageType, string | undefined> = {
  user:          undefined,
  agent_reply:   "#5CFF5C",
  agent_thought: "#5BADFF",
  tool_call:     "#FFD700",
  system:        "#888888",
  cross_context: "#5BADFF",
};

export default function ContextArea() {
  const renderer = useRenderer();

  // 屏幕宽度（用于绘制分隔线）
  const termWidth = () => renderer?.width ?? 80;

  // 合并 messages + collapsedThoughts → 提取 _collapsed 标记
  const renderedMessages = createMemo(() => {
    const msgs = tuiState.messages();
    const collapsed = tuiState.collapsedThoughts();
    return msgs.map(m => ({
      ...m,
      _collapsed: collapsed.has(m.id),
    }));
  });

  return (
    <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
      <box flexDirection="column">
        {renderedMessages().map((msg) => {
            // ── 用户消息：双横线夹内容 ──
            if (msg.msgType === 'user') {
              const rule = '─'.repeat(Math.max(termWidth() - 2, 20));
              return (
                <box flexDirection="column">
                  <text fg="#555555">{rule}</text>
                  <box flexDirection="row" justifyContent="space-between" padding={0}>
                    <text selectable>{msg.content}</text>
                    <text fg="#666666">{msg.time}</text>
                  </box>
                  <text fg="#555555">{rule}</text>
                </box>
              );
            }

            // ── Agent 消息（回复/推理/工具）：标签行 + 内容 ──
            if (msg.msgType === 'agent_reply' || msg.msgType === 'agent_thought' || msg.msgType === 'tool_call') {
              // 空消息不渲染
              if (!msg.content) return null;

              const label = TYPE_LABEL[msg.msgType];
              const fg = TYPE_FG[msg.msgType];
              const isThought = msg.msgType === 'agent_thought';
              const collapsed = isThought && (msg as any)._collapsed;
              const toggle = isThought
                ? () => {
                    const set = new Set(tuiState.collapsedThoughts());
                    if (collapsed) set.delete(msg.id);
                    else set.add(msg.id);
                    tuiState.setCollapsedThoughts(set);
                  }
                : undefined;

              return (
                <box flexDirection="column" padding={0} marginBottom={1}>
                  <box
                    flexDirection="column"
                    padding={0}
                    backgroundColor="#1e2433"
                    borderStyle="rounded"
                    borderColor="#2d3548"
                  >
                    <box
                      flexDirection="row"
                      justifyContent="space-between"
                      onMouseDown={isThought ? (e: any) => { toggle?.(); e?.preventDefault?.(); } : undefined}
                    >
                      <text fg={fg} style={{ italic: true }}>
                        {isThought ? (collapsed ? '▸ ' : '▾ ') : ''}{label}
                      </text>
                      {msg.time ? <text fg="#666666">{msg.time}</text> : null}
                    </box>
                    {collapsed ? (
                      <text fg="#555555" dim selectable>
                        {msg.content.length > 60
                          ? msg.content.slice(0, 60).replace(/\n/g, ' ') + '…'
                          : msg.content.replace(/\n/g, ' ')}
                      </text>
                    ) : (
                      <text selectable>{msg.content}</text>
                    )}
                  </box>
                </box>
              );
            }

            // ── 系统 / 跨模块消息：简单文本 ──
            const fg = TYPE_FG[msg.msgType] || "#888888";
            return (
              <box flexDirection="column" padding={0}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={fg} selectable={true} dim>
                    {msg.content}
                  </text>
                  {msg.time ? <text fg="#666666">{msg.time}</text> : null}
                </box>
              </box>
            );
          })}
      </box>
    </scrollbox>
  );
}
