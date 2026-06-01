// ---------------------------------------------------------------------------
// tui/renderer.tsx — TUI 渲染器入口
// 使用 OpenTUI 创建 CLI 渲染器，挂载 SolidJS 应用根组件
// ---------------------------------------------------------------------------

import { createCliRenderer } from '@opentui/core';
import { render } from '@opentui/solid';
import { createDefaultOpenTuiKeymap } from '@opentui/keymap/opentui';
import { registerEmacsBindings } from '@opentui/keymap/addons';
import path from 'path';
import App from './App.js';
import { tuiState } from './state.js';
import { executeCommand } from './commands.js';
import { TuiBridge } from './bridge.js';
import { defaultLogger, LogLevel } from '../core/Logger.js';
import fs from 'fs-extra';
import type { ChatMessage } from './types.js';

export async function startTui(projectRoot: string) {
  defaultLogger.configure(path.join(projectRoot, 'logs'), LogLevel.INFO);

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
    autoFocus: false,
  });

  // ── @opentui/keymap — 组合/序列快捷键 ──
  const keymap = createDefaultOpenTuiKeymap(renderer);

  // 注册 Emacs 风格解析器以支持 "ctrl+x t" 空格分隔的多键序列
  registerEmacsBindings(keymap);

  keymap.registerLayer({
    commands: [
      {
        name: 'toggle-tree',
        run() {
          if (tuiState.screen() === 'tree') {
            tuiState.setScreen('chat');
            tuiState.setInputValue('');
            tuiState.setShowCommands(false);
          } else {
            tuiState.setScreen('tree');
          }
        },
      },
      {
        name: 'toggle-diff',
        run() {
          if (tuiState.diffPrompt()) {
            tuiState.setShowDiffPanel(!tuiState.showDiffPanel());
          }
        },
      },
      {
        name: 'toggle-experience',
        run() {
          if (tuiState.showExperiencePanel()) {
            tuiState.setShowExperiencePanel(false);
            tuiState.setScreen('chat');
            tuiState.setInputValue('');
            tuiState.setShowCommands(false);
            return;
          }
          // 加载所有模块的 experience.md（仅首次）
          const entries = tuiState.experienceEntries();
          if (entries.length === 0) {
            const bridge = (globalThis as any).__tuiAgentService;
            if (!bridge?.core) return;
            const graph = bridge.core.getGraph?.();
            if (!graph) return;
            const loaded: { moduleName: string; content: string; filePath: string }[] = [];
            for (const [name, node] of graph.nodes) {
              const expPath = path.join(node.absolutePath, 'experience.md');
              try {
                const content = fs.readFileSync(expPath, 'utf-8').trim();
                if (content) {
                  const body = content.replace(/^# .+?\n+/, '').trim();
                  if (body) {
                    loaded.push({ moduleName: name, content, filePath: expPath });
                  }
                }
              } catch { /* 跳过无 experience.md 的模块 */ }
            }
            if (loaded.length === 0) return;
            tuiState.setExperienceEntries(loaded);
          }
          // 切到树模式，用户选择模块后显示经验
          tuiState.setExperienceModuleIndex(-1);
          tuiState.setShowExperiencePanel(true);
          tuiState.setScreen('tree');
        },
      },
    ],
    bindings: [
      { key: 'ctrl+x t', cmd: 'toggle-tree' },
      { key: 'ctrl+x d', cmd: 'toggle-diff' },
      { key: 'ctrl+x h', cmd: 'toggle-experience' },
    ],
  });

  // ── 键盘快捷键 ──
  renderer.keyInput.on('keypress', (key: { name: string; ctrl: boolean; shift: boolean }) => {
    if (key.name === 'c' && key.ctrl) {
      // Ctrl+C: 流式输出中取消当前请求
      if (tuiState.agentStatus() === 'streaming') {
        tuiState.setAgentStatus('idle');
        (globalThis as any).__tuiCancelStream?.();
      }
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



  // ── 桥接层 ──
  const bridge = new TuiBridge();

  // ── 挂载 globalThis 钩子 ──
  (globalThis as any).__tuiInitAgent = async (root: string) => {
    try {
      // 重新配置日志目录（切换到新项目路径）
      defaultLogger.configure(path.join(root, 'logs'), LogLevel.INFO);
      defaultLogger.info(`TUI reinit with projectRoot: ${root}`);

      // 清理旧状态（设置变更后重新初始化）
      if (bridge.core.isInitialized()) {
        await bridge.dispose();
        tuiState.setMessages([]);  // 清除旧项目消息，让 init() 加载新项目历史
      }

      const result = await bridge.init(root);
      tuiState.setCurrentAgent(result.rootAgent || 'main');

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
