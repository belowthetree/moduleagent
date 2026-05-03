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

  // On non-Windows, detect Windows drive-letter absolute paths
  if (process.platform !== 'win32' && /^[a-zA-Z]:[/\\]/.test(p)) {
    const drive = p.charAt(0).toLowerCase();
    const rest = p.slice(2).replace(/\\/g, '/');
    return `/mnt/${drive}${rest}`;
  }

  return path.resolve(p);
}
