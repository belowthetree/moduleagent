// ============================================================================
// dialogHandlers — 对话框 IPC handler
// 注册通道: dialog:selectDir — 打开系统目录选择对话框
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import { dialog } from 'electron';

export function registerDialogHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IpcChannel.Dialog.SelectDir, async (_event, title: string) => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      properties: ['openDirectory'],
      title,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });
}
