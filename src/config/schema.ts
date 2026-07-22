// ---------------------------------------------------------------------------
// config/schema.ts — Zod 配置校验 Schema
// 定义所有配置结构的 Zod Schema，包括 Agent/Role/Workflow/Workspace 配置
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const AgentConfigSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  model: z.string().optional(),
  defaultMode: z.string().optional(),
  fastModel: z.string().optional(),
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  contextWindow: z.number().int().positive().optional(),
});

export const TruncationConfigSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  truncateRatio: z.number().min(0.1).max(1).optional(),
  tailTokenBudget: z.number().int().positive().optional(),
  minKeepMessages: z.number().int().min(1).optional(),
  snipRatio: z.number().min(0.1).max(1).optional(),
});

export const CompactionConfigSchema = z.object({
  enabled: z.boolean(),
  compactRatio: z.number().min(0.1).max(1).optional(),
  tailTokenBudget: z.number().int().positive().optional(),
  minIntervalMs: z.number().int().positive().optional(),
});

export const CrossModuleConfigSchema = z.object({
  maxHops: z.number().int().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

// 单条项目配置（无名称）
export const ProjectConfigSchema = z.object({
  agents: z.object({
    default: AgentConfigSchema,
    modules: z.record(z.string(), AgentConfigSchema).optional(),
  }),
  exclude: z.array(z.string()),
  projectPath: z.string(),
  sessionRound: z.number().int().min(1).default(1).optional(),
  summarization: z.object({
    enabled: z.boolean(),
  }).optional(),
  truncation: TruncationConfigSchema.optional(),
  compaction: CompactionConfigSchema.optional(),
  crossModule: CrossModuleConfigSchema.optional(),
  contextHistoryLimit: z.number().int().positive().optional(),
  progressiveDisclosure: z.boolean().optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// 带名称的配置条目（用于 configs 数组）
export const ConfigEntrySchema = ProjectConfigSchema.extend({
  name: z.string(),
});

export type ConfigEntry = z.infer<typeof ConfigEntrySchema>;

// 角色 Agent 配置
export const RoleAgentConfigSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  fastModel: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
});

export type RoleAgentConfig = z.infer<typeof RoleAgentConfigSchema>;

// 单条角色定义
export const RoleConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  visibleModulePaths: z.array(z.string()).default([]),
  agents: z.object({
    default: RoleAgentConfigSchema,
  }),
  knowledgeRefs: z.array(z.object({
    filename: z.string(),
    name: z.string(),
  })).optional(),
});

export type RoleConfig = z.infer<typeof RoleConfigSchema>;

// 顶层工作区配置，包含已命名配置的数组
export const WorkspaceConfigSchema = z.object({
  configs: z.array(ConfigEntrySchema),
  defaultConfig: z.string(),
  roles: z.array(RoleConfigSchema).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

// ---------------------------------------------------------------------------
// Workflow step schemas
// ---------------------------------------------------------------------------

export const StepAgentConfigSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  visibleModulePaths: z.array(z.string()).optional(),
  knowledgeRefs: z.array(z.object({
    filename: z.string(),
    name: z.string(),
  })).optional(),
});

export type StepAgentConfig = z.infer<typeof StepAgentConfigSchema>;

export const StepInputSchema = z.object({
  from: z.enum(['user', 'previous', 'both']).default('previous'),
  sourceStep: z.string().optional(),
});

export type StepInput = z.infer<typeof StepInputSchema>;

export const StepAcceptanceSchema = z.object({
  criteria: z.string(),
});

export type StepAcceptance = z.infer<typeof StepAcceptanceSchema>;

export const StepFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  input: StepInputSchema.optional(),
  acceptance: StepAcceptanceSchema.optional(),
  agent: StepAgentConfigSchema.optional(),
});

export type StepDefinition = z.infer<typeof StepFrontmatterSchema>;
