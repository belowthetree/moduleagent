// ---------------------------------------------------------------------------
// renderer/src/stores/__tests__/agent.test.ts — Agent Store 单元测试
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAgentStore } from '../agent'
import { createMockModuleAgentApi, triggerStream, triggerCrossContext, triggerStatus } from '../../__mocks__/moduleAgent'
import type { ChatMsg } from '../../../../types/shared'

function makeMock() {
  const mock = createMockModuleAgentApi()
  ;(globalThis as any).window.moduleAgent = mock
  return mock
}

describe('useAgentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    makeMock()
  })

  it('startAgent: mock returns sessionId', async () => {
    const result = await window.moduleAgent.startAgent('modA', 'cmd', ['arg1'], '/cwd')
    expect(result.sessionId).toBe('mock-session-id')
    expect(result.error).toBeUndefined()
  })

  it('sendMessage flow: user msg added to contextMap, agent msg from IPC result', async () => {
    const store = useAgentStore()
    await store.sendMessage('module-1', 'Hello world', '/cwd')

    const msgs = store.getMsgs('module-1')
    expect(msgs).toHaveLength(2)

    const userMsg = msgs.find((m: ChatMsg) => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content).toBe('Hello world')
    expect(userMsg!.moduleName).toBe('module-1')
    expect(userMsg!.status).toBe('sent')

    const agentMsg = msgs.find((m: ChatMsg) => m.role === 'agent')
    expect(agentMsg).toBeDefined()
    expect(agentMsg!.content).toBe('mock reply')
    expect(agentMsg!.moduleName).toBe('module-1')
    expect(agentMsg!.status).toBe('completed')
  })

  it('cancelAgent: calls mock cancelAgent', async () => {
    const spy = vi.spyOn(window.moduleAgent, 'cancelAgent')
    const store = useAgentStore()
    store.cancelAgent('module-x')
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('module-x'))
    spy.mockRestore()
  })

  it('stopAgent: ensureStatusListener updates runningAgents Map via push events', () => {
    const mock = makeMock()
    const store = useAgentStore()
    store.ensureStatusListener()

    triggerStatus(mock, { name: 'agent-1', status: 'idle' })
    triggerStatus(mock, { name: 'agent-2', status: 'streaming' })

    expect(store.runningAgents.get('agent-1')).toBe('idle')
    expect(store.runningAgents.get('agent-2')).toBe('streaming')
    expect(store.runningAgents.size).toBe(2)

    store.stopRunningPoll()
    expect(store.runningAgents.size).toBe(0)
  })

  it('context messages: all 12 msgs available without pagination', () => {
    const store = useAgentStore()
    const msgs: ChatMsg[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      role: 'user' as const,
      content: `msg ${i}`,
      thinking: '',
      tools: '',
      time: '10:00',
      status: 'sent' as const,
      moduleName: 'mod-msgs',
      agentCmd: 'test',
    }))
    store.contextMap.set('mod-msgs', msgs)

    const all = store.getMsgs('mod-msgs')
    expect(all).toHaveLength(12)
    expect(all[0]!.content).toBe('msg 0')
    expect(all[11]!.content).toBe('msg 11')
  })

  it('ensureStatusListener: push events update runningAgents Map (including stopped)', () => {
    const mock = makeMock()
    const store = useAgentStore()
    store.ensureStatusListener()

    triggerStatus(mock, { name: 'agent-a', status: 'streaming' })
    triggerStatus(mock, { name: 'agent-b', status: 'idle' })

    expect(store.runningAgents.size).toBe(2)
    expect(store.runningAgents.get('agent-a')).toBe('streaming')
    expect(store.runningAgents.get('agent-b')).toBe('idle')

    triggerStatus(mock, { name: 'agent-a', status: 'stopped' })
    expect(store.runningAgents.has('agent-a')).toBe(false)
    expect(store.runningAgents.get('agent-b')).toBe('idle')
    expect(store.runningAgents.size).toBe(1)
  })

  it('cross-context: event appends to correct moduleName', () => {
    const mock = makeMock()
    const store = useAgentStore()
    store.ensureCrossContextListener()

    triggerCrossContext(mock, {
      moduleName: 'target-module',
      crossModule: 'other-module',
      direction: 'received',
      phase: 'request',
      content: 'Cross-context message from another module',
      time: '12:00:00',
    })

    const msgs = store.getMsgs('target-module')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('cross')
    expect(msgs[0]!.moduleName).toBe('target-module')
    expect(msgs[0]!.crossModule).toBe('other-module')
    expect(msgs[0]!.crossDirection).toBe('received')
    expect(msgs[0]!.crossPhase).toBe('request')
    expect(msgs[0]!.content).toBe('Cross-context message from another module')
  })

  it('restoreContext: loads from IPC when contextMap is empty', async () => {
    const mock = makeMock()
    const msgs: ChatMsg[] = [
      {
        id: '1', role: 'user', content: 'Q1', thinking: '', tools: '',
        time: '10:00', status: 'sent', moduleName: 'mod-r', agentCmd: '',
      },
    ]
    mock.getContext = vi.fn().mockResolvedValue(msgs)
    ;(globalThis as any).window.moduleAgent = mock

    const store = useAgentStore()
    await store.restoreContext('mod-r')

    expect(mock.getContext).toHaveBeenCalledWith('mod-r')
    expect(store.getMsgs('mod-r')).toHaveLength(1)
    expect(store.getMsgs('mod-r')[0]!.content).toBe('Q1')
  })

  it('restoreContext: skips when contextMap already has data', async () => {
    const mock = makeMock()
    mock.getContext = vi.fn().mockResolvedValue([])
    ;(globalThis as any).window.moduleAgent = mock

    const store = useAgentStore()
    store.contextMap.set('mod-skip', [{ id: 'x', role: 'user', content: 'existing', thinking: '', tools: '', time: '10:00', status: 'sent', moduleName: 'mod-skip', agentCmd: '' }])

    await store.restoreContext('mod-skip')
    expect(mock.getContext).not.toHaveBeenCalled()
  })

  it('clearContext: calls IPC and clears local map', async () => {
    const mock = makeMock()
    mock.clearContext = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).window.moduleAgent = mock

    const store = useAgentStore()
    store.contextMap.set('mod-clr', [{ id: 'x', role: 'user', content: 'test', thinking: '', tools: '', time: '10:00', status: 'sent', moduleName: 'mod-clr', agentCmd: '' }])

    await store.clearContext('mod-clr')
    expect(mock.clearContext).toHaveBeenCalledWith('mod-clr')
    expect(store.getMsgs('mod-clr')).toHaveLength(0)
  })

  it('clearAllContexts: calls IPC and clears all local state', async () => {
    const mock = makeMock()
    mock.clearAllContexts = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).window.moduleAgent = mock

    const store = useAgentStore()
    store.contextMap.set('mod-a', [{ id: '1', role: 'user', content: 'a', thinking: '', tools: '', time: '10:00', status: 'sent', moduleName: 'mod-a', agentCmd: '' }])
    store.contextMap.set('mod-b', [{ id: '2', role: 'agent', content: 'b', thinking: '', tools: '', time: '10:01', status: 'completed', moduleName: 'mod-b', agentCmd: '' }])
    store.selectedModuleName = 'mod-a'

    await store.clearAllContexts()
    expect(mock.clearAllContexts).toHaveBeenCalled()
    expect(store.contextMap.size).toBe(0)
    expect(store.selectedModuleName).toBeNull()
  })
})
