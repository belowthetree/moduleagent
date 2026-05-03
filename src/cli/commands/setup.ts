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
  return !!(config.agents.default.command && config.workspace.path);
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
      config = await ConfigLoader.load(projectRoot);
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

    // 1. 模块目录 — where module.md files live
    if (!hasExplicitProject) {
      const modDir = await reader.readLine(`  模块目录 [${projectRoot}]: `);
      if (modDir.trim()) {
        const resolved = path.resolve(modDir.trim());
        if (fs.existsSync(resolved)) {
          projectRoot = resolved;
        } else {
          console.log(`  路径不存在: ${resolved}，使用默认`);
        }
      }
    }
    console.log(`  模块目录: ${projectRoot}`);

    // Ensure module.md exists (silent auto-gen when project is resolved)
    if (!fs.existsSync(path.join(projectRoot, 'module.md'))) {
      try {
        const content = await ModuleGenerator.generate({ dirPath: projectRoot });
        fs.writeFileSync(path.join(projectRoot, 'module.md'), content, 'utf-8');
        console.log(`  已自动生成 module.md`);
        log.info(`Setup: auto-generated module.md (${content.length} chars)`);
      } catch (err) {
        console.log(`  生成 module.md 失败: ${(err as Error).message}`);
        log.error(`Setup: module.md generation failed: ${(err as Error).message}`);
      }
    }

    // 2. 工作目录 — where agent workspaces are created
    const wsDefault = config.workspace.path || '.module-agent/workspaces';
    const wsPath = await reader.readLine(`  工作目录 [${wsDefault}]: `);
    if (wsPath.trim()) {
      config.workspace.path = wsPath.trim();
    }

    // 3. Agent 命令
    const cmd = await reader.readLine(`  Agent 命令 [${config.agents.default.command}]: `);
    if (cmd.trim()) config.agents.default.command = cmd.trim();

    // 4. Agent 参数
    const currentArgs = (config.agents.default.args || []).join(' ');
    const argsStr = await reader.readLine(`  Agent 参数 [${currentArgs}]: `);
    if (argsStr.trim()) {
      config.agents.default.args = argsStr.trim().split(/\s+/);
    }

    // 5. 代码来源类型
    const srcType = await reader.readLine(`  代码来源类型 (local/git) [${config.codeSource.type || 'local'}]: `);
    if (srcType.trim() === 'git') {
      config.codeSource.type = 'git';
    } else if (srcType.trim() === 'local') {
      config.codeSource.type = 'local';
    }

    // 6. Source-specific fields
    if (config.codeSource.type === 'git') {
      const gitUrl = await reader.readLine(`  Git 仓库地址 [${config.codeSource.url || ''}]: `);
      if (gitUrl.trim()) config.codeSource.url = gitUrl.trim();
      const gitBranch = await reader.readLine(`  Git 分支 [${config.codeSource.branch || 'main'}]: `);
      if (gitBranch.trim()) config.codeSource.branch = gitBranch.trim();
    } else {
      const localPath = await reader.readLine(`  本地代码路径 [${config.codeSource.path || projectRoot}]: `);
      if (localPath.trim()) config.codeSource.path = path.resolve(localPath.trim());
    }

    // Save config
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`\n  配置已保存: ${configPath}`);
      log.info(`Setup: saved config to ${configPath}`);
    } catch (err) {
      console.log(`\n  保存配置失败: ${(err as Error).message}`);
      log.warn(`Setup: could not save config: ${(err as Error).message}`);
    }
  }

  // ── Summary ──

  const csInfo = config.codeSource.type === 'git'
    ? `git @ ${config.codeSource.url || '?'} (${config.codeSource.branch || 'main'})`
    : `local @ ${config.codeSource.path || projectRoot}`;

  console.log('');
  console.log(`  模块目录:      ${projectRoot}`);
  console.log(`  工作目录:      ${config.workspace.path}`);
  console.log(`  Agent:        ${config.agents.default.command} ${(config.agents.default.args || []).join(' ')}`);
  console.log(`  代码来源:      ${csInfo}`);
  console.log('');

  saveLastProject(projectRoot);

  const bufferedLines = reader.drain();

  return { projectRoot, config, bufferedLines };
}
