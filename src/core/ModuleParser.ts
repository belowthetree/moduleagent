import fs from 'fs-extra';
import path from 'path';
import matter from 'gray-matter';
import type { ModuleDefinition, ModuleFrontmatter, SubModuleRef } from '../types/module.js';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

export class ModuleParser {
  static async parseFile(filePath: string): Promise<ModuleDefinition> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(raw);

    const frontmatter = ModuleParser.parseFrontmatter(data);
    // Prefer frontmatter submodules; fall back to markdown body (legacy format)
    const subModules = frontmatter.submodules?.length
      ? frontmatter.submodules
      : ModuleParser.parseSubModulesFromBody(marked.lexer(content));
    const description = ModuleParser.parseDescription(marked.lexer(content));

    return {
      frontmatter,
      body: content.trim(),
      description,
      subModules,
    };
  }

  private static parseFrontmatter(data: Record<string, unknown>): ModuleFrontmatter {
    const name = typeof data.name === 'string' ? data.name : path.basename(process.cwd());
    const description = typeof data.description === 'string' ? data.description : '';
    const submodules = ModuleParser.parseSubModulesFromData(data.submodules);

    return { name, description, submodules };
  }

  private static parseSubModulesFromData(raw: unknown): SubModuleRef[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const result: SubModuleRef[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name : '';
      const subPath = typeof obj.path === 'string' ? obj.path : '';
      const desc = typeof obj.description === 'string' ? obj.description : '';
      if (name && subPath) {
        result.push({ name, path: subPath, description: desc });
      }
    }
    return result.length > 0 ? result : undefined;
  }

  private static parseDescription(tokens: Token[]): string {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token?.type === 'heading' && (token as Tokens.Heading).depth === 2) {
        const heading = token as Tokens.Heading;
        if (heading.text === '模块说明' || heading.text.toLowerCase() === 'description') {
          const next = tokens[i + 1];
          if (next && next.type === 'paragraph') {
            return (next as Tokens.Paragraph).text;
          }
          return '';
        }
      }
    }
    return '';
  }

  private static parseSubModulesFromBody(tokens: Token[]): SubModuleRef[] {
    const subModules: SubModuleRef[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token?.type === 'heading' && (token as Tokens.Heading).depth === 2) {
        const heading = token as Tokens.Heading;
        if (heading.text === '子模块' || heading.text.toLowerCase() === 'submodules') {
          const next = tokens[i + 1];
          if (next && next.type === 'list') {
            const list = next as Tokens.List;
            for (const item of list.items) {
              const ref = ModuleParser.parseSubModuleItem(item);
              if (ref) subModules.push(ref);
            }
          }
          break;
        }
      }
    }
    return subModules;
  }

  private static parseSubModuleItem(item: Tokens.ListItem): SubModuleRef | null {
    const textToken = item.tokens[0];
    if (!textToken || textToken.type !== 'text') return null;
    const text = (textToken as Tokens.Text).text;

    const pattern = /^`([^`]+)`\s*[-–—]\s*(.+)$/;
    const match = text.match(pattern);
    if (!match) {
      const codePattern = /^`([^`]+)`\s*(.*)$/;
      const codeMatch = text.match(codePattern);
      if (codeMatch) {
        return {
          name: codeMatch[1]!.replace(/\/$/, ''),
          path: codeMatch[1]!,
          description: codeMatch[2]?.trim() || '',
        };
      }
      return null;
    }

    return {
      name: match[1]!.replace(/\/$/, ''),
      path: match[1]!,
      description: match[2]!.trim(),
    };
  }
}
