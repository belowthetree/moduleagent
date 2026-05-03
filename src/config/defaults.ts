export interface CodeSourceConfig {
  type: 'git' | 'local';
  url?: string;
  branch?: string;
  path?: string;
}

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
  codeSource: CodeSourceConfig;
  modulesPath?: string;
}

export const DEFAULT_CONFIG: ProjectConfig = {
  agents: {
    default: {
      command: 'opencode',
      args: ['acp'],
    },
  },
  exclude: [],
  workspace: {
    path: '.module-agent/workspaces',
  },
  codeSource: {
    type: 'local',
    path: '',
  },
  modulesPath: '',
};
