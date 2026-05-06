import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js';
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
 * Resolve the source path for a given module node by joining the project
 * path with the node's relative path.
 *
 * @param node - The module graph node
 * @param projectPath - Root directory of the project
 * @returns Resolved absolute source path for the module
 */
export function codeSourcePathForModule(
  node: ModuleGraphNode,
  projectPath: string,
): string {
  return node.relativePath === '.' ? projectPath : path.join(projectPath, node.relativePath);
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
 * 3. Resolve srcDir via `codeSourcePathForModule(node, projectPath)`
 * 4. If no srcDir → warn + return node.absolutePath
 * 5. If srcDir doesn't exist on disk → ensureDir(destDir) + return destDir
 * 6. If srcDir === destDir → return destDir (no copy needed)
 * 7. Copy srcDir → destDir, excluding node_modules, .git, and sub-module directories
 * 8. On error → warn + return node.absolutePath (never throws)
 *
 * @param node - The module graph node
 * @param options - Workspace isolation options
 * @param options.workspaceRoot - Root directory for isolated workspace copies
 * @param options.projectPath - Project root directory for source resolution
 * @param options.graph - Module graph (used to discover sub-module paths to exclude)
 * @param options.onLog - Optional log callback (reserved; defaultLogger used internally)
 * @returns Path to the prepared workspace directory
 */
export async function prepareModuleWorkspace(
  node: ModuleGraphNode,
  options: {
    workspaceRoot: string | null;
    projectPath: string;
    graph: ModuleGraphType | null;
    onLog?: (msg: string) => void;
  },
): Promise<string> {
  if (!options.workspaceRoot) return node.absolutePath;

  const destDir = workspacePathForModule(node, options.workspaceRoot, '');

  const srcDir = codeSourcePathForModule(node, options.projectPath);
  if (!srcDir) {
    defaultLogger.warn(`Module ${node.name}: no project path configured, skipping isolation`);
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
