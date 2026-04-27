import { z } from 'zod';

export const AgentConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
});

export const ProjectConfigSchema = z.object({
  agents: z.object({
    default: AgentConfigSchema,
    modules: z.record(z.string(), AgentConfigSchema).optional(),
  }),
  exclude: z.array(z.string()),
  workspace: z.object({
    path: z.string(),
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
