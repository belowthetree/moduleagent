import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { ChatView, type ChatMessage } from './ChatView.js';
import { StatusBar } from './StatusBar.js';
import type { AgentManager } from '../../agents/AgentManager.js';
import type { SessionUpdate, SessionPromptResult } from '../../protocol/acp/types.js';

interface Props {
  manager: AgentManager;
  rootName: string;
  onExit: () => void;
}

export function App({ manager, rootName, onExit }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentAgent, setCurrentAgent] = useState('main');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('就绪');
  const pendingRef = useRef(false);
  const mainAgentRef = useRef<string | null>(null);

  useEffect(() => {
    setup().catch((err) => {
      addSystem(`初始化失败: ${err.message}`);
    });
  }, []);

  async function setup() {
    addSystem('正在启动主 Agent...');
    setStatus('启动中');

    try {
      const main = await manager.startMainAgent(manager['graph'].nodes.get(rootName)?.absolutePath || process.cwd());
      mainAgentRef.current = main.sessionId!;

      const session = main.agent.client.getSession(mainAgentRef.current!);
      if (session) {
        session.handlers = {
          ...session.handlers,
          onUpdate: (_sid, update) => {
            handleUpdate(update);
          },
        };
      }

      addSystem(`主 Agent 已启动 (${main.name})`);
      setStatus('就绪');
      setCurrentAgent('main');
    } catch (err) {
      addSystem(`启动失败: ${(err as Error).message}`);
      setStatus('错误');
    }
  }

  function addSystem(content: string) {
    setMessages((prev) => [...prev, { role: 'system', content, timestamp: new Date() }]);
  }

  function handleUpdate(update: SessionUpdate) {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = (update as { text?: string }).text;
        if (text) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'agent' && !last.content.endsWith('...')) {
              last.content += text;
              return [...prev];
            }
            return [...prev, { role: 'agent', content: text, timestamp: new Date() }];
          });
        }
        break;
      }
      case 'user_message_chunk': {
        const text = (update as { text?: string }).text;
        if (text) {
          setMessages((prev) => [...prev, { role: 'user', content: text, timestamp: new Date() }]);
        }
        break;
      }
      case 'thought_message_chunk': {
        const text = (update as { text?: string }).text;
        if (text) {
          setMessages((prev) => [...prev, { role: 'system', content: `[思考] ${text}`, timestamp: new Date() }]);
        }
        break;
      }
      case 'tool_call': {
        const tc = update as { toolCallId?: string; title?: string; status?: string };
        addSystem(`[工具调用] ${tc.title || tc.toolCallId} (${tc.status || 'pending'})`);
        break;
      }
      case 'plan': {
        const plan = update as { entries?: { content: string; priority: string; status: string }[] };
        if (plan.entries) {
          for (const entry of plan.entries) {
            addSystem(`[计划] [${entry.status}] ${entry.content}`);
          }
        }
        break;
      }
    }
  }

  useInput(async (value: string, key: { return?: boolean; escape?: boolean; ctrl?: boolean }) => {
    if (key.escape) {
      onExit();
      return;
    }

    if (key.return) {
      const text = input.trim();
      if (!text || busy) return;

      if (text === '/exit' || text === '/quit') {
        onExit();
        return;
      }

      if (text === '/tree') {
        addSystem('使用 /tree 命令查看模块树');
        return;
      }

      setInput('');
      setBusy(true);
      setStatus('处理中');

      setMessages((prev) => [...prev, { role: 'user', content: text, timestamp: new Date() }]);

      try {
        const entry = manager.getAgent(currentAgent);
        if (!entry || !entry.sessionId) {
          addSystem('Agent 未就绪');
          setBusy(false);
          setStatus('就绪');
          return;
        }

        const result = await entry.agent.client.prompt(entry.sessionId, text);
        addSystem(`完成 (${result.stopReason})`);
      } catch (err) {
        addSystem(`错误: ${(err as Error).message}`);
      } finally {
        setBusy(false);
        setStatus('就绪');
      }
      return;
    }

    if (value) {
      setInput((prev) => prev + value);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <StatusBar agentName={currentAgent} mode={status} sessionCount={manager.listAgents().length} />
      <ChatView messages={messages} />
      <Box borderStyle="round" paddingX={1} marginTop={1}>
        <Text color="green" bold>{'> '}</Text>
        <Text>{input}</Text>
        {busy && <Text dimColor> ...</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>输入消息后 Enter 发送 | /exit 退出 | /tree 查看模块结构</Text>
      </Box>
    </Box>
  );
}
