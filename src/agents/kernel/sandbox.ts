// ---------------------------------------------------------------------------
// agents/kernel/sandbox.ts — 代理沙箱
// 每个 agent 实例化一个独立的 AgentSandbox，封装路径可见性和文件操作
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs-extra';

export interface VisibilityConfig {
  /** 可见的根路径列表（绝对路径） */
  allowed: string[];
  /** allowed 路径内需排除的子目录（子模块路径） */
  excluded: string[];
}

export class AgentSandbox {
  readonly rootPath: string;
  private allowed: string[];
  private excluded: string[];

  constructor(visibility: VisibilityConfig) {
    this.allowed = visibility.allowed.map(p => path.resolve(p).replace(/\\/g, '/'));
    this.excluded = visibility.excluded.map(p => path.resolve(p).replace(/\\/g, '/'));
    this.rootPath = this.allowed[0] || '';
  }

  // ── 路径校验 ──────────────────────────────────────────

  resolvePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    const normalized = resolved.replace(/\\/g, '/');

    for (const a of this.allowed) {
      if (normalized === a || normalized.startsWith(a + '/')) {
        for (const e of this.excluded) {
          if (normalized === e || normalized.startsWith(e + '/')) {
            throw new Error(
              `访问被拒绝: "${filePath}" 属于子模块目录，不可直接访问。请使用 module_call 委派任务。`,
            );
          }
        }
        return resolved;
      }
    }

    throw new Error(
      `访问被拒绝: "${filePath}" (resolved="${normalized}") 不在可见范围内。可见根路径: ${this.allowed.join(', ')}，排除路径: ${this.excluded.join(', ')}`,
    );
  }

  isPathVisible(filePath: string): boolean {
    try {
      this.resolvePath(filePath);
      return true;
    } catch {
      return false;
    }
  }

  relativePath(filePath: string): string {
    const resolved = this.resolvePath(filePath);
    return path.relative(this.rootPath, resolved).replace(/\\/g, '/');
  }

  // ── 命令执行 ──────────────────────────────────────────

  resolveCommandCwd(cwdRel?: string): string {
    return cwdRel ? this.resolvePath(cwdRel) : this.rootPath;
  }

  // ── 文件操作 ──────────────────────────────────────────

  async readFile(
    filePath: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<string> {
    const resolved = this.resolvePath(filePath);

    if (!(await fs.pathExists(resolved))) {
      throw new Error(`文件未找到: ${filePath}`);
    }

    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new Error(`不是文件: ${filePath}`);
    }

    const content = await fs.readFile(resolved, 'utf-8');

    if (opts?.offset !== undefined || opts?.limit !== undefined) {
      const lines = content.split('\n');
      const start = (opts.offset ?? 1) - 1;
      const end = opts.limit !== undefined ? start + opts.limit : lines.length;
      return lines.slice(start, end).join('\n');
    }

    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this.resolvePath(filePath);
    await fs.ensureDir(path.dirname(resolved));
    await fs.writeFile(resolved, content, 'utf-8');
  }

  async listDir(
    dirPath?: string,
    opts?: { recursive?: boolean; maxDepth?: number; markExcluded?: boolean },
  ): Promise<string[]> {
    const resolved = dirPath ? this.resolvePath(dirPath) : this.rootPath;
    const maxDepth = opts?.maxDepth ?? (opts?.recursive ? 10 : 1);
    const markExcluded = opts?.markExcluded ?? true;
    const results: string[] = [];

    const self = this;
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(self.rootPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          const isExcluded = self.isExcludedPath(fullPath);
          if (isExcluded) {
            if (markExcluded) {
              results.push(relPath + '/ [submodule]');
            }
            continue;
          }
          results.push(relPath + '/');
          if (depth < maxDepth) await walk(fullPath, depth + 1);
        } else {
          if (!self.isPathVisible(fullPath)) continue;
          results.push(relPath);
        }
      }
    }

    await walk(resolved, 1);
    return results.sort();
  }

  private isExcludedPath(resolved: string): boolean {
    const normalized = resolved.replace(/\\/g, '/');
    for (const e of this.excluded) {
      if (normalized === e || normalized.startsWith(e + '/')) {
        return true;
      }
    }
    return false;
  }
}
