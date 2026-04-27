import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  agentName: string;
  mode?: string;
  sessionCount?: number;
}

export function StatusBar({ agentName, mode = 'ready', sessionCount = 0 }: Props) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold>ModuleAgent</Text>
      <Text dimColor> | </Text>
      <Text>
        当前: <Text color="cyan">{agentName}</Text>
      </Text>
      <Text dimColor> | </Text>
      <Text>模式: {mode}</Text>
      {sessionCount > 0 && (
        <>
          <Text dimColor> | </Text>
          <Text>会话: {sessionCount}</Text>
        </>
      )}
    </Box>
  );
}
