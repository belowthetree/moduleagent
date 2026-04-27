import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { ModuleScanner } from '../src/core/ModuleScanner.js';
import { ModuleGraph } from '../src/core/ModuleGraph.js';
import { ConfigLoader } from '../src/config/ConfigLoader.js';
import type { ModuleGraphNode } from '../src/types/module.js';

let mainWindow: BrowserWindow | null = null;
let currentGraph: ReturnType<ModuleGraph['build']> | null = null;
let currentProjectRoot = '';

function getResourcePath(...segments: string[]): string {
  return path.join(app.getAppPath(), ...segments);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'ModuleAgent',
    webPreferences: {
      preload: getResourcePath('electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(getResourcePath('electron', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
}

function registerIpcHandlers() {
  ipcMain.handle('dialog:selectDir', async (_event, title: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('project:scan', async (_event, projectRoot: string, workspaceRoot: string) => {
    try {
      const config = await ConfigLoader.loadOrCreate(projectRoot);
      const descriptors = await ModuleScanner.scan({
        projectRoot,
        extraExclude: config.exclude,
      });
      const graph = new ModuleGraph().build(descriptors, projectRoot);
      currentGraph = graph;
      currentProjectRoot = projectRoot;

      const nodes: Record<string, ModuleGraphNode> = {};
      for (const [name, node] of graph.nodes) {
        nodes[name] = { ...node, workspacePath: workspaceRoot };
      }

      return {
        root: graph.root,
        nodes,
        moduleCount: descriptors.length,
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('project:getTree', () => {
    if (!currentGraph) return null;

    function buildTree(node: ModuleGraphNode): Record<string, unknown> {
      return {
        name: node.name,
        path: node.relativePath,
        description: node.definition.frontmatter.description,
        source: node.definition.frontmatter.source || null,
        children: node.children
          .map((c) => currentGraph!.nodes.get(c))
          .filter(Boolean)
          .map((c) => buildTree(c!)),
      };
    }

    const rootNode = currentGraph.nodes.get(currentGraph.root);
    if (!rootNode) return null;
    return buildTree(rootNode);
  });

  ipcMain.handle('project:validateModules', async (_event, projectRoot: string) => {
    try {
      const descriptors = await ModuleScanner.scan({ projectRoot });
      const graph = new ModuleGraph().build(descriptors, projectRoot);
      const warnings: string[] = [];
      for (const [name, node] of graph.nodes) {
        for (const sub of node.definition.subModules) {
          if (!graph.nodes.has(sub.name)) {
            warnings.push(`模块 "${name}" 声明的子模块 "${sub.name}" 未找到`);
          }
        }
      }
      return { valid: warnings.length === 0, warnings, moduleCount: descriptors.length };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
