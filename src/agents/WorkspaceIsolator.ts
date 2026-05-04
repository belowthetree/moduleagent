import path from 'path';
import fs from 'fs';
import os from 'os';
import fse from 'fs-extra';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js';
import { normalizeCodeSourcePath } from '../core/PathUtils.js';
import { defaultLogger } from '../core/Logger.js';

/**
 * Compute the workspace directory path for a given module node.
 *
 * When a workspace root is configured, the module is placed at:
 *   <workspaceRoot>/<relativePath>  (or <workspaceRoot>/<name> when relativePath is '.')
 * Otherwise, the module's absolutePath is used, falling back to:
 *   <projectRoot>/<relativePath>
 *
 * @param node - The module graph node
 * @param workspaceRoot - Optional workspace root directory for isolated workspaces
 * @param projectRoot - The project root directory (fallback when no workspace root)
 * @returns Resolved absolute path to the module's workspace directory
 */
export function workspacePathForModule(
  node: ModuleGraphNode,
  workspaceRoot: string | null,
  projectRoot: string,
): string {
  if (workspaceRoot) {
    return node.relativePath === '.'
      ? path.join(workspaceRoot, node.name)
      : path.join(workspaceRoot, node.relativePath);
  }
  return node.absolutePath || path.join(projectRoot, node.relativePath);
}

/**
 * Resolve the code source path for a given module node, based on the project's
 * code source configuration.
 *
 * Resolution strategy (for each candidate base directory):
 *   1. If relativePath is '.', return the base directory itself
 *   2. Try direct mapping: <base>/<relativePath> — check with existsSync
 *   3. Try src/ prefix: <base>/src/<relativePath> (common for Rust/Java projects)
 *   4. Fall back to direct path (caller should verify existence)
 *
 * @param node - The module graph node
 * @param codeSource - The code source configuration from project config
 *                     ({ type: 'local', path: '...' } or { type: 'git', url: '...' })
 * @returns Resolved path, or empty string if no valid code source is configured
 */
export function codeSourcePathForModule(
  node: ModuleGraphNode,
  codeSource: { type: string; path?: string } | null,
): string {
  if (!codeSource) return '';

  const resolvePath = (base: string): string => {
    if (node.relativePath === '.') return base;

    const direct = path.join(base, node.relativePath);
    if (fs.existsSync(direct)) return direct;

    const srcPath = path.join(base, 'src', node.relativePath);
    if (fs.existsSync(srcPath)) return srcPath;

    return direct;
  };

  if (codeSource.type === 'local' && codeSource.path) {
    return resolvePath(normalizeCodeSourcePath(codeSource.path));
  }

  return '';
}

// ---------------------------------------------------------------------------
// Git code source resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a git code source to a local cache path.
 *
 * Clones the repository on first access, pulls on subsequent accesses.
 * Results are cached in the provided `gitCacheDir` Map for reuse across
 * multiple modules in the same session.
 *
 * @param codeSource - The code source configuration ({ type: 'git', url, branch })
 * @param gitCacheDir - Session-scoped cache mapping cacheKey → local path
 * @param _onLog - Optional log callback (reserved for future use; defaultLogger used internally)
 * @returns Resolved cache path, or empty string if codeSource is not git
 */
export async function resolveGitCodeSource(
  codeSource: { type: string; url?: string; branch?: string } | null,
  gitCacheDir: Map<string, string>,
  _onLog?: (msg: string) => void,
): Promise<string> {
  if (!codeSource || codeSource.type !== 'git' || !codeSource.url) return '';

  const cacheKey = `${codeSource.url}@${codeSource.branch || 'main'}`;
  const cached = gitCacheDir.get(cacheKey);
  if (cached && fs.existsSync(cached)) return cached;

  const repoName = (codeSource.url.split('/').pop() || 'repo').replace(/\.git$/, '');
  const cachePath = path.join(os.tmpdir(), 'module-agent-git-cache', repoName);

  if (fs.existsSync(cachePath)) {
    defaultLogger.info(`Git cache exists, pulling: ${cachePath}`);
    try {
      const git = await import('simple-git');
      await git.simpleGit(cachePath).pull();
    } catch (err) {
      defaultLogger.warn(`Git pull failed, using cached copy: ${(err as Error).message}`);
    }
  } else {
    defaultLogger.info(`Cloning ${codeSource.url} -> ${cachePath}`);
    await fse.ensureDir(path.dirname(cachePath));
    const git = await import('simple-git');
    const branch = codeSource.branch || 'main';
    await git.simpleGit().clone(codeSource.url, cachePath, ['--branch', branch, '--single-branch']);
  }

  gitCacheDir.set(cacheKey, cachePath);
  return cachePath;
}

// ---------------------------------------------------------------------------
// Module workspace preparation (isolation copy)
// ---------------------------------------------------------------------------

