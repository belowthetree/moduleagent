// ---------------------------------------------------------------------------
// agents/kernel/prompts/system.ts — 系统提示构建器
// 从 config/knowledge/ 目录加载提示模板并注入模块上下文
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';

export interface SystemPromptContext {
  moduleName: string;
  isRoot: boolean;
  moduleBody?: string;
  patternsContent?: string;
  experienceContent?: string;
}

export function loadPromptTemplates(configDir: string): { mainPrompt: string; subPrompt: string } {
  const mainPath = path.join(configDir, 'knowledge', 'mainagentprompt.md');
  const subPath = path.join(configDir, 'knowledge', 'subagentprompt.md');

  let mainPrompt = '';
  let subPrompt = '';

  try { mainPrompt = fs.readFileSync(mainPath, 'utf-8'); } catch { /* ignore */ }
  try { subPrompt = fs.readFileSync(subPath, 'utf-8'); } catch { /* ignore */ }

  return { mainPrompt, subPrompt };
}

export function buildSystemPrompt(
  templates: { mainPrompt: string; subPrompt: string },
  ctx: SystemPromptContext,
): string {
  const parts: string[] = [];

  const basePrompt = ctx.isRoot ? templates.mainPrompt : templates.subPrompt;
  if (basePrompt) {
    parts.push(basePrompt);
  }

  if (ctx.moduleBody) {
    parts.push(`# Module: ${ctx.moduleName}\n\n${ctx.moduleBody}`);
  }

  if (ctx.patternsContent) {
    parts.push(`# Module Modification Patterns\n\n${ctx.patternsContent}`);
  }

  if (ctx.experienceContent) {
    parts.push(`# Recent Experience\n\n${ctx.experienceContent}`);
  }

  return parts.join('\n\n---\n\n');
}
