import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { scanCommand } from './commands/scan.js';
import { treeCommand } from './commands/tree.js';
import { workspaceCommand } from './commands/workspace.js';
import { serveCommand } from './commands/serve.js';

const program = new Command();

program
  .name('module-agent')
  .description('模块化 Agent 编排框架')
  .version('0.1.0');

initCommand(program);
scanCommand(program);
treeCommand(program);
workspaceCommand(program);
serveCommand(program);

program.parse(process.argv);
