import { z } from 'zod';

export const AgentConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
});

export const CodeSourceSchema = z.object({
  type: z.enum(['git', 'local']),
  url: z.string().optional(),
  branch: z.string().optional(),
  path: z.string().optional(),
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
  codeSource: CodeSourceSchema,
  modulesPath: z.string().optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
