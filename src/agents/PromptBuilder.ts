// ---------------------------------------------------------------------------
// PromptBuilder.ts — 系统提示加载与消息 Prompt 构建
// 加载 main/sub agent 系统提示、模块上下文、修改规范、近期经验，为 Agent 消息构建 ContentBlock
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import type { PromptBlock } from './kernel/types.js';
import type { ModuleGraph } from '../types/module.js';
import { defaultLogger } from '../core/Logger.js';

/**
 * 从 config/ 目录加载系统提示文件。
 * 如果文件缺失则返回空字符串（附带警告）。
 */
export function loadSystemPrompts(configDir: string): { mainPrompt: string; subPrompt: string } {
  const mainPath = path.join(configDir, 'knowledge', 'mainagentprompt.md');
  const subPath = path.join(configDir, 'knowledge', 'subagentprompt.md');

  let mainPrompt = '';
  let subPrompt = '';

  try {
    mainPrompt = fs.readFileSync(mainPath, 'utf-8');
  } catch (err) {
    mainPrompt = '';
    defaultLogger.warn(`Failed to read main agent prompt: ${(err as Error).message}`);
  }

  try {
    subPrompt = fs.readFileSync(subPath, 'utf-8');
  } catch (err) {
    subPrompt = '';
    defaultLogger.warn(`Failed to read sub-agent prompt: ${(err as Error).message}`);
  }

  if (mainPrompt) defaultLogger.info(`Loaded main agent prompt (${mainPrompt.length} chars)`);
  if (subPrompt) defaultLogger.info(`Loaded sub-agent prompt (${subPrompt.length} chars)`);

  return { mainPrompt, subPrompt };
}

/**
 * 为模块消息构建 ContentBlock 数组。
 * 对于给定 moduleName 的首条消息，注入系统提示、模块上下文、
 * 修改规范及近期经验。
 * sessionPrompted 集合的键为 moduleName。
 */
export function buildPromptBlocks(options: {
  moduleName: string;
  userText: string;
  graph: ModuleGraph | null;
  prompts: { mainPrompt: string; subPrompt: string };
  sessionPrompted: Set<string>;
  cwd?: string;
}): PromptBlock[] {
  const { moduleName, userText, graph, prompts, sessionPrompted, cwd } = options;
  const blocks: PromptBlock[] = [];
  const isFirst = !sessionPrompted.has(moduleName);

  if (isFirst) {
    sessionPrompted.add(moduleName);

    // cwd 提示（非根模块）
    if (cwd && moduleName !== graph?.root) {
      blocks.push({ type: 'text', text: `当前工作目录: ${cwd}\n\n` });
    }

    // 系统提示
    const systemPrompt = moduleName === graph?.root ? prompts.mainPrompt : prompts.subPrompt;
    if (systemPrompt) {
      blocks.push({ type: 'text', text: systemPrompt + '\n\n---\n\n' });
      defaultLogger.info(`[${moduleName}] system prompt: ${systemPrompt.slice(0, 120)}... (${systemPrompt.length} chars)`);
    }

    // 模块上下文（module.md 正文）
    const node = graph?.nodes.get(moduleName);

    if (node?.definition?.body) {
      blocks.push({ type: 'text', text: `# Module: ${moduleName}\n\n${node.definition.body}\n\n---\n\n` });
      defaultLogger.info(`[${moduleName}] module context: ${node.definition.body.slice(0, 120)}... (${node.definition.body.length} chars)`);
    }

    // 修改规范（patterns.md）
    const patternsBlock = loadPatternsBlock(node?.absolutePath);
    if (patternsBlock) {
      blocks.push({ type: 'text', text: patternsBlock });
      defaultLogger.info(`[${moduleName}] patterns injected (${patternsBlock.length} chars)`);
    }

    // 近期经验（experience.md，最近 3 条）
    const experienceBlock = loadExperienceBlock(node?.absolutePath);
    if (experienceBlock) {
      blocks.push({ type: 'text', text: experienceBlock });
      defaultLogger.info(`[${moduleName}] experience injected (${experienceBlock.length} chars)`);
    }
  }

  blocks.push({ type: 'text', text: userText });
  return blocks;
}

// ── 经验 / 规范注入 ──

function loadPatternsBlock(moduleDir: string | undefined): string | null {
  if (!moduleDir) return null;
  const patternsPath = path.join(moduleDir, 'patterns.md');
  try {
    const content = fs.readFileSync(patternsPath, 'utf-8');
    const bodyLines = content.split('\n').filter(l => l.trim() && !l.startsWith('# '));
    if (bodyLines.length === 0) return null;
    return `# 模块修改规范\n\n${content}\n\n---\n\n`;
  } catch {
    return null;
  }
}

function loadExperienceBlock(moduleDir: string | undefined): string | null {
  if (!moduleDir) return null;
  const experiencePath = path.join(moduleDir, 'experience.md');
  try {
    const content = fs.readFileSync(experiencePath, 'utf-8');
    // 解析以 "## " 标题分隔的章节；取最后 3 条
    const sections = content.split(/\n(?=## )/);
    // 第一个"章节"是文件标题——以 "# " 开头则跳过
    const entries = sections.filter(s => s.trim().startsWith('## '));
    if (entries.length === 0) return null;
    const recent = entries.slice(-3);
    return `# 近期经验\n\n${recent.join('\n')}\n\n---\n\n`;
  } catch {
    return null;
  }
}

/**
 * 按模块名称 + 文本在时间窗口内去重 Agent 消息。
 * 如果消息是重复的则应忽略，返回 `true`；
 * 否则应发送，返回 `false`。
 *
 * 首次调用（或消息不同时）：更新 lastSent 并返回 false。
 * 后续在 windowMs 内相同调用：记录去重事件并返回 true。
 */
export function dedupMessage(
  lastSent: Map<string, { text: string; time: number }>,
  moduleName: string,
  text: string,
  windowMs = 3000,
): boolean {
  const now = Date.now();
  const last = lastSent.get(moduleName);

  if (last && last.text === text && now - last.time < windowMs) {
    defaultLogger.info(`[dedup] ${moduleName} — duplicate ignored`);
    return true;
  }

  lastSent.set(moduleName, { text, time: now });
  return false;
}

/**
 * 工厂函数，返回一个空的 Set<string>，用于追踪哪些会话
 * 已被提示过（键为 moduleName）。
 *
 * 由 Electron 和 TUI 路径分别调用，创建独立的追踪状态。
 */
export function createSessionPrompted(): Set<string> {
  return new Set<string>();
}
