// ---------------------------------------------------------------------------
// config/__tests__/ConfigLoader.test.ts — ConfigLoader 单元测试
// 测试配置文件加载、格式兼容、默认值回退、创建行为
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs-extra'
import { ConfigLoader } from '../ConfigLoader'
import { DEFAULT_WORKSPACE_CONFIG } from '../defaults'
import { defaultLogger } from '../../core/Logger'

vi.mock('fs-extra')

let mockSearchResult: { config: unknown; filepath: string; isEmpty: boolean } | null = null

vi.mock('../../core/ConfigPaths.js', () => ({
  configExplorer: {
    search: vi.fn().mockImplementation(() => mockSearchResult),
  },
}))

describe('ConfigLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchResult = null
  })

  describe('load()', () => {
    it('returns parsed config with projectPath when loading valid new-format config', async () => {
      const mockConfig = {
        configs: [
          {
            name: 'd',
            projectPath: '/proj',
            agents: { default: { command: 'c' } },
            exclude: [],
          },
        ],
        defaultConfig: 'd',
      }
      mockSearchResult = { config: mockConfig, filepath: '/test/.module-agent.json', isEmpty: false }

      const result = await ConfigLoader.load('/test')

      expect(result.configs[0]).toHaveProperty('projectPath', '/proj')
    })

    it('rejects old-format config and falls back to defaults with warning', async () => {
      const oldConfig = {
        agents: { default: { command: 'test' } },
        exclude: [],
        workspace: { path: '/ws' },
        codeSource: { type: 'local' as const, path: '/src' },
        modulesPath: '/mod',
      }
      mockSearchResult = { config: oldConfig, filepath: '/test/.module-agent.json', isEmpty: false }
      const warnSpy = vi.spyOn(defaultLogger, 'warn')

      const result = await ConfigLoader.load('/test')

      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid config format'),
      )
      expect(vi.mocked(fs.writeJson)).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('returns DEFAULT_WORKSPACE_CONFIG when no config file exists', async () => {
      mockSearchResult = null

      const result = await ConfigLoader.load('/test')

      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
    })

    it('falls back to defaults when config search throws', async () => {
      const { configExplorer } = await import('../../core/ConfigPaths.js')
      vi.mocked(configExplorer.search).mockRejectedValueOnce(new Error('read error'))

      const result = await ConfigLoader.load('/test')

      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
    })
  })

  describe('loadWithStatus()', () => {
    it('exposes readable error details when zod validation fails', async () => {
      const invalidConfig = {
        configs: [{ name: 42, agents: { default: {} }, exclude: 'not-an-array' }],
        defaultConfig: 'd',
      }
      mockSearchResult = { config: invalidConfig, filepath: '/test/.module-agent.json', isEmpty: false }
      const errorSpy = vi.spyOn(defaultLogger, 'error')

      const { config, error } = await ConfigLoader.loadWithStatus('/test')

      expect(config).toEqual(DEFAULT_WORKSPACE_CONFIG)
      expect(error).toBeDefined()
      expect(error).toContain('校验失败')
      expect(error).toContain('.module-agent.json')
      // zod issue 详情应写入 error 日志
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Config validation failed'),
      )
      errorSpy.mockRestore()
    })

    it('exposes error when config search throws', async () => {
      const { configExplorer } = await import('../../core/ConfigPaths.js')
      vi.mocked(configExplorer.search).mockRejectedValueOnce(new Error('read error'))

      const { config, error } = await ConfigLoader.loadWithStatus('/test')

      expect(config).toEqual(DEFAULT_WORKSPACE_CONFIG)
      expect(error).toContain('read error')
    })

    it('returns no error for valid config', async () => {
      const mockConfig = {
        configs: [
          {
            name: 'd',
            projectPath: '/proj',
            agents: { default: { command: 'c' } },
            exclude: [],
          },
        ],
        defaultConfig: 'd',
      }
      mockSearchResult = { config: mockConfig, filepath: '/test/.module-agent.json', isEmpty: false }

      const { config, error } = await ConfigLoader.loadWithStatus('/test')

      expect(error).toBeUndefined()
      expect(config.configs[0]).toHaveProperty('projectPath', '/proj')
    })
  })

  describe('loadOrCreate()', () => {
    it('creates config file when none exists and returns defaults', async () => {
      mockSearchResult = null

      const result = await ConfigLoader.loadOrCreate('/test')

      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
        expect.stringContaining('.module-agent.json'),
        DEFAULT_WORKSPACE_CONFIG,
        { spaces: 2 },
      )
      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
    })
  })

  describe('getDefaultConfig()', () => {
    it('returns the config matching defaultConfig name', () => {
      const workspace = {
        configs: [
          { name: 'a', agents: { default: { command: 'c' } }, exclude: [] },
          { name: 'b', agents: { default: { command: 'd' } }, exclude: [] },
        ],
        defaultConfig: 'b',
      }

      const result = ConfigLoader.getDefaultConfig(workspace as any)

      expect(result.name).toBe('b')
    })

    it('falls back to first config when defaultConfig name is not found', () => {
      const workspace = {
        configs: [
          { name: 'a', agents: { default: { command: 'c' } }, exclude: [] },
          { name: 'b', agents: { default: { command: 'd' } }, exclude: [] },
        ],
        defaultConfig: 'nonexistent',
      }

      const result = ConfigLoader.getDefaultConfig(workspace as any)

      expect(result.name).toBe('a')
    })
  })
})
