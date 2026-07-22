// ---------------------------------------------------------------------------
// tui/components/ContextArea.tsx — TUI 聊天上下文区域组件
// 渲染消息列表、思考内容、工具调用时间线
// ---------------------------------------------------------------------------

import { createMemo, createSignal, onCleanup } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { tuiState } from "../state.js";
import type { ChatMessage, MessageType } from "../types.js";

const SCROLL_LINE_STEP = 6;
const BOTTOM_FIXED_ROWS = 5;
const PAGE_OVERLAP = 5;

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
    const collapsedCross = tuiState.collapsedCrossContext();
    return msgs.map(m => ({
      ...m,
      _collapsed: collapsed.has(m.id),
      _crossCollapsed: collapsedCross.has(m.id),
    }));
  });

  // ── 翻页/滚轮键盘事件 ──

  useKeyboard((key) => {
    if (!scrollEl) return;

    if (key.name === 'pageup') {
      const visibleRows = (renderer?.height ?? 40) - BOTTOM_FIXED_ROWS;
      const scrollAmount = Math.max(1, visibleRows - PAGE_OVERLAP);
      scrollEl.scrollTop = Math.max(0, (scrollEl.scrollTop ?? 0) - scrollAmount);
      setSticky(false);
      key.preventDefault();
    } else if (key.name === 'pagedown') {
      const visibleRows = (renderer?.height ?? 40) - BOTTOM_FIXED_ROWS;
      const scrollAmount = Math.max(1, visibleRows - PAGE_OVERLAP);
      scrollEl.scrollTop = (scrollEl.scrollTop ?? 0) + scrollAmount;
      key.preventDefault();
    } else if (key.ctrl && key.name === 'home') {
      scrollEl.scrollTop = 0;
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

  function handleMouseScroll(deltaY: number, e?: any) {
    if (!scrollEl) return;
    e?.preventDefault?.();
    const visibleRows = (renderer?.height ?? 40) - BOTTOM_FIXED_ROWS;
    const step = Math.max(6, Math.floor(visibleRows / 5));
    if (deltaY > 0) {
      scrollEl.scrollTop = (scrollEl.scrollTop ?? 0) + step;
    } else if (deltaY < 0) {
      scrollEl.scrollTop = Math.max(0, (scrollEl.scrollTop ?? 0) - step);
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
        handleMouseScroll(e.deltaY ?? 0, e);
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
                      <text fg={fg} attributes={TextAttributes.ITALIC}>
                        {isThought ? (collapsed ? '▸ ' : '▾ ') : ''}{label}
                      </text>
                      {msg.time ? <text fg="#666666">{msg.time}</text> : null}
                    </box>
                    {collapsed ? (
                      <text fg="#555555" attributes={TextAttributes.DIM} selectable>
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

            // ── 跨模块通信消息：可点击展开 ──
            if (msg.msgType === 'cross_context') {
              const crossContent = msg.content || '';
              const firstLine = crossContent.split('\n')[0] || crossContent;
              const bodyLines = crossContent.split('\n').slice(1).join('\n');
              const collapsed = (msg as any)._crossCollapsed ?? true;
              const toggle = () => {
                const set = new Set(tuiState.collapsedCrossContext());
                if (collapsed) set.delete(msg.id);
                else set.add(msg.id);
                tuiState.setCollapsedCrossContext(set);
              };

              return (
                <box flexDirection="column" padding={0} marginBottom={1}>
                  <box
                    flexDirection="column"
                    padding={0}
                    backgroundColor="#1e2433"
                    borderStyle="rounded"
                    borderColor="#2d3548"
                    onMouseDown={(e: any) => { toggle(); e?.preventDefault?.(); }}
                  >
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg="#5BADFF" attributes={TextAttributes.ITALIC}>
                        {collapsed ? '▸ ' : '▾ '}跨模块通信
                      </text>
                      {msg.time ? <text fg="#666666">{msg.time}</text> : null}
                    </box>
                    <text fg="#5BADFF" attributes={TextAttributes.DIM} selectable>{firstLine}</text>
                    {collapsed ? (
                      bodyLines ? (
                        <text fg="#555555" attributes={TextAttributes.DIM} selectable>
                          {bodyLines.length > 60
                            ? bodyLines.slice(0, 60).replace(/\n/g, ' ') + '…'
                            : bodyLines.replace(/\n/g, ' ')}
                        </text>
                      ) : null
                    ) : (
                      <text fg="#9ACFFF" selectable>{bodyLines || firstLine}</text>
                    )}
                  </box>
                </box>
              );
            }

            // ── 系统消息：简单文本 ──
            return (
              <box flexDirection="column" padding={0}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg="#888888" selectable={true} attributes={TextAttributes.DIM}>
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
