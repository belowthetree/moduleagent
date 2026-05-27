// ============================================================================
// workflowHandlers — 工作流 IPC handler
// 注册通道: workflow:list / workflow:load / workflow:create / workflow:delete / workflow:stepSave / workflow:stepDelete / workflow:stepAdd / workflow:execute / workflow:cancel / workflow:status
// 管理工作流的完整生命周期（CRUD + 执行 + 状态查询）
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerWorkflowHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Workflow.List, async () => {
    if (!ctx.core.workflows) return [];
    try {
      const names = ctx.core.workflows.listWorkflows();
      return names.map(name => {
        const wf = ctx.core.workflows!.loadWorkflow(name);
        return { name, stepCount: wf?.steps.length ?? 0 };
      });
    } catch { return []; }
  });

  ipcMain.handle(IpcChannel.Workflow.Load, async (_event, name: string) => {
    if (!ctx.core.workflows) return { error: 'workflow subsystem not initialized' };
    try {
      const wf = ctx.core.workflows.loadWorkflow(name);
      if (!wf) return { error: `workflow not found: ${name}` };
      return { workflow: wf };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Workflow.Execute, async (_event, name: string, userInput?: string) => {
    if (!ctx.core.workflows) return { error: 'workflow subsystem not initialized' };
    try {
      const results = await ctx.core.workflows.executeWorkflow(name, userInput);
      return { success: true, results };
    } catch (err) {
      ctx.logger.error(`workflow:execute [${name}] failed: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Workflow.Cancel, async (_event, name: string) => {
    if (!ctx.core.workflows) return;
    await ctx.core.workflows.cancel(name);
  });

  ipcMain.handle(IpcChannel.Workflow.Status, async (_event, name: string) => {
    if (!ctx.core.workflows) return null;
    const state = ctx.core.workflows.getExecutionState(name);
    if (!state) return null;
    return {
      status: state.status,
      currentStep: state.currentStepIndex,
      totalSteps: state.stepResults.length,
      results: state.stepResults,
    };
  });

  // ── CRUD operations ──

  ipcMain.handle(IpcChannel.Workflow.Create, async (_event, name: string) => {
    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { success: false, error: 'no project root' };
    try {
      const wfDir = path.join(projectRoot, '.module-agent', 'workflow', name);
      const stepDir = path.join(wfDir, 'step1');
      await fs.ensureDir(stepDir);
      const stepMd = [
        '---',
        'name: ' + name,
        '---',
        '',
        '# ' + name,
        '',
        '请描述第一步要完成的工作...',
      ].join('\n');
      await fs.promises.writeFile(path.join(stepDir, 'STEP.md'), stepMd, 'utf-8');
      ctx.logger.info(`workflow:create [${name}] created at ${wfDir}`);
      return { success: true };
    } catch (err) {
      ctx.logger.error(`workflow:create [${name}] failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Workflow.Delete, async (_event, name: string) => {
    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { success: false };
    try {
      const wfDir = path.join(projectRoot, '.module-agent', 'workflow', name);
      if (fs.existsSync(wfDir)) {
        await fs.remove(wfDir);
      }
      // Also clean up state file
      const stateFile = path.join(projectRoot, '.module-agent', 'workflow', `${name}.state.json`);
      if (fs.existsSync(stateFile)) await fs.promises.unlink(stateFile);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Workflow.StepSave, async (_event, wfName: string, stepName: string, content: string) => {
    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { success: false };
    try {
      const filePath = path.join(projectRoot, '.module-agent', 'workflow', wfName, stepName, 'STEP.md');
      await fs.ensureDir(path.dirname(filePath));
      await fs.promises.writeFile(filePath, content, 'utf-8');
      ctx.logger.info(`workflow:stepSave [${wfName}/${stepName}]`);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Workflow.StepDelete, async (_event, wfName: string, stepName: string) => {
    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { success: false };
    try {
      const stepDir = path.join(projectRoot, '.module-agent', 'workflow', wfName, stepName);
      if (fs.existsSync(stepDir)) await fs.remove(stepDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Workflow.StepAdd, async (_event, wfName: string) => {
    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { success: false, error: 'no project root' };
    try {
      const wfDir = path.join(projectRoot, '.module-agent', 'workflow', wfName);
      // Find next step number
      let maxN = 0;
      if (fs.existsSync(wfDir)) {
        const entries = fs.readdirSync(wfDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && e.name.startsWith('step')) {
            const n = parseInt(e.name.replace('step', ''), 10);
            if (!isNaN(n) && n > maxN) maxN = n;
          }
        }
      }
      const nextStep = `step${maxN + 1}`;
      const stepDir = path.join(wfDir, nextStep);
      await fs.ensureDir(stepDir);
      const stepMd = [
        '---',
        'name: ' + nextStep,
        '---',
        '',
        '# ' + nextStep,
        '',
        '请描述此步骤要完成的工作...',
      ].join('\n');
      await fs.promises.writeFile(path.join(stepDir, 'STEP.md'), stepMd, 'utf-8');
      return { success: true, stepName: nextStep };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
