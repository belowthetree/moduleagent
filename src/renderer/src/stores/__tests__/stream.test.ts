import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAgentStore } from '../agent'
import { createMockModuleAgentApi, triggerStream } from '../../__mocks__/moduleAgent'

function setup() {
  const mock = createMockModuleAgentApi()
  ;(globalThis as any).window.moduleAgent = mock
  const store = useAgentStore()
  store.ensureStreamListener()
  return { mock, store }
}

describe('stream composable', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('agent_message_chunk → reply', () => {
    const { mock, store } = setup()

    triggerStream(mock, {
      moduleName: 'mod1',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: 'Hello from agent' } },
    })

    const st = store.getStreamState('mod1')
    expect(st.reply).toBe('Hello from agent')
    expect(st.sections.reply).toBe(true)
    expect(st.thinking).toBe('')
    expect(st.tools).toBe('')
  })

  it('agent_thought_chunk → thinking', () => {
    const { mock, store } = setup()

    triggerStream(mock, {
      moduleName: 'mod2',
      update: 'agent_thought_chunk',
      data: { content: { type: 'text', text: 'Let me think about this...' } },
    })

    const st = store.getStreamState('mod2')
    expect(st.thinking).toBe('Let me think about this...')
    expect(st.sections.thinking).toBe(true)
    expect(st.reply).toBe('')
    expect(st.tools).toBe('')
  })

  it('tool_call → tools', () => {
    const { mock, store } = setup()

    triggerStream(mock, {
      moduleName: 'mod3',
      update: 'tool_call',
      data: { title: 'read_file', toolCallId: 'tc_001', status: 'completed' },
    })

    const st = store.getStreamState('mod3')
    expect(st.tools).toContain('[工具调用: read_file | completed]')
    expect(st.sections.tools).toBe(true)
    expect(st.reply).toBe('')
  })

  it('multi-chunk accumulation across types', () => {
    const { mock, store } = setup()

    triggerStream(mock, {
      moduleName: 'mod4',
      update: 'agent_thought_chunk',
      data: { content: { type: 'text', text: 'Analyzing...' } },
    })
    triggerStream(mock, {
      moduleName: 'mod4',
      update: 'tool_call',
      data: { title: 'search', toolCallId: 'tc_s', status: 'running' },
    })
    triggerStream(mock, {
      moduleName: 'mod4',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: 'Here is the answer.' } },
    })
    triggerStream(mock, {
      moduleName: 'mod4',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: ' Hope that helps!' } },
    })

    const st = store.getStreamState('mod4')
    expect(st.thinking).toBe('Analyzing...')
    expect(st.tools).toContain('[工具调用: search | running]')
    expect(st.reply).toBe('Here is the answer. Hope that helps!')
    expect(st.sections.thinking).toBe(true)
    expect(st.sections.tools).toBe(true)
    expect(st.sections.reply).toBe(true)
  })

  it('finishStream: clears streamState and persists to context', () => {
    const { mock, store } = setup()

    triggerStream(mock, {
      moduleName: 'mod5',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: 'Final answer.' } },
    })

    expect(store.streamState.get('mod5')).toBeDefined()

    store.finishStream('mod5')

    expect(store.streamState.get('mod5')).toBeUndefined()

    const msgs = store.getMsgs('mod5')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('agent')
    expect(msgs[0]!.content).toBe('Final answer.')
    expect(msgs[0]!.status).toBe('completed')
  })

  it('stopStream: resets stream state', () => {
    const { mock, store } = setup()

    triggerStream(mock, {
      moduleName: 'mod6',
      update: 'agent_message_chunk',
      data: { content: { type: 'text', text: 'In progress...' } },
    })

    expect(store.streamState.get('mod6')).toBeDefined()

    store.stopStream('mod6')

    expect(store.streamState.get('mod6')).toBeUndefined()
    expect(localStorage.getItem('stream_snapshot')).toBeNull()
  })
})
