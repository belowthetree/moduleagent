// ============================================================================
// workspaceDiffHandlers — 工作区 Diff IPC handler
// 注册通道: workspace:diff / workspace:diff-file / workspace:apply / workspace:discard
// Agent 编辑工作区副本后对比源文件、查看差异、选择性写回
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import * as WorkspaceDiff from '../../core/WorkspaceDiff.js';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerWorkspaceDiffHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IpcChannel.WorkspaceDiff.Diff, async (_event, moduleName: string) => {
    const cached = ctx.diffCache.get(moduleName);
    if (cached) return cached;

    const entry = ctx.core.modules.getAgent(moduleName);
    if (!entry) return { error: 'no active agent for this module' };

    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { error: 'no project root' };

    const workspaceCwd = entry.agent.cwd;
    const workspaceBase = path.join(projectRoot, '.module-agent', 'workspace');
    if (!workspaceCwd.startsWith(workspaceBase)) return { error: 'module has no workspace isolation' };

    const relPath = path.relative(workspaceBase, workspaceCwd);
    const sourceDir = relPath ? path.join(projectRoot, relPath) : projectRoot;

    const summary = WorkspaceDiff.analyze(workspaceCwd, sourceDir);
    summary.moduleName = moduleName;
    ctx.diffCache.set(moduleName, summary);
    return summary;
  });

  ipcMain.handle(IpcChannel.WorkspaceDiff.DiffFile, async (_event, moduleName: string, filePath: string) => {
    const cached = ctx.diffCache.get(moduleName);
    if (!cached) return { error: 'no diff data — call workspace:diff first' };

    const file = cached.files.find(f => f.relativePath === filePath);
    if (!file) return { error: `file not found in diff: ${filePath}` };

    const hunks = WorkspaceDiff.unifiedDiff(file.workspacePath, file.sourcePath);
    return { hunks };
  });

  ipcMain.handle(IpcChannel.WorkspaceDiff.Apply, async (_event, moduleName: string, files?: string[]) => {
    const cached = ctx.diffCache.get(moduleName);
    if (!cached) return { applied: 0, errors: ['no diff data'] };

    const result = await WorkspaceDiff.apply(cached.workspaceDir, cached.sourceDir, files, cached.files);
    ctx.logger.info(`WorkspaceDiff: applied ${result.applied} files for [${moduleName}]`);

    const newSummary = WorkspaceDiff.analyze(cached.workspaceDir, cached.sourceDir);
    newSummary.moduleName = moduleName;
    ctx.diffCache.set(moduleName, newSummary);

    return result;
  });

  ipcMain.handle(IpcChannel.WorkspaceDiff.Discard, async (_event, moduleName: string) => {
    const cached = ctx.diffCache.get(moduleName);
    if (cached) {
      await WorkspaceDiff.discardWorkspace(cached.workspaceDir);
      ctx.diffCache.delete(moduleName);
      ctx.logger.info(`WorkspaceDiff: discarded workspace for [${moduleName}]`);
    }
    return { success: true };
  });
}
