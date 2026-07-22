// ---------------------------------------------------------------------------
// agents/kernel/sandbox.ts — 代理沙箱
// 每个 agent 实例化一个独立的 AgentSandbox，封装路径可见性和文件操作
// ---------------------------------------------------------------------------

import path from 'path';
import { realpathSync } from 'fs';
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
    this.allowed = visibility.allowed.map(p => this.normalizePath(this.toRealPath(path.resolve(p))));
    this.excluded = visibility.excluded.map(p => this.normalizePath(this.toRealPath(path.resolve(p))));
    this.rootPath = this.allowed[0] || '';
  }

  // ── 路径校验 ──────────────────────────────────────────

  /**
   * 解析为真实路径（跟随 symlink / Windows junction），防止通过链接逃逸沙箱。
   * 目标不存在时，向上找最近的已存在祖先做 realpath，再拼接剩余部分。
   */
  private toRealPath(resolved: string): string {
    let existing = resolved;
    const missing: string[] = [];
    while (!fs.existsSync(existing)) {
      missing.push(path.basename(existing));
      const parent = path.dirname(existing);
      if (parent === existing) break; // 已到达文件系统根
      existing = parent;
    }
    let real: string;
    try {
      real = realpathSync.native(existing);
    } catch {
      real = existing;
    }
    for (const seg of [...missing].reverse()) {
      real = path.join(real, seg);
    }
    return real;
  }

  /** 统一为 '/' 分隔符并去掉 Windows realpath 可能带出的 \\?\ 前缀 */
  private normalizePath(p: string): string {
    let n = p.replace(/\\/g, '/');
    if (n.startsWith('//?/')) n = n.slice(4);
    if (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1);
    return n;
  }

  /** 比较用规范化：Windows 下路径不区分大小写 */
  private cmpPath(p: string): string {
    const n = this.normalizePath(p);
    return process.platform === 'win32' ? n.toLowerCase() : n;
  }

  resolvePath(filePath: string): string {
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(this.rootPath, filePath);
    // 词法解析后再解析符号链接，与 realpath 化的 allowed/excluded 根做比较
    const realCmp = this.cmpPath(this.toRealPath(resolved));

    for (const a of this.allowed) {
      const cmpA = this.cmpPath(a);
      if (realCmp === cmpA || realCmp.startsWith(cmpA + '/')) {
        for (const e of this.excluded) {
          const cmpE = this.cmpPath(e);
          if (realCmp === cmpE || realCmp.startsWith(cmpE + '/')) {
            throw new Error(
              `访问被拒绝: "${filePath}" 属于子模块目录，不可直接访问。请使用 module_call 委派任务。`,
            );
          }
        }
        return resolved;
      }
    }

    throw new Error(
      `访问被拒绝: "${filePath}" (resolved="${this.normalizePath(resolved)}") 不在可见范围内。可见根路径: ${this.allowed.join(', ')}，排除路径: ${this.excluded.join(', ')}`,
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
    const normalized = this.cmpPath(resolved);
    for (const e of this.excluded) {
      const cmpE = this.cmpPath(e);
      if (normalized === cmpE || normalized.startsWith(cmpE + '/')) {
        return true;
      }
    }
    return false;
  }
}
