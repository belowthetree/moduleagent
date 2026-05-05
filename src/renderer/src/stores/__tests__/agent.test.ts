import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAgentStore } from '../agent'
import { createMockModuleAgentApi, triggerStream, triggerCrossContext, triggerStatus } from '../../__mocks__/moduleAgent'
import type { ChatMsg } from '../../../../types/preload'

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

  it('sendMessage flow: user msg added to contextMap', async () => {
    const store = useAgentStore()
    await store.sendMessage('module-1', 'Hello world', '/cwd')

    const msgs = store.getMsgs('module-1')
    expect(msgs.length).toBeGreaterThanOrEqual(1)
    const userMsg = msgs.find((m: ChatMsg) => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content).toBe('Hello world')
    expect(userMsg!.moduleName).toBe('module-1')
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

  it('stream chunk accumulation: 3 message chunks → concatenated reply', () => {
    const mock = makeMock()
    const store = useAgentStore()
    store.ensureStreamListener()

    triggerStream(mock, {
      moduleName: 'mod-stream',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: 'Hello' } },
    })
    triggerStream(mock, {
      moduleName: 'mod-stream',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: ' ' } },
    })
    triggerStream(mock, {
      moduleName: 'mod-stream',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: 'World' } },
    })

    const st = store.getStreamState('mod-stream')
    expect(st.reply).toBe('Hello World')
  })

  it('saveStreamSnapshot / restoreStreamSnapshot roundtrip', () => {
    const store = useAgentStore()
    const st = store.getStreamState('mod-roundtrip')
    st.reply = 'Snapshot reply content'
    st.thinking = 'Snapshot thinking'
    st.tools = 'tool log'
    st.finished = true

    store.saveStreamSnapshot()

    const raw = localStorage.getItem('stream_snapshot')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].moduleName).toBe('mod-roundtrip')
    expect(parsed[0].reply).toBe('Snapshot reply content')

    const msg = store.restoreStreamSnapshot('mod-roundtrip')
    expect(msg).not.toBeNull()
    expect(msg!.content).toBe('Snapshot reply content')
    expect(msg!.thinking).toBe('Snapshot thinking')
    expect(msg!.tools).toBe('tool log')
    expect(msg!.status).toBe('completed')
  })

  it('saveContext / loadContext roundtrip (localStorage)', () => {
    const store = useAgentStore()
    const msgs: ChatMsg[] = [
      {
        id: '1', role: 'user', content: 'Q1', thinking: '', tools: '',
        time: '10:00', status: 'sent', moduleName: 'mod-ctx', agentCmd: 'test',
      },
      {
        id: '2', role: 'agent', content: 'A1', thinking: '...', tools: '',
        time: '10:01', status: 'completed', moduleName: 'mod-ctx', agentCmd: 'test',
      },
    ]
    store.contextMap.set('mod-ctx', [...msgs])
    store.saveContext('mod-ctx')

    const loaded = store.loadContext('mod-ctx')
    expect(loaded).toHaveLength(2)
    expect(loaded[0]!.id).toBe('1')
    expect(loaded[0]!.content).toBe('Q1')
    expect(loaded[1]!.role).toBe('agent')
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
})
