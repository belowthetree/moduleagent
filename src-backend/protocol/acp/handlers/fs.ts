import fs from 'fs-extra';
import path from 'path';
import type { ReadTextFileRequest, ReadTextFileResponse, WriteTextFileRequest } from '@agentclientprotocol/sdk';
import { defaultLogger as log } from '../../../core/Logger.js';

export class FsHandler {
  private workspaceRoot: string;

  constructor(workspaceRoot: string, _subModuleDirs: string[] = []) {
    this.workspaceRoot = path.resolve(workspaceRoot);
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
    const allowed = p.startsWith(this.workspaceRoot + path.sep) || p === this.workspaceRoot;
    if (!allowed) {
      log.warn(`FsHandler access denied: ${filePath}`);
      throw new Error(`Access denied: ${filePath} is outside module workspace`);
    }
    return p;
  }
}
