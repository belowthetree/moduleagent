import { Command } from 'commander';
import path from 'path';
import { createInterface } from 'readline';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { AgentManager } from '../../agents/AgentManager.js';
import type { AgentEntry } from '../../agents/AgentManager.js';

export function serveCommand(program: Command) {
  program
    .command('serve [projectPath]')
    .description('启动编排服务，拉起主 Agent，进入交互模式')
    .option('-m, --mcpserver', '同时启动 MCP 服务器供模块间通信')
    .action(async (projectPath?: string, _options?: { mcpserver?: boolean }) => {
      const root = projectPath ? path.resolve(projectPath) : process.cwd();
      console.log(`[serve] 项目路径: ${root}`);

      const config = await ConfigLoader.loadOrCreate(root);
      console.log(`[serve] Agent 配置: ${config.agents.default.command}${config.agents.default.args ? ' ' + config.agents.default.args.join(' ') : ''}`);

      const descriptors = await ModuleScanner.scan({ projectRoot: root, extraExclude: config.exclude });
      if (descriptors.length === 0) {
        console.log('[serve] 未发现任何模块，请先运行 module-agent init');
        return;
      }

      const graph = new ModuleGraph().build(descriptors, root);
      console.log(`[serve] 根模块: ${graph.root}，共 ${graph.nodes.size} 个模块`);

      const manager = new AgentManager(config, graph);

      if (process.stdin.isTTY) {
        await startInkUI(manager, graph.root);
      } else {
        await startReadlineUI(manager, graph.root);
      }

      await manager.stopAll();
      console.log('[serve] 已退出');
    });
}

async function startInkUI(manager: AgentManager, rootName: string) {
  const react = await import('react') as unknown as typeof import('react');
  const ink = await import('ink') as unknown as typeof import('ink');
  const appMod = await import('../views/App.jsx') as unknown as typeof import('../views/App.jsx');

  const { waitUntilExit } = ink.render(
    react.createElement(appMod.App, {
      manager,
      rootName,
      onExit: () => process.exit(0),
    }),
  );

  await waitUntilExit();
}

async function startReadlineUI(manager: AgentManager, rootName: string) {
  console.log(`\n[serve] 交互模式 (简易) | 输入 /exit 退出 | /tree 查看模块\n`);

  let mainEntry: AgentEntry | undefined;
  try {
    console.log('[serve] 正在启动主 Agent...');
    mainEntry = await manager.startMainAgent(process.cwd());
    console.log(`[serve] 主 Agent 已启动 (${mainEntry.name})`);
  } catch (err) {
    console.log(`[serve] 启动主 Agent 失败: ${(err as Error).message}`);
    console.log('[serve] 进入离线模式\n');
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.prompt();

  for await (const line of rl) {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      continue;
    }

    if (text === '/exit' || text === '/quit') {
      rl.close();
      break;
    }

    if (text === '/tree') {
      const descriptors = await ModuleScanner.scan({ projectRoot: process.cwd() });
      const graph = new ModuleGraph().build(descriptors, process.cwd());
      for (const [name, node] of graph.nodes) {
        const indent = name === graph.root ? '' : '  ';
        const marker = name === graph.root ? '◆' : '├';
        console.log(`${indent}${marker} ${name} (${node.relativePath})`);
      }
      rl.prompt();
      continue;
    }

    if (mainEntry && mainEntry.sessionId) {
      try {
        console.log('[处理中...]');
        const result = await mainEntry.agent.client.prompt(mainEntry.sessionId, text);
        console.log(`[完成] ${result.stopReason}`);
      } catch (err) {
        console.log(`[错误] ${(err as Error).message}`);
      }
    } else {
      console.log('[serve] Agent 未就绪，无法处理请求');
    }

    rl.prompt();
  }
}
