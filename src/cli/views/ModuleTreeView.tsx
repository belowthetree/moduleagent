import React from 'react';
import { Box, Text } from 'ink';
import type { ModuleGraphNode } from '../../types/module.js';

interface Props {
  node: ModuleGraphNode;
  graph: { nodes: Map<string, ModuleGraphNode> };
  indent?: string;
  isLast?: boolean;
  isRoot?: boolean;
  detail?: boolean;
}

export function ModuleTreeView({ node, graph, indent = '', isLast = true, isRoot = true, detail = false }: Props) {
  const icon = isRoot ? '◆' : '├';
  const connector = isRoot ? '' : '─';
  const prefix = isRoot ? '' : (indent + (isLast ? '└' : '├') + connector);

  const desc = detail
    ? ` — ${node.definition.frontmatter.description || '无描述'}`
    : '';
  const count = node.children.length > 0
    ? ` [${node.children.length} 子模块]`
    : '';

  const children = node.children
    .map((name) => graph.nodes.get(name))
    .filter((n): n is ModuleGraphNode => n !== undefined);

  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          {prefix}{icon} {node.name} ({node.relativePath}){desc}{count}
        </Text>
      </Box>
      {detail && node.definition.frontmatter.source && (
        <Box>
          <Text dimColor>
            {indent + (isRoot ? '  ' : (isLast ? '   ' : '│  '))}
            源: {node.definition.frontmatter.source.type}:
            {node.definition.frontmatter.source.type === 'git'
              ? `${node.definition.frontmatter.source.url || 'unknown'}@${node.definition.frontmatter.source.branch || 'main'}`
              : node.definition.frontmatter.source.path || node.relativePath}
          </Text>
        </Box>
      )}
      {children.map((child, i) => (
        <ModuleTreeView
          key={child.name}
          node={child}
          graph={graph}
          indent={indent + (isRoot ? '  ' : (isLast ? '   ' : '│  '))}
          isLast={i === children.length - 1}
          isRoot={false}
          detail={detail}
        />
      ))}
    </Box>
  );
}
