// ---------------------------------------------------------------------------
// tui/components/QuickPanel.tsx — 快速面板
// 按 Ctrl+P 呼出，显示可打开的面板及快捷键，↑↓ 选择，Enter 打开
// ---------------------------------------------------------------------------

import { createSignal } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { tuiState } from '../state.js';
import type { KeyEvent } from '@opentui/core';


export default function QuickPanel() {
  const renderer = useRenderer();
  const entries = () => tuiState.quickPanelEntries();
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  useKeyboard((key: KeyEvent) => {
    const list = entries();
    if (list.length === 0) return;

    if (key.name === 'escape' || (key.ctrl && key.name === 'p')) {
      tuiState.setShowQuickPanel(false);
      return;
    }

    if (key.name === 'up' || key.name === 'k') {
      setSelectedIdx(prev => prev > 0 ? prev - 1 : list.length - 1);
      key.preventDefault();
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      setSelectedIdx(prev => prev < list.length - 1 ? prev + 1 : 0);
      key.preventDefault();
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      const entry = list[selectedIdx()];
      if (entry) {
        tuiState.setShowQuickPanel(false);
        entry.action();
      }
      key.preventDefault();
      return;
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/*
        隐藏 input：OpenTUI 的键盘事件路由依赖聚焦的 input 元素。
        没有 input 聚焦时 useKeyboard 不会被派发。
      */}
      <input
        width={0}
        height={0}
        visible={false}
        value=""
        keyBindings={[]}
      />
      <text height={3}> </text>
      <box
        flexDirection="column"
        width={Math.min(56, renderer?.width ?? 80)}
        alignSelf="center"
        backgroundColor="#161b22"
        borderStyle="round"
        borderColor="#58a6ff"
        padding={1}
      >
        <text fg="#58a6ff" bold>  快捷面板</text>
        <text fg="#888888" dim>  ———————————</text>
        <text height={1}> </text>

        {(() => {
          const list = entries();
          const sel = selectedIdx();
          return list.map((entry, i) => {
            const isSelected = i === sel;
            return (
              <box flexDirection="row" height={1} backgroundColor="#161b22">
                <text fg={isSelected ? '#58a6ff' : '#555555'}>
                  {isSelected ? '▸ ' : '  '}
                </text>
                <text fg={isSelected ? '#58a6ff' : '#c9d1d9'} bold={isSelected} width={20}>
                  {entry.label}
                </text>
                <text fg="#FFA07A" dim width={16}>
                  {entry.keys}
                </text>
                <text fg="#888888" dim>
                  {entry.description}
                </text>
              </box>
            );
          });
        })()}

        <text height={1}> </text>
        <text fg="#555555" dim>
          {'  '}↑↓ 选择 &nbsp; Enter 打开 &nbsp; Esc 关闭
        </text>
      </box>
    </box>
  );
}


