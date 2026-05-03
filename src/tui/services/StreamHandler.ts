import type { SessionNotification } from '@agentclientprotocol/sdk';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

export interface StreamHandler {
  onSessionUpdate: (
    moduleName: string,
    sessionId: string,
    notification: SessionNotification,
  ) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

export function createStreamHandler(callbacks: StreamCallbacks): StreamHandler {
  const { onChunk, onComplete, onError } = callbacks;

  const onSessionUpdate = (_moduleName: string, _sessionId: string, notification: SessionNotification) => {
    const sessionUpdate = notification.update.sessionUpdate;

    if (sessionUpdate === 'agent_message_chunk' || sessionUpdate === 'agent_thought_chunk') {
      const contentChunk = notification.update as { content?: { type?: string; text?: string } };
      const text = contentChunk.content?.text;
      if (text) {
        onChunk(text);
      }
      return;
    }

    if (sessionUpdate === 'tool_call') {
      const toolCall = notification.update as { title?: string; status?: string };
      if (toolCall.status === 'error') {
        onError(`Tool call failed: ${toolCall.title || 'unknown'}`);
      }
      return;
    }
  };

  return { onSessionUpdate, onComplete, onError };
}
