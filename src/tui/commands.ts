import type { ChatMessage, CommandDef } from './types.js';
import { tuiState } from './state.js';

function addSystemMsg(text: string) {
  const msg: ChatMessage = {
    id: `cmd-${Date.now()}`,
    role: 'system',
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
      const help = [
        '/list       — 列出所有模块',
        '/tree       — 显示模块树形结构 (含状态)',
        '/get <name> — 查看模块详情',
        '/mode <id>  — 切换 agent 模式',
        '/setup      — 重新配置项目 (codeSource, workspace 等)',
        '/clear      — 清空上下文',
        '/help       — 显示此帮助',
        '/quit       — 退出 TUI',
      ].join('\n');
      addSystemMsg(`可用命令:\n${help}`);
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

    case '/tree': {
      const service = getAgentService();
      if (!service) {
        addSystemMsg('Agent 服务未就绪');
        return;
      }
      const graph = service.getGraph?.();
      if (!graph) {
        addSystemMsg('Agent 服务未就绪');
        return;
      }
      const currentAgent = service.getCurrentAgent?.() ?? '';
      const currentStatus = service.getAgentStatus?.() ?? 'idle';

      const visited = new Set<string>();
      const lines: string[] = [];

      function buildTree(nodeName: string, prefix: string, isLast: boolean, isRoot: boolean) {
        if (visited.has(nodeName)) return;
        visited.add(nodeName);

        const node = graph.nodes.get(nodeName);
        if (!node) return;

        // 状态标记
        let status = '◌'; // 未启动
        if (nodeName === currentAgent) {
          if (currentStatus === 'streaming') status = '▶';
          else if (currentStatus === 'error') status = '✗';
          else status = '●';
        } else if (service.isModuleLoaded?.(nodeName)) {
          status = '●'; // loaded
        }

        // 描述（带截断）
        const desc = node.definition?.frontmatter?.description || '';
        const shortDesc = desc.length > 40 ? desc.slice(0, 40) + '…' : (desc || '(无描述)');

        // 路径
        const path = node.relativePath || '.';

        // 构建行
        const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
        lines.push(`${prefix}${connector}${status} ${node.name} — ${shortDesc} [${path}]`);

        // 子节点
        const children = node.children || [];
        const validChildren = children.filter((c: string) => graph.nodes.has(c) && !visited.has(c));
        const childPrefix = isRoot ? '' : (isLast ? '    ' : '│   ');

        validChildren.forEach((childName: string, i: number) => {
          const childIsLast = i === validChildren.length - 1;
          buildTree(childName, prefix + childPrefix, childIsLast, false);
        });
      }

      const rootNode = graph.nodes.get(graph.root);
      if (!rootNode) {
        addSystemMsg('无法找到根模块');
        return;
      }
      buildTree(graph.root, '', true, true);

      addSystemMsg(lines.join('\n'));
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
          tuiState.setCurrentAgent(arg);
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
      tuiState.setMessages([]);
      addSystemMsg('上下文已清空');
      break;
    }

    case '/setup':
    case '/config': {
      addSystemMsg('正在打开配置向导...');
      tuiState.setSetupStep(0);
      tuiState.setScreen('setup');
      break;
    }

    case '/quit': {
      addSystemMsg('正在退出...');
      const service = getAgentService();
      const renderer = (globalThis as any).__tuiRenderer;

      // 延迟一小段时间让消息渲染
      setTimeout(async () => {
        try {
          if (service?.dispose) {
            await service.dispose();
          }
        } catch {
          // 忽略退出时的 dispose 错误
        }
        if (renderer?.destroy) {
          renderer.destroy();
        }
        process.exit(0);
      }, 200);
      break;
    }

    default: {
      addSystemMsg(`未知命令: ${cmd}，输入 /help 查看可用命令。`);
      break;
    }
  }
}
