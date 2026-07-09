// ---------------------------------------------------------------------------
// agents/kernel/sandbox.ts — 工作区路径沙箱验证
// 确保所有工具操作的路径都在代理的工作区根目录内
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs-extra';

export function resolveSandboxPath(workspaceRoot: string, filePath: string): string {
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, '/');
  const root = workspaceRoot.replace(/\\/g, '/');

  if (!normalized.startsWith(root + '/') && normalized !== root) {
    throw new Error(`Access denied: "${filePath}" is outside workspace root "${workspaceRoot}"`);
  }

  return resolved;
}

export function isPathWithinWorkspace(workspaceRoot: string, filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, '/');
  const root = workspaceRoot.replace(/\\/g, '/');
  return normalized.startsWith(root + '/') || normalized === root;
}

export function relativeSandboxPath(workspaceRoot: string, filePath: string): string {
  const resolved = resolveSandboxPath(workspaceRoot, filePath);
  return path.relative(workspaceRoot, resolved).replace(/\\/g, '/');
}

export async function safeReadFile(
  workspaceRoot: string,
  filePath: string,
  options?: { offset?: number; limit?: number },
): Promise<string> {
  const resolved = resolveSandboxPath(workspaceRoot, filePath);

  if (!(await fs.pathExists(resolved))) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const content = await fs.readFile(resolved, 'utf-8');

  if (options?.offset !== undefined || options?.limit !== undefined) {
    const lines = content.split('\n');
    const start = (options.offset ?? 1) - 1;
    const end = options.limit !== undefined ? start + options.limit : lines.length;
    return lines.slice(start, end).join('\n');
  }

  return content;
}

export async function safeWriteFile(
  workspaceRoot: string,
  filePath: string,
  content: string,
): Promise<void> {
  const resolved = resolveSandboxPath(workspaceRoot, filePath);
  await fs.ensureDir(path.dirname(resolved));
  await fs.writeFile(resolved, content, 'utf-8');
}

export async function safeListDir(
  workspaceRoot: string,
  dirPath: string,
  options?: { recursive?: boolean; maxDepth?: number },
): Promise<string[]> {
  const resolved = resolveSandboxPath(workspaceRoot, dirPath || '.');
  const maxDepth = options?.maxDepth ?? (options?.recursive ? 10 : 1);
  const results: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        results.push(relPath + '/');
        if (depth < maxDepth) await walk(fullPath, depth + 1);
      } else {
        results.push(relPath);
      }
    }
  }

  await walk(resolved, 1);
  return results.sort();
}
