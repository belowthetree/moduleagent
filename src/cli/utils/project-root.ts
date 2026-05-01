import fs from 'fs';
import path from 'path';
import { CliError } from './output.js';

export function resolveProjectRoot(cliProject?: string): string {
  if (cliProject) {
    const resolved = path.resolve(cliProject);
    if (!fs.existsSync(resolved)) {
      throw new CliError(2, `Project path does not exist: ${cliProject}`);
    }
    return resolved;
  }

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
