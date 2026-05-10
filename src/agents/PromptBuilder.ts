import fs from 'fs';
import path from 'path';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import type { ModuleGraph } from '../types/module.js';
import { defaultLogger } from '../core/Logger.js';

/**
 * Load system prompt files from config/ directory.
 * Returns empty strings (with warning) if files are missing.
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
 * Build ContentBlock array for a module message.
 * On first message for a given moduleName, injects system prompt + module context
 * + modification patterns + recent experiences.
 * Key in sessionPrompted Set is moduleName.
 */
export function buildPromptBlocks(options: {
  moduleName: string;
  userText: string;
  graph: ModuleGraph | null;
  prompts: { mainPrompt: string; subPrompt: string };
  sessionPrompted: Set<string>;
}): ContentBlock[] {
  const { moduleName, userText, graph, prompts, sessionPrompted } = options;
  const blocks: ContentBlock[] = [];
  const isFirst = !sessionPrompted.has(moduleName);

  if (isFirst) {
    sessionPrompted.add(moduleName);

    // System prompt
    const systemPrompt = moduleName === graph?.root ? prompts.mainPrompt : prompts.subPrompt;
    if (systemPrompt) {
      blocks.push({ type: 'text', text: systemPrompt + '\n\n---\n\n' });
      defaultLogger.info(`[${moduleName}] system prompt: ${systemPrompt.slice(0, 120)}... (${systemPrompt.length} chars)`);
    }

    // Module context (module.md body)
    const node = graph?.nodes.get(moduleName);
    if (node?.definition?.body) {
      blocks.push({ type: 'text', text: `# Module: ${moduleName}\n\n${node.definition.body}\n\n---\n\n` });
      defaultLogger.info(`[${moduleName}] module context: ${node.definition.body.slice(0, 120)}... (${node.definition.body.length} chars)`);
    }

    // Modification patterns (patterns.md)
    const patternsBlock = loadPatternsBlock(node?.absolutePath);
    if (patternsBlock) {
      blocks.push({ type: 'text', text: patternsBlock });
      defaultLogger.info(`[${moduleName}] patterns injected (${patternsBlock.length} chars)`);
    }

    // Recent experiences (experience.md, last 3 entries)
    const experienceBlock = loadExperienceBlock(node?.absolutePath);
    if (experienceBlock) {
      blocks.push({ type: 'text', text: experienceBlock });
      defaultLogger.info(`[${moduleName}] experience injected (${experienceBlock.length} chars)`);
    }
  }

  blocks.push({ type: 'text', text: userText });
  return blocks;
}

// ── Experience / Patterns injection ──

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
    // Parse sections delimited by "## " headings; take the last 3
    const sections = content.split(/\n(?=## )/);
    // First "section" is the file title — skip it if it starts with "# "
    const entries = sections.filter(s => s.trim().startsWith('## '));
    if (entries.length === 0) return null;
    const recent = entries.slice(-3);
    return `# 近期经验\n\n${recent.join('\n')}\n\n---\n\n`;
  } catch {
    return null;
  }
}

/**
 * Deduplicate agent messages by module name + text within a time window.
 * Returns `true` if the message is a duplicate and should be ignored,
 * `false` if it should be sent.
 *
 * On the first call (or when the message differs): updates lastSent and returns false.
 * On subsequent identical calls within windowMs: logs the dedup event and returns true.
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
 * Factory that returns an empty Set<string> for tracking which sessions
 * have already been prompted (keyed by moduleName).
 *
 * Used by both Electron and TUI paths to create independent tracking state.
 */
export function createSessionPrompted(): Set<string> {
  return new Set<string>();
}
