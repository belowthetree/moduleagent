// ---------------------------------------------------------------------------
// agents/kernel/StormBreaker.ts — 死循环防护
//
// 对标 Reasonix agent.go Storm Breaker 机制。
// 检测 "同一个 tool + 同一个 error" 的重复模式，
// 连续 N 次相同失败后注入干预消息。
// ---------------------------------------------------------------------------

import { defaultLogger, type Logger } from '../../core/Logger.js';

export class StormBreaker {
  /** 连续相同签名的最大容忍次数 */
  readonly maxStorms: number;

  private _stormSig = '';
  private _stormCount = 0;
  private logger: Logger;

  constructor(maxStorms = 3, logger?: Logger) {
    this.maxStorms = maxStorms;
    this.logger = logger || defaultLogger;
  }

  /**
   * 检测是否陷入循环。
   * 签名基于 `(toolName, normalizedError)`，而非 `(toolName, args)`。
   * 对齐 Reasonix: 模型经常重新措辞参数但仍然获得相同错误。
   *
   * @returns intervene=true 时应注入干预消息
   */
  detect(
    toolName: string,
    error: string,
  ): { intervene: boolean; message?: string } {
    const sig = `${toolName}:${this.normalizeError(error)}`;

    if (sig === this._stormSig) {
      this._stormCount++;
      this.logger.warn(
        `StormBreaker: repeated failure #${this._stormCount}/${this.maxStorms} ` +
        `tool="${toolName}" sig="${sig.slice(0, 80)}"`,
      );
      if (this._stormCount >= this.maxStorms) {
        this.logger.error(
          `StormBreaker: INTERVENE — injecting intervention after ${this._stormCount} repeated failures on "${toolName}"`,
        );
        return {
          intervene: true,
          message: `[系统提示] 你似乎陷入了循环——连续 ${this._stormCount} 次相同的 "${toolName}" 操作都失败了（错误: ${error.slice(0, 200)}）。请尝试完全不同的方法，或向用户说明情况并寻求帮助。`,
        };
      }
    } else {
      if (this._stormSig && sig !== this._stormSig) {
        this.logger.info(`StormBreaker: new failure pattern detected, resetting counter (was: "${this._stormSig.slice(0, 60)}")`);
      }
      this._stormSig = sig;
      this._stormCount = 1;
    }

    return { intervene: false };
  }

  /** 任何成功操作复位计数器 */
  reset(): void {
    this._stormSig = '';
    this._stormCount = 0;
  }

  // ── 内部 ──

  /**
   * 去参数化：移除 UUID、路径、数字等变化部分，
   * 使得同一类错误能匹配到相同签名。
   * 对齐 Reasonix stormBreaker 的签名去参。
   */
  private normalizeError(error: string): string {
    return error
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<UUID>',
      )
      .replace(/\/[^\s,"']+\/[^\s,"']+/g, '<PATH>')
      .replace(/\\[^\s,"']+\\[^\s,"']+/g, '<PATH>')
      .replace(/\b\d+\b/g, '<N>');
  }
}
