// ---------------------------------------------------------------------------
// tui/components/ContextArea.tsx — TUI 聊天上下文区域组件
// 渲染消息列表、思考内容、工具调用时间线
// ---------------------------------------------------------------------------

import { createMemo, createSignal, onCleanup } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { tuiState } from "../state.js";
import type { ChatMessage, MessageType } from "../types.js";

const SCROLL_LINE_STEP = 4;

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

  // 粘性滚动状态：用户手动上滚时关闭，回到底部或新消息时恢复
  const [sticky, setSticky] = createSignal(true);

  let scrollEl: {
    scrollTo?: (y: number) => void;
    scrollBy?: (delta: number) => void;
    scrollToBottom?: () => void;
    scrollTop?: number;
  } | null = null;

  // 合并 messages + collapsedThoughts → 提取 _collapsed 标记
  const renderedMessages = createMemo(() => {
    const msgs = tuiState.messages();
    const collapsed = tuiState.collapsedThoughts();
    return msgs.map(m => ({
      ...m,
      _collapsed: collapsed.has(m.id),
    }));
  });

  // ── 翻页/滚轮键盘事件 ──

  useKeyboard((key) => {
    if (!scrollEl) return;

    if (key.name === 'pageup') {
      const height = renderer?.height ?? 40;
      scrollEl.scrollBy?.(height);
      setSticky(false);
      key.preventDefault();
    } else if (key.name === 'pagedown') {
      const height = renderer?.height ?? 40;
      scrollEl.scrollBy?.(-height);
      key.preventDefault();
    } else if (key.ctrl && key.name === 'home') {
      scrollEl.scrollTo?.(0);
      setSticky(false);
      key.preventDefault();
    } else if (key.ctrl && key.name === 'end') {
      scrollEl.scrollToBottom?.();
      setSticky(true);
      key.preventDefault();
    }
  });

  // ── 新消息时自动恢复 sticky ──

  const msgCount = () => tuiState.messages().length;
  createMemo(() => {
    const count = msgCount();
    if (sticky() && scrollEl?.scrollToBottom) {
      // 延迟一帧让内容先渲染再滚动
      setTimeout(() => {
        scrollEl?.scrollToBottom?.();
      }, 0);
    }
    return count;
  });

  onCleanup(() => {
    scrollEl = null;
  });

  // ── 滚轮事件 ──

  function handleMouseScroll(deltaY: number) {
    if (!scrollEl) return;
    if (deltaY > 0) {
      // 向下滚 → 往底部 → delta 为正
      scrollEl.scrollBy?.(-deltaY * SCROLL_LINE_STEP);
    } else if (deltaY < 0) {
      // 向上滚 → 离开底部
      scrollEl.scrollBy?.(-deltaY * SCROLL_LINE_STEP);
      setSticky(false);
    }
  }

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={sticky()}
      stickyStart="bottom"
      ref={(el: any) => { scrollEl = el; }}
      onMouseScroll={(e: any) => {
        handleMouseScroll(e.deltaY ?? 0);
      }}
    >
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
