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

export interface ConfigEntry extends ProjectConfig {
  name: string;
}

export interface WorkspaceConfig {
  configs: ConfigEntry[];
  defaultConfig: string;
}

export const DEFAULT_CONFIG_ENTRY: ConfigEntry = {
  name: 'default',
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

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  configs: [DEFAULT_CONFIG_ENTRY],
  defaultConfig: 'default',
};

// Keep backward compat: legacy code that expects the single-entry format
export const DEFAULT_CONFIG: ProjectConfig = DEFAULT_CONFIG_ENTRY;
