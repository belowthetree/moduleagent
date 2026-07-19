// ---------------------------------------------------------------------------
// tui/components/QuickPanel.tsx — 快速面板（模态弹窗）
// 按 Ctrl+P 呼出，显示可打开的面板及快捷键，↑↓ 选择，Enter 打开
// 数据构建和键盘处理都在此文件内完成
// ---------------------------------------------------------------------------

import { createSignal } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { tuiState } from '../state.js';
import type { KeyEvent } from '@opentui/core';
import fs from 'fs-extra';
import path from 'path';

interface QuickPanelEntry {
  label: string;
  keys: string;
  description: string;
  action: () => void;
}

function buildEntries(): QuickPanelEntry[] {
  const bridge = (globalThis as any).__tuiAgentService;
  const graph = bridge?.core?.getGraph?.();
  const result: QuickPanelEntry[] = [];

  result.push({
    label: '模块树',
    keys: 'Ctrl+X  T',
    description: '浏览模块依赖树',
    action: () => {
      tuiState.setScreen('tree');
      tuiState.setShowExperiencePanel(false);
    },
  });

  result.push({
    label: '经验浏览',
    keys: 'Ctrl+X  H',
    description: '查看模块经验记录',
    action: () => {
      if (tuiState.showExperiencePanel()) return;
      if (tuiState.experienceEntries().length === 0 && bridge?.core && graph) {
        const loaded: any[] = [];
        for (const [, node] of graph.nodes) {
          const expPath = path.join(node.absolutePath, 'experience.md');
          try {
            const content = fs.readFileSync(expPath, 'utf-8').trim();
            if (content) {
              const body = content.replace(/^# .+?\n+/, '').trim();
              if (body) loaded.push({ moduleName: node.name, content, filePath: expPath });
            }
          } catch { /* skip */ }
        }
        if (loaded.length > 0) tuiState.setExperienceEntries(loaded);
      }
      tuiState.setExperienceModuleIndex(-1);
      tuiState.setShowExperiencePanel(true);
      tuiState.setScreen('tree');
    },
  });

  result.push({
    label: '角色选择',
    keys: 'Ctrl+X  R',
    description: '查看并切换角色 Agent',
    action: () => {
      tuiState.setScreen('roles');
    },
  });

  return result;
}

export default function QuickPanel() {
  const renderer = useRenderer();
  const entries = buildEntries();
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  useKeyboard((key: KeyEvent) => {
    const list = entries;
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

  const panelWidth = Math.min(56, renderer?.width ?? 80);

  return (
    <box flexDirection="column" width="100%" height="100%">
      <input width={0} height={0} visible={false} value="" keyBindings={[]} />

      {/* 暗色遮罩 + 垂直居中 */}
      <box flexDirection="column" width="100%" height="100%" alignSelf="center" justifyContent="center">
        <box
          flexDirection="column"
          width={panelWidth}
          alignSelf="center"
          backgroundColor="#161b22"
          borderStyle="round"
          borderColor="#58a6ff"
          padding={1}
        >
          <text fg="#58a6ff" bold>快捷面板</text>
          <text fg="#555555" dim height={1}>——————————————</text>

          {(() => {
            const sel = selectedIdx();
            return entries.map((entry, i) => {
              const isSelected = i === sel;
              return (
                <box flexDirection="row" height={1}>
                  <text width={2} fg={isSelected ? '#58a6ff' : '#555555'}>
                    {isSelected ? '▸' : ' '}
                  </text>
                  <text width={18} fg={isSelected ? '#58a6ff' : '#c9d1d9'} bold={isSelected}>
                    {entry.label}
                  </text>
                  <text width={14} fg="#FFA07A" dim>
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
          <text fg="#555555" dim height={1}>
            ↑↓ 选择  Enter 打开  Esc 关闭
          </text>
        </box>
      </box>
    </box>
  );
}
