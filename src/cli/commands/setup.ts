import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { ModuleGenerator } from '../../core/ModuleGenerator.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { DEFAULT_CONFIG, type ProjectConfig } from '../../config/defaults.js';
import { saveLastProject } from '../utils/project-root.js';
import { defaultLogger as log } from '../../core/Logger.js';

export interface SetupResult {
  projectRoot: string;
  config: ProjectConfig;
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

function isConfigComplete(config: ProjectConfig): boolean {
  return !!config.projectPath;
}

export async function runSetup(
  cliProject?: string,
  rl?: readline.Interface,
): Promise<SetupResult> {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  const reader = createLineReader(rl);

  // ── Resolve module directory (project root) ──

  const hasExplicitProject = !!cliProject;
  let projectRoot = cliProject ? path.resolve(cliProject) : '';
  if (projectRoot && !fs.existsSync(projectRoot)) {
    console.log(`Project path does not exist: ${projectRoot}`);
    log.warn(`Setup: project path does not exist: ${projectRoot}`);
    projectRoot = '';
  }

  if (!projectRoot) {
    projectRoot = path.resolve(process.cwd());
  }
  log.info(`Setup: initial projectRoot=${projectRoot}`);

  // ── Load or create config ──

  let config: ProjectConfig;
  const configPath = path.join(projectRoot, '.module-agent.json');
  const hasConfig = fs.existsSync(configPath);

  if (hasConfig) {
    try {
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      config = ConfigLoader.getDefaultConfig(workspaceConfig);
      log.info(`Setup: loaded config from ${configPath}`);
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  } else {
    config = { ...DEFAULT_CONFIG };
  }

  // ── Interactive setup — GUI-aligned field order ──

  if (!hasConfig || !isConfigComplete(config)) {
    console.log('\n=== ModuleAgent Setup ===\n');

    // 1. 项目路径 — project root (module.md + workspaces auto-created)
    if (!hasExplicitProject) {
      const projInput = await reader.readLine(`  项目路径 (源代码所在目录，.module-agent/module/ 和 .module-agent/workspace/ 目录将自动创建) [${projectRoot}]: `);
      if (projInput.trim()) {
        const resolved = path.resolve(projInput.trim());
        if (fs.existsSync(resolved)) {
          projectRoot = resolved;
        } else {
          console.log(`  路径不存在: ${resolved}，使用默认`);
        }
      }
    }
    config.projectPath = projectRoot;
    console.log(`  项目路径: ${projectRoot}`);

    // 确保 module.md 存在（项目解析时静默自动生成）
    if (!fs.existsSync(path.join(projectRoot, 'module.md'))) {
      try {
        const content = await ModuleGenerator.generate({ dirPath: projectRoot, projectRoot });
        fs.writeFileSync(path.join(projectRoot, 'module.md'), content, 'utf-8');
        console.log(`  已自动生成 module.md`);
        log.info(`Setup: auto-generated module.md (${content.length} chars)`);
      } catch (err) {
        console.log(`  生成 module.md 失败: ${(err as Error).message}`);
        log.error(`Setup: module.md generation failed: ${(err as Error).message}`);
      }
    }

    // 2. Agent 命令
    const cmd = await reader.readLine(`  Agent 命令 [${config.agents.default.command}]: `);
    if (cmd.trim()) config.agents.default.command = cmd.trim();

    // 4. Agent 参数
    const currentArgs = (config.agents.default.args || []).join(' ');
    const argsStr = await reader.readLine(`  Agent 参数 [${currentArgs}]: `);
    if (argsStr.trim()) {
      config.agents.default.args = argsStr.trim().split(/\s+/);
    }

    // 以新数组格式保存配置
    try {
      const workspaceConfig: { configs: (typeof config & { name: string })[]; defaultConfig: string } = {
        configs: [{ name: 'default', ...config }],
        defaultConfig: 'default',
      };
      fs.writeFileSync(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
      console.log(`\n  配置已保存: ${configPath}`);
      log.info(`Setup: saved config to ${configPath}`);
    } catch (err) {
      console.log(`\n  保存配置失败: ${(err as Error).message}`);
      log.warn(`Setup: could not save config: ${(err as Error).message}`);
    }
  }

  // ── Summary ──

  console.log('');
  console.log(`  项目路径:      ${projectRoot}`);
  console.log(`  模块目录:      ${path.join(projectRoot, '.module-agent/module/')}`);
  console.log(`  工作目录:      ${path.join(projectRoot, '.module-agent/workspace/')}`);
  console.log(`  Agent:        ${config.agents.default.command} ${(config.agents.default.args || []).join(' ')}`);
  console.log('');

  saveLastProject(projectRoot);

  const bufferedLines = reader.drain();

  return { projectRoot, config, bufferedLines };
}
