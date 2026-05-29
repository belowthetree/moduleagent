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

  // ── Ctrl+D 退出，流式中 Ctrl+C 取消 ──
  renderer.keyInput.on('keypress', (key: { name: string; ctrl: boolean }) => {
    if (key.name === 'c' && key.ctrl) {
      // Ctrl+C: 流式输出中取消当前请求
      if (tuiState.agentStatus() === 'streaming') {
        tuiState.setAgentStatus('idle');
        (globalThis as any).__tuiCancelStream?.();
      }
      // 非流式时不做任何事（留给终端原生的复制快捷键处理）
    }
    if (key.name === 'd' && key.ctrl) {
      // Ctrl+D: 先保存再退出
      const bridge = (globalThis as any).__tuiAgentService;
      if (bridge) {
        bridge.saveSession?.().then(() => {
          renderer.destroy();
          process.exit(0);
        }).catch(() => {
          renderer.destroy();
          process.exit(0);
        });
      } else {
        renderer.destroy();
        process.exit(0);
      }
    }
  });

  // ── 文本选择 → 自动复制到剪贴板 ──
  renderer.on('selection', (selection: { text: string }) => {
    if (selection.text) {
      renderer.copyToClipboardOSC52(selection.text);
    }
  });

  // ── 桥接层 ──
  const bridge = new TuiBridge();

  // ── 挂载 globalThis 钩子 ──
  (globalThis as any).__tuiInitAgent = async (root: string) => {
    try {
      // 清理旧状态（设置变更后重新初始化）
      if (bridge.core.isInitialized()) {
        await bridge.dispose();
      }

      const result = await bridge.init(root);
      tuiState.setCurrentAgent(result.rootAgent || 'main');
      tuiState.setMessages([]);  // 清除旧消息，重新开始

      const { saveLastProjectRoot } = await import('./config.js');
      await saveLastProjectRoot(root);

      tuiState.setAgentStatus('idle');
      const agents = bridge.listAgents();
      const roles = await bridge.getRoleConfigs();
      const workflows = bridge.listWorkflows();

      let initMsg = `Agent ready — modules: ${agents.join(', ') || '(none)'}`;
      if (roles.length > 0) initMsg += ` | roles: ${roles.map(r => r.name).join(', ')}`;
      if (workflows.length > 0) initMsg += ` | workflows: ${workflows.join(', ')}`;
      initMsg += '\nType /help for available commands.';

      const msg: ChatMessage = {
        id: `init-${Date.now()}`,
        role: 'system',
        msgType: 'system',
        content: initMsg,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
    } catch (err) {
      tuiState.setAgentStatus('error');
      const msg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        msgType: 'system',
        content: `Init failed: ${(err as Error).message}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
    }
  };

  (globalThis as any).__tuiSendMessage = async (text: string) => {
    await bridge.sendMessage(bridge.getCurrentAgent(), text);
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

  // ── 输入历史持久化钩子 ──
  (globalThis as any).__tuiSaveHistory = (history: string[]) => {
    bridge.saveInputHistory(history).catch(() => {});
  };

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
          msgType: 'system',
          content: 'Enter /setup to configure project path.',
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      }
    } else {
      const msg: ChatMessage = {
        id: `sys-${Date.now()}`,
        role: 'system',
        msgType: 'system',
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
