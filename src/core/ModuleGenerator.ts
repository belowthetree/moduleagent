import fs from 'fs-extra';
import path from 'path';
import { isBuiltinExcluded } from './ExclusionRules.js';
import type { ModuleFrontmatter } from '../types/module.js';

export interface GenerateOptions {
  dirPath: string;
  force?: boolean;
  extraExclude?: string[];
}

export class ModuleGenerator {
  static async generate(options: GenerateOptions): Promise<string> {
    const { dirPath } = options;

    if (!await fs.pathExists(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    const dirName = path.basename(path.resolve(dirPath));
    const description = await ModuleGenerator.inferDescription(dirPath);
    const subModules = await ModuleGenerator.inferSubModules(dirPath, options.extraExclude || []);
    const body = await ModuleGenerator.inferBody(dirPath, dirName);

    return ModuleGenerator.composeModuleMd(
      { name: dirName, description },
      body,
      subModules,
    );
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

    let yaml = '---\n';
    yaml += `${ModuleGenerator.yamlDump(fmObj, 0)}\n`;
    yaml += '---\n\n';
    yaml += body.trimEnd() + '\n';

    if (subModules.length > 0) {
      yaml += '\n## 子模块\n';
      for (const sub of subModules) {
        yaml += `- \`${sub.path}/\` - ${sub.description}\n`;
      }
    }

    return yaml;
  }

  private static yamlDump(obj: Record<string, unknown>, indent: number): string {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            lines.push(`${prefix}  - ${ModuleGenerator.yamlInline(item as Record<string, unknown>)}`);
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

  private static yamlInline(obj: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && !value.includes(' ') && !value.includes(':')) {
        parts.push(`${key}: ${value}`);
      } else {
        throw new Error('Inline YAML only supports simple string values without spaces');
      }
    }
    return `{ ${parts.join(', ')} }`;
  }
}
