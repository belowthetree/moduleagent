import fs from 'fs-extra';
import path from 'path';
import { isBuiltinExcluded } from './ExclusionRules.js';
import type { ModuleFrontmatter } from '../types/module.js';
import { defaultLogger as log } from './Logger.js';

export interface GenerateOptions {
  dirPath: string;
  projectRoot: string;
  force?: boolean;
  extraExclude?: string[];
}

export class ModuleGenerator {
  static async generate(options: GenerateOptions): Promise<string> {
    const { dirPath, projectRoot } = options;

    log.info(`ModuleGenerator: generating for ${dirPath} (projectRoot=${projectRoot})`);
    if (!await fs.pathExists(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    // Use relative path from project root as module name for uniqueness.
    // Falls back to basename for the root module (where relative path is "").
    const relativePath = path.relative(projectRoot, dirPath);
    const moduleName = relativePath || path.basename(projectRoot);
    const description = await ModuleGenerator.inferDescription(dirPath);
    const subModules = await ModuleGenerator.inferSubModules(dirPath, options.extraExclude || []);
    const body = await ModuleGenerator.inferBody(dirPath, moduleName);

    const result = ModuleGenerator.composeModuleMd(
      { name: moduleName, description },
      body,
      subModules,
    );
    log.info(`ModuleGenerator: generated module.md for "${moduleName}" (${subModules.length} submodules, ${result.length} chars)`);
    return result;
  }

  private static async inferDescription(dirPath: string): Promise<string> {
    const pkgPath = path.join(dirPath, 'package.json');
    if (await fs.pathExists(pkgPath)) {
      try {
        const pkg = await fs.readJson(pkgPath);
        if (pkg.description) return pkg.description;
      } catch {}
    }

    const cargoPath = path.join(dirPath, 'Cargo.toml');
    if (await fs.pathExists(cargoPath)) {
      try {
        const content = await fs.readFile(cargoPath, 'utf-8');
        const match = content.match(/description\s*=\s*"([^"]+)"/);
        if (match) return match[1]!;
      } catch {}
    }

    const basename = path.basename(dirPath);
    return `${basename} 模块`;
  }

  private static async inferSubModules(dirPath: string, extraExclude: string[]): Promise<{ name: string; path: string; description: string }[]> {
    const subs: { name: string; path: string; description: string }[] = [];

    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return subs;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isBuiltinExcluded(entry.name)) continue;
      if (extraExclude.includes(entry.name)) continue;

      const subDesc = await ModuleGenerator.inferDescription(path.join(dirPath, entry.name));
      subs.push({
        name: entry.name,
        path: `./${entry.name}`,
        description: subDesc,
      });
    }

    return subs;
  }

  private static async inferBody(dirPath: string, dirName: string): Promise<string> {
    let body = `# ${dirName}\n\n## 模块说明\n\n待补充\n`;
    return body;
  }

  static composeModuleMd(
    frontmatter: ModuleFrontmatter,
    body: string,
    subModules: { name: string; path: string; description: string }[],
  ): string {
    const fmObj: Record<string, unknown> = {
      name: frontmatter.name,
      description: frontmatter.description,
    };
    if (subModules.length > 0) {
      fmObj.submodules = subModules.map(s => ({
        name: s.name,
        path: s.path,
        description: s.description,
      }));
    }

    let yaml = '---\n';
    yaml += `${ModuleGenerator.yamlDump(fmObj, 0)}\n`;
    yaml += '---\n\n';
    yaml += body.trimEnd() + '\n';

    return yaml;
  }

  static createModuleMd(name: string, description?: string): string {
    const desc = description || `${name} 模块`;
    return ModuleGenerator.composeModuleMd(
      { name, description: desc },
      `# ${name}\n\n## 模块说明\n\n待补充\n`,
      [],
    );
  }

  private static yamlDump(obj: Record<string, unknown>, indent: number): string {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        lines.push(`${prefix}${key}:`);
        const isObjectArray = value.length > 0 && typeof value[0] === 'object' && value[0] !== null;
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            lines.push(`${prefix}  -`);
            lines.push(ModuleGenerator.yamlDump(item as Record<string, unknown>, indent + 2));
          } else {
            lines.push(`${prefix}  - ${JSON.stringify(item)}`);
          }
        }
      } else if (typeof value === 'object') {
        lines.push(`${prefix}${key}:`);
        lines.push(ModuleGenerator.yamlDump(value as Record<string, unknown>, indent + 1));
      } else {
        lines.push(`${prefix}${key}: ${JSON.stringify(value)}`);
      }
    }

    return lines.join('\n');
  }
}
