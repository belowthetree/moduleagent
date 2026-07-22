// ---------------------------------------------------------------------------
// tui/persistence.ts — TUI 输入历史持久化
// 消息持久化已统一到 Core 层 SessionStore（context/ 目录）
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs-extra';

/** 历史输入持久化 */
export class InputHistoryPersistence {
  private filePath: string;

  constructor(projectRoot: string) {
    const dir = path.join(projectRoot, '.module-agent');
    this.filePath = path.join(dir, 'tui_input_history.json');
  }

  async load(): Promise<string[]> {
    try {
      if (await fs.pathExists(this.filePath)) {
        const raw = await fs.readFile(this.filePath, 'utf-8');
        return JSON.parse(raw) as string[];
      }
    } catch { /* ignore */ }
    return [];
  }

  async save(history: string[]): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.filePath));
      // 最多保存 100 条
      const trimmed = history.slice(-100);
      await fs.writeFile(this.filePath, JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
}