/**
 * Prepare an isolated workspace directory for a module by copying its source
 * code into the configured workspace root.
 *
 * Strategy:
 * 1. If no workspaceRoot → return node.absolutePath (no isolation)
 * 2. Compute destDir via `workspacePathForModule`
 * 3. Resolve srcDir: try `codeSourcePathForModule` first; if empty + git codeSource → resolve git
 * 4. If no srcDir → warn + return node.absolutePath
 * 5. If srcDir doesn't exist on disk → ensureDir(destDir) + return destDir
 * 6. If srcDir === destDir → return destDir (no copy needed)
 * 7. Copy srcDir → destDir, excluding node_modules, .git, and sub-module directories
 * 8. On error → warn + return node.absolutePath (never throws)
 *
 * @param node - The module graph node
 * @param options - Workspace isolation options
 * @param options.workspaceRoot - Root directory for isolated workspace copies
 * @param options.codeSource - Project code source configuration
 * @param options.graph - Module graph (used to discover sub-module paths to exclude)
 * @param options.gitCacheDir - Session-scoped git cache
 * @param options.onLog - Optional log callback (reserved; defaultLogger used internally)
 * @returns Path to the prepared workspace directory
 */
export async function prepareModuleWorkspace(
  node: ModuleGraphNode,
  options: {
    workspaceRoot: string | null;
    codeSource: { type: string; path?: string; url?: string; branch?: string } | null;
    graph: ModuleGraphType | null;
    gitCacheDir: Map<string, string>;
    onLog?: (msg: string) => void;
  },
): Promise<string> {
  if (!options.workspaceRoot) return node.absolutePath;

  const destDir = workspacePathForModule(node, options.workspaceRoot, '');

  let srcDir = codeSourcePathForModule(node, options.codeSource);
  if (!srcDir && options.codeSource?.type === 'git') {
    const gitRoot = await resolveGitCodeSource(options.codeSource, options.gitCacheDir);
    if (gitRoot) {
      const direct = path.join(gitRoot, node.relativePath);
      const srcPath = path.join(gitRoot, 'src', node.relativePath);
      if (node.relativePath === '.') {
        srcDir = gitRoot;
      } else if (fs.existsSync(direct)) {
        srcDir = direct;
      } else if (fs.existsSync(srcPath)) {
        srcDir = srcPath;
      } else {
        srcDir = direct;
      }
    }
  }
  if (!srcDir) {
    defaultLogger.warn(`Module ${node.name}: no code source configured, skipping isolation`);
    return node.absolutePath;
  }

  if (!fs.existsSync(srcDir)) {
    defaultLogger.warn(`Module ${node.name}: source dir not found: ${srcDir}, skipping isolation`);
    // Ensure workspace directory still exists so agent has a valid cwd
    await fse.ensureDir(destDir);
    return destDir;
  }

  if (path.resolve(srcDir) === path.resolve(destDir)) return destDir;

  // Collect submodule relative paths to exclude from root module copy
  const subModulePaths = new Set<string>();
  if (node.relativePath === '.') {
    for (const childName of node.children) {
      const child = options.graph?.nodes.get(childName);
      if (child?.relativePath) {
        subModulePaths.add(child.relativePath);
      }
    }
  }

  try {
    defaultLogger.info(`Isolating module ${node.name}: ${srcDir} -> ${destDir}`);
    await fse.ensureDir(path.dirname(destDir));
    await fse.copy(srcDir, destDir, {
      overwrite: true,
      errorOnExist: false,
      filter: (src: string) => {
        const basename = path.basename(src);
        if (basename === 'node_modules' || basename === '.git') return false;
        if (subModulePaths.size > 0) {
          const rel = path.relative(srcDir, src);
          if (rel && [...subModulePaths].some(s => rel === s || rel.startsWith(s + path.sep))) return false;
        }
        return true;
      },
    });
    return destDir;
  } catch (err) {
    defaultLogger.error(`Failed to isolate module ${node.name}: ${(err as Error).message}`);
    return node.absolutePath;
  }
}

// ---------------------------------------------------------------------------
// Sub-module directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve workspace directory paths for all sub-module children of a given
 * module node.
 *
 * Returns an empty array when the graph is null (no module graph available).
 * Otherwise, maps each child name through the graph to resolve the full node,
 * then applies the provided `workspacePathFn` to get the final path.
 *
 * @param node - The parent module graph node
 * @param graph - The module graph (nullable)
 * @param workspacePathFn - Function that resolves a module node to its workspace path
 * @returns Array of resolved workspace paths for sub-modules
 */
export function getSubModuleDirs(
  node: ModuleGraphNode,
  graph: ModuleGraphType | null,
  workspacePathFn: (n: ModuleGraphNode) => string,
): string[] {
  if (!graph) return [];
  return node.children
    .map(childName => graph.nodes.get(childName))
    .filter((c): c is ModuleGraphNode => !!c)
    .map(c => workspacePathFn(c));
}
