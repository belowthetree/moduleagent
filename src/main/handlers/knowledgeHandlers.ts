// ============================================================================
// knowledgeHandlers — 知识库 IPC handler
// 注册通道: knowledge:list / knowledge:read / knowledge:save / knowledge:create / knowledge:delete
// 管理 markdown 知识条目的 CRUD（项目 + 全局双目录）
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import { getUserConfigRoot } from '../../core/ConfigPaths.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerKnowledgeHandlers(ctx: HandlerContext): void {
  function extractTitle(content: string, filename: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
    return filename.replace(/\.md$/, '');
  }

  function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_') + '.md';
  }

  function getKnowledgeDirs(): string[] {
    const dirs: string[] = [];
    const projectRoot = ctx.core.getProjectRoot();
    if (projectRoot) {
      dirs.push(path.join(projectRoot, '.module-agent', 'knowledge'));
    }
    dirs.push(path.join(getUserConfigRoot(), 'config', 'knowledge'));
    return dirs;
  }

  function findKnowledgeFile(filename: string): string | null {
    for (const dir of getKnowledgeDirs()) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) return filePath;
    }
    return null;
  }

  async function readKnowledgeDir(dir: string): Promise<{ name: string; filename: string; source: string }[]> {
    const items: { name: string; filename: string; source: string }[] = [];
    try {
      fs.ensureDirSync(dir);
      const files = await fs.promises.readdir(dir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      for (const file of mdFiles) {
        const filePath = path.join(dir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          items.push({ name: extractTitle(content, file), filename: file, source: dir });
        } catch {
          items.push({ name: file.replace(/\.md$/, ''), filename: file, source: dir });
        }
      }
    } catch { /* 目录可能不存在 */ }
    return items;
  }

  ipcMain.handle(IpcChannel.Knowledge.List, async () => {
    try {
      const dirs = getKnowledgeDirs();
      const seen = new Set<string>();
      const items: { name: string; filename: string }[] = [];
      for (const dir of dirs) {
        const dirItems = await readKnowledgeDir(dir);
        for (const item of dirItems) {
          if (seen.has(item.filename)) continue;
          seen.add(item.filename);
          items.push({ name: item.name, filename: item.filename });
        }
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      return items;
    } catch (err) {
      ctx.logger.error(`knowledge:list failed: ${(err as Error).message}`);
      return [];
    }
  });

  ipcMain.handle(IpcChannel.Knowledge.Read, async (_event, filename: string) => {
    try {
      const filePath = findKnowledgeFile(filename);
      if (!filePath) return null;
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { name: extractTitle(content, filename), filename, content };
    } catch (err) {
      ctx.logger.error(`knowledge:read failed [${filename}]: ${(err as Error).message}`);
      return null;
    }
  });

  ipcMain.handle(IpcChannel.Knowledge.Save, async (_event, entry: { name: string; filename: string; content: string }) => {
    try {
      const projectRoot = ctx.core.getProjectRoot();
      if (!projectRoot) return { success: false };
      const knowledgeDir = path.join(projectRoot, '.module-agent', 'knowledge');
      fs.ensureDirSync(knowledgeDir);
      const filePath = path.join(knowledgeDir, entry.filename);
      let content = entry.content;
      if (/^#\s+/m.test(content)) {
        content = content.replace(/^#\s+.*$/m, `# ${entry.name}`);
      } else {
        content = `# ${entry.name}\n\n${content}`;
      }
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      ctx.logger.error(`knowledge:save failed [${entry.filename}]: ${(err as Error).message}`);
      return { success: false };
    }
  });

  ipcMain.handle(IpcChannel.Knowledge.Create, async (_event, name: string) => {
    try {
      const projectRoot = ctx.core.getProjectRoot();
      if (!projectRoot) return { error: 'no project root' };
      const knowledgeDir = path.join(projectRoot, '.module-agent', 'knowledge');
      fs.ensureDirSync(knowledgeDir);
      const filename = sanitizeFilename(name || '新知识条目');
      const filePath = path.join(knowledgeDir, filename);
      if (fs.existsSync(filePath)) return { error: '文件已存在' };
      const content = `# ${name || '新知识条目'}\n\n`;
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { name: name || '新知识条目', filename, content };
    } catch (err) {
      ctx.logger.error(`knowledge:create failed: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Knowledge.Delete, async (_event, filename: string) => {
    try {
      const projectRoot = ctx.core.getProjectRoot();
      if (!projectRoot) return { success: false };
      const knowledgeDir = path.join(projectRoot, '.module-agent', 'knowledge');
      const filePath = path.join(knowledgeDir, filename);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return { success: true };
      }
      return { success: true };
    } catch (err) {
      ctx.logger.error(`knowledge:delete failed [${filename}]: ${(err as Error).message}`);
      return { success: false };
    }
  });
}
