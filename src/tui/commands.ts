import type { ChatMessage, CommandDef } from './types.js';
import { tuiState } from './state.js';

function addSystemMsg(text: string) {
  const msg: ChatMessage = {
    id: `cmd-${Date.now()}`,
    role: 'system',
    msgType: 'system',
    content: text,
    time: new Date().toLocaleTimeString(),
  };
  tuiState.setMessages([...tuiState.messages(), msg]);
}

function getAgentService(): any {
  return (globalThis as any).__tuiAgentService;
}

export function executeCommand(input: string): void {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]!.toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case '/help': {
      const moduleHelp = [
        '/list            — 列出所有模块',
        '/tree            — 显示模块树形结构 (含状态)',
        '/rescan          — 重新扫描模块',
        '/get <name>      — 查看模块详情',
        '/mode <id>       — 切换 agent 模式',
        '/clear           — 清空上下文',
      ].join('\n');
      const roleHelp = [
        '/role list       — 列出所有角色',
        '/role start <n>  — 启动角色 Agent',
        '/role stop <n>   — 停止角色 Agent',
        '/role cancel     — 取消当前角色操作',
      ].join('\n');
      const wfHelp = [
        '/workflow list   — 列出所有工作流',
        '/workflow run <n>— 执行工作流',
        '/workflow status — 工作流执行状态',
        '/workflow cancel — 取消工作流',
      ].join('\n');
      const otherHelp = [
        '/thought         — 切换推理过程可见性',
        '/status          — 显示子系统状态',
        '/save [name]     — 保存当前对话',
        '/load [name]     — 加载历史对话',
        '/setup           — 重新配置项目',
        '/help            — 显示此帮助',
        '/quit            — 退出 TUI',
      ].join('\n');
      addSystemMsg(
        `可用命令:\n\n模块 Agent:\n${moduleHelp}\n\n角色 Agent:\n${roleHelp}\n\n工作流:\n${wfHelp}\n\n其他:\n${otherHelp}`,
      );
      break;
    }

    case '/list': {
      const service = getAgentService();
      if (!service) {
        addSystemMsg('Agent 服务未就绪');
        return;
      }
      const agents: string[] = service.listAgents?.() ?? [];
      if (agents.length === 0) {
        addSystemMsg('无可用模块。请先完成初始化。');
        return;
      }
      const listItems = agents.map((name, i) => `  ${i + 1}. ${name}`).join('\n');
      addSystemMsg(`可用模块 (共 ${agents.length} 个):\n${listItems}\n\n输入模块名以切换，或使用 /get <name> 查看详情。`);

      const cmdDefs: CommandDef[] = agents.map((name) => ({
        name: name,
        description: `切换到 ${name} agent`,
        handler: () => {
          executeCommand(`/mode ${name}`);
        },
      }));
      tuiState.setCommands(cmdDefs);
      tuiState.setShowCommands(true);
      break;
    }

    case '/get': {
      if (!arg) {
        addSystemMsg('用法: /get <module-name>');
        return;
      }
      const service = getAgentService();
      if (!service) {
        addSystemMsg('Agent 服务未就绪');
        return;
      }
      const agents: string[] = service.listAgents?.() ?? [];
      if (!agents.includes(arg)) {
        addSystemMsg(`未找到模块: "${arg}"\n使用 /list 查看所有可用模块。`);
        return;
      }
      const current = service.getCurrentAgent?.() ?? '';
      const isCurrent = current === arg;
      addSystemMsg(
        `模块: ${arg}${isCurrent ? ' (当前)' : ''}\n` +
        `使用 /mode ${arg} 可切换到此 agent。`,
      );
      break;
    }

    case '/rescan': {
      const service = getAgentService();
      if (!service) { addSystemMsg('Agent 服务未就绪'); return; }
      addSystemMsg('正在重新扫描模块...');
      const root = tuiState.workingDir() || process.cwd();
      (globalThis as any).__tuiInitAgent?.(root)?.then(() => {
        addSystemMsg('模块扫描完成。');
      }).catch((err: Error) => {
        addSystemMsg(`扫描失败: ${err.message}`);
      });
      break;
    }

    case '/tree': {
      // 切换模块树面板
      const currentScreen = tuiState.screen();
      if (currentScreen === 'tree') {
        tuiState.setScreen('chat');
        tuiState.setInputValue('');
        tuiState.setShowCommands(false);
      } else {
        tuiState.setScreen('tree');
        tuiState.setInputValue('');
        tuiState.setShowCommands(false);
      }
      break;
    }

    case '/mode': {
      if (!arg) {
        addSystemMsg('用法: /mode <mode-id>\n示例: /mode main');
        return;
      }
      const service = getAgentService();
      if (!service) {
        addSystemMsg('Agent 服务未就绪');
        return;
      }
      const agents: string[] = service.listAgents?.() ?? [];
      if (!agents.includes(arg)) {
        addSystemMsg(`未找到模块: "${arg}"\n使用 /list 查看所有可用模块。`);
        return;
      }
      if (!service.setCurrentAgent) {
        addSystemMsg('切换功能暂不可用');
        return;
      }
      tuiState.setAgentStatus('loading');
      (service.setCurrentAgent(arg) as Promise<void>)
        .then(() => {
          tuiState.setAgentStatus('idle');
          addSystemMsg(`已切换到: ${arg}`);
        })
        .catch((err: Error) => {
          tuiState.setAgentStatus('error');
          addSystemMsg(`切换失败: ${err.message}`);
        });
      break;
    }

    case '/clear': {
      const service = getAgentService();
      if (service?.clearContext) {
        service.clearContext().then(() => {
          addSystemMsg('上下文已清空（Agent 已重启）');
        }).catch((err: Error) => {
          addSystemMsg(`清空失败: ${err.message}`);
        });
      } else {
        tuiState.setMessages([]);
        addSystemMsg('上下文已清空（仅 UI）');
      }
      break;
    }

    case '/save': {
      const service = getAgentService();
      if (!service) { addSystemMsg('Agent 服务未就绪'); return; }
      const name = arg || service.getCurrentAgent?.() || 'main';
      service.saveSession?.(name).then(() => {
        addSystemMsg(`对话已保存: ${name}`);
      }).catch((err: Error) => addSystemMsg(`保存失败: ${err.message}`));
      break;
    }

    case '/load': {
      const service = getAgentService();
      if (!service) { addSystemMsg('Agent 服务未就绪'); return; }

      if (!arg) {
        // 列出可加载的会话
        service.listSessions?.().then((sessions: string[]) => {
          if (!sessions || sessions.length === 0) {
            addSystemMsg('无已保存的对话。');
            return;
          }
          const items = sessions.map((s: string) => `  ${s}`).join('\n');
          addSystemMsg(`已保存的对话:\n${items}\n\n使用 /load <name> 加载。`);
        }).catch((err: Error) => addSystemMsg(`列出失败: ${err.message}`));
        return;
      }

      service.loadSession?.(arg).then((msgs: any[]) => {
        if (!msgs || msgs.length === 0) {
          addSystemMsg(`未找到 "${arg}" 的对话记录。`);
          return;
        }
        tuiState.setMessages(msgs);
        addSystemMsg(`已加载 "${arg}" 的对话 (${msgs.length} 条消息)。`);
      }).catch((err: Error) => addSystemMsg(`加载失败: ${err.message}`));
      break;
    }

    case '/setup':
    case '/config': {
      addSystemMsg('正在打开配置向导...');
      tuiState.setSetupStep(0);
      tuiState.setScreen('setup');
      break;
    }

    case '/thought': {
      const current = tuiState.showThought();
      tuiState.setShowThought(!current);
      addSystemMsg(`推理过程: ${!current ? '显示' : '隐藏'}`);
      break;
    }

    case '/status': {
      const service = getAgentService();
      if (!service) { addSystemMsg('Agent 服务未就绪'); return; }

      const counts = tuiState.activeCounts();
      const lines = [
        `模块 Agent: ${counts.modules} loaded`,
        `角色 Agent: ${counts.roles} running`,
        `工作流: ${counts.workflows} active`,
        `当前目标: ${tuiState.currentTarget()}`,
        `当前 Agent: ${tuiState.currentAgent()}`,
      ];
      addSystemMsg(lines.join('\n'));
      break;
    }

    // ── 角色命令 ──
    case '/role': {
      const service = getAgentService();
      if (!service) { addSystemMsg('Agent 服务未就绪'); return; }

      const subCmd = parts[1]?.toLowerCase();
      const subArg = parts.slice(2).join(' ');

      switch (subCmd) {
        case 'list': {
          service.getRoleConfigs?.().then((roles: any[]) => {
            if (!roles || roles.length === 0) {
              addSystemMsg('无可用角色。请先在 .module-agent.json 中配置 roles。');
              return;
            }
            const items = roles.map((r: any) => {
              const running = service.listRunningRoles?.()?.includes(r.name) ? ' [running]' : '';
              return `  ${r.name}${running} — ${r.description || '(无描述)'}`;
            }).join('\n');
            addSystemMsg(`可用角色 (共 ${roles.length} 个):\n${items}\n\n使用 /role start <name> 启动角色。`);
          }).catch((err: Error) => addSystemMsg(`获取角色列表失败: ${err.message}`));
          break;
        }
        case 'start': {
          if (!subArg) { addSystemMsg('用法: /role start <name>'); return; }
          tuiState.setAgentStatus('loading');
          service.startRole?.(subArg).then(() => {
            tuiState.setAgentStatus('idle');
            addSystemMsg(`角色 "${subArg}" 已启动。现在可直接输入消息与之对话。`);
          }).catch((err: Error) => {
            tuiState.setAgentStatus('error');
            addSystemMsg(`启动角色失败: ${err.message}`);
          });
          break;
        }
        case 'stop': {
          if (!subArg) { addSystemMsg('用法: /role stop <name>'); return; }
          service.stopRole?.(subArg).then(() => {
            addSystemMsg(`角色 "${subArg}" 已停止。`);
          }).catch((err: Error) => addSystemMsg(`停止角色失败: ${err.message}`));
          break;
        }
        case 'cancel': {
          const currentRole = tuiState.currentAgent();
          service.cancelRole?.(currentRole).then(() => {
            addSystemMsg(`角色 "${currentRole}" 操作已取消。`);
          }).catch((err: Error) => addSystemMsg(`取消失败: ${err.message}`));
          break;
        }
        default:
          addSystemMsg('用法: /role <list|start|stop|cancel> [name]');
          break;
      }
      break;
    }

    // ── 工作流命令 ──
    case '/workflow': {
      const service = getAgentService();
      if (!service) { addSystemMsg('Agent 服务未就绪'); return; }

      const subCmd = parts[1]?.toLowerCase();
      const subArg = parts.slice(2).join(' ');

      switch (subCmd) {
        case 'list': {
          const workflows: string[] = service.listWorkflows?.() ?? [];
          if (workflows.length === 0) {
            addSystemMsg('无可用工作流。请在 .module-agent/workflow/ 下创建工作流。');
            return;
          }
          const items = workflows.map((n: string) => `  ${n}`).join('\n');
          addSystemMsg(`可用工作流 (共 ${workflows.length} 个):\n${items}\n\n使用 /workflow run <name> 执行。`);
          break;
        }
        case 'run': {
          if (!subArg) { addSystemMsg('用法: /workflow run <name> [user input]'); return; }
          addSystemMsg(`正在执行工作流 "${subArg}"...`);
          service.executeWorkflow?.(subArg, subArg.includes(' ') ? subArg : undefined).then(() => {
            addSystemMsg(`工作流 "${subArg}" 执行完成。`);
          }).catch((err: Error) => {
            addSystemMsg(`工作流执行失败: ${err.message}`);
          });
          break;
        }
        case 'status': {
          const currentWf = service.getCurrentWorkflow?.();
          if (!currentWf) {
            addSystemMsg('当前无运行中的工作流。');
            return;
          }
          const state = service.getWorkflowStatus?.(currentWf);
          if (!state) {
            addSystemMsg(`工作流 "${currentWf}" 状态: 无状态数据`);
            return;
          }
          const lines = [
            `工作流: ${state.workflowName}`,
            `状态: ${state.status}`,
            `当前步骤: ${state.currentStepIndex + 1} / ${(state.stepResults?.length || state.currentStepIndex) + 1}`,
          ];
          if (state.stepResults?.length) {
            lines.push('步骤结果:');
            state.stepResults.forEach((r: any, i: number) => {
              lines.push(`  ${i + 1}. ${r.stepName}: ${r.success ? '✓' : '✗'}${r.error ? ` (${r.error})` : ''}`);
            });
          }
          addSystemMsg(lines.join('\n'));
          break;
        }
        case 'cancel': {
          const currentWf = service.getCurrentWorkflow?.();
          if (!currentWf) { addSystemMsg('当前无运行中的工作流。'); return; }
          service.cancelWorkflow?.(currentWf).then(() => {
            addSystemMsg(`工作流 "${currentWf}" 已取消。`);
          }).catch((err: Error) => addSystemMsg(`取消失败: ${err.message}`));
          break;
        }
        default:
          addSystemMsg('用法: /workflow <list|run|status|cancel> [name]');
          break;
      }
      break;
    }

    case '/quit': {
      addSystemMsg('正在保存并退出...');
      const service = getAgentService();
      const renderer = (globalThis as any).__tuiRenderer;

      // 先保存会话，再退出
      const cleanup = async () => {
        try { await service?.saveSession?.(); } catch { /* ignore */ }
        try { await service?.dispose?.(); } catch { /* ignore */ }
        renderer?.destroy?.();
        process.exit(0);
      };
      cleanup();
      break;
    }

    default: {
      addSystemMsg(`未知命令: ${cmd}，输入 /help 查看可用命令。`);
      break;
    }
  }
}
