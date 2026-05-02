import fs from 'fs-extra';
import path from 'path';
import type { ReadTextFileRequest, ReadTextFileResponse, WriteTextFileRequest } from '@agentclientprotocol/sdk';
import { defaultLogger as log } from '../../../core/Logger.js';

export class FsHandler {
  private workspaceRoot: string;
  private allowedDirs: string[];

  constructor(workspaceRoot: string, subModuleDirs: string[] = []) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.allowedDirs = [this.workspaceRoot, ...subModuleDirs.map(d => path.resolve(d))];
    log.debug(`FsHandler: root=${this.workspaceRoot} allowedDirs=${this.allowedDirs.length}`);
  }

  async readFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const filePath = this.resolvePath(params.path);

    if (!await fs.pathExists(filePath)) {
      throw new Error(`File not found: ${params.path}`);
    }

    let content: string;
    if (params.line !== undefined || params.limit !== undefined) {
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw.split('\n');
      const start = (params.line ?? 1) - 1;
      const end = params.limit ? start + params.limit : lines.length;
      content = lines.slice(start, end).join('\n');
    } else {
      content = await fs.readFile(filePath, 'utf-8');
    }

    log.debug(`FsHandler read: ${params.path} (${content.length} chars)`);
    return { content };
  }

  async writeFile(params: WriteTextFileRequest): Promise<void> {
    const filePath = this.resolvePath(params.path);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, params.content, 'utf-8');
    log.debug(`FsHandler write: ${params.path} (${params.content.length} chars)`);
  }

  private resolvePath(filePath: string): string {
    const p = path.resolve(filePath);
    const allowed = this.allowedDirs.some(dir => p.startsWith(dir + path.sep) || p === dir);
    if (!allowed) {
      log.warn(`FsHandler access denied: ${filePath}`);
      throw new Error(`Access denied: ${filePath} is outside allowed module directories`);
    }
    return p;
  }
}
