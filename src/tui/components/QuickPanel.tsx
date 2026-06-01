// ---------------------------------------------------------------------------
// tui/components/QuickPanel.tsx — 快速面板
// 按 Ctrl+P 呼出，显示可打开的面板及快捷键，↑↓ 选择，Enter 打开
// ---------------------------------------------------------------------------

import { createMemo, For } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { tuiState } from '../state.js';
import type { KeyEvent } from '@opentui/core';

export default function QuickPanel() {
  const renderer = useRenderer();
  const entries = () => tuiState.quickPanelEntries();

  // 选中的索引由 state 管理以便外部设置
  const selectedIndex = () => {
    const current = (globalThis as any).__quickPanelIndex;
    return typeof current === 'number' ? current : 0;
  };

  const setSelectedIndex = (v: number) => {
    (globalThis as any).__quickPanelIndex = v;
    renderer.requestRender();
  };

  useKeyboard((key: KeyEvent) => {
    const list = entries();
    const idx = selectedIndex();

    if (key.name === 'escape' || (key.ctrl && key.name === 'p')) {
      tuiState.setShowQuickPanel(false);
      key.preventDefault();
      return;
    }

    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex(idx > 0 ? idx - 1 : list.length - 1);
      key.preventDefault();
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex(idx < list.length - 1 ? idx + 1 : 0);
      key.preventDefault();
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      const entry = list[idx];
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
      {/* 顶部留白 */}
      <text height={3}> </text>

      {/* 面板框 */}
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

        <For each={entries()}>
          {(entry, i) => {
            const isSelected = i() === selectedIndex();
            return (
              <box
                flexDirection="row"
                height={1}
                backgroundColor={isSelected ? '#1a2538' : 'transparent'}
              >
                <text fg={isSelected ? '#58a6ff' : '#555555'}>
                  {isSelected ? ' → ' : '    '}
                </text>
                <text
                  fg="#c9d1d9"
                  bold={isSelected}
                  width={20}
                >
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
          }}
        </For>

        <text height={1}> </text>
        <text fg="#555555" dim>
          {'  '}↑↓ 选择 &nbsp; Enter 打开 &nbsp; Esc 关闭
        </text>
      </box>
    </box>
  );
}
