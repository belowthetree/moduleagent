// ---------------------------------------------------------------------------
// agents/kernel/ModelRouter.ts — 快/慢模型路由
//
// 对标 Reasonix task_classifier.go 的启发式分类器。
// 简单问题用 fastModel（便宜/快），复杂任务用主 model（强/贵）。
// 零额外 LLM 调用，纯启发式。
// ---------------------------------------------------------------------------

import { defaultLogger, type Logger } from '../../core/Logger.js';

export type RouteDecision = 'fast' | 'normal';

export interface RouteContext {
  userText: string;
  hasFileReferences: boolean;
  hasCodeActions: boolean;
  messageLength: number;
  turnNumber: number;
}

export class ModelRouter {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || defaultLogger;
  }

  private readonly fastKeywords = [
    '是什么', 'what is', 'how many', 'list', '列出',
    'show', '显示', 'explain', '解释', 'describe', '描述',
    'how to', '怎么', '如何',
  ];

  private readonly codeActionKeywords = [
    'fix', '修复', 'create', '创建', 'write', '写', '编写',
    'edit', '修改', 'change', '改', 'add', '添加', 'delete', '删除',
    'refactor', '重构', 'implement', '实现', 'build', '构建',
    'run', '运行', 'test', '测试', 'deploy', '部署',
    'debug', '调试', 'optimize', '优化',
  ];

  /**
   * 启发式分类（对齐 Reasonix task_classifier.go 的 heuristic 模式）。
   *
   * 规则：
   * 1. 短问候（≤3 词，无文件引用，无代码动作） → fast
   * 2. 简单查询关键词 + 无代码动作 → fast
   * 3. 文件引用 / 代码动作 → normal
   * 4. 长消息（>100 字符） → normal
   * 5. 第 1 轮 → normal（确保首次注入 module context 用强模型）
   * 6. 默认 → fast
   */
  classify(ctx: RouteContext): RouteDecision {
    const lower = ctx.userText.toLowerCase();
    const words = ctx.userText.trim().split(/\s+/);
    let reason = '';

    // 1. 短问候
    if (
      words.length <= 3 &&
      !ctx.hasFileReferences &&
      !ctx.hasCodeActions
    ) {
      reason = 'short-greeting';
      return this._decide('fast', reason, ctx);
    }

    // 2. 简单查询
    const hasFastKeyword = this.fastKeywords.some((k) => lower.includes(k));
    const hasCodeKeyword = this.codeActionKeywords.some((k) => lower.includes(k));
    if (hasFastKeyword && !hasCodeKeyword && !ctx.hasFileReferences) {
      reason = 'fast-keyword';
      return this._decide('fast', reason, ctx);
    }

    // 3. 文件引用 / 代码动作
    if (ctx.hasFileReferences || hasCodeKeyword) {
      reason = hasCodeKeyword ? 'code-action' : 'file-reference';
      return this._decide('normal', reason, ctx);
    }

    // 4. 长消息
    if (ctx.messageLength > 100) {
      reason = 'long-message';
      return this._decide('normal', reason, ctx);
    }

    // 5. 第 1 轮
    if (ctx.turnNumber <= 1) {
      reason = 'first-turn';
      return this._decide('normal', reason, ctx);
    }

    // 6. 默认
    reason = 'default';
    return this._decide('fast', reason, ctx);
  }

  private _decide(decision: RouteDecision, reason: string, ctx: RouteContext): RouteDecision {
    this.logger.info(
      `ModelRouter: ${decision} (reason=${reason} turn=${ctx.turnNumber} len=${ctx.messageLength})`,
    );
    return decision;
  }
}
