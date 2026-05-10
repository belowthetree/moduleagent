import path from 'path';
import fs from 'fs';
import { AgentLauncher, type AgentConfig } from '../agents/AgentLauncher.js';
import { defaultLogger, type Logger } from './Logger.js';
import type { ChatMsg } from '../types/preload.js';
import type { ContentBlock } from '@agentclientprotocol/sdk';

export interface SummarizeParams {
  moduleName: string;
  chatMsgs: ChatMsg[];
  projectRoot: string;
  configDir: string;
  agentConfig: AgentConfig;
  logger?: Logger;
}

export class ExperienceSummarizer {
  private logger: Logger;
  private summarizerPrompt = '';
  private promptLoaded = false;

  constructor(logger?: Logger) {
    this.logger = logger || defaultLogger;
  }

  async summarize(params: SummarizeParams): Promise<void> {
    const { moduleName, chatMsgs, projectRoot, configDir, agentConfig } = params;

    if (chatMsgs.length === 0) {
      this.logger.info(`ExperienceSummarizer: no messages for [${moduleName}], skipping`);
      return;
    }

    this.loadPrompt(configDir);

    this.logger.info(`ExperienceSummarizer: starting for [${moduleName}] (${chatMsgs.length} msgs)`);

    const launcher = new AgentLauncher();
    let launched: Awaited<ReturnType<typeof launcher.launch>> | null = null;

    try {
      launched = await launcher.launch(
        agentConfig,
        `summarizer-${moduleName}`,
        projectRoot,
        this.logger,
      );

      const { sessionId } = await launched.connection.newSession({
        cwd: projectRoot,
        mcpServers: [],
      });

      const blocks = this.buildPrompt(moduleName, chatMsgs, projectRoot);
      this.logger.info(`ExperienceSummarizer: sending prompt [${moduleName}] (${blocks.length} blocks)`);

      await launched.connection.prompt({ sessionId, prompt: blocks });
      this.logger.info(`ExperienceSummarizer: completed for [${moduleName}]`);
    } catch (err) {
      this.logger.error(`ExperienceSummarizer: failed for [${moduleName}]: ${(err as Error).message}`);
    } finally {
      if (launched) {
        try { launched.process.kill(); } catch { /* ignore */ }
      }
    }
  }

  private loadPrompt(configDir: string): void {
    if (this.promptLoaded) return;
    this.promptLoaded = true;

    const promptPath = path.join(configDir, 'knowledge', 'summarizerprompt.md');
    try {
      this.summarizerPrompt = fs.readFileSync(promptPath, 'utf-8');
      this.logger.info(`ExperienceSummarizer: loaded prompt (${this.summarizerPrompt.length} chars)`);
    } catch {
      this.summarizerPrompt = '';
      this.logger.warn(`ExperienceSummarizer: failed to load prompt from ${promptPath}`);
    }
  }

  private buildPrompt(moduleName: string, chatMsgs: ChatMsg[], projectRoot: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    if (this.summarizerPrompt) {
      blocks.push({ type: 'text', text: this.summarizerPrompt + '\n\n---\n\n' });
    }

    const conversationSummary = this.formatConversation(chatMsgs);
    const contextDir = path.join(projectRoot, '.module-agent', 'module', moduleName);

    const taskPrompt = [
      '## 任务',
      '',
      '请按以下流程处理模块文档：',
      '',
      `- **模块名称**: ${moduleName}`,
      `- **模块文档目录**: ${contextDir}`,
      `- **module.md**: ${path.join(contextDir, 'module.md')}`,
      `- **experience.md**: ${path.join(contextDir, 'experience.md')}`,
      `- **patterns.md**: ${path.join(contextDir, 'patterns.md')}`,
      '',
      '请严格按顺序执行：',
      '',
      '**Step 1 — 评估**：阅读对话，判断是否涉及代码变更、有值得记录的经验、或发现了修改规范。如果三者都不需要更新，直接回复「无需更新」并停止。',
      '',
      '**Step 2 — 更新 module.md**（如代码有变更）：先读取现有 module.md，只修改发生变化的部分（API、依赖、职责），保持 frontmatter 和其他章节不变，通过 file_access 写回。',
      '',
      '**Step 3 — 追加经验**（如有）：提取关键决策、踩坑、注意事项，按格式追加到 experience.md。',
      '',
      '**Step 4 — 记录规范**（如有）：提取联动修改规律，追加到 patterns.md。同名规范则替换旧内容。',
      '',
      '## 对话内容',
      '',
      conversationSummary,
    ].join('\n');

    blocks.push({ type: 'text', text: taskPrompt });
    return blocks;
  }

  private formatConversation(msgs: ChatMsg[]): string {
    const lines: string[] = [];
    for (const msg of msgs) {
      const role = msg.role === 'user' ? '用户' : msg.role === 'agent' ? 'Agent' : '系统';
      lines.push(`### ${role} (${msg.time || '?'})`);

      if (msg.content) {
        const truncated = msg.content.length > 3000
          ? msg.content.slice(0, 3000) + '\n\n... (内容过长，已截断)'
          : msg.content;
        lines.push(truncated);
      }

      if (msg.thinking && msg.thinking.length > 0) {
        const truncatedThinking = msg.thinking.length > 1000
          ? msg.thinking.slice(0, 1000) + '\n... (思考过程已截断)'
          : msg.thinking;
        lines.push(`<thinking>${truncatedThinking}</thinking>`);
      }

      if (msg.timeline && msg.timeline.length > 0) {
        lines.push('工具调用:');
        for (const ev of msg.timeline) {
          const prefix = ev.type === 'tool_call' ? '[tool]' : '[think]';
          lines.push(`  ${prefix} ${ev.content}`);
        }
      }

      lines.push('');
    }
    return lines.join('\n');
  }
}
