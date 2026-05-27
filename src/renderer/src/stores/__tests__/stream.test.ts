import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAgentStore } from '../agent'
import { createMockModuleAgentApi } from '../../__mocks__/moduleAgent'

describe('stream composable (simplified IPC flow)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('sendMessage: user msg pushed before IPC, agent msg from IPC result', async () => {
    const mock = createMockModuleAgentApi()
    ;(globalThis as any).window.moduleAgent = mock
    const store = useAgentStore()

    await store.sendMessage('mod1', 'Test message', '/cwd')

    const msgs = store.getMsgs('mod1')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.role).toBe('user')
    expect(msgs[0]!.content).toBe('Test message')
    expect(msgs[1]!.role).toBe('agent')
    expect(msgs[1]!.content).toBe('mock reply')
    expect(msgs[1]!.status).toBe('completed')
  })

  it('sendMessage: sends user msg before throwing on IPC failure', async () => {
    const mock = createMockModuleAgentApi()
    mock.sendMessage = vi.fn().mockRejectedValue(new Error('IPC failed'))
    ;(globalThis as any).window.moduleAgent = mock
    const store = useAgentStore()

    await store.sendMessage('mod2', 'Will fail', '/cwd')

    // User message should still be in context
    const msgs = store.getMsgs('mod2')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('user')
    expect(msgs[0]!.content).toBe('Will fail')
  })

  it('cancelAgent: updates executing message to interrupted', async () => {
    const mock = createMockModuleAgentApi()
    mock.cancelAgent = vi.fn().mockResolvedValue({
      accumulated: { reply: 'Partial...', thinking: '...', tools: '', finished: false, sections: { thinking: true, tools: false, reply: true } }
    })
    ;(globalThis as any).window.moduleAgent = mock
    const store = useAgentStore()

    // Simulate a currently-executing agent message
    store.getMsgs('mod3').push({
      id: 'exec-1',
      role: 'agent',
      content: '',
      thinking: '',
      tools: '',
      time: '10:00',
      status: 'executing',
      moduleName: 'mod3',
      agentCmd: '',
    })

    await store.cancelAgent('mod3')

    const msgs = store.getMsgs('mod3')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.status).toBe('interrupted')
    expect(msgs[0]!.content).toBe('Partial...')
    expect(msgs[0]!.thinking).toBe('...')
  })
})
