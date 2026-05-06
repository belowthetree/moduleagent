import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs-extra'
import { ConfigLoader } from '../ConfigLoader'
import { DEFAULT_WORKSPACE_CONFIG } from '../defaults'
import { defaultLogger } from '../../core/Logger'

vi.mock('fs-extra')

describe('ConfigLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('load()', () => {
    // 1. Valid new-format config is parsed correctly
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
      vi.mocked(fs.pathExists).mockResolvedValue(true)
      vi.mocked(fs.readJson).mockResolvedValue(mockConfig)

      const result = await ConfigLoader.load('/test')

      expect(result.configs[0]).toHaveProperty('projectPath', '/proj')
    })

    // 2. Old-format config is rejected (falls back to defaults, NOT migrated)
    it('rejects old-format config and falls back to defaults with warning', async () => {
      const oldConfig = {
        agents: { default: { command: 'test' } },
        exclude: [],
        workspace: { path: '/ws' },
        codeSource: { type: 'local' as const, path: '/src' },
        modulesPath: '/mod',
      }
      vi.mocked(fs.pathExists).mockResolvedValue(true)
      vi.mocked(fs.readJson).mockResolvedValue(oldConfig)
      const warnSpy = vi.spyOn(defaultLogger, 'warn')

      const result = await ConfigLoader.load('/test')

      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid config format')
      )
      // ConfigLoader must NOT attempt to migrate old config
      expect(vi.mocked(fs.writeJson)).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    // 3. No config file → defaults
    it('returns DEFAULT_WORKSPACE_CONFIG when no config file exists', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false)

      const result = await ConfigLoader.load('/test')

      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
    })

    // 4. Invalid JSON in config file → fallback to defaults
    it('falls back to defaults when config file has invalid JSON', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true)
      vi.mocked(fs.readJson).mockRejectedValue(new Error('invalid JSON'))

      const result = await ConfigLoader.load('/test')

      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
    })
  })

  describe('loadOrCreate()', () => {
    // 5. Creates file when missing and returns defaults
    it('creates config file when none exists and returns defaults', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false)

      const result = await ConfigLoader.loadOrCreate('/test')

      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
        expect.stringContaining('.module-agent.json'),
        DEFAULT_WORKSPACE_CONFIG,
        { spaces: 2 }
      )
      expect(result).toEqual(DEFAULT_WORKSPACE_CONFIG)
    })
  })

  describe('getDefaultConfig()', () => {
    // 6. Finds the named default config
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

    // 7. Falls back to first config when defaultConfig name not found
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
