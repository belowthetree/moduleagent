// ---------------------------------------------------------------------------
// main/index.ts — Electron 主进程入口
// 创建浏览器窗口、配置 CSP、初始化 ElectronBridge，管理应用生命周期
// ---------------------------------------------------------------------------

import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { defaultLogger, LogLevel } from '../core/Logger.js';
import { ElectronBridge } from './bridge.js';

let mainWindow: BrowserWindow | null = null;
let bridge: ElectronBridge | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'ModuleAgent',
    backgroundColor: '#0f1117',               // 暗色主题页面底色，消除加载白闪
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 14 } }
      : {
          titleBarOverlay: {
            color: '#1a1d27',                  // 与暗色主题卡片背景一致
            symbolColor: '#9ca3af',            // 与暗色主题次要文字色一致
            height: 36,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    defaultLogger.error(`[main] FAILED TO LOAD: ${code} ${desc} ${url}`);
  });

  mainWindow.webContents.on('console-message', (_event, _level, msg) => {
    defaultLogger.info(`[renderer console] ${msg}`);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
}

app.whenReady().then(() => {
  // 日志目录固定在 userData 下：打包后不依赖 cwd，避免日志散落
  // （app.getPath('userData') 需在 ready 后使用，故 configure 移到此处）
  defaultLogger.configure(path.join(app.getPath('userData'), 'logs'), LogLevel.INFO);
  defaultLogger.info('ModuleAgent starting...');

  Menu.setApplicationMenu(null);
  createWindow();

  bridge = new ElectronBridge(mainWindow!);
  bridge.registerAllHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 退出前顺序执行：await bridge.cleanup()（内部 await core.dispose()，
  // 等待进行中的 context 保存完成）→ 关闭日志流 → app.quit()
  void (async () => {
    try {
      await bridge?.cleanup();
    } catch (err) {
      defaultLogger.error(`cleanup failed: ${(err as Error).message}`);
    }
    if (process.platform !== 'darwin') {
      await defaultLogger.close();
      app.quit();
    }
  })();
});
