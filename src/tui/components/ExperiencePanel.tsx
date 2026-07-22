// ---------------------------------------------------------------------------
// tui/components/ExperiencePanel.tsx — 经验浏览面板
// 展示所选模块的 experience.md 内容，支持基本的 Markdown 着色渲染
// 模块选择通过 ModuleTree（经验模式）完成
// ---------------------------------------------------------------------------

import { createMemo, Show } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { tuiState } from '../state.js';
import { TextAttributes, type KeyEvent } from '@opentui/core';

// ── 简易 Markdown → OpenTUI 渲染 ──

interface StyledSegment {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
}

/** 将片段的 bold/dim 标记合成为 OpenTUI attributes 位掩码 */
function segmentAttributes(s: StyledSegment): number {
  return (s.bold ? TextAttributes.BOLD : 0) | (s.dim ? TextAttributes.DIM : 0);
}

/** 单行解析：将一行文本解析为带样式的片段列表 */
function parseLine(line: string): StyledSegment[] {
  if (!line.trim()) return [{ text: '' }];

  if (line.startsWith('    ') || line.startsWith('\t')) {
    return [{ text: line, fg: '#88BB88', dim: true }];
  }

  const segments: StyledSegment[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      // 正则含必填捕获组 (.+?)，匹配成功时组 1 必存在
      segments.push({ text: boldMatch[1]!, bold: true });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      segments.push({ text: codeMatch[1]!, fg: '#FFA07A', bg: '#333333' });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      segments.push({ text: `[${linkMatch[1]}]`, fg: '#5BADFF' });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    const nextSpecial = remaining.search(/\*\*|`|\[/);
    const take = nextSpecial === -1 ? remaining.length : nextSpecial;
    if (take > 0) {
      segments.push({ text: remaining.slice(0, take) });
    }
    remaining = remaining.slice(take);
  }

  return segments;
}

/** 渲染一段 markdown 文本为 OpenTUI <text> 元素数组 */
function renderMarkdown(content: string) {
  const lines = content.split('\n');
  const elements: any[] = [];
  let inCodeBlock = false;
  let codeContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <text fg="#88BB88" attributes={TextAttributes.DIM}>{codeContent.trimEnd()}</text>
        );
        elements.push(<text> </text>);
        codeContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      elements.push(<text fg="#555555" attributes={TextAttributes.DIM}>{'─'.repeat(Math.min(60, process.stdout.columns || 80))}</text>);
      continue;
    }

    if (!line.trim()) {
      elements.push(<text> </text>);
      continue;
    }

    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1]!.length;
      const text = hMatch[2];
      const fg = level === 1 ? '#FFFFFF' : level === 2 ? '#5BADFF' : '#CCCCCC';
      elements.push(<text fg={fg} attributes={TextAttributes.BOLD}>{'# '.repeat(level) + text}</text>);
      continue;
    }

    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      const indentSrc = ulMatch[1]!;
      const indent = indentSrc.length ? '  '.repeat(Math.floor(indentSrc.length / 2)) : '';
      const contentLine = ulMatch[2]!;
      const segments = parseLine(contentLine);
      elements.push(
        <text>
          <text attributes={TextAttributes.DIM}>{indent}• </text>
          {segments.map(s => <text fg={s.fg} bg={s.bg} attributes={segmentAttributes(s)}>{s.text}</text>)}
        </text>
      );
      continue;
    }

    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      const indentSrc = olMatch[1]!;
      const indent = indentSrc.length ? '  '.repeat(Math.floor(indentSrc.length / 2)) : '';
      const contentLine = olMatch[2]!;
      const segments = parseLine(contentLine);
      elements.push(
        <text>
          <text attributes={TextAttributes.DIM}>{indent}  </text>
          {segments.map(s => <text fg={s.fg} bg={s.bg} attributes={segmentAttributes(s)}>{s.text}</text>)}
        </text>
      );
      continue;
    }

    const segments = parseLine(line);
    elements.push(
      <text>
        {segments.map(s => <text fg={s.fg} bg={s.bg} attributes={segmentAttributes(s)}>{s.text}</text>)}
      </text>
    );
  }

  return elements;
}

// ── ExperiencePanel 组件 ──

export default function ExperiencePanel() {
  const renderer = useRenderer();
  const entries = () => tuiState.experienceEntries();
  const selectedIndex = () => tuiState.experienceModuleIndex();

  const currentEntry = createMemo(() => {
    const list = entries();
    const idx = selectedIndex();
    return list[idx] || null;
  });

  const currentModuleName = createMemo(() => currentEntry()?.moduleName || '');
  const currentContent = createMemo(() => currentEntry()?.content || '');

  // 键盘：Esc 回到树选择
  useKeyboard((key: KeyEvent) => {
    if (key.name === 'escape') {
      tuiState.setExperienceModuleIndex(-1);
      key.preventDefault();
      return;
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0d1117">
      {/* 顶部标题 */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        height={1}
        padding={0}
        backgroundColor="#161b22"
      >
        <text fg="#58a6ff" attributes={TextAttributes.BOLD}> 经验浏览 — {currentModuleName()}</text>
        <text fg="#888888" attributes={TextAttributes.DIM}>Esc 返回模块列表</text>
      </box>

      <text height={1}> </text>

      {/* 分割线 */}
      <text fg="#555555" attributes={TextAttributes.DIM}>{'─'.repeat(Math.min(60, process.stdout.columns || 80))}</text>

      <text height={1}> </text>

      {/* 经验内容 */}
      <scrollbox flexGrow={1} flexShrink={1}>
        <Show when={currentEntry()} fallback={<text fg="#888888" attributes={TextAttributes.DIM}>  (无经验内容)</text>}>
          {() => (
            <box flexDirection="column">
              {renderMarkdown(currentContent())}
            </box>
          )}
        </Show>
      </scrollbox>
    </box>
  );
}
