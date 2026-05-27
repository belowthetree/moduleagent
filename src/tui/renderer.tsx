import { createCliRenderer } from '@opentui/core';
import { render } from '@opentui/solid';
import path from 'path';
import App from './App.js';
import { tuiState } from './state.js';
import { executeCommand } from './commands.js';
import { TuiBridge } from './bridge.js';
import { defaultLogger, LogLevel } from '../core/Logger.js';
import type { ChatMessage } from './types.js';

export async function startTui(projectRoot: string) {
  defaultLogger.configure(path.join(projectRoot, 'logs'), LogLevel.INFO);

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
    autoFocus: false,
  });

  // ── Ctrl+C 处理 ──
  renderer.keyInput.on('keypress', (key: { name: string; ctrl: boolean }) => {
    if (key.name === 'c' && key.ctrl) {
      if (tuiState.agentStatus() === 'streaming') {
        tuiState.setAgentStatus('idle');
        (globalThis as any).__tuiCancelStream?.();
      } else {
        renderer.destroy();
        process.exit(0);
      }
    }
  });

  // ── 桥接层 ──
  const bridge = new TuiBridge();

  // ── 挂载 globalThis 钩子 ──
  (globalThis as any).__tuiInitAgent = async (root: string) => {
    try {
      await bridge.init(root);

      const { saveLastProjectRoot } = await import('./config.js');
      await saveLastProjectRoot(root);

      tuiState.setAgentStatus('idle');
      const agents = bridge.listAgents();
      const msg: ChatMessage = {
        id: `init-${Date.now()}`,
        role: 'system',
        content: `Agent ready — modules: ${agents.join(', ')}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
    } catch (err) {
      tuiState.setAgentStatus('error');
      const msg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `Init failed: ${(err as Error).message}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
    }
  };

  (globalThis as any).__tuiSendMessage = async (text: string) => {
    await bridge.sendMessage(text);
  };

  (globalThis as any).__tuiCancelStream = async () => {
    await bridge.cancel();
  };

  // ── 命令执行 ──
  (globalThis as any).__tuiRunCommand = (cmd: string) => {
    executeCommand(cmd);
  };

  // ── 暴露桥接层供 commands.ts 使用 ──
  (globalThis as any).__tuiAgentService = bridge;

  // ── 自动初始化或显示设置界面 ──
  import('./config.js').then(async ({ validateModuleAgentJson }) => {
    if (await validateModuleAgentJson(projectRoot)) {
      await (globalThis as any).__tuiInitAgent(projectRoot);

      const { ConfigLoader } = await import('../config/ConfigLoader.js');
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      const hasProjectPath = !!config.projectPath;
      if (!hasProjectPath) {
        const msg: ChatMessage = {
          id: `sys-${Date.now()}`,
          role: 'system',
          content: 'Enter /setup to configure project path.',
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      }
    } else {
      const msg: ChatMessage = {
        id: `sys-${Date.now()}`,
        role: 'system',
        content: 'No config found. Please complete setup.',
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([msg]);
      tuiState.setSetupStep(0);
      tuiState.setScreen('setup');
    }
  });

  (globalThis as any).__tuiRenderer = renderer;

  tuiState.setWorkingDir(projectRoot);
  render(() => <App />, renderer);
}
