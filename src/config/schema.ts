import { z } from 'zod';

export const AgentConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
});

// Single project config entry (without name)
export const ProjectConfigSchema = z.object({
  agents: z.object({
    default: AgentConfigSchema,
    modules: z.record(z.string(), AgentConfigSchema).optional(),
  }),
  exclude: z.array(z.string()),
  projectPath: z.string(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// Config entry with name (used in the configs array)
export const ConfigEntrySchema = ProjectConfigSchema.extend({
  name: z.string(),
});

export type ConfigEntry = z.infer<typeof ConfigEntrySchema>;

// Top-level workspace config containing an array of named configs
export const WorkspaceConfigSchema = z.object({
  configs: z.array(ConfigEntrySchema),
  defaultConfig: z.string(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
