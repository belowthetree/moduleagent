import fs from 'fs';
import path from 'path';
import { CliError } from './output.js';

function stateFile(projectRoot: string): string {
  const dir = path.join(projectRoot, '.module-agent');
  return path.join(dir, 'state.json');
}

function loadState(projectRoot: string): { lastProject?: string } {
  try {
    const sf = stateFile(projectRoot);
    if (fs.existsSync(sf)) {
      return JSON.parse(fs.readFileSync(sf, 'utf-8'));
    }
  } catch {}
  return {};
}

export function saveLastProject(projectPath: string): void {
  try {
    const sf = stateFile(projectPath);
    const dir = path.dirname(sf);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const state = loadState(projectPath);
    state.lastProject = projectPath;
    fs.writeFileSync(sf, JSON.stringify(state, null, 2), 'utf-8');
  } catch {}
}

function findSavedProject(): string | null {
  // Search upward from cwd for .module-agent/state.json containing lastProject
  let dir = path.resolve(process.cwd());
  while (true) {
    const state = loadState(dir);
    if (state.lastProject && fs.existsSync(state.lastProject)) {
      return state.lastProject;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveProjectRoot(cliProject?: string): string {
  if (cliProject) {
    const resolved = path.resolve(cliProject);
    if (!fs.existsSync(resolved)) {
      throw new CliError(2, `Project path does not exist: ${cliProject}`);
    }
    saveLastProject(resolved);
    return resolved;
  }

  // Check saved last project path from any ancestor .module-agent/state.json
  const saved = findSavedProject();
  if (saved) return saved;

  // Fallback: search upward from cwd for project markers
  let dir = path.resolve(process.cwd());
  while (true) {
    if (
      fs.existsSync(path.join(dir, '.module-agent.json')) ||
      fs.existsSync(path.join(dir, 'module.md'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new CliError(
    1,
    'Could not find project root. ' +
      'Use --project <path> or run from within a project that has .module-agent.json or module.md.',
  );
}
