import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { defaultLogger, LogLevel } from '../core/Logger.js';
import { ElectronBridge } from './bridge.js';

defaultLogger.configure('logs', LogLevel.INFO);
defaultLogger.info('ModuleAgent starting...');

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
    console.error('[main] FAILED TO LOAD:', code, desc, url);
  });

  mainWindow.webContents.on('console-message', (_event, _level, msg) => {
    console.log('[renderer console]', msg);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  bridge = new ElectronBridge(mainWindow!);
  bridge.registerAllHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  bridge?.cleanup().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});
