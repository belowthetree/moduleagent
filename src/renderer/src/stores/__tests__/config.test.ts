// ---------------------------------------------------------------------------
// renderer/src/stores/__tests__/config.test.ts — Config Store 单元测试
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConfigStore } from '../config'
import { createMockModuleAgentApi } from '../../__mocks__/moduleAgent'

describe('useConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    const mock = createMockModuleAgentApi()
    ;(globalThis as any).window.moduleAgent = mock
  })

  it('initial state: all refs have default values', () => {
    const store = useConfigStore()
    expect(store.provider).toBe('anthropic')
    expect(store.apiKey).toBe('')
    expect(store.model).toBe('')
    expect(store.projectPath).toBe('')
  })

  it('loadFromLocalStorage: preset values restored, missing keys fall back to defaults', () => {
    localStorage.setItem('provider', 'openai')
    localStorage.setItem('apiKey', 'sk-test123')
    localStorage.setItem('model', 'gpt-4o')
    localStorage.setItem('lastProject', '/home/user/project')

    const store = useConfigStore()
    store.loadFromLocalStorage()

    expect(store.provider).toBe('openai')
    expect(store.apiKey).toBe('sk-test123')
    expect(store.model).toBe('gpt-4o')
    expect(store.projectPath).toBe('/home/user/project')
  })

  it('saveToLocalStorage: store writes to correct keys', () => {
    const store = useConfigStore()
    store.provider = 'deepseek'
    store.apiKey = 'sk-key'
    store.model = 'deepseek-chat'
    store.projectPath = '/tmp/proj'

    store.saveToLocalStorage()

    expect(localStorage.getItem('provider')).toBe('deepseek')
    expect(localStorage.getItem('apiKey')).toBe('sk-key')
    expect(localStorage.getItem('model')).toBe('deepseek-chat')
    expect(localStorage.getItem('lastProject')).toBe('/tmp/proj')
  })

  it('saveToProject: mock saveAgentConfig called with right args', async () => {
    const spy = vi.spyOn(window.moduleAgent, 'saveAgentConfig')

    const store = useConfigStore()
    store.provider = 'openai'
    store.apiKey = 'sk-test'
    store.model = 'gpt-4o'
    store.projectPath = '/my/project/path'

    const result = await store.saveToProject('/project/root')

    expect(result.success).toBe(true)
    expect(spy).toHaveBeenCalledWith(
      '/project/root',
      'openai',
      'sk-test',
      '',
      'gpt-4o',
      '/my/project/path',
      true,
    )

    spy.mockRestore()
  })

  it('loadFromProject: mock getAgentConfig maps result to refs', async () => {
    vi.spyOn(window.moduleAgent, 'getAgentConfig').mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-4-20250514',
      projectPath: '/project/root',
    })

    const store = useConfigStore()
    await store.loadFromProject('/project/root')

    expect(store.provider).toBe('anthropic')
    expect(store.apiKey).toBe('sk-ant')
    expect(store.model).toBe('claude-sonnet-4-20250514')
    expect(store.projectPath).toBe('/project/root')
  })

  it('corrupt config from project: getAgentConfig throws -> promise rejects gracefully', async () => {
    vi.spyOn(window.moduleAgent, 'getAgentConfig').mockRejectedValue(new Error('Corrupt config file'))

    const store = useConfigStore()
    await expect(store.loadFromProject('/bad/project')).rejects.toThrow('Corrupt config file')
    expect(store.provider).toBe('anthropic')
    expect(store.projectPath).toBe('')
  })
})
