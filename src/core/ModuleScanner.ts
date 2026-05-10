import fs from 'fs-extra';
import path from 'path';
import { isBuiltinExcluded } from './ExclusionRules.js';
import type { ModuleDescriptor } from '../types/module.js';
import { ModuleParser } from './ModuleParser.js';
import { defaultLogger as log } from './Logger.js';

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

    log.info(`ModuleScanner: scanning ${projectRoot}`);
    const modules: ModuleDescriptor[] = [];
    await ModuleScanner.scanDir(projectRoot, projectRoot, extraExclude, modules);
    await ModuleScanner.ensureDocFiles(modules);
    log.info(`ModuleScanner: found ${modules.length} modules in ${projectRoot}`);
    return modules;
  }

  private static async ensureDocFiles(modules: ModuleDescriptor[]): Promise<void> {
    let created = 0;
    for (const mod of modules) {
      const experiencePath = path.join(mod.rootPath, 'experience.md');
      const patternsPath = path.join(mod.rootPath, 'patterns.md');

      try {
        if (!await fs.pathExists(experiencePath)) {
          await fs.writeFile(experiencePath, `# ${mod.name} — 经验记录\n\n`, 'utf-8');
          created++;
        }
      } catch { /* ignore */ }

      try {
        if (!await fs.pathExists(patternsPath)) {
          await fs.writeFile(patternsPath, `# ${mod.name} — 修改规范\n\n`, 'utf-8');
          created++;
        }
      } catch { /* ignore */ }
    }
    if (created > 0) {
      log.info(`ModuleScanner: initialized ${created} doc file(s) (experience.md / patterns.md)`);
    }
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
          log.error(`ModuleScanner: failed to parse ${fullPath} | ${(err as Error).message}`);
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
