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
    expect(store.agentCmd).toBe('opencode')
    expect(store.agentArgs).toBe('acp')
    expect(store.projectPath).toBe('')
  })

  it('loadFromLocalStorage: preset values restored, missing keys fall back to defaults', () => {
    localStorage.setItem('agentCmd', 'custom-cmd')
    localStorage.setItem('agentArgs', '--verbose --model gpt4')
    localStorage.setItem('lastProject', '/home/user/project')

    const store = useConfigStore()
    store.loadFromLocalStorage()

    expect(store.agentCmd).toBe('custom-cmd')
    expect(store.agentArgs).toBe('--verbose --model gpt4')
    expect(store.projectPath).toBe('/home/user/project')
  })

  it('loadFromLocalStorage: migrates old lastWorkspace key to lastProject', () => {
    localStorage.setItem('lastWorkspace', '/legacy/workspace')

    const store = useConfigStore()
    store.loadFromLocalStorage()

    expect(store.projectPath).toBe('/legacy/workspace')
    expect(localStorage.getItem('lastWorkspace')).toBeNull()
    expect(localStorage.getItem('lastProject')).toBe('/legacy/workspace')
  })

  it('saveToLocalStorage: store writes to correct keys', () => {
    const store = useConfigStore()
    store.agentCmd = 'my-agent'
    store.agentArgs = 'serve'
    store.projectPath = '/tmp/proj'

    store.saveToLocalStorage()

    expect(localStorage.getItem('agentCmd')).toBe('my-agent')
    expect(localStorage.getItem('agentArgs')).toBe('serve')
    expect(localStorage.getItem('lastProject')).toBe('/tmp/proj')
    expect(localStorage.getItem('lastWorkspace')).toBeNull()
    expect(localStorage.getItem('codeSourceType')).toBeNull()
  })

  it('saveToProject: mock saveAgentConfig called with right args', async () => {
    const spy = vi.spyOn(window.moduleAgent, 'saveAgentConfig')

    const store = useConfigStore()
    store.agentCmd = 'claude'
    store.agentArgs = 'acp --model sonnet'
    store.projectPath = '/my/project/path'

    const result = await store.saveToProject('/project/root')

    expect(result.success).toBe(true)
    expect(spy).toHaveBeenCalledWith(
      '/project/root',
      'claude',
      ['acp', '--model', 'sonnet'],
      '/my/project/path',
      true,
    )

    spy.mockRestore()
  })

  it('loadFromProject: mock getAgentConfig maps result to refs', async () => {
    vi.spyOn(window.moduleAgent, 'getAgentConfig').mockResolvedValue({
      command: 'custom-agent',
      args: ['--verbose', '--debug'],
      projectPath: '/project/root',
    })

    const store = useConfigStore()
    await store.loadFromProject('/project/root')

    expect(store.agentCmd).toBe('custom-agent')
    expect(store.agentArgs).toBe('--verbose --debug')
    expect(store.projectPath).toBe('/project/root')
  })

  it('corrupt config from project: getAgentConfig throws → promise rejects gracefully', async () => {
    vi.spyOn(window.moduleAgent, 'getAgentConfig').mockRejectedValue(new Error('Corrupt config file'))

    const store = useConfigStore()
    await expect(store.loadFromProject('/bad/project')).rejects.toThrow('Corrupt config file')
    expect(store.agentCmd).toBe('opencode')
    expect(store.projectPath).toBe('')
  })
})
