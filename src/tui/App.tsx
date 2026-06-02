// ---------------------------------------------------------------------------
// tui/App.tsx — TUI 主应用组件
// 使用 OpenTUI SolidJS 渲染主界面，管理键盘事件和屏幕切换
// ---------------------------------------------------------------------------

import { useKeyboard, useRenderer, useSelectionHandler } from '@opentui/solid';
import type { Selection, KeyEvent } from '@opentui/core';
import { tuiState } from './state.js';
import type { ChatMessage } from './types.js';
import StatusBar from './components/StatusBar.js';
import InputBox from './components/InputBox.js';
import ContextArea from './components/ContextArea.js';
import CommandPalette from './components/CommandPalette.js';
import SetupWizard from './components/SetupWizard.js';
import ModuleTree from './components/ModuleTree.js';
import DiffBar from './components/DiffBar.js';
import DiffPanel from './components/DiffPanel.js';
import ExperiencePanel from './components/ExperiencePanel.js';
import QuickPanel from './components/QuickPanel.js';

function addSystemMessage(text: string) {
  const msg: ChatMessage = {
    id: `sys-${Date.now()}`,
    role: 'system',
    msgType: 'system',
    content: text,
    time: new Date().toLocaleTimeString(),
  };
  tuiState.setMessages([...tuiState.messages(), msg]);
}

function addUserMessage(text: string) {
  const msg: ChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    msgType: 'user',
    content: text,
    time: new Date().toLocaleTimeString(),
  };
  tuiState.setMessages([...tuiState.messages(), msg]);
}

export default function App() {
  const screen = () => tuiState.screen();
  const renderer = useRenderer();

  // 文本选择 → 自动拷入系统剪贴板 (OSC 52)
  useSelectionHandler((selection: Selection) => {
    const text = selection.getSelectedText();
    if (text) {
      renderer.copyToClipboardOSC52(text);
    }
  });

  // Esc: 关闭模块树 / 经验选择回退
  useKeyboard((key) => {
    if (screen() !== 'tree') return;
    if (key.name === 'escape') {
      if (tuiState.showExperiencePanel()) {
        const idx = tuiState.experienceModuleIndex();
        if (idx >= 0) {
          // 经验内容 → 回到树继续选择
          tuiState.setExperienceModuleIndex(-1);
        } else {
          // 树 → 关闭经验面板
          tuiState.setShowExperiencePanel(false);
          tuiState.setScreen('chat');
          tuiState.setInputValue('');
          tuiState.setShowCommands(false);
        }
      } else {
        // 普通树模式 → 关闭
        tuiState.setScreen('chat');
        tuiState.setInputValue('');
        tuiState.setShowCommands(false);
      }
      key.preventDefault();
    }
  });

  // Diff 快捷键（全局）— Y/R/N 操作
  useKeyboard((key: KeyEvent) => {
    // diffPrompt 激活时的 Y/R/N 操作
    const diff = tuiState.diffPrompt();
    if (!diff || tuiState.showDiffPanel() || screen() !== 'chat') return;

    const service = (globalThis as any).__tuiAgentService;
    const moduleName = diff.moduleName;

    if (key.name === 'y') {
      service?.applyWorkspaceDiff?.(moduleName).then(() => {
        tuiState.setDiffPrompt(null);
      }).catch(() => {});
      key.preventDefault();
    } else if (key.name === 'r') {
      tuiState.setShowDiffPanel(true);
      key.preventDefault();
    } else if (key.name === 'n') {
      service?.discardWorkspaceDiff?.(moduleName).then(() => {
        tuiState.setDiffPrompt(null);
      }).catch(() => {});
      key.preventDefault();
    }
  });

  const handleSend = (text: string) => {
    // 用户消息现在由 __tuiSendMessage 在 Agent 占位消息之前推送，
    // 这样流数据块会追加到 Agent 消息而非用户消息。
    (globalThis as any).__tuiSendMessage?.(text);
  };

  const handleCommand = (text: string) => {
    // 触发命令执行器
    (globalThis as any).__tuiRunCommand?.(text);
  };

  const handleSetupComplete = () => {
    const projectRoot = tuiState.workingDir() || process.cwd();
    tuiState.setWorkingDir(projectRoot);
    tuiState.setScreen('chat');
    addSystemMessage('正在初始化 agent...');
    (globalThis as any).__tuiInitAgent?.(projectRoot);
  };

  return (
    <box position="relative" width="100%" height="100%">
      {screen() === 'setup' ? (
        <SetupWizard onComplete={handleSetupComplete} />
      ) : screen() === 'tree' && tuiState.showExperiencePanel() && tuiState.experienceModuleIndex() >= 0 ? (
        <ExperiencePanel />
      ) : screen() === 'tree' ? (
        <ModuleTree
          graph={(globalThis as any).__tuiAgentService?.getGraph?.() ?? null}
          moduleStatuses={
            // 读取版本信号确保状态变化时重新求值
            (tuiState.moduleStatusVersion(), (globalThis as any).__tuiAgentService?.getModuleStatuses?.() ?? new Map())
          }
          loadedModules={(globalThis as any).__tuiAgentService?.loadedModulesSet ?? new Set()}
          currentAgent={tuiState.currentAgent()}
          selectionMode={tuiState.showExperiencePanel() ? 'experience' : 'agent'}
          onSelect={(name: string) => {
            if (tuiState.showExperiencePanel()) {
              const entries = tuiState.experienceEntries();
              const idx = entries.findIndex(e => e.moduleName === name);
              if (idx >= 0) {
                tuiState.setExperienceModuleIndex(idx);
              }
            } else {
              (globalThis as any).__tuiAgentService?.setCurrentAgent?.(name);
              tuiState.setScreen('chat');
              tuiState.setInputValue('');
              tuiState.setShowCommands(false);
            }
          }}
          onClose={() => {
            if (tuiState.showExperiencePanel()) {
              tuiState.setShowExperiencePanel(false);
            }
            tuiState.setScreen('chat');
            tuiState.setInputValue('');
            tuiState.setShowCommands(false);
          }}
        />
      ) : tuiState.showDiffPanel() && tuiState.diffPrompt() ? (
        <DiffPanel />
      ) : (
        <>
          <ContextArea />
          {tuiState.diffPrompt() ? <DiffBar /> : null}
          <CommandPalette />
          <box flexDirection="column" flexShrink={0}>
            <InputBox onSend={handleSend} onCommand={handleCommand} />
            <text fg="#555555" height={1}>  Ctrl+P 打开快捷面板</text>
            <StatusBar />
          </box>
        </>
      )}

      {/* 快捷面板 — 绝对定位覆盖在当前界面之上 */}
      {tuiState.showQuickPanel() && (
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          backgroundColor="#0d1117DD"
        >
          <QuickPanel />
        </box>
      )}
    </box>
  );
}
