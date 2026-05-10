import { z } from 'zod';

export const AgentConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
});

// 单条项目配置（无名称）
export const ProjectConfigSchema = z.object({
  agents: z.object({
    default: AgentConfigSchema,
    modules: z.record(z.string(), AgentConfigSchema).optional(),
  }),
  exclude: z.array(z.string()),
  projectPath: z.string(),
  summarization: z.object({
    enabled: z.boolean(),
  }).optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// 带名称的配置条目（用于 configs 数组）
export const ConfigEntrySchema = ProjectConfigSchema.extend({
  name: z.string(),
});

export type ConfigEntry = z.infer<typeof ConfigEntrySchema>;

// 角色 Agent 配置（按角色覆写 Agent 命令）
export const RoleAgentConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
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
