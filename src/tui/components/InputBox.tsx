// ---------------------------------------------------------------------------
// tui/components/InputBox.tsx — TUI 输入框组件
// 支持文本输入、键盘事件、粘贴、输入历史导航
// ---------------------------------------------------------------------------

import { createEffect, onCleanup, untrack } from "solid-js";
import { useKeyboard, useRenderer, usePaste } from "@opentui/solid";
import { defaultLogger } from "../../core/Logger.js";
import { tuiState } from "../state.js";
import { cjkDisplayWidth } from "../cjk.js";

export default function InputBox(props: {
  onSend: (text: string) => void;
  onCommand: (text: string) => void;
}) {
  const renderer = useRenderer();
  let inputEl: unknown = null;

  // 焦点移开时自动重聚焦输入框（程序化焦点变化的安全网）
  // 不再在 streaming 时阻止重聚焦 — 用户可在 agent 输出时继续输入
  createEffect(() => {
    const handler = (current: unknown) => {
      if (current !== inputEl && inputEl) {
        (inputEl as { focus?: () => void }).focus?.();
      }
    };
    renderer.on("focused_renderable", handler);
    onCleanup(() => renderer.off("focused_renderable", handler));
  });

  // 输入以 "/" 开头时显示命令面板，命令后加空格显示子命令
  createEffect(() => {
    const val = tuiState.inputValue();
    if (val.startsWith("/")) {
      tuiState.setShowCommands(true);
    } else {
      tuiState.setShowCommands(false);
    }
  });

  // ── CJK 光标修正 ──
  // 仅在非键盘输入时（程序化设置值如加载历史、发送后清空）将光标移至末尾。
  let _skipCursorFix = false;
  let lastCursorVal = '';

  createEffect(() => {
    const val = tuiState.inputValue();
    const el = inputEl as { gotoLineEnd?: () => void; cursorOffset?: number } | null;

    queueMicrotask(() => {
      if (!el?.gotoLineEnd) return;
      if (val === lastCursorVal) return;
      lastCursorVal = val;

      if (_skipCursorFix) {
        _skipCursorFix = false;
        return;
      }

      try {
        if (val.length === 0) {
          el.cursorOffset = 0;
        } else {
          el.gotoLineEnd();
        }
      } catch {
        // OpenTUI 内部状态不一致时忽略
      }
    });
  });

  useKeyboard((key) => {
    defaultLogger.info(`[InputBox] key: ${key.name}`);
    if (tuiState.screen() !== 'chat') return;
    if (tuiState.showQuickPanel()) return;
    if (tuiState.showExperiencePanel()) return;
    // 不再阻止 streaming 时的键盘输入 — 消息会自动排队

    // Ctrl+C：流式输出中取消当前请求（在组件层处理，确保聚焦时也能触发）
    if (key.name === 'c' && key.ctrl) {
      defaultLogger.info(`[InputBox] cancel"`);
      if (tuiState.agentStatus() === 'streaming') {
        tuiState.setAgentStatus('idle');
        (globalThis as any).__tuiCancelStream?.();
      }
      key.preventDefault();
      return;
    }

    const val = tuiState.inputValue();

    // 回车：提交消息或命令
    if (key.name === "return" || key.name === "enter") {
      const text = val;
      if (text.startsWith("/")) {
        props.onCommand(text);
      } else if (text.trim()) {
        props.onSend(text);
      }
      // 添加到输入历史
      if (text.trim()) {
        const history = [...tuiState.inputHistory()];
        // 去重: 移除旧条目再推到末尾
        const existingIdx = history.lastIndexOf(text);
        if (existingIdx >= 0) history.splice(existingIdx, 1);
        history.push(text);
        if (history.length > 200) history.shift();
        tuiState.setInputHistory(history);
        tuiState.setHistoryIndex(history.length);
        // 触发后台持久化
        (globalThis as any).__tuiSaveHistory?.(history);
      }
      _skipCursorFix = true;
      tuiState.setInputValue("");
      tuiState.setShowCommands(false);
      key.preventDefault();
      return;
    }

    // 上箭头：输入历史回退
    if (key.name === "up" && !tuiState.showCommands()) {
      const history = tuiState.inputHistory();
      if (history.length === 0) { key.preventDefault(); return; }
      let idx = tuiState.historyIndex();
      if (idx === -1 || idx >= history.length) idx = history.length;
      idx = Math.max(0, idx - 1);
      _skipCursorFix = true;
      tuiState.setHistoryIndex(idx);
      tuiState.setInputValue(history[idx] || '');
      (inputEl as { gotoLineEnd?: () => void })?.gotoLineEnd?.();
      renderer.requestRender();
      key.preventDefault();
      return;
    }

    // 下箭头：输入历史前进
    if (key.name === "down" && !tuiState.showCommands()) {
      const history = tuiState.inputHistory();
      if (history.length === 0) { key.preventDefault(); return; }
      let idx = tuiState.historyIndex();
      if (idx === -1) { key.preventDefault(); return; }
      idx = idx + 1;
      _skipCursorFix = true;
      if (idx >= history.length) {
        tuiState.setHistoryIndex(-1);
        tuiState.setInputValue('');
      } else {
        tuiState.setHistoryIndex(idx);
        tuiState.setInputValue(history[idx] || '');
      }
      (inputEl as { gotoLineEnd?: () => void })?.gotoLineEnd?.();
      renderer.requestRender();
      key.preventDefault();
      return;
    }

    // Escape：关闭命令面板并清空输入
    if (key.name === "escape") {
      _skipCursorFix = true;
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

    // 字符键 / 退格 / 空格 — 全部交给 <input> 组件原生处理（onChange 会更新状态）。
    // 手动 cursorOffset 管理对 CJK 字符宽度计算不正确，让 OpenTUI 内部负责。
    if (
      key.name.length === 1 ||
      key.name === "space" ||
      key.name === "backspace"
    ) {
      return;
    }
  });

  // 粘贴处理（streaming 时也允许粘贴，消息自动排队）
  usePaste((event: { bytes: Uint8Array; preventDefault?: () => void }) => {
    if (tuiState.screen() !== 'chat') return;
    event.preventDefault?.(); // 阻止 <input> 内置粘贴，避免双重写入
    const text = new TextDecoder().decode(event.bytes);
    tuiState.setInputValue(tuiState.inputValue() + text);
    renderer.requestRender();
  });

  const isStreaming = () => tuiState.agentStatus() === "streaming";
  const termWidth = () => renderer?.width ?? 80;
  const blueRule = () => '─'.repeat(Math.max(termWidth() - 2, 20));

  return (
    <box flexDirection="column" padding={0} flexShrink={0} minHeight={3}>
      <text fg="#5BADFF" height={1}>{blueRule()}</text>
      <box flexDirection="row" height={1} padding={0}>
        <input
          ref={(el: unknown) => { inputEl = el; }}
          placeholder="输入消息 (输入 / 查看命令)..."
          width="100%"
          value={tuiState.inputValue()}
          focused={true}
          opacity={isStreaming() ? 0.7 : 1}
          onInput={(value: string) => {
            defaultLogger.info(`[InputBox] onInput: "${value}"`);
            _skipCursorFix = true; // 输入组件自行管理光标，不要让 effect 跳到末尾
            tuiState.setInputValue(value);
            if (!value.startsWith("/")) {
              tuiState.setShowCommands(false);
            }
            renderer.requestRender();
          }}
        />
      </box>
      <text fg="#5BADFF" height={1}>{blueRule()}</text>
    </box>
  );
}
