// ---------------------------------------------------------------------------
// core/WorkflowScanner.ts — 工作流扫描器
// 扫描 .module-agent/workflow/ 目录，发现并解析工作流定义和各步骤 STEP.md
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs';
import matter from 'gray-matter';
import { StepFrontmatterSchema } from '../config/schema.js';
import type { WorkflowDescriptor, WorkflowStepDescriptor, StepDefinition } from '../config/defaults.js';
import { defaultLogger, type Logger } from './Logger.js';

/**
 * Scans `.module-agent/workflow/` directories and parses STEP.md files.
 * Directory structure:
 *   workflow/<name>/step1/STEP.md
 *   workflow/<name>/step2/STEP.md
 */

export class WorkflowScanner {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || defaultLogger;
  }

  /** List all workflow names found under the workflow root. */
  listWorkflows(projectPath: string): string[] {
    const wfDir = path.join(projectPath, '.module-agent', 'workflow');
    if (!fs.existsSync(wfDir)) return [];

    const names: string[] = [];
    const entries = fs.readdirSync(wfDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      // Must contain at least one step directory
      const wfPath = path.join(wfDir, entry.name);
      if (this._scanStepDirs(wfPath).length > 0) {
        names.push(entry.name);
      }
    }
    return names;
  }

  /** Load a single workflow descriptor including all steps. */
  loadWorkflow(projectPath: string, workflowName: string): WorkflowDescriptor | null {
    const wfPath = path.join(projectPath, '.module-agent', 'workflow', workflowName);
    if (!fs.existsSync(wfPath) || !fs.statSync(wfPath).isDirectory()) return null;

    const stepDirs = this._scanStepDirs(wfPath);
    const steps: WorkflowStepDescriptor[] = [];

    for (const stepDir of stepDirs) {
      const stepFile = path.join(wfPath, stepDir, 'STEP.md');
      if (!fs.existsSync(stepFile)) {
        this.logger.warn(`WorkflowScanner: ${workflowName}/${stepDir}: no STEP.md, skipping`);
        continue;
      }
      const parsed = this.parseStep(stepFile, stepDir);
      if (parsed) {
        steps.push(parsed);
      }
    }

    return { name: workflowName, dir: wfPath, steps };
  }

  /** Parse a single STEP.md file. */
  parseStep(filePath: string, stepDir: string): WorkflowStepDescriptor | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(raw);

      const parsed = StepFrontmatterSchema.safeParse({
        name: data.name || stepDir,
        description: data.description,
        input: data.input,
        acceptance: data.acceptance,
        agent: data.agent,
      });

      if (!parsed.success) {
        this.logger.warn(`WorkflowScanner: invalid frontmatter in ${filePath}: ${parsed.error.message}`);
        // Still return a basic descriptor with raw frontmatter as definition
        return {
          name: stepDir,
          dir: path.dirname(filePath),
          definition: { name: stepDir },
          body: content.trim(),
        };
      }

      return {
        name: parsed.data.name,
        dir: path.dirname(filePath),
        definition: parsed.data as StepDefinition,
        body: content.trim(),
      };
    } catch (err) {
      this.logger.error(`WorkflowScanner: failed to parse ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Scan for step directories (step1, step2, ...) sorted by name. */
  private _scanStepDirs(wfPath: string): string[] {
    const entries = fs.readdirSync(wfPath, { withFileTypes: true });
    const steps = entries
      .filter(e => e.isDirectory() && e.name.startsWith('step') && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => {
        const na = parseInt(a.replace('step', ''), 10);
        const nb = parseInt(b.replace('step', ''), 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      });
    return steps;
  }
}
