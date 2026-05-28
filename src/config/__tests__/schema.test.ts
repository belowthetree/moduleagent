import { describe, expect, it } from 'vitest';
import {
  ProjectConfigSchema,
  WorkspaceConfigSchema,
  RoleConfigSchema,
  ConfigEntrySchema,
} from '../schema.js';

describe('ProjectConfigSchema', () => {
  it('accepts a minimal valid config', () => {
    const result = ProjectConfigSchema.safeParse({
      agents: { default: { command: 'opencode' } },
      exclude: [],
      projectPath: '.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts config with modules override', () => {
    const result = ProjectConfigSchema.safeParse({
      agents: {
        default: { command: 'opencode' },
        modules: { 'module-a': { command: 'custom-agent' } },
      },
      exclude: ['node_modules'],
      projectPath: '/home/project',
    });
    expect(result.success).toBe(true);
  });

  it('rejects config missing agents.default', () => {
    const result = ProjectConfigSchema.safeParse({
      agents: {},
      exclude: [],
      projectPath: '.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type for exclude', () => {
    const result = ProjectConfigSchema.safeParse({
      agents: { default: { command: 'echo' } },
      exclude: 'not-an-array',
      projectPath: '.',
    });
    expect(result.success).toBe(false);
  });
});

describe('ConfigEntrySchema', () => {
  it('requires a name field', () => {
    const result = ConfigEntrySchema.safeParse({
      agents: { default: { command: 'echo' } },
      exclude: [],
      projectPath: '.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid config entry with name', () => {
    const result = ConfigEntrySchema.safeParse({
      name: 'my-config',
      agents: { default: { command: 'echo' } },
      exclude: [],
      projectPath: '.',
    });
    expect(result.success).toBe(true);
  });
});

describe('RoleConfigSchema', () => {
  it('accepts a minimal role config', () => {
    const result = RoleConfigSchema.safeParse({
      name: 'test-role',
      agents: { default: { command: 'echo' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects role with empty name', () => {
    const result = RoleConfigSchema.safeParse({
      name: '',
      agents: { default: { command: 'echo' } },
    });
    expect(result.success).toBe(false);
  });

  it('fills defaults for optional fields', () => {
    const result = RoleConfigSchema.safeParse({
      name: 'test',
      agents: { default: { command: 'echo' } },
    });
    if (result.success) {
      expect(result.data.visibleModulePaths).toEqual([]);
    }
  });
});

describe('WorkspaceConfigSchema', () => {
  it('accepts a valid workspace config', () => {
    const result = WorkspaceConfigSchema.safeParse({
      configs: [
        {
          name: 'default',
          agents: { default: { command: 'opencode' } },
          exclude: [],
          projectPath: '.',
        },
      ],
      defaultConfig: 'default',
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace config with roles', () => {
    const result = WorkspaceConfigSchema.safeParse({
      configs: [
        {
          name: 'default',
          agents: { default: { command: 'opencode' } },
          exclude: [],
          projectPath: '.',
        },
      ],
      defaultConfig: 'default',
      roles: [
        {
          name: 'reviewer',
          description: 'Code reviewer',
          visibleModulePaths: [],
          agents: { default: { command: 'opencode' } },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
