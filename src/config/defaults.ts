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
  projectPath: string;
}

export interface ConfigEntry extends ProjectConfig {
  name: string;
}

export interface RoleAgentConfig {
  command: string;
  args?: string[];
}

export interface RoleConfig {
  name: string;
  description: string;
  visibleModulePaths: string[];
  agents: {
    default: RoleAgentConfig;
  };
}

export interface WorkspaceConfig {
  configs: ConfigEntry[];
  defaultConfig: string;
  roles?: RoleConfig[];
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
  projectPath: '.',
};

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  configs: [DEFAULT_CONFIG_ENTRY],
  defaultConfig: 'default',
};

// Keep backward compat: legacy code that expects the single-entry format
export const DEFAULT_CONFIG: ProjectConfig = DEFAULT_CONFIG_ENTRY;
