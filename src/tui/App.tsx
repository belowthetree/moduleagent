import { useKeyboard, useRenderer, useSelectionHandler } from '@opentui/solid';
import type { Selection } from '@opentui/core';
import { tuiState } from './state.js';
import type { ChatMessage } from './types.js';
import StatusBar from './components/StatusBar.js';
import InputBox from './components/InputBox.js';
import ContextArea from './components/ContextArea.js';
import CommandPalette from './components/CommandPalette.js';
import SetupWizard from './components/SetupWizard.js';
import ModuleTree from './components/ModuleTree.js';

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

  // Esc 关闭模块树
  useKeyboard((key) => {
    if (screen() !== 'tree') return;
    if (key.name === 'escape') {
      tuiState.setScreen('chat');
      tuiState.setInputValue('');
      tuiState.setShowCommands(false);
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
    <box flexDirection="column" width="100%" height="100%">
      {screen() === 'setup' ? (
        <SetupWizard onComplete={handleSetupComplete} />
      ) : screen() === 'tree' ? (
        <ModuleTree
          graph={(globalThis as any).__tuiAgentService?.getGraph?.() ?? null}
          moduleStatuses={(globalThis as any).__tuiAgentService?.getModuleStatuses?.() ?? new Map()}
          loadedModules={(globalThis as any).__tuiAgentService?.loadedModulesSet ?? new Set()}
          currentAgent={tuiState.currentAgent()}
          onSelect={(name: string) => {
            (globalThis as any).__tuiAgentService?.setCurrentAgent?.(name);
            tuiState.setScreen('chat');
            tuiState.setInputValue('');
            tuiState.setShowCommands(false);
          }}
          onClose={() => tuiState.setScreen('chat')}
        />
      ) : (
        <>
          <ContextArea />
          <CommandPalette />
          <box flexDirection="column" flexShrink={0}>
            <InputBox onSend={handleSend} onCommand={handleCommand} />
            <StatusBar />
            <text height={1}> </text>
            <text height={1}> </text>
          </box>
        </>
      )}
    </box>
  );
}
