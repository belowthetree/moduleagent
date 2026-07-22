// ---------------------------------------------------------------------------
// tui/components/RolePanel.tsx — TUI 角色选择界面
// 全屏显示可用角色列表，↑↓ 导航，Enter 切换当前 agent 到所选角色，Esc 返回
// 数据通过 __tuiAgentService（TuiBridge）加载，风格对齐 ModuleTree
// ---------------------------------------------------------------------------

import { createSignal, onMount } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { TextAttributes, type KeyEvent } from '@opentui/core';
import { tuiState } from '../state.js';
import { defaultLogger } from '../../core/Logger.js';
import type { RoleConfigData } from '../../types/shared.js';
import type { ChatMessage } from '../types.js';

function addSystemMessage(text: string) {
  const msg: ChatMessage = {
    id: `sys-${Date.now()}`,
    role: 'system',
    msgType: 'system',
    content: text,
    time: new Date().toLocaleTimeString(),
  };
  tuiState.setMessages([...tuiState.messages(), msg]);
}

function backToChat() {
  tuiState.setScreen('chat');
  tuiState.setInputValue('');
  tuiState.setShowCommands(false);
}

export default function RolePanel() {
  const renderer = useRenderer();
  const [roles, setRoles] = createSignal<RoleConfigData[]>([]);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [switching, setSwitching] = createSignal(false);
  let scrollEl: any = null;

  onMount(async () => {
    const bridge = (globalThis as any).__tuiAgentService;
    try {
      const list: RoleConfigData[] = await bridge?.getRoleConfigs?.() ?? [];
      setRoles(list);
      // 默认选中当前角色
      if (tuiState.currentTarget() === 'role') {
        const cur = list.findIndex(r => r.name === tuiState.currentAgent());
        if (cur >= 0) setSelectedIdx(cur);
      }
    } catch (err) {
      defaultLogger.warn(`RolePanel: load roles failed: ${(err as Error).message}`);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  });

  const selectRole = async (name: string) => {
    const bridge = (globalThis as any).__tuiAgentService;
    if (!bridge?.startRole || switching()) return;
    // 已是当前角色：直接返回
    if (tuiState.currentTarget() === 'role' && tuiState.currentAgent() === name) {
      backToChat();
      return;
    }
    setSwitching(true);
    try {
      await bridge.startRole(name);
      backToChat();
    } catch (err) {
      addSystemMessage(`切换角色失败: ${(err as Error).message}`);
      setSwitching(false);
    }
  };

  useKeyboard((key: KeyEvent) => {
    if (switching()) return;
    const list = roles();

    if (key.name === 'escape') {
      backToChat();
      key.preventDefault();
      return;
    }

    if (list.length === 0) return;

    if (key.name === 'up' || key.name === 'k') {
      setSelectedIdx(prev => {
        const next = prev > 0 ? prev - 1 : list.length - 1;
        scrollEl?.scrollTo?.(Math.max(0, next - 3));
        return next;
      });
      key.preventDefault();
    } else if (key.name === 'down' || key.name === 'j') {
      setSelectedIdx(prev => {
        const next = prev < list.length - 1 ? prev + 1 : 0;
        scrollEl?.scrollTo?.(Math.max(0, next - 3));
        return next;
      });
      key.preventDefault();
    } else if (key.name === 'return') {
      const role = list[selectedIdx()];
      if (role) selectRole(role.name);
      key.preventDefault();
    }
  });

  const termWidth = () => renderer?.width ?? 80;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0d1117">
      <box
        flexDirection="row"
        justifyContent="space-between"
        height={1}
        padding={0}
        backgroundColor="#161b22"
        focused={true}
      >
        <text fg="#58a6ff"> 角色选择</text>
        <text fg="#888888" attributes={TextAttributes.DIM}>
          {switching() ? '正在切换…' : '↑↓ 导航  Enter 切换  Esc 关闭'}
        </text>
      </box>
      {/*
        隐藏 input：OpenTUI 的键盘事件路由依赖聚焦的 input 元素。
        没有 input 聚焦时方向键不会被派发到 useKeyboard 处理器。
      */}
      <input
        width={0}
        visible={false}
        value=""
        keyBindings={[]}
      />
      <scrollbox ref={(el: any) => { scrollEl = el; }} flexGrow={1}>
        <box flexDirection="column">
          {loading() ? (
            <text fg="#888888" attributes={TextAttributes.DIM}>  加载中…</text>
          ) : roles().length === 0 ? (
            <box flexDirection="column" padding={1}>
              <text fg="#888888">  无可用角色。</text>
              <text fg="#555555" attributes={TextAttributes.DIM}>  请先在 .module-agent.json 中配置 roles。</text>
            </box>
          ) : (
            (() => {
              const list = roles();
              const sel = selectedIdx();
              const running = new Set<string>((globalThis as any).__tuiAgentService?.listRunningRoles?.() ?? []);
              const currentName = tuiState.currentTarget() === 'role' ? tuiState.currentAgent() : '';
              return list.map((role, i) => {
                const isSelected = i === sel;
                const isCurrent = role.name === currentName;
                const isRunning = running.has(role.name);
                const nameFg = isCurrent ? '#58a6ff' : '#c9d1d9';
                const descMax = Math.max(10, termWidth() - role.name.length - 16);
                const desc = (role.description || '').length > descMax
                  ? role.description.slice(0, descMax - 1) + '…'
                  : (role.description || '');

                return (
                  <box
                    flexDirection="row"
                    height={1}
                    padding={0}
                    backgroundColor={isSelected ? '#1a2538' : 'transparent'}
                  >
                    <text fg={isSelected ? '#58a6ff' : '#555555'}>{isSelected ? '→ ' : '  '}</text>
                    <text fg={isRunning ? '#00FF00' : '#555555'}>{isRunning ? '● ' : '◌ '}</text>
                    <text fg={nameFg} attributes={isCurrent ? TextAttributes.BOLD : TextAttributes.NONE}>{role.name}</text>
                    <text fg="#58a6ff" attributes={TextAttributes.DIM}>{isCurrent ? ' [当前]' : ''}</text>
                    <text fg="#888888" attributes={TextAttributes.DIM}>{desc ? ` — ${desc}` : ''}</text>
                  </box>
                );
              });
            })()
          )}
        </box>
      </scrollbox>
    </box>
  );
}
