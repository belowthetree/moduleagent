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
    expect(store.workspacePath).toBe('')
    expect(store.projectPath).toBe('')
    expect(store.codeSourceType).toBe('local')
    expect(store.codeSourcePath).toBe('')
    expect(store.codeSourceUrl).toBe('')
    expect(store.codeSourceBranch).toBe('')
  })

  it('loadFromLocalStorage: preset values restored, missing keys fall back to defaults', () => {
    localStorage.setItem('agentCmd', 'custom-cmd')
    localStorage.setItem('agentArgs', '--verbose --model gpt4')
    localStorage.setItem('lastWorkspace', '/home/user/workspace')
    localStorage.setItem('codeSourceType', 'git')
    localStorage.setItem('codeSourceUrl', 'https://github.com/example/repo')

    const store = useConfigStore()
    store.loadFromLocalStorage()

    expect(store.agentCmd).toBe('custom-cmd')
    expect(store.agentArgs).toBe('--verbose --model gpt4')
    expect(store.workspacePath).toBe('/home/user/workspace')
    expect(store.codeSourceType).toBe('git')
    expect(store.codeSourceUrl).toBe('https://github.com/example/repo')
    expect(store.codeSourceBranch).toBe('')
    expect(store.projectPath).toBe('')
    expect(store.codeSourcePath).toBe('')
  })

  it('saveToLocalStorage: store writes to correct keys', () => {
    const store = useConfigStore()
    store.agentCmd = 'my-agent'
    store.agentArgs = 'serve'
    store.workspacePath = '/tmp/ws'
    store.projectPath = '/tmp/proj'
    store.codeSourceType = 'git'
    store.codeSourcePath = '/code'
    store.codeSourceUrl = 'git@github.com:foo/bar.git'
    store.codeSourceBranch = 'develop'

    store.saveToLocalStorage()

    expect(localStorage.getItem('agentCmd')).toBe('my-agent')
    expect(localStorage.getItem('agentArgs')).toBe('serve')
    expect(localStorage.getItem('lastWorkspace')).toBe('/tmp/ws')
    expect(localStorage.getItem('lastProject')).toBe('/tmp/proj')
    expect(localStorage.getItem('codeSourceType')).toBe('git')
    expect(localStorage.getItem('codeSourcePath')).toBe('/code')
    expect(localStorage.getItem('codeSourceUrl')).toBe('git@github.com:foo/bar.git')
    expect(localStorage.getItem('codeSourceBranch')).toBe('develop')
  })

  it('saveToProject: mock saveAgentConfig called with right args', async () => {
    const spy = vi.spyOn(window.moduleAgent, 'saveAgentConfig')

    const store = useConfigStore()
    store.agentCmd = 'claude'
    store.agentArgs = 'acp --model sonnet'
    store.codeSourceType = 'local'
    store.codeSourcePath = '/my/local/code'

    const result = await store.saveToProject('/project/root')

    expect(result.success).toBe(true)
    expect(spy).toHaveBeenCalledWith(
      '/project/root',
      'claude',
      ['acp', '--model', 'sonnet'],
      { type: 'local', path: '/my/local/code' }
    )

    spy.mockRestore()
  })

  it('loadFromProject: mock getAgentConfig maps result to refs', async () => {
    vi.spyOn(window.moduleAgent, 'getAgentConfig').mockResolvedValue({
      command: 'custom-agent',
      args: ['--verbose', '--debug'],
      codeSource: { type: 'git', url: 'https://git.example.com/repo', branch: 'feat/x' },
      modulesPath: '/custom/modules',
    })

    const store = useConfigStore()
    await store.loadFromProject('/project/path')

    expect(store.agentCmd).toBe('custom-agent')
    expect(store.agentArgs).toBe('--verbose --debug')
    expect(store.codeSourceType).toBe('git')
    expect(store.codeSourceUrl).toBe('https://git.example.com/repo')
    expect(store.codeSourceBranch).toBe('feat/x')
    expect(store.projectPath).toBe('/project/path')
  })

  it('corrupt config from project: getAgentConfig throws → promise rejects gracefully', async () => {
    vi.spyOn(window.moduleAgent, 'getAgentConfig').mockRejectedValue(new Error('Corrupt config file'))

    const store = useConfigStore()
    await expect(store.loadFromProject('/bad/project')).rejects.toThrow('Corrupt config file')
    expect(store.agentCmd).toBe('opencode')
    expect(store.projectPath).toBe('')
  })
})
