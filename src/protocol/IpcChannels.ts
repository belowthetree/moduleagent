// ============================================================================
// IPC 通道集中注册表
//
// 所有 invoke/handle 和 webContents.send / ipcRenderer.on 通道名的单一事实来源。
// bridge.ts 和 preload/index.ts 都必须引用此常量，不允许硬编码字符串。
// ============================================================================

export const IpcChannel = {
  // ── 对话框 ──
  Dialog: {
    SelectDir: 'dialog:selectDir',
  },

  // ── 项目 ──
  Project: {
    Scan: 'project:scan',
    GetTree: 'project:getTree',
    GenerateModules: 'project:generateModules',
  },

  // ── Agent ──
  Agent: {
    Start: 'agent:start',
    Send: 'agent:send',
    Cancel: 'agent:cancel',
    Stop: 'agent:stop',
    IsRunning: 'agent:isRunning',
    GetRunning: 'agent:getRunning',
  },

  // ── 上下文 ──
  Context: {
    Get: 'context:get',
    Clear: 'context:clear',
    ClearAll: 'context:clearAll',
  },

  // ── 配置 ──
  Config: {
    Save: 'config:save',
    Get: 'config:get',
  },

  // ── 角色 Agent ──
  Role: {
    List: 'role:list',
    Save: 'role:save',
    Delete: 'role:delete',
    Start: 'role:start',
    Send: 'role:send',
    Cancel: 'role:cancel',
    Stop: 'role:stop',
    IsRunning: 'role:isRunning',
    GetContext: 'role:getContext',
    ClearContext: 'role:clearContext',
  },

  // ── 工作流 ──
  Workflow: {
    List: 'workflow:list',
    Load: 'workflow:load',
    Create: 'workflow:create',
    Delete: 'workflow:delete',
    StepSave: 'workflow:stepSave',
    StepDelete: 'workflow:stepDelete',
    StepAdd: 'workflow:stepAdd',
    Execute: 'workflow:execute',
    Cancel: 'workflow:cancel',
    Status: 'workflow:status',
  },

  // ── 迁移 ──
  Migrate: {
    Check: 'migrate:check',
    Data: 'migrate:data',
  },

  // ── 知识 ──
  Knowledge: {
    List: 'knowledge:list',
    Read: 'knowledge:read',
    Save: 'knowledge:save',
    Create: 'knowledge:create',
    Delete: 'knowledge:delete',
  },

  // ── 工作区 Diff ──
  WorkspaceDiff: {
    Diff: 'workspace:diff',
    DiffFile: 'workspace:diff-file',
    Apply: 'workspace:apply',
    Discard: 'workspace:discard',
  },

  // ── Push 通道（webContents.send → ipcRenderer.on） ──
  Push: {
    AgentStream: 'agent:stream',
    RoleStream: 'role:stream',
    CrossContext: 'agent:cross-context',
    AgentStatus: 'agent:status',
    RoleStatus: 'role:status',
    WorkspaceDiffReady: 'workspace:diff-ready',
  },
} as const;
