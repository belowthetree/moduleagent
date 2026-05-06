import { createCliRenderer } from '@opentui/core';
import { render } from '@opentui/solid';
import path from 'path';
import App from './App.js';
import { tuiState } from './state.js';
import { executeCommand } from './commands.js';
import { AgentService } from './services/AgentService.js';
import { createStreamHandler } from './services/StreamHandler.js';
import { defaultLogger, LogLevel } from '../core/Logger.js';
import type { ChatMessage } from './types.js';

export async function startTui(projectRoot: string) {
  defaultLogger.configure(path.join(projectRoot, 'logs'), LogLevel.INFO);

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,  // Custom Ctrl+C handling
    targetFps: 30,
    autoFocus: false,    // Prevent clicks from stealing focus from the input box
  });

  // Ctrl+C handling
  renderer.keyInput.on('keypress', (key: { name: string; ctrl: boolean }) => {
    if (key.name === 'c' && key.ctrl) {
      if (tuiState.agentStatus() === 'streaming') {
        // Cancel stream but stay alive
        tuiState.setAgentStatus('idle');
        // Signal cancel — AgentService will handle
        (globalThis as any).__tuiCancelStream?.();
      } else {
        // Exit cleanly
        renderer.destroy();
        process.exit(0);
      }
    }
  });

  // ── Agent Service ──
  const agentService = new AgentService(
    (msg: ChatMessage) => {
      tuiState.setMessages([...tuiState.messages(), msg]);
    },
    (status) => {
      tuiState.setAgentStatus(status);
    }
  );

  // Create stream handler
  const streamHandler = createStreamHandler({
    onChunk: (text: string) => {
      const msgs = tuiState.messages();
      if (msgs.length === 0) return;
      const lastMsg = msgs[msgs.length - 1]!;
      const updatedMsgs = [...msgs];
      updatedMsgs[msgs.length - 1] = {
        ...lastMsg,
        content: lastMsg.content + text,
      };
      tuiState.setMessages(updatedMsgs);
    },
    onComplete: () => {
      const msgs = tuiState.messages();
      if (msgs.length === 0) return;
      const lastMsg = msgs[msgs.length - 1]!;
      const updatedMsgs = [...msgs];
      updatedMsgs[msgs.length - 1] = {
        ...lastMsg,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages(updatedMsgs);
      tuiState.setAgentStatus('idle');
    },
    onError: (error: string) => {
      tuiState.setAgentStatus('error');
      const msg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `❌ ${error}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
    },
  });

  agentService.setStreamHandler(streamHandler);

  // ── Wire globalThis hooks ──

  (globalThis as any).__tuiInitAgent = async (root: string) => {
    try {
      await agentService.init(root);

      // Persist project root so restart can find the correct config
      const { saveLastProjectRoot } = await import('./config.js');
      await saveLastProjectRoot(root);

      tuiState.setAgentStatus('idle');
      const msg: ChatMessage = {
        id: `init-${Date.now()}`,
        role: 'system',
        content: `Agent 已就绪 — 模块: ${agentService.listAgents().join(', ')}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
    } catch (err) {
      tuiState.setAgentStatus('error');
      const msg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `❌ 初始化失败: ${(err as Error).message}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
    }
  };

  (globalThis as any).__tuiSendMessage = async (text: string) => {
    try {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: text,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), userMsg]);

      const streamMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: '',
        time: '',
      };
      tuiState.setMessages([...tuiState.messages(), streamMsg]);

      await agentService.sendMessage(text);
    } catch (err) {
      const msg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `❌ 发送失败: ${(err as Error).message}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
      tuiState.setAgentStatus('error');
    }
  };

  (globalThis as any).__tuiCancelStream = async () => {
    await agentService.cancel();
  };

  // ── Command execution ──
  (globalThis as any).__tuiRunCommand = (cmd: string) => {
    executeCommand(cmd);
  };

  // ── Auto-init or show setup ──
  import('./config.js').then(async ({ validateModuleAgentJson }) => {
    if (await validateModuleAgentJson(projectRoot)) {
      await (globalThis as any).__tuiInitAgent(projectRoot);

      // Warn if projectPath is not configured
      const { ConfigLoader } = await import('../config/ConfigLoader.js');
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      const hasProjectPath = !!config.projectPath;
      if (!hasProjectPath) {
        const msg: ChatMessage = {
          id: `sys-${Date.now()}`,
          role: 'system',
          content: '输入 /setup 可配置项目路径。',
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      }
    } else {
      const msg: ChatMessage = {
        id: `sys-${Date.now()}`,
        role: 'system',
        content: '未找到配置文件，请先完成配置。',
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([msg]);
      tuiState.setSetupStep(0);
      tuiState.setScreen('setup');
    }
  });

  (globalThis as any).__tuiAgentService = agentService;

  tuiState.setWorkingDir(projectRoot);
  render(() => <App />, renderer);
}
