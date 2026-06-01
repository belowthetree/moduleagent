// ---------------------------------------------------------------------------
// config/defaults.ts — 配置类型定义与默认值
// 定义 ProjectConfig、ConfigEntry、RoleConfig、Workflow 等配置接口和默认常量
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  agents: {
    default: {
      command: string;
      args?: string[];
      model?: string;
      defaultMode?: string;
    };
    modules?: Record<string, {
      command: string;
      args?: string[];
      model?: string;
      defaultMode?: string;
    }>;
  };
  exclude: string[];
  projectPath: string;
  summarization?: {
    enabled: boolean;
  };
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
  knowledgeRefs?: { filename: string; name: string }[];
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

export const DEFAULT_MODULE_GEN_ROLE: RoleConfig = {
  name: '模块生成角色',
  description: '负责根据项目需求生成新模块，识别代码边界并创建模块定义。对项目所有模块具有可见性，能够分析现有模块结构并生成符合项目规范的新模块。',
  visibleModulePaths: [],
  agents: {
    default: {
      command: 'opencode',
      args: ['acp'],
    },
  },
  knowledgeRefs: [
    { filename: 'MODULE_FORMAT.md', name: 'Module.md 文件规范' },
  ],
};

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  configs: [DEFAULT_CONFIG_ENTRY],
  defaultConfig: 'default',
  roles: [DEFAULT_MODULE_GEN_ROLE],
};

// ---------------------------------------------------------------------------
// Workflow types
// ---------------------------------------------------------------------------

export interface StepAgentConfig {
  command?: string;
  args?: string[];
  visibleModulePaths?: string[];
  knowledgeRefs?: { filename: string; name: string }[];
}

export interface StepInput {
  from: 'user' | 'previous' | 'both';
  sourceStep?: string;
}

export interface StepAcceptance {
  criteria: string;
}

export interface StepDefinition {
  name: string;
  description?: string;
  input?: StepInput;
  acceptance?: StepAcceptance;
  agent?: StepAgentConfig;
}

export interface WorkflowDescriptor {
  name: string;
  dir: string;
  steps: WorkflowStepDescriptor[];
}

export interface WorkflowStepDescriptor {
  name: string;
  dir: string;
  definition: StepDefinition;
  body: string;
}

export interface WorkflowStepResult {
  stepName: string;
  success: boolean;
  outputDir: string;
  completedAt: string;
  acceptancePassed?: boolean;
  error?: string;
}

export interface WorkflowExecutionState {
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  startedAt: string;
  completedAt?: string;
  stepResults: WorkflowStepResult[];
}

// 保持向后兼容：旧代码期望单条目格式
export const DEFAULT_CONFIG: ProjectConfig = DEFAULT_CONFIG_ENTRY;
