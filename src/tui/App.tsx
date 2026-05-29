import { tuiState } from './state.js';
import type { ChatMessage } from './types.js';
import StatusBar from './components/StatusBar.js';
import InputBox from './components/InputBox.js';
import ContextArea from './components/ContextArea.js';
import CommandPalette from './components/CommandPalette.js';
import SetupWizard from './components/SetupWizard.js';

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
      ) : (
        <>
          <ContextArea />
          <CommandPalette />
          <box flexDirection="column">
            <InputBox onSend={handleSend} onCommand={handleCommand} />
            <StatusBar />
          </box>
        </>
      )}
    </box>
  );
}
