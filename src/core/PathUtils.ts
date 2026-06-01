// ---------------------------------------------------------------------------
// core/PathUtils.ts — 路径工具函数
// 处理 Windows 驱动器字母路径在非 Windows 平台上的归一化
// ---------------------------------------------------------------------------

import path from 'path';

/**
 * Normalize a path for the current platform.
 *
 * On Linux/WSL, Node's path.resolve() does not recognize Windows absolute paths
 * (e.g., "E:\foo\bar") as absolute — they are treated as relative and get
 * concatenated with process.cwd(). This converts such paths to WSL's
 * /mnt/<drive>/... format.
 */
export function normalizeCodeSourcePath(p: string): string {
  if (!p) return p;

  // 在非 Windows 上检测 Windows 盘符绝对路径
  if (process.platform !== 'win32' && /^[a-zA-Z]:[/\\]/.test(p)) {
    const drive = p.charAt(0).toLowerCase();
    const rest = p.slice(2).replace(/\\/g, '/');
    return `/mnt/${drive}${rest}`;
  }

  return path.resolve(p);
}
