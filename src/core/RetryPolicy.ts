// ---------------------------------------------------------------------------
// core/RetryPolicy.ts — 通用重试策略
//
// 对标 Reasonix internal/provider/retry.go：
// 指数退避 + 抖动 + Retry-After 响应头 + 可重试错误分类。
// 零依赖，kernel（LLM 调用）与 subsystem（agent 启动）共用。
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** 最大尝试次数（含首次），默认 3 */
  maxAttempts?: number;
  /** 基础退避延迟 ms，默认 500 */
  baseDelayMs?: number;
  /** 最大退避延迟 ms，默认 15000 */
  maxDelayMs?: number;
  /** 判断错误是否可重试；缺省用 isRetryableError */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** 重试前回调（用于日志） */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

/** 计算第 attempt 次重试的退避延迟（attempt 从 1 开始） */
export function backoffDelay(attempt: number, baseDelayMs = 500, maxDelayMs = 15_000): number {
  const d = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return d + Math.floor(Math.random() * 250);
}

interface HttpErrorLike {
  statusCode?: number;
  responseHeaders?: Record<string, string>;
}

/** 从 Retry-After 响应头解析服务器指定的重试间隔（秒） */
function retryAfterMs(err: unknown): number | null {
  const headers = (err as HttpErrorLike | undefined)?.responseHeaders;
  if (!headers) return null;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * 可重试错误分类：
 * - HTTP 408 / 429 / 5xx
 * - 连接级错误：ECONNRESET / ECONNABORTED / ETIMEDOUT / EPIPE / undici 连接错误 / EOF
 * - 400 / 401 / 403 / 404 等客户端错误快速失败
 */
export function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { statusCode?: number; code?: string; message?: string; cause?: { code?: string } };

  const status = e.statusCode;
  if (typeof status === 'number') {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }

  const code = e.code ?? e.cause?.code ?? '';
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_SOCKET'
  ) {
    return true;
  }

  const msg = (e.message ?? '').toLowerCase();
  if (
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('unexpected eof') ||
    msg.includes('terminated') ||
    msg.includes('network error') ||
    msg.includes('fetch failed')
  ) {
    return true;
  }

  return false;
}

/** 带重试执行异步函数 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    shouldRetry = isRetryableError,
    onRetry,
  } = options;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delay = retryAfterMs(err) ?? backoffDelay(attempt, baseDelayMs, maxDelayMs);
      onRetry?.(attempt, delay, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
