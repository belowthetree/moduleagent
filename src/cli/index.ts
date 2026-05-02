#!/usr/bin/env node
import { resolveProjectRoot } from './utils/project-root.js';
import { CliError } from './utils/output.js';
import { listModules } from './commands/list.js';
import { getModule } from './commands/get.js';
import { serve } from './commands/serve.js';
import { tui } from './commands/tui.js';
import { defaultLogger, LogLevel } from '../core/Logger.js';

defaultLogger.configure('logs', LogLevel.INFO);

const HELP = `Usage: module-agent <command> [options]

Commands:
  list              List all modules in the project
  get <name>        Show detailed information for a module
  serve             Run in persistent stdio NDJSON mode
  tui               Interactive terminal UI (chat + module tree)

Options:
  --project <path>  Path to project root (auto-detected from cwd if omitted)
  --help, -h        Show this help
  --version, -v     Show version
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write('0.1.0\n');
    process.exit(0);
  }

  const command = args[0]!;
  const rest = args.slice(1);

  let projectFlag: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--project' && rest[i + 1]) {
      projectFlag = rest[++i]!;
    } else {
      positional.push(rest[i]!);
    }
  }

  defaultLogger.info(`CLI invoked: ${command} ${positional.join(' ')}`.trim());

  try {
    switch (command) {
      case 'list':
        await listModules({ projectRoot: resolveProjectRoot(projectFlag) });
        break;

      case 'get':
        if (positional.length === 0) {
          process.stderr.write('Usage: module-agent get <name> [--project <path>]\n');
          process.exit(2);
        }
        await getModule({
          projectRoot: resolveProjectRoot(projectFlag),
          moduleName: positional[0]!,
        });
        break;

      case 'serve':
        await serve({ projectRoot: resolveProjectRoot(projectFlag) });
        break;

      case 'tui':
        await tui({ projectRoot: resolveProjectRoot(projectFlag) });
        break;

      default:
        defaultLogger.warn(`Unknown command: ${command}`);
        process.stderr.write(`Unknown command: ${command}\n\n${HELP}\n`);
        process.exit(2);
    }
  } catch (err) {
    defaultLogger.error(`Command failed: ${command} | ${(err as Error).message}`);
    if (err instanceof CliError) {
      process.stderr.write(JSON.stringify({ success: false, error: err.message }) + '\n');
      process.exit(err.exitCode);
    }
    process.stderr.write(JSON.stringify({ success: false, error: (err as Error).message }) + '\n');
    process.exit(1);
  }
}

main().catch((err) => {
  defaultLogger.error(`Fatal: ${(err as Error).message}`);
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
