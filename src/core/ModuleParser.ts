import fs from 'fs-extra';
import path from 'path';
import matter from 'gray-matter';
import type { ModuleDefinition, ModuleFrontmatter, SubModuleRef, SourceConfig } from '../types/module.js';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

export class ModuleParser {
  static async parseFile(filePath: string): Promise<ModuleDefinition> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(raw);

    const frontmatter = ModuleParser.parseFrontmatter(data);
    const subModules = ModuleParser.parseSubModules(marked.lexer(content));
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

    return {
      name,
      description,
      source: ModuleParser.parseSource(data.source),
    };
  }

  private static parseSource(raw: unknown): SourceConfig | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const src = raw as Record<string, unknown>;
    const type = src.type;
    if (type !== 'git' && type !== 'local') return undefined;

    return {
      type,
      url: typeof src.url === 'string' ? src.url : undefined,
      branch: typeof src.branch === 'string' ? src.branch : undefined,
      path: typeof src.path === 'string' ? src.path : undefined,
    };
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

  private static parseSubModules(tokens: Token[]): SubModuleRef[] {
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
