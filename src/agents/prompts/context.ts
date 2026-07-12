// ---------------------------------------------------------------------------
// agents/kernel/prompts/context.ts — 模块上下文注入
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';

export function loadModuleBody(moduleDir: string | undefined): string | null {
  if (!moduleDir) return null;
  const moduleMdPath = path.join(moduleDir, 'module.md');
  try {
    const content = fs.readFileSync(moduleMdPath, 'utf-8');
    return content;
  } catch {
    return null;
  }
}

export function loadPatternsContent(moduleDir: string | undefined): string | null {
  if (!moduleDir) return null;
  const patternsPath = path.join(moduleDir, 'patterns.md');
  try {
    const content = fs.readFileSync(patternsPath, 'utf-8');
    if (content.trim()) return content;
  } catch { /* 忽略 */ }
  return null;
}

export function loadExperienceContent(moduleDir: string | undefined): string | null {
  if (!moduleDir) return null;
  const experiencePath = path.join(moduleDir, 'experience.md');
  try {
    const content = fs.readFileSync(experiencePath, 'utf-8');
    const sections = content.split(/\n(?=## )/);
    const entries = sections.filter((s) => s.trim().startsWith('## '));
    if (entries.length === 0) return null;
    return entries.slice(-3).join('\n');
  } catch {
    return null;
  }
}
