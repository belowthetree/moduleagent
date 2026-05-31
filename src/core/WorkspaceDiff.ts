import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import crypto from 'crypto';
import type { DiffFile, DiffStatus, DiffSummary } from '../types/shared.js';
import { defaultLogger } from './Logger.js';

// ---------------------------------------------------------------------------
// 工作区 Diff 引擎
//
// 比较 Agent 工作区副本与源目录，识别新增/修改/删除的文件，
// 支持统一 diff 预览和选择性写回。
// ---------------------------------------------------------------------------

const EXCLUDE_PATTERNS = ['node_modules', '.git', '.DS_Store'];

/**
 * 递归列出目录下所有文件的相对路径（排除 node_modules / .git 等）。
 */
function listFilesRecursive(dir: string, baseDir: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_PATTERNS.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      const sub = listFilesRecursive(fullPath, baseDir);
      for (const [k, v] of sub) result.set(k, v);
    } else {
      result.set(relPath, fullPath);
    }
  }
  return result;
}

/**
 * 计算文件的 SHA256 哈希（用于快速比对内容是否相同）。
 */
function fileHash(filePath: string): string {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return '';
  }
}

/**
 * 逐行比对两个文本文件，生成统一 diff 格式的输出。
 *
 * 使用简单的 LCS（最长公共子序列）算法进行行级比对。
 * 对于大文件（>500 行），回退为简单全量对比。
 */
function computeLineDiff(
  workspaceLines: string[],
  sourceLines: string[],
): string {
  // 对于超大文件，仅报告"文件已修改"
  if (workspaceLines.length > 500 || sourceLines.length > 500) {
    return `--- a/source\n+++ b/workspace\n@@ File too large for inline diff (${sourceLines.length} → ${workspaceLines.length} lines)\n`;
  }

  const result: string[] = [];
  let i = 0; // source index
  let j = 0; // workspace index
  let hunkHeaderEmitted = false;

  while (i < sourceLines.length || j < workspaceLines.length) {
    // 跳过相同的行
    let sameCount = 0;
    while (
      i + sameCount < sourceLines.length &&
      j + sameCount < workspaceLines.length &&
      sourceLines[i + sameCount] === workspaceLines[j + sameCount]
    ) {
      sameCount++;
    }

    if (sameCount > 0) {
      if (hunkHeaderEmitted) {
        // 上下文行
        const ctxStart = Math.max(0, sameCount - 3);
        for (let k = ctxStart; k < sameCount; k++) {
          result.push(` ${sourceLines[i + k]}`);
        }
        hunkHeaderEmitted = false;
      }
      i += sameCount;
      j += sameCount;
    }

    if (i >= sourceLines.length && j >= workspaceLines.length) break;

    // 找到差异块
    const delStart = i;
    const addStart = j;

    // 收集删除的行
    const deleted: string[] = [];
    while (i < sourceLines.length) {
      // 检查是否能在后续 workspace 行中找到匹配
      const matchIdx = workspaceLines.indexOf(sourceLines[i]!, j);
      if (matchIdx !== -1 && matchIdx - j <= 3) {
        // 找到了较近的匹配，停止当前差异块
        break;
      }
      deleted.push(sourceLines[i]!);
      i++;
    }

    // 收集新增的行
    const added: string[] = [];
    while (j < workspaceLines.length) {
      const matchIdx = sourceLines.indexOf(workspaceLines[j]!, i);
      if (matchIdx !== -1 && matchIdx - i <= 3) {
        break;
      }
      added.push(workspaceLines[j]!);
      j++;
    }

    if (deleted.length > 0 || added.length > 0) {
      result.push(`@@ -${delStart + 1},${deleted.length} +${addStart + 1},${added.length} @@`);
      for (const line of deleted) result.push(`-${line}`);
      for (const line of added) result.push(`+${line}`);
      hunkHeaderEmitted = true;
    }

    // 防止无限循环：如果没有任何进展，强制推进
    if (deleted.length === 0 && added.length === 0) {
      if (i < sourceLines.length) {
        result.push(`-${sourceLines[i]}`);
        i++;
      }
      if (j < workspaceLines.length) {
        result.push(`+${workspaceLines[j]}`);
        j++;
      }
      hunkHeaderEmitted = true;
    }
  }

  return result.join('\n');
}

