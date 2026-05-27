import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG_ENTRY, DEFAULT_WORKSPACE_CONFIG, DEFAULT_CONFIG } from '../defaults'

describe('Defaults (new format)', () => {
  // 1. DEFAULT_CONFIG_ENTRY has projectPath field
  it('has projectPath field with default value "."', () => {
    // RED: current DEFAULT_CONFIG_ENTRY still lacks projectPath
    expect(DEFAULT_CONFIG_ENTRY.projectPath).toBeDefined()
    expect(DEFAULT_CONFIG_ENTRY.projectPath).toBe('.')
  })

  // 2. DEFAULT_CONFIG_ENTRY has NO old fields
  it('has no old fields (codeSource, workspace, modulesPath)', () => {
    // RED: current DEFAULT_CONFIG_ENTRY still has codeSource, workspace, modulesPath
    expect(DEFAULT_CONFIG_ENTRY).not.toHaveProperty('codeSource')
    expect(DEFAULT_CONFIG_ENTRY).not.toHaveProperty('modulesPath')
    expect(DEFAULT_CONFIG_ENTRY).not.toHaveProperty('workspace')
  })

  // 3. Preserves agent config
  it('preserves agent config (command and args)', () => {
    expect(DEFAULT_CONFIG_ENTRY.agents.default.command).toBe('opencode')
    expect(DEFAULT_CONFIG_ENTRY.agents.default.args).toEqual(['acp'])
  })

  // 4. Preserves name field
  it('preserves name field with value "default"', () => {
    expect(DEFAULT_CONFIG_ENTRY.name).toBe('default')
  })

  // 5. DEFAULT_WORKSPACE_CONFIG wraps the entry
  it('wraps entry in DEFAULT_WORKSPACE_CONFIG', () => {
    expect(DEFAULT_WORKSPACE_CONFIG.configs).toHaveLength(1)
    expect(DEFAULT_WORKSPACE_CONFIG.defaultConfig).toBe('default')
  })

  // 6. DEFAULT_CONFIG alias for backward compat
  it('DEFAULT_CONFIG points to same object as DEFAULT_CONFIG_ENTRY', () => {
    expect(DEFAULT_CONFIG).toBe(DEFAULT_CONFIG_ENTRY)
  })

  // 7. Preserves exclude as empty array
  it('preserves exclude field as empty array', () => {
    expect(DEFAULT_CONFIG_ENTRY.exclude).toEqual([])
  })
})
