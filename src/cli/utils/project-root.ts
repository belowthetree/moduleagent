import fs from 'fs';
import os from 'os';
import path from 'path';
import { CliError } from './output.js';

const STATE_DIR = path.join(os.homedir(), '.module-agent');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function loadState(): { lastProject?: string } {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

export function saveLastProject(projectPath: string): void {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    const state = loadState();
    state.lastProject = projectPath;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {}
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

  // Check saved last project path first
  const state = loadState();
  if (state.lastProject && fs.existsSync(state.lastProject)) {
    return state.lastProject;
  }

  // Fallback: search upward from cwd
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
