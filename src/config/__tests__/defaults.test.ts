// ---------------------------------------------------------------------------
// config/__tests__/defaults.test.ts — 默认配置常量测试
// 验证 DEFAULT_CONFIG、DEFAULT_CONFIG_ENTRY 等常量的完整性和 Schema 合规性
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_ENTRY,
  DEFAULT_WORKSPACE_CONFIG,
  DEFAULT_MODULE_GEN_ROLE,
} from '../defaults.js';
import { WorkspaceConfigSchema, ProjectConfigSchema } from '../schema.js';

describe('defaults', () => {
  describe('DEFAULT_CONFIG', () => {
    it('has a valid command', () => {
      expect(DEFAULT_CONFIG.agents.default.command).toBeTruthy();
    });

    it('is the same as DEFAULT_CONFIG_ENTRY (backward compat)', () => {
      expect(DEFAULT_CONFIG).toBe(DEFAULT_CONFIG_ENTRY);
    });
  });

  describe('DEFAULT_CONFIG_ENTRY', () => {
    it('has name "default"', () => {
      expect(DEFAULT_CONFIG_ENTRY.name).toBe('default');
    });

    it('has empty exclude array', () => {
      expect(DEFAULT_CONFIG_ENTRY.exclude).toEqual([]);
    });

    it('is valid per schema', () => {
      const result = ProjectConfigSchema.safeParse(DEFAULT_CONFIG_ENTRY);
      expect(result.success).toBe(true);
    });
  });

  describe('DEFAULT_WORKSPACE_CONFIG', () => {
    it('contains exactly one config entry', () => {
      expect(DEFAULT_WORKSPACE_CONFIG.configs).toHaveLength(1);
    });

    it('has defaultConfig pointing to "default"', () => {
      expect(DEFAULT_WORKSPACE_CONFIG.defaultConfig).toBe('default');
    });

    it('passes workspace schema validation', () => {
      const result = WorkspaceConfigSchema.safeParse(DEFAULT_WORKSPACE_CONFIG);
      expect(result.success).toBe(true);
    });

    it('contains the module generator role', () => {
      expect(DEFAULT_WORKSPACE_CONFIG.roles).toBeDefined();
      expect(DEFAULT_WORKSPACE_CONFIG.roles![0]?.name).toContain('模块生成');
    });
  });

  describe('DEFAULT_MODULE_GEN_ROLE', () => {
    it('has knowledgeRefs with MODULE_FORMAT.md', () => {
      const refs = DEFAULT_MODULE_GEN_ROLE.knowledgeRefs;
      expect(refs).toBeDefined();
      expect(refs!.some((r) => r.filename === 'MODULE_FORMAT.md')).toBe(true);
    });

    it('has empty visibleModulePaths', () => {
      expect(DEFAULT_MODULE_GEN_ROLE.visibleModulePaths).toEqual([]);
    });
  });
});