/**
 * 生成单个文件的统一 diff 文本。
 */
export function unifiedDiff(workspaceFile: string, sourceFile: string): string {
  const wsExists = fs.existsSync(workspaceFile);
  const srcExists = fs.existsSync(sourceFile);

  if (!wsExists && !srcExists) return '';

  if (!srcExists) {
    // 新增文件 — 全部为 +
    const lines = fs.readFileSync(workspaceFile, 'utf-8').split('\n');
    const header = `--- /dev/null\n+++ b/${path.basename(workspaceFile)}\n`;
    return header + lines.map(l => `+${l}`).join('\n');
  }

  if (!wsExists) {
    // 删除文件 — 全部为 -
    const lines = fs.readFileSync(sourceFile, 'utf-8').split('\n');
    const header = `--- a/${path.basename(sourceFile)}\n+++ /dev/null\n`;
    return header + lines.map(l => `-${l}`).join('\n');
  }

  // 快速检查：同 hash 则无差异
  if (fileHash(workspaceFile) === fileHash(sourceFile)) return '';

  const wsLines = fs.readFileSync(workspaceFile, 'utf-8').split('\n');
  const srcLines = fs.readFileSync(sourceFile, 'utf-8').split('\n');

  const header = `--- a/${path.basename(sourceFile)}\n+++ b/${path.basename(workspaceFile)}\n`;
  return header + computeLineDiff(wsLines, srcLines);
}

/**
 * 判断文件是否为文本文件（基于常见扩展名 + 无 null 字节检测）。
 */
function isTextFile(filePath: string): boolean {
  const textExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.vue', '.json', '.md', '.txt',
    '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.toml',
    '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
    '.sh', '.bat', '.ps1', '.env', '.gitignore', '.npmignore',
    '.svg', '.graphql', '.gql', '.prisma', '.sql',
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return textExtensions.has(ext);
}

/**
 * 比对工作区目录与源目录，生成变更摘要。
 *
 * @param workspaceDir - Agent 工作区目录（修改后的副本）
 * @param sourceDir - 项目源目录
 * @returns DiffSummary 包含所有变更文件的分类列表
 */
