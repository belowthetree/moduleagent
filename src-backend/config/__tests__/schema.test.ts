import { describe, it, expect } from 'vitest'
import { ProjectConfigSchema, ConfigEntrySchema, WorkspaceConfigSchema } from '../schema'

describe('ProjectConfigSchema (new format)', () => {
  // 1. Valid new format: projectPath replaces codeSource/workspace/modulesPath
  it('accepts valid new format with projectPath', () => {
    const input = {
      projectPath: '/test/proj',
      agents: { default: { command: 'test' } },
      exclude: [],
    }
    const result = ProjectConfigSchema.safeParse(input)
    // RED: current schema still expects workspace + codeSource → fails
    expect(result.success).toBe(true)
  })

  // 2. Old fields (codeSource, workspace, modulesPath) should be rejected
  it('rejects old fields (codeSource, workspace, modulesPath)', () => {
    const input = {
      codeSource: { type: 'local' as const, path: '/x' },
      workspace: { path: '/y' },
      modulesPath: '/z',
      agents: { default: { command: 'test' } },
      exclude: [],
    }
    const result = ProjectConfigSchema.safeParse(input)
    // RED: current schema still accepts old fields → passes but should fail
    expect(result.success).toBe(false)
  })

  // 3. All old fields together should be rejected
  it('rejects all old fields together', () => {
    const input = {
      codeSource: { type: 'git' as const, url: 'https://example.com/repo.git' },
      workspace: { path: '/ws' },
      modulesPath: '/modules',
      agents: { default: { command: 'agent' } },
      exclude: ['node_modules'],
    }
    const result = ProjectConfigSchema.safeParse(input)
    // RED: current schema still accepts old fields → passes but should fail
    expect(result.success).toBe(false)
  })

  // 4. projectPath is required
  it('requires projectPath field', () => {
    const input = {
      agents: { default: { command: 'test' } },
      exclude: [],
    }
    const result = ProjectConfigSchema.safeParse(input)
    // RED: current schema rejects due to missing workspace/codeSource, not projectPath
    expect(result.success).toBe(false)
  })

  // 5. projectPath must be a string
  it('rejects projectPath with wrong type (number)', () => {
    const input = {
      projectPath: 123,
      agents: { default: { command: 'test' } },
      exclude: [],
    }
    const result = ProjectConfigSchema.safeParse(input)
    // RED: current schema rejects due to missing workspace/codeSource, not type error
    expect(result.success).toBe(false)
  })

  // 6. ConfigEntrySchema extends with name field
  it('accepts ConfigEntrySchema with name and projectPath', () => {
    const input = {
      name: 'test',
      projectPath: '.',
      agents: { default: { command: 'agent' } },
      exclude: [],
    }
    const result = ConfigEntrySchema.safeParse(input)
    // RED: current schema still expects workspace + codeSource → fails
    expect(result.success).toBe(true)
  })

  // 7. WorkspaceConfigSchema wraps array of configs
  it('accepts WorkspaceConfigSchema with configs array', () => {
    const input = {
      configs: [
        {
          name: 'default',
          projectPath: '.',
          agents: { default: { command: 'agent' } },
          exclude: [],
        },
      ],
      defaultConfig: 'default',
    }
    const result = WorkspaceConfigSchema.safeParse(input)
    // RED: current schema expects workspace + codeSource inside each config → fails
    expect(result.success).toBe(true)
  })

  // 8. Empty exclude array is valid
  it('accepts empty exclude array', () => {
    const input = {
      projectPath: '/proj',
      agents: { default: { command: 'test' } },
      exclude: [],
    }
    const result = ProjectConfigSchema.safeParse(input)
    // RED: same as test 1 — missing workspace + codeSource
    expect(result.success).toBe(true)
  })

  // 9. Optional modules agent works (both with and without modules)
  it('accepts config with optional modules agent', () => {
    const input = {
      projectPath: '/proj',
      agents: { default: { command: 'test' }, modules: {} },
      exclude: [],
    }
    const result = ProjectConfigSchema.safeParse(input)
    // RED: same as test 1 — missing workspace + codeSource
    expect(result.success).toBe(true)
  })
})
