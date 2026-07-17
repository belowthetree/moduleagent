// ---------------------------------------------------------------------------
// agents/kernel/ArchiveWriter.ts — 被丢弃内容的存档写入器
//
// snip / compact / truncate 丢弃的原始内容以 jsonl 追加到
// .module-agent/archives/<module>/ 下，fire-and-forget，不阻塞推理。
// ---------------------------------------------------------------------------

import fs from 'fs/promises';
import path from 'path';
import { defaultLogger } from '../../core/Logger.js';

export type ArchiveWriter = (filename: string, records: unknown[]) => void;

/**
 * 创建存档写入器。archiveDir 缺省时返回 undefined（调用方跳过存档）。
 */
export function createArchiveWriter(archiveDir?: string): ArchiveWriter | undefined {
  if (!archiveDir) return undefined;

  return (filename, records) => {
    if (records.length === 0) return;
    void (async () => {
      try {
        await fs.mkdir(archiveDir, { recursive: true });
        const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
        await fs.appendFile(path.join(archiveDir, filename), lines, 'utf-8');
      } catch (err) {
        defaultLogger.warn(
          `[ArchiveWriter] append failed ${archiveDir}/${filename}: ${(err as Error).message}`,
        );
      }
    })();
  };
}