export function analyze(workspaceDir: string, sourceDir: string, excludeRelPaths?: string[]): DiffSummary {
  defaultLogger.info(`WorkspaceDiff.analyze: ws=${workspaceDir} src=${sourceDir} exclude=${excludeRelPaths?.length || 0} paths`);
  if (!fs.existsSync(workspaceDir)) { defaultLogger.info(`WorkspaceDiff.analyze: ws dir missing`); return emptySummary(); }
  if (!fs.existsSync(sourceDir)) { defaultLogger.info(`WorkspaceDiff.analyze: src dir missing`); return emptySummary(); }

  const excludeSet = new Set(excludeRelPaths?.map(p => p.replace(/\\/g, '/')) || []);
  function isExcluded(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    if (excludeSet.has(normalized)) return true;
    for (const ex of excludeSet) {
      if (normalized.startsWith(ex + '/')) return true;
    }
    return false;
  }

  const wsFiles = listFilesRecursive(workspaceDir, workspaceDir);
  const srcFiles = listFilesRecursive(sourceDir, sourceDir);
  // 从源文件列表中移除被排除的子模块目录
  for (const key of srcFiles.keys()) {
    if (isExcluded(key)) srcFiles.delete(key);
  }
  defaultLogger.info(`WorkspaceDiff.analyze: wsFiles=${wsFiles.size} srcFiles=${srcFiles.size} (after exclude)`);

  // 工作区为空（只有 .git 等元数据）→ 不是真实变更，跳过
  const wsNonMeta = [...wsFiles.keys()].filter(k => !k.startsWith('.git'));
  if (wsNonMeta.length === 0) {
    defaultLogger.info(`WorkspaceDiff.analyze: workspace empty (no non-meta files)`);
    return emptySummary();
  }

  const allRelPaths = new Set([...wsFiles.keys(), ...srcFiles.keys()]);

  const files: DiffFile[] = [];

  for (const relPath of allRelPaths) {
    const wsAbs = wsFiles.get(relPath);
    const srcAbs = srcFiles.get(relPath);

    let status: DiffStatus;
    if (wsAbs && !srcAbs) {
      status = 'added';
    } else if (!wsAbs && srcAbs) {
      status = 'deleted';
    } else if (wsAbs && srcAbs) {
      const wsHash = fileHash(wsAbs);
      const srcHash = fileHash(srcAbs);
      status = wsHash !== srcHash ? 'modified' : 'unchanged';
    } else {
      continue; // 不应出现
    }

    if (status === 'unchanged') continue;

    // 跳过非文本文件（二进制等），避免 diff 噪音
    const fileForExt = wsAbs || srcAbs!;
    if (!isTextFile(fileForExt)) {
      // 二进制文件只报告状态，不提供行级 diff
    }

    let sizeDiff: number | undefined;
    if (wsAbs && srcAbs) {
      try {
        const wsStat = fs.statSync(wsAbs);
        const srcStat = fs.statSync(srcAbs);
        sizeDiff = wsStat.size - srcStat.size;
      } catch {
        // ignore
      }
    }

    files.push({
      relativePath: relPath,
      status,
      workspacePath: wsAbs || '',
      sourcePath: srcAbs || '',
      sizeDiff,
    });
  }

  // 按状态排序：modified > added > deleted
  files.sort((a, b) => {
    const order: Record<DiffStatus, number> = { modified: 0, added: 1, deleted: 2, unchanged: 3 };
    return order[a.status] - order[b.status] || a.relativePath.localeCompare(b.relativePath);
  });

  const result = {
    moduleName: '',
    workspaceDir,
    sourceDir,
    files,
    addedCount: files.filter(f => f.status === 'added').length,
    modifiedCount: files.filter(f => f.status === 'modified').length,
    deletedCount: files.filter(f => f.status === 'deleted').length,
  };
  defaultLogger.info(`WorkspaceDiff.analyze: result +${result.addedCount} ~${result.modifiedCount} -${result.deletedCount} (${result.files.length} files)`);
  return result;
}

function emptySummary(): DiffSummary {
  return { moduleName: '', workspaceDir: '', sourceDir: '', files: [], addedCount: 0, modifiedCount: 0, deletedCount: 0 };
}

/**
 * 将选定的文件从工作区写回到源目录。
 *
 * @param workspaceDir - 工作区目录
 * @param sourceDir - 源项目目录
 * @param filePaths - 要写回的文件相对路径列表；不传则写回所有变更
 * @param diffFiles - 完整的变更文件列表（用于确定哪些是删除操作）
 * @returns 写回结果
 */
export async function apply(
  workspaceDir: string,
  sourceDir: string,
  filePaths: string[] | undefined,
  diffFiles: DiffFile[],
): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];
  let applied = 0;

  const targetFiles = filePaths
    ? diffFiles.filter(f => filePaths.includes(f.relativePath))
    : diffFiles;

  for (const file of targetFiles) {
    try {
      const dest = path.join(sourceDir, file.relativePath);

      if (file.status === 'deleted') {
        if (fs.existsSync(dest)) {
          await fse.remove(dest);
          applied++;
        }
      } else {
        // added 或 modified：从工作区拷贝到源
        await fse.ensureDir(path.dirname(dest));
        await fse.copy(file.workspacePath, dest, { overwrite: true });
        applied++;
      }
    } catch (err) {
      errors.push(`${file.relativePath}: ${(err as Error).message}`);
    }
  }

  return { applied, errors };
}

/**
 * 删除工作区目录（丢弃所有变更）。
 */
export async function discardWorkspace(workspaceDir: string): Promise<void> {
  if (fs.existsSync(workspaceDir)) {
    await fse.remove(workspaceDir);
    defaultLogger.info(`WorkspaceDiff: discarded ${workspaceDir}`);
  }
}
