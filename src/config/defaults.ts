export interface ProjectConfig {
  agents: {
    default: {
      command: string;
      args?: string[];
    };
    modules?: Record<string, {
      command: string;
      args?: string[];
    }>;
  };
  exclude: string[];
  workspace: {
    path: string;
  };
}

export const DEFAULT_CONFIG: ProjectConfig = {
  agents: {
    default: {
      command: 'claude',
      args: ['--acp', '--dangerously-skip-permissions'],
    },
  },
  exclude: [],
  workspace: {
    path: '~/.module-agent/workspaces',
  },
};
