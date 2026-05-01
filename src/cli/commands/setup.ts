import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { ModuleGenerator } from '../../core/ModuleGenerator.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { DEFAULT_CONFIG, type ProjectConfig } from '../../config/defaults.js';
import { saveLastProject } from '../utils/project-root.js';

export interface SetupResult {
  projectRoot: string;
  config: ProjectConfig;
  /** Remaining lines buffered during setup (not consumed by prompts) */
  bufferedLines: string[];
}

function createLineReader(rl: readline.Interface) {
  const queue: string[] = [];
  let waiter: ((line: string) => void) | null = null;

  const handler = (line: string) => {
    if (waiter) {
      waiter(line);
      waiter = null;
    } else {
      queue.push(line);
    }
  };
  rl.on('line', handler);

  return {
    readLine(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      return new Promise((resolve) => { waiter = resolve; });
    },
    drain(): string[] {
      rl.removeListener('line', handler);
      // Resolve any pending waiter with empty string
      if (waiter) {
        waiter('');
        waiter = null;
      }
      const remaining = [...queue];
      queue.length = 0;
      return remaining;
    },
  };
}

export async function runSetup(
  cliProject?: string,
  rl?: readline.Interface,
): Promise<SetupResult> {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  const reader = createLineReader(rl);

  let projectRoot = cliProject ? path.resolve(cliProject) : '';
  if (projectRoot && !fs.existsSync(projectRoot)) {
    console.log(`Project path does not exist: ${projectRoot}`);
    projectRoot = '';
  }

  if (!projectRoot) {
    projectRoot = path.resolve(process.cwd());
  }

  // Ensure module.md exists
  while (!fs.existsSync(path.join(projectRoot, 'module.md'))) {
    console.log(`\nNo module.md found at: ${projectRoot}\n`);
    const answer = await reader.readLine('Auto-generate module.md? (Y/n/enter path): ');
    const trimmed = answer.trim();

    if (trimmed === '' || trimmed.toLowerCase() === 'y' || trimmed.toLowerCase() === 'yes') {
      try {
        const content = await ModuleGenerator.generate({ dirPath: projectRoot });
        const mdPath = path.join(projectRoot, 'module.md');
        fs.writeFileSync(mdPath, content, 'utf-8');
        console.log(`Generated: ${mdPath}`);
      } catch (err) {
        console.log(`Failed to generate: ${(err as Error).message}`);
        continue;
      }
    } else if (trimmed.toLowerCase() === 'n' || trimmed.toLowerCase() === 'no') {
      const newPath = await reader.readLine('Enter project root path: ');
      const resolved = path.resolve(newPath.trim());
      if (!fs.existsSync(resolved)) {
        console.log(`Path does not exist: ${resolved}`);
        continue;
      }
      projectRoot = resolved;
    } else {
      const resolved = path.resolve(trimmed);
      if (fs.existsSync(resolved)) {
        projectRoot = resolved;
      } else {
        console.log(`Path does not exist: ${resolved}`);
      }
    }
  }

  // Ensure agent config
  let config: ProjectConfig;
  try {
    config = await ConfigLoader.load(projectRoot);
  } catch {
    config = { ...DEFAULT_CONFIG };
  }

  const configPath = path.join(projectRoot, '.module-agent.json');
  const hasConfig = fs.existsSync(configPath);

  if (!hasConfig) {
    console.log('\nAgent configuration:');
    const cmd = await reader.readLine(`  Agent command [${config.agents.default.command}]: `);
    if (cmd.trim()) config.agents.default.command = cmd.trim();

    const currentArgs = (config.agents.default.args || []).join(' ');
    const argsStr = await reader.readLine(`  Agent args [${currentArgs}]: `);
    if (argsStr.trim()) {
      config.agents.default.args = argsStr.trim().split(/\s+/);
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`Saved: ${configPath}`);
    } catch (err) {
      console.log(`Warning: could not save config: ${(err as Error).message}`);
    }
  }

  console.log(`\n  Project: ${projectRoot}`);
  console.log(`  Agent:   ${config.agents.default.command} ${(config.agents.default.args || []).join(' ')}`);

  saveLastProject(projectRoot);

  const bufferedLines = reader.drain();
  // Don't close readline — close() restores TTY settings and may disrupt raw mode
  // reader.drain() already removed our 'line' listener

  console.log('');
  return { projectRoot, config, bufferedLines };
}
