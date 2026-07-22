// ---------------------------------------------------------------------------
// core/WorkflowSubsystem.ts — 工作流子系统
// 编排多步骤工作流的执行，支持步骤间数据传递、验收检查和状态持久化
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs';
import { KernelFactory, type AgentConfig } from '../agents/KernelFactory.js';
import { WorkflowManager } from '../agents/lifecycle/WorkflowManager.js';
import { prepareStepWorkspace, collectStepOutput, cleanupStepWorkspace } from '../agents/lifecycle/WorkflowWorkspace.js';
import { WorkflowScanner } from './WorkflowScanner.js';
import { defaultLogger, type Logger } from './Logger.js';
import type { CoreCallbacks } from './CoreTypes.js';
import { resolveKnowledgePath } from './AgentSubsystemUtils.js';
import type {
  WorkflowDescriptor,
  WorkflowStepDescriptor,
  WorkflowExecutionState,
  WorkflowStepResult,
  StepInput,
} from '../config/defaults.js';
import type { PromptBlock } from '../agents/kernel/types.js';

// ---------------------------------------------------------------------------
// WorkflowSubsystemOptions
// ---------------------------------------------------------------------------

export interface WorkflowSubsystemOptions {
  callbacks: CoreCallbacks;
  basePath: string;
  configDir?: string;
  projectPath: string;
  workspaceRoot: string;
  logger?: Logger;
  onSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void;
  /** 项目级默认 agent 配置（provider/model/apiKey 等，来自主配置 agents.default） */
  defaultAgentConfig?: AgentConfig;
  /** 上下文截断配置（透传 kernel，来自主配置） */
  truncation?: import('../agents/kernel/types.js').AgentLoopConfig['truncation'];
  /** 在线压缩配置（透传 kernel，来自主配置） */
  compaction?: import('../agents/kernel/types.js').AgentLoopConfig['compaction'];
  /** 按 agent 名解析丢弃内容存档目录 */
  archiveDirFor?: (agentName: string) => string;
}

// ---------------------------------------------------------------------------
// WorkflowSubsystem — workflow orchestration
// ---------------------------------------------------------------------------

export class WorkflowSubsystem {
  private callbacks: CoreCallbacks;
  private logger: Logger;
  private manager: WorkflowManager;
  private scanner: WorkflowScanner;
  private projectPath: string;
  private workspaceRoot: string;
  private configDir: string;
  private subPrompt = '';
  private defaultAgentConfig: AgentConfig;

  // Execution state
  private currentWorkflow: string | null = null;
  private currentStepIndex = 0;
  private abortFlag = false;

  private _onSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void;

