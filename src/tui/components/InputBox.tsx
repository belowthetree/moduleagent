import { createEffect, onCleanup, untrack } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
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

  // ── CJK 光标修正 ──
  // 每次 inputValue 变化后，将光标强制设置到文字末尾的正确视觉列位置。
  // gotoLineEnd() 内部使用 OpenTUI 的 wcwidth（由 OPENTUI_FORCE_WCWIDTH 控制），
  // 但为保证万无一失，我们用 cjkDisplayWidth 计算视觉列并显式设置。
  // 上次已处理的值 — 避免重复设置光标
  let lastCursorVal = '';

  createEffect(() => {
    const val = tuiState.inputValue();
    const el = inputEl as { gotoLineEnd?: () => void; cursorOffset?: number } | null;

    // 延迟到下一微任务，确保 OpenTUI 已完成 setText() 内部处理
    queueMicrotask(() => {
      if (!el?.gotoLineEnd) return;
      // 值未变则跳过
      if (val === lastCursorVal) return;
      lastCursorVal = val;

      try {
        if (val.length === 0) {
          el.cursorOffset = 0;
        } else {
          el.gotoLineEnd();
        }
      } catch {
        // OpenTUI 内部状态不一致时忽略（如流式响应刚结束的瞬态）
      }
    });
  });

  useKeyboard((key) => {
    if (tuiState.agentStatus() === "streaming") return;

    defaultLogger.info(`[InputBox] key: ${key.name} seq: ${key.sequence} val: "${tuiState.inputValue()}"`);

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
      tuiState.setHistoryIndex(idx);
      tuiState.setInputValue(history[idx] || '');
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
      if (idx >= history.length) {
        tuiState.setHistoryIndex(-1);
        tuiState.setInputValue('');
      } else {
        tuiState.setHistoryIndex(idx);
        tuiState.setInputValue(history[idx] || '');
      }
      renderer.requestRender();
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

    // 空格：手动追加（OpenTUI 中 key.name 为 "space"，不匹配普通字符判断）
    if (key.name === "space") {
      tuiState.setInputValue(tuiState.inputValue() + ' ');
      renderer.requestRender();
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
  const termWidth = () => renderer?.width ?? 80;
  const blueRule = () => '─'.repeat(Math.max(termWidth() - 2, 20));

  return (
    <box flexDirection="column" padding={0} flexShrink={0} minHeight={4}>
      <text fg="#5BADFF" height={1}>{blueRule()}</text>
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
      <text fg="#5BADFF" height={1}>{blueRule()}</text>
    </box>
  );
}
