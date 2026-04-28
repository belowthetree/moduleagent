import fs from 'fs-extra';
import path from 'path';
import type { ReadTextFileRequest, ReadTextFileResponse, WriteTextFileRequest } from '@agentclientprotocol/sdk';

export class FsHandler {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
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

    return { content };
  }

  async writeFile(params: WriteTextFileRequest): Promise<void> {
    const filePath = this.resolvePath(params.path);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, params.content, 'utf-8');
  }

  private resolvePath(filePath: string): string {
    const p = path.resolve(filePath);
    if (!p.startsWith(this.workspaceRoot)) {
      throw new Error(`Access denied: ${filePath} is outside workspace`);
    }
    return p;
  }
}
