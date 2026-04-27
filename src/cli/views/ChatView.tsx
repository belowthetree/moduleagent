import React from 'react';
import { Box, Text } from 'ink';

export interface ChatMessage {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp?: Date;
}

interface Props {
  messages: ChatMessage[];
  maxHeight?: number;
}

export function ChatView({ messages, maxHeight = 20 }: Props) {
  const display = messages.slice(-maxHeight);

  return (
    <Box flexDirection="column" paddingY={1}>
      {display.map((msg, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box>
            {msg.role === 'user' && <Text color="green" bold>{'> '}</Text>}
            {msg.role === 'agent' && <Text color="cyan">{'◀ '}</Text>}
            {msg.role === 'system' && <Text color="yellow">{'[系统] '}</Text>}
            <Text>{msg.content}</Text>
          </Box>
        </Box>
      ))}
      {display.length === 0 && (
        <Box>
          <Text dimColor>等待输入...</Text>
        </Box>
      )}
    </Box>
  );
}
