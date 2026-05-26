# 前端架构

> Vue 3 + Element Plus + Pinia 前端：组件树、状态管理、API 通信。

## 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Vue 3 (Composition API + `<script setup>`) |
| UI | Element Plus 2.x |
| 状态管理 | Pinia |
| 路由 | Vue Router (Hash Mode) |
| Markdown | marked |
| 主题 | Element Plus CSS 变量 + 自定义 `modern-minimal.css` |

## 目录结构

```
src/
├── main.ts                 # 应用入口、Pinia 初始化、配置加载
├── router/index.ts         # 路由定义（/setup, /main）
├── App.vue                 # 根组件
├── components/
│   ├── ChatInput.vue       # 消息输入框
│   ├── ContextCards.vue    # 上下文卡片展示
│   ├── LeftSidebar.vue     # 左侧导航
│   ├── NodeDetailPanel.vue # 模块节点详情 + Agent 聊天
│   ├── RolePanel.vue       # 角色管理面板
│   ├── RoleConfigDialog.vue # 角色配置对话框
│   ├── SettingsDialog.vue  # 设置对话框
│   ├── SVGTree.vue         # 模块树可视化
│   ├── ThemeToggle.vue     # 深色/浅色主题切换
│   ├── KnowledgePanel.vue  # 知识库面板
│   └── WorkflowPanel.vue   # 工作流面板
├── composables/
│   ├── useApi.ts           # Tauri IPC 封装 + SSE 流监听
│   ├── useModuleAgent.ts   # API facade 安装
│   └── useTheme.ts         # 主题管理
├── stores/
│   ├── agent.ts            # Agent 状态、消息管理
│   ├── config.ts           # 配置状态、持久化
│   ├── project.ts          # 项目扫描、模块树布局
│   ├── knowledge.ts        # 知识库状态
│   └── workflow.ts         # 工作流状态
├── types/
│   └── preload.ts          # 前端类型定义
├── views/
│   ├── SetupView.vue       # 初始设置页面
│   └── MainView.vue        # 主工作台
└── styles/
    └── modern-minimal.css  # 全局样式 + Element Plus 主题变量
```

## Pages

### SetupView

首次启动时显示。包含：
- Agent 命令/参数配置
- 项目目录选择
- 确认后跳转到 `/main`

### MainView

主工作台，布局：
```
┌──────────────┬──────────────────────────┐
│  左侧导航     │  主区域                    │
│  • 模块树     │  • 模块详情/Agent 聊天     │
│  • 角色列表   │  • 角色详情/聊天           │
│  • 知识库     │  • 知识库内容               │
│  • 工作流     │  • 工作流详情               │
│  • 设置       │                           │
└──────────────┴──────────────────────────┘
```

## Pinia Stores

### configStore

管理应用配置，`.module-agent.json` 为唯一数据源：
- `agentCmd` / `agentArgs`：Agent 命令和参数
- `projectPath`：项目路径
- `autoDocUpdate`：自动文档更新开关

### agentStore

Agent 和角色 Agent 的状态与消息管理：
- `sendMessage(moduleName, text, cwd)`：向模块 Agent 发送消息
- `sendRoleMessage(roleName, text)`：向角色 Agent 发送消息
- `selectRoleAgentAndStart(name)`：选择并启动角色 Agent
- 消息列表：`Map<moduleName, ChatMsg[]>` 和 `Map<roleName, ChatMsg[]>`

### projectStore

模块扫描和树布局：
- `scanProject(projectRoot)`：触发扫描 + 构建树
- `treeRoot`：模块树根节点
- `flattenedNodes`：布局后的节点列表
- `moduleCount`：发现的模块数量

## API 通信

### IPC 调用

通过 `window.__TAURI__.core.invoke()` 调用 Rust 命令：

```typescript
const { invoke } = getTauri();
const result = await invoke('agent_send', { body: { name, text, cwd } });
```

### 流事件

通过 `window.__TAURI__.core.listen()` 监听后端推送：

```typescript
listen('stream', (event) => {
  const { type, data } = event.payload;
  // 分发到对应回调
});
```

## 主题系统

通过 `useTheme()` composable 管理：
- 默认深色主题（`html.dark` 类）
- 通过 `localStorage('theme')` 持久化
- 自定义 CSS 变量覆盖 Element Plus 默认主题
- 同步设置 Tauri 原生窗口标题栏颜色（`setTheme()`）

## 自动 Agent 启动

`NodeDetailPanel` 中发送消息时自动启动 Agent：

```
handleSendMessage(text)
  → isAgentRunning(name)
  → 未运行 → startAgent(agentCmd, agentArgs, cwd)
  → 启动失败 → 在聊天中显示错误
  → 启动成功 → sendMessage(name, text, cwd)
```
