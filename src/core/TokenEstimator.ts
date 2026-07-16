// ---------------------------------------------------------------------------
// core/TokenEstimator.ts — 自适应 Token 估算器
//
// 对标 Reasonix tokPerChar() 运行时校准，零外部依赖。
// 从 Provider 返回的真实 prompt_tokens 反推 chars→token 转换比，
// 使用 EMA 平滑收敛。
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 4 条消息的格式开销（role + 分隔符），估算值 */
const MESSAGE_OVERHEAD = 4;

export class TokenEstimator {
  // ── 状态 ──

  /** 当前 chars→token 比，默认 0.25（≈4 chars/token） */
  private _tokPerChar = 0.25;

  /** EMA 平滑系数：0.3 权重给新样本 */
  private readonly _emaAlpha: number;

  private _calibrated = false;

  // ── 构造 ──

  constructor(emaAlpha = 0.3) {
    this._emaAlpha = emaAlpha;
  }

  // ── 公开 API ──

  /**
   * 从 Provider 返回的真实 usage 反推校准。
   * 对齐 Reasonix compact.go:153-189 tokPerChar()。
   *
   * @param usage  Provider 返回的 usage 对象
   * @param promptChars 提交给 LLM 的 prompt 文本总字符数
   */
  calibrate(usage: TokenUsage, promptChars: number): void {
    if (usage.promptTokens <= 0 || promptChars <= 0) return;

    const r = usage.promptTokens / promptChars;

    // 拒绝异常值（对齐 Reasonix: 0.05 < r < 2）
    if (r < 0.05 || r > 2) return;

    // EMA 平滑
    this._tokPerChar =
      (1 - this._emaAlpha) * this._tokPerChar + this._emaAlpha * r;
    this._calibrated = true;
  }

  /** 估算单段文本的 token 数 */
  estimate(text: string): number {
    return Math.ceil(text.length * this._tokPerChar);
  }

  /** 批量估算 */
  estimateAll(texts: string[]): number {
    return texts.reduce((sum, t) => sum + this.estimate(t), 0);
  }

  /**
   * 估算 ChatMessage 数组的总 prompt token。
   * 每条消息附加 ~4 token 的格式开销。
   */
  estimateMessages(
    messages: Array<{ role: string; content: string | null }>,
  ): number {
    const overhead = messages.length * MESSAGE_OVERHEAD;
    const contentTokens = this.estimateAll(
      messages.map((m) => m.content ?? ''),
    );
    return overhead + contentTokens;
  }

  /** 是否已经过真值校准 */
  get isCalibrated(): boolean {
    return this._calibrated;
  }

  /** 当前 chars→token 比（调试用） */
  get currentRatio(): number {
    return this._tokPerChar;
  }
}
