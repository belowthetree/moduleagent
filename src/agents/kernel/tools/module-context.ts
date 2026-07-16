// ---------------------------------------------------------------------------
// agents/kernel/tools/module-context.ts — 渐进式上下文披露工具（P1）
//
// 对标 Reasonix token_profile.go 的 connect_tool_source 理念。
// 提供 3 个按需查询工具，让 Agent 在需要时才获取完整文档，
// 而非在首条消息中一次性注入全部上下文。
//
// Tier 0: system prompt（必注）
// Tier 1: module.md 摘要（首注）
// Tier 2: 完整文档 → 通过以下工具按需获取
// ---------------------------------------------------------------------------

import fs from 'fs-extra';
import path from 'path';
import type { Tool } from '../types.js';

/**
 * 创建 module_context:* 系列工具。
 *
 * @param moduleDir  模块的源码目录（.module-agent/module/<moduleName>/）
 * @param sandbox    AgentSandbox（用于路径校验和文件读取）
 */
export function createModuleContextTools(moduleDir: string): Tool[] {
  return [
    createReadFullTool(moduleDir),
    createReadPatternsTool(moduleDir),
    createReadExperienceTool(moduleDir),
  ];
}

// ── module_context_read_full ──

function createReadFullTool(moduleDir: string): Tool {
  const modulePath = path.join(moduleDir, 'module.md');

  return {
    name: 'module_context_read_full',
    description:
      '获取当前模块的完整文档（module.md），包含 API、依赖关系、职责描述等。' +
      '当需要了解模块的完整接口或修改模块时调用。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      try {
        const content = await fs.readFile(modulePath, 'utf-8');
        return { content };
      } catch {
        return { content: '(暂无 module.md 文档)' };
      }
    },
  };
}

// ── module_context_read_patterns ──

function createReadPatternsTool(moduleDir: string): Tool {
  const patternsPath = path.join(moduleDir, 'patterns.md');

  return {
    name: 'module_context_read_patterns',
    description:
      '获取当前模块的修改规范（patterns.md），包含联动修改规律、常见模式。' +
      '当需要跨文件修改或遵循项目规范时调用。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      try {
        const content = await fs.readFile(patternsPath, 'utf-8');
        return { content };
      } catch {
        return { content: '(暂无 patterns.md 修改规范)' };
      }
    },
  };
}

// ── module_context_read_experience ──

function createReadExperienceTool(moduleDir: string): Tool {
  const experiencePath = path.join(moduleDir, 'experience.md');

  return {
    name: 'module_context_read_experience',
    description:
      '获取当前模块的近期开发经验（experience.md），包含踩坑记录、关键决策、注意事项。' +
      '可通过 count 参数指定返回最近 N 条经验（默认 3）。',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: '获取最近 N 条经验，默认 3',
        },
      },
      required: [],
    },
    async execute(input) {
      const count = (input as any).count || 3;
      try {
        const content = await fs.readFile(experiencePath, 'utf-8');
        // 解析以 "## " 标题分隔的章节
        const sections = content.split(/\n(?=## )/);
        // 第一个 "章节" 是文件标题（以 "# " 开头），跳过
        const entries = sections.filter(
          (s) => s.trim().startsWith('## '),
        );
        if (entries.length === 0) {
          return { content: '(暂无经验记录)' };
        }
        const recent = entries.slice(-Math.min(count, entries.length));
        return { content: `# 近期经验（最近 ${recent.length} 条）\n\n${recent.join('\n')}` };
      } catch {
        return { content: '(暂无 experience.md 经验记录)' };
      }
    },
  };
}
