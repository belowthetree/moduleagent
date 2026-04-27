import fs from 'fs-extra';
import path from 'path';
import { isBuiltinExcluded } from './ExclusionRules.js';
import type { ModuleDescriptor } from '../types/module.js';
import { ModuleParser } from './ModuleParser.js';

export interface ScanOptions {
  projectRoot: string;
  extraExclude?: string[];
}

export class ModuleScanner {
  static async scan(options: ScanOptions): Promise<ModuleDescriptor[]> {
    const { projectRoot, extraExclude = [] } = options;

    if (!await fs.pathExists(projectRoot)) {
      throw new Error(`Project root does not exist: ${projectRoot}`);
    }

    const modules: ModuleDescriptor[] = [];
    await ModuleScanner.scanDir(projectRoot, projectRoot, extraExclude, modules);
    return modules;
  }

  private static async scanDir(
    dirPath: string,
    projectRoot: string,
    extraExclude: string[],
    modules: ModuleDescriptor[],
  ): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (ModuleScanner.isExcluded(entry.name, extraExclude)) {
          continue;
        }
        await ModuleScanner.scanDir(fullPath, projectRoot, extraExclude, modules);
      } else if (entry.isFile() && entry.name === 'module.md') {
        try {
          const definition = await ModuleParser.parseFile(fullPath);
          const rootPath = path.dirname(fullPath);
          const relativePath = path.relative(projectRoot, rootPath) || '.';
          modules.push({
            name: definition.frontmatter.name,
            rootPath,
            relativePath,
            moduleMdPath: fullPath,
            definition,
          });
        } catch (err) {
          console.error(`Failed to parse ${fullPath}:`, err);
        }
      }
    }
  }

  private static isExcluded(name: string, extraExclude: string[]): boolean {
    if (isBuiltinExcluded(name)) return true;
    return extraExclude.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1);
        return name.endsWith(ext);
      }
      return name === pattern;
    });
  }
}