  constructor(options: WorkflowSubsystemOptions) {
    this.callbacks = options.callbacks;
    this.logger = options.logger || defaultLogger;
    this.projectPath = options.projectPath;
    this.workspaceRoot = options.workspaceRoot;
    this.configDir = options.configDir || path.join(options.basePath, 'config');
    this._onSessionUpdate = options.onSessionUpdate;
    this.defaultAgentConfig = options.defaultAgentConfig ?? {};
    const subPromptPath = path.join(this.configDir, 'knowledge', 'subagentprompt.md');
    try {
      this.subPrompt = fs.readFileSync(subPromptPath, 'utf-8');
      this.logger.info(`Workflow: loaded subagent prompt (${this.subPrompt.length} chars)`);
    } catch {
      this.subPrompt = '';
      this.logger.warn('Workflow: failed to load subagent prompt');
    }

    const launcher = new KernelFactory();
    this.scanner = new WorkflowScanner(this.logger);

    const self = this;
    this.manager = new WorkflowManager({
      launcher,
      basePath: options.basePath,
      projectPath: options.projectPath,
      workspaceRoot: options.workspaceRoot,
      logger: this.logger,
      truncation: options.truncation,
      compaction: options.compaction,
      archiveDirFor: options.archiveDirFor,
      callbacks: {
        onSessionUpdate(agentName, sessionId, notification) {
          const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
          if (update) self.logger.info(`[ACP:wf] ${agentName} ← ${update}`);
          const data = notification.update as Record<string, unknown>;

          if (update === 'agent_message_chunk') {
            const block = data.content as { type?: string; text?: string } | undefined;
            if (block?.text) self.callbacks.onStreamChunk(agentName, block.text, 'message');
          } else if (update === 'agent_thought_chunk') {
            const block = data.content as { type?: string; text?: string } | undefined;
            if (block?.text) self.callbacks.onStreamChunk(agentName, block.text, 'thought');
          } else if (update === 'tool_call') {
            const tc = data as { title?: string; status?: string };
            if (tc.status === 'error') {
              self.callbacks.onStreamError(agentName, `Tool call failed: ${tc.title || 'unknown'}`);
            }
          }

          if (self._onSessionUpdate) {
            self._onSessionUpdate(agentName, sessionId, notification);
          }
        },
      },
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async dispose(): Promise<void> {
    await this.manager.stopAll();
    this.abortFlag = true;
  }

  // -----------------------------------------------------------------------
  // Workflow discovery
  // -----------------------------------------------------------------------

  listWorkflows(): string[] {
    return this.scanner.listWorkflows(this.projectPath);
  }

  loadWorkflow(name: string): WorkflowDescriptor | null {
    return this.scanner.loadWorkflow(this.projectPath, name);
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  async executeWorkflow(name: string, userInput?: string): Promise<WorkflowStepResult[]> {
    const wf = this.scanner.loadWorkflow(this.projectPath, name);
    if (!wf) throw new Error(`Workflow not found: ${name}`);

    if (wf.steps.length === 0) throw new Error(`Workflow "${name}" has no steps`);

    this.currentWorkflow = name;
    this.abortFlag = false;
    this.currentStepIndex = 0;

    const state = this._loadState(name);
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    this._saveState(name, state);

    // 项目级 agent 配置来自主配置 agents.default（内核模式 command/args 已无效）
    const projectAgentConfig: AgentConfig = { ...this.defaultAgentConfig };

    const results: WorkflowStepResult[] = [];

    for (let i = 0; i < wf.steps.length; i++) {
      if (this.abortFlag) {
        state.status = 'cancelled';
        this._saveState(name, state);
        break;
      }

      this.currentStepIndex = i;
      state.currentStepIndex = i;

      const step = wf.steps[i];
      if (!step) {
        state.status = 'failed';
        this._saveState(name, state);
        break;
      }

      try {
        const result = await this.executeStep(wf, step, i, projectAgentConfig, results, userInput);
        results.push(result);
        state.stepResults = [...results];
        this._saveState(name, state);
      } catch (err) {
        const result: WorkflowStepResult = {
          stepName: step.name,
          success: false,
          outputDir: '',
          completedAt: new Date().toISOString(),
          error: (err as Error).message,
        };
        results.push(result);
        state.stepResults = [...results];
        state.status = 'failed';
        this._saveState(name, state);
        break;
      }
    }

    if (!this.abortFlag && state.status !== 'failed') {
      state.status = 'completed';
    }
    state.completedAt = new Date().toISOString();
    this._saveState(name, state);

    this.currentWorkflow = null;
    return results;
  }

  async executeStep(
    wf: WorkflowDescriptor,
    step: WorkflowStepDescriptor,
    _stepIndex: number,
    projectAgentConfig: AgentConfig,
    previousResults: WorkflowStepResult[],
    userInput?: string,
  ): Promise<WorkflowStepResult> {

    // 1. Collect input
    const inputContext = this._collectInput(step, previousResults, userInput);

    // 2. Resolve agent config
    const agentConfig = this._resolveAgentConfig(step, projectAgentConfig);

    // 3. Prepare workspace
    const visibleModulePaths = step.definition.agent?.visibleModulePaths || [];
    const workspacePath = await prepareStepWorkspace({
      workflowName: wf.name,
      stepName: step.name,
      visibleModulePaths,
      projectPath: this.projectPath,
      workspaceRoot: this.workspaceRoot,
    });

    try {
      // 4. Start agent（subagent 系统提示词以独立 system 角色注入，锚定前缀缓存）
      const entry = await this.manager.startStepAgent(
        wf.name,
        step.name,
        agentConfig,
        workspacePath,
        this.subPrompt || undefined,
      );

      // 5. Build and send prompt
      const blocks = this._buildStepPrompt(wf, step, inputContext);
      this.callbacks.onStatusChange('streaming');

      await entry.agent.send(blocks);

      this.callbacks.onStreamComplete(step.name);
      this.callbacks.onStatusChange('idle');

      // 6. Collect output
      const outputPath = step.definition.acceptance?.criteria
        ? `step-${step.name}`
        : step.name;
      const outputDir = await collectStepOutput({
        workspacePath,
        outputPath,
        workflowName: wf.name,
        stepName: step.name,
        workspaceRoot: this.workspaceRoot,
      });

      // 7. Stop agent
      await this.manager.stopStepAgent(wf.name, step.name);

      // 8. Acceptance (optional)
      let acceptancePassed: boolean | undefined;
      if (step.definition.acceptance?.criteria) {
        acceptancePassed = await this.runAcceptance(wf.name, step, outputDir);
      }

      return {
        stepName: step.name,
        success: true,
        outputDir,
        completedAt: new Date().toISOString(),
        acceptancePassed,
      };
    } catch (err) {
      // Ensure agent is stopped on failure
      try { await this.manager.stopStepAgent(wf.name, step.name); } catch { /* ignore */ }
      // Cleanup workspace on failure (but keep output if any was collected)
      try { await cleanupStepWorkspace({ workflowName: wf.name, stepName: step.name, workspaceRoot: this.workspaceRoot }); } catch { /* ignore */ }
      throw err;
    }
  }

  async runAcceptance(
    workflowName: string,
    step: WorkflowStepDescriptor,
    outputDir: string,
  ): Promise<boolean> {
    const acceptance = step.definition.acceptance;
    if (!acceptance?.criteria) return true;

    this.logger.info(`Workflow ${workflowName}/${step.name}: running acceptance check`);

    // Build acceptance prompt
    let outputContents = '';
    try {
      const files = await fs.promises.readdir(outputDir);
      for (const file of files) {
        const filePath = path.join(outputDir, file);
        const stat = await fs.promises.stat(filePath);
        if (stat.isFile() && stat.size < 50_000) {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          outputContents += `\n### ${file}\n\`\`\`\n${content}\n\`\`\`\n`;
        } else if (stat.isDirectory()) {
          outputContents += `\n- [目录] ${file}/\n`;
        } else {
          outputContents += `\n- [文件] ${file} (${stat.size} bytes)\n`;
        }
      }
    } catch {
      outputContents = '(无法读取产出目录)';
    }

    const acceptancePrompt = [
      '# 验收任务\n\n',
      '请根据以下标准验证步骤产出是否符合要求。\n\n',
      '## 验收标准\n\n',
      acceptance.criteria,
      '\n\n---\n\n',
      '## 步骤产出\n\n',
      outputContents || '(无产出文件)',
      '\n\n---\n\n',
      '请先给出简要分析（如不通过，列出具体哪些标准未满足），',
      '然后在回复的**最后一行**单独输出结论，格式严格为：\n\n',
      '`VERDICT: PASS`（全部标准均满足）或 `VERDICT: FAIL`（任一标准未满足）',
    ].join('');

    // 验收 agent 复用项目级默认配置（内核模式 command/args 已无效）
    const agentConfig: AgentConfig = { ...this.defaultAgentConfig };

    const workspacePath = await prepareStepWorkspace({
      workflowName,
      stepName: `${step.name}-acceptance`,
      visibleModulePaths: [],
      projectPath: this.projectPath,
      workspaceRoot: this.workspaceRoot,
    });

    try {
      // subagent 系统提示词以独立 system 角色注入，锚定前缀缓存
      const entry = await this.manager.startStepAgent(
        workflowName,
        `${step.name}-acceptance`,
        agentConfig,
        workspacePath,
        this.subPrompt || undefined,
      );

      const blocks: PromptBlock[] = [
        { type: 'text', text: acceptancePrompt },
      ];

      const sendResult = await entry.agent.send(blocks);
      const responseText = sendResult.content || '';

      this.callbacks.onStreamComplete(`${step.name}-acceptance`);

      await this.manager.stopStepAgent(workflowName, `${step.name}-acceptance`);
      await cleanupStepWorkspace({
        workflowName,
        stepName: `${step.name}-acceptance`,
        workspaceRoot: this.workspaceRoot,
      });

      // 从累积回复解析验收结论（取最后一个 VERDICT 行）
      const verdict = WorkflowSubsystem.parseVerdict(responseText);
      if (verdict === null) {
        this.logger.warn(
          `Workflow ${workflowName}/${step.name}: 验收回复未包含 VERDICT 行，保守判定 FAIL` +
          `（回复末尾: ${responseText.slice(-200) || '(空回复)'}）`,
        );
        return false;
      }
      this.logger.info(`Workflow ${workflowName}/${step.name}: acceptance verdict = ${verdict}`);
      return verdict === 'PASS';
    } catch (err) {
      this.logger.error(`Workflow ${workflowName}/${step.name}: acceptance check failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** 解析验收回复结论：取最后一个 `VERDICT: PASS|FAIL` 行；无法解析返回 null（调用方保守判 FAIL） */
  private static parseVerdict(text: string): 'PASS' | 'FAIL' | null {
    const matches = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)];
    if (matches.length === 0) return null;
    return matches[matches.length - 1]![1]!.toUpperCase() as 'PASS' | 'FAIL';
  }

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  async cancel(workflowName: string): Promise<void> {
    this.abortFlag = true;

    // Try to cancel the current step agent if running
    if (this.currentWorkflow === workflowName) {
      for (const [key, entry] of this.manager.agents) {
        if (key.startsWith(`${workflowName}:`)) {
          await entry.agent.cancel();
        }
      }
    }

    const state = this._loadState(workflowName);
    state.status = 'cancelled';
    state.completedAt = new Date().toISOString();
    this._saveState(workflowName, state);
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getCurrentWorkflow(): string | null {
    return this.currentWorkflow;
  }

  getCurrentStepIndex(): number {
    return this.currentStepIndex;
  }

  getExecutionState(workflowName: string): WorkflowExecutionState | null {
    return this._loadState(workflowName);
  }

  // -----------------------------------------------------------------------
  // Internal: prompt building
  // -----------------------------------------------------------------------

  private _buildStepPrompt(
    wf: WorkflowDescriptor,
    step: WorkflowStepDescriptor,
    inputContext: string,
  ): PromptBlock[] {
    const blocks: PromptBlock[] = [];

    // 注意：subagent 系统提示词已通过 Agent.start({ systemPrompt }) 独立注入，
    // 不在此重复拼入 user blocks（前缀缓存锚定）。

    // Knowledge references
    const knowledgeBlock = this._buildKnowledgeBlock(step, wf);
    if (knowledgeBlock) {
      blocks.push({ type: 'text', text: knowledgeBlock });
    }

    // Work description header
    let workBlock = '';
    workBlock += `# 工作流: ${wf.name}\n`;
    workBlock += `# 步骤: ${step.definition.name}\n`;
    if (step.definition.description) {
      workBlock += `# 说明: ${step.definition.description}\n`;
    }
    workBlock += '\n---\n\n';

    // Work body (STEP.md body content)
    workBlock += step.body;
    workBlock += '\n\n---\n\n';

    // Output path instruction
    workBlock += '# 产出要求\n\n';
    workBlock += `请将你的产出文件写入当前工作目录。`;
    workBlock += `完成后，所有工作目录中的文件将被收集作为步骤产出。`;

    blocks.push({ type: 'text', text: workBlock });

    // Input context
    if (inputContext) {
      blocks.push({ type: 'text', text: inputContext });
    }

    return blocks;
  }

  private _buildKnowledgeBlock(
    step: WorkflowStepDescriptor,
    _wf: WorkflowDescriptor,
  ): string | null {
    const sections: string[] = [];

    // 1. Step-level knowledge/ directory
    const stepKnowledgeDir = path.join(step.dir, 'knowledge');
    if (fs.existsSync(stepKnowledgeDir)) {
      try {
        const files = fs.readdirSync(stepKnowledgeDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const content = fs.readFileSync(path.join(stepKnowledgeDir, file), 'utf-8');
          const name = file.replace(/\.md$/, '');
          sections.push(`## ${name}\n\n${content}`);
        }
      } catch { /* ignore */ }
    }

    // 2. Global knowledge refs (knowledgeRefs in frontmatter)
    const refs = step.definition.agent?.knowledgeRefs;
    if (refs && refs.length > 0) {
      for (const ref of refs) {
        const filePath = resolveKnowledgePath(this.projectPath, ref.filename);
        if (!filePath) {
          this.logger.warn(`Workflow: knowledge file not found: ${ref.filename}`);
          continue;
        }
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          sections.push(`## ${ref.name}\n\n${content}`);
        } catch (err) {
          this.logger.warn(`Workflow: failed to read knowledge file ${ref.filename}: ${(err as Error).message}`);
        }
      }
    }

    if (sections.length === 0) return null;

    return '# 参考知识\n\n' + sections.join('\n\n---\n\n') + '\n\n---\n\n';
  }

  // -----------------------------------------------------------------------
  // Internal: input collection
  // -----------------------------------------------------------------------

  private _collectInput(
    step: WorkflowStepDescriptor,
    previousResults: WorkflowStepResult[],
    userInput?: string,
  ): string {
    const input: StepInput = step.definition.input || { from: step.definition.name === 'step1' ? 'user' : 'previous' };

    if (input.from === 'user') {
      return this._formatUserInput(userInput);
    }

    // Resolve source step
    let sourceResult: WorkflowStepResult | undefined;
    if (input.sourceStep) {
      sourceResult = previousResults.find(r => r.stepName === input.sourceStep);
    } else {
      // Default to the previous step (last in results array)
      sourceResult = previousResults[previousResults.length - 1];
    }

    const previousOutput = sourceResult ? this._readOutputContents(sourceResult.outputDir) : '';

    if (input.from === 'previous') {
      return this._formatPreviousOutput(sourceResult, previousOutput);
    }

    // 'both'
    let context = '';
    if (userInput) {
      context += this._formatUserInput(userInput) + '\n\n';
    }
    context += this._formatPreviousOutput(sourceResult, previousOutput);
    return context;
  }

  private _formatUserInput(userInput?: string): string {
    if (!userInput) return '';
    return '# 用户输入\n\n' + userInput + '\n\n---\n\n';
  }

  private _formatPreviousOutput(sourceResult?: WorkflowStepResult, contents?: string): string {
    const stepLabel = sourceResult?.stepName || '上一步骤';
    return `# 前置步骤「${stepLabel}」的产出\n\n` + (contents || '(无产出)\n') + '\n\n---\n\n';
  }

  private _readOutputContents(outputDir: string): string {
    if (!outputDir || !fs.existsSync(outputDir)) return '';

    try {
      const files = fs.readdirSync(outputDir);
      let result = '';
      for (const file of files.slice(0, 20)) { // limit to 20 files
        const filePath = path.join(outputDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size < 50_000) {
          const content = fs.readFileSync(filePath, 'utf-8');
          result += `### ${file}\n\`\`\`\n${content.slice(0, 5_000)}\n\`\`\`\n\n`;
        } else if (stat.isDirectory()) {
          result += `- 📁 ${file}/\n`;
        } else {
          result += `- 📄 ${file} (${stat.size} bytes)\n`;
        }
      }
      return result;
    } catch {
      return '';
    }
  }

  // -----------------------------------------------------------------------
  // Internal: config resolution
  // -----------------------------------------------------------------------

  private _resolveAgentConfig(_step: WorkflowStepDescriptor, projectConfig: AgentConfig): AgentConfig {
    // 内核模式下 step 级 command/args 已无效，统一使用项目级默认配置
    return { ...projectConfig };
  }

  // -----------------------------------------------------------------------
  // Internal: state persistence
  // -----------------------------------------------------------------------

  private _stateDir(): string {
    return path.join(this.projectPath, '.module-agent', 'workflow');
  }

  private _loadState(workflowName: string): WorkflowExecutionState {
    const statePath = path.join(this._stateDir(), `${workflowName}.state.json`);
    try {
      if (fs.existsSync(statePath)) {
        return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {
      workflowName,
      status: 'pending',
      currentStepIndex: 0,
      startedAt: new Date().toISOString(),
      stepResults: [],
    };
  }

  private _saveState(workflowName: string, state: WorkflowExecutionState): void {
    const statePath = path.join(this._stateDir(), `${workflowName}.state.json`);
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`Workflow: failed to save state for ${workflowName}: ${(err as Error).message}`);
    }
  }
}
