<!--
  MainView.vue — 主工作区视图
  左侧边栏 + 模块树抽屉 + 角色 Agent 抽屉 + 中央聊天面板 + 底部输入区
-->

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import SVGTree from '../components/SVGTree.vue'
import NodeDetailPanel from '../components/NodeDetailPanel.vue'
import LeftSidebar from '../components/LeftSidebar.vue'
import RolePanel from '../components/RolePanel.vue'
import KnowledgePanel from '../components/KnowledgePanel.vue'
import WorkflowPanel from '../components/WorkflowPanel.vue'
import ContextCards from '../components/ContextCards.vue'
import ChatInput from '../components/ChatInput.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
// 工具栏 / 空状态 / 关闭按钮图标（替换原 emoji 与文字符号）
import { Refresh, Delete, Setting, MagicStick, FolderOpened, Pointer, Close } from '@element-plus/icons-vue'
import { useProjectStore } from '../stores/project'
import { useAgentStore } from '../stores/agent'
import { useConfigStore } from '../stores/config'
import { useKnowledgeStore } from '../stores/knowledge'
import { useWorkflowStore } from '../stores/workflow'

const projectStore = useProjectStore()
const agentStore = useAgentStore()
const configStore = useConfigStore()
const knowledgeStore = useKnowledgeStore()
const workflowStore = useWorkflowStore()

// ── 设置对话框开关 ──
const showSettings = ref(false)
const scanning = ref(false)
const generating = ref(false)

// ── 侧边栏标签（'' = 抽屉关闭） ──
const activeTab = ref('')

// ── 抽屉调整大小 ──
const SIDEBAR_WIDTH = 52
const DRAWER_MIN = 280
const DRAWER_MAX_RATIO = 0.85

function defaultDrawerWidth(): number {
  const avail = window.innerWidth - SIDEBAR_WIDTH
  return Math.floor(avail * 2 / 3)
}

function loadDrawerWidth(): number {
  const saved = localStorage.getItem('sideDrawerWidth')
  if (saved) {
    const n = parseInt(saved, 10)
    if (n >= DRAWER_MIN) return n
  }
  return defaultDrawerWidth()
}

const drawerWidth = ref(loadDrawerWidth())
const resizeDragging = ref(false)
let resizeStartX = 0
let resizeStartWidth = 0

function onResizeMousedown(e: MouseEvent) {
  e.preventDefault()
  resizeDragging.value = true
  resizeStartX = e.clientX
  resizeStartWidth = drawerWidth.value
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onWindowMousemove(e: MouseEvent) {
  if (!resizeDragging.value) return
  const delta = e.clientX - resizeStartX
  const avail = window.innerWidth - SIDEBAR_WIDTH
  const max = Math.floor(avail * DRAWER_MAX_RATIO)
  const newWidth = Math.min(max, Math.max(DRAWER_MIN, resizeStartWidth + delta))
  drawerWidth.value = newWidth
}

function onWindowMouseup() {
  if (!resizeDragging.value) return
  resizeDragging.value = false
  localStorage.setItem('sideDrawerWidth', String(drawerWidth.value))
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// ── 计算属性 ──
const statusText = computed(() => {
  if (scanning.value) return '正在扫描...'
  if (!projectStore.treeRoot) return '就绪'
  const count = projectStore.flattenedNodes.length
  return `已渲染 ${count} 个节点`
})

const statusClass = computed(() => {
  if (scanning.value) return 'pending'
  for (const status of agentStore.runningAgents.values()) {
    if (status === 'streaming') return 'streaming'
  }
  for (const status of agentStore.roleRunningAgents.values()) {
    if (status === 'streaming') return 'streaming'
  }
  return 'idle'
})

const projectName = computed(() => {
  const p = configStore.projectPath
  if (!p) return ''
  return p.split(/[/\\]/).pop() || p
})

const drawerOpen = computed(() => activeTab.value !== '')

// ── 标签切换 ──
function onTabChange(tabId: string): void {
  if (activeTab.value === tabId) {
    activeTab.value = '' // close drawer
  } else {
    activeTab.value = tabId // open drawer
  }
}

function closeDrawer(): void {
  activeTab.value = ''
}

// ── Escape 关闭抽屉（纯 UI 监听器，复用 closeDrawer，不改状态逻辑） ──
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && drawerOpen.value) {
    closeDrawer()
  }
}

async function rescan(): Promise<void> {
  if (!configStore.projectPath) return

  agentStore.stopRunningPoll()
  agentStore.stopRoleRunningPoll()
  projectStore.treeRoot = null
  projectStore.flattenedNodes = []
  projectStore.selectedNode = null

  try {
    await projectStore.scanProject(configStore.projectPath)
  } catch (err) {
    console.error('重新扫描失败:', (err as Error).message)
  }

  agentStore.ensureStatusListener()
  agentStore.ensureRoleStatusListener()

  // 未找到模块节点时自动选择首个角色
  if (!projectStore.treeRoot) {
    await agentStore.fetchRoles()
    if (agentStore.roles.length > 0) {
      await agentStore.selectRoleAgentAndStart(agentStore.roles[0].name)
    }
  }
}

async function generateModules(): Promise<void> {
  if (!configStore.projectPath) return

  // 尝试使用"模块生成角色"角色 Agent
  await agentStore.fetchRoles()
  const genRole = agentStore.roles.find(r => r.name === '模块生成角色')
  if (genRole) {
    projectStore.selectedNode = null
    await agentStore.selectRoleAgentAndStart(genRole.name)
    closeDrawer()
    await agentStore.sendRoleMessage(
      genRole.name,
      '请根据 Module.md 文件规范，扫描当前项目源码目录结构，为每个需要模块化的目录生成对应的 module.md 文件到 .module-agent/module/ 下。生成完成后请调用 finishSession 结束。',
    )
    return
  }

  // 回退：基于旧版 Agent 的生成方式
  generating.value = true
  try {
    const result = await window.moduleAgent.generateModules(configStore.projectPath)
    if (result.success) {
      scanning.value = true
      await projectStore.scanProject(configStore.projectPath)
    }
  } catch (err) {
    console.error('生成模块失败:', (err as Error).message)
  } finally {
    generating.value = false
    scanning.value = false
  }
}

function clearAll(): void {
  agentStore.clearAllContexts()
}

// ── 树节点事件 ──
function onSelectNode(node: Parameters<typeof projectStore.selectNode>[0]): void {
  agentStore.selectedRoleAgent = null // clear role selection
  projectStore.selectNode(node)
  closeDrawer() // 选择节点后自动关闭抽屉
}

function onCloseNodeDetail(): void {
  projectStore.selectedNode = null
}

// ── 角色选择（从抽屉） ──
function onSelectRole(name: string): void {
  projectStore.selectedNode = null // clear node selection
  agentStore.selectRoleAgentAndStart(name)
  closeDrawer()
}

function onCloseRoleDetail(): void {
  agentStore.selectedRoleAgent = null
}

async function handleClearRoleContext(): Promise<void> {
  if (agentStore.selectedRoleAgent) {
    await agentStore.clearRoleContext(agentStore.selectedRoleAgent)
  }
}

async function handleRoleSendMessage(text: string): Promise<void> {
  if (!agentStore.selectedRoleAgent) return
  await agentStore.sendRoleMessage(agentStore.selectedRoleAgent, text)
}

// ── 知识选择（从抽屉） ──
async function onSelectKnowledge(filename: string): Promise<void> {
  projectStore.selectedNode = null
  agentStore.selectedRoleAgent = null
  await knowledgeStore.selectByFilename(filename)
  closeDrawer()
}

function onCloseKnowledgeDetail(): void {
  knowledgeStore.clearSelection()
}

// ── 工作流选择（从抽屉） ──
async function onSelectWorkflow(name: string): Promise<void> {
  projectStore.selectedNode = null
  agentStore.selectedRoleAgent = null
  knowledgeStore.clearSelection()
  await workflowStore.selectWorkflow(name)
  closeDrawer()
}

function onCloseWorkflowDetail(): void {
  workflowStore.clearSelection()
}

async function onRunWorkflow(): Promise<void> {
  if (!workflowStore.selectedWorkflow) return
  await workflowStore.executeWorkflow(workflowStore.selectedWorkflow.name)
}

// ── 计算属性：选中的角色信息 ──
const selectedRoleInfo = computed(() => {
  if (!agentStore.selectedRoleAgent) return null
  return agentStore.roles.find(r => r.name === agentStore.selectedRoleAgent) || null
})

const selectedKnowledge = computed(() => knowledgeStore.selectedEntry)

const renderedKnowledge = computed(() => {
  if (!knowledgeStore.selectedContent) return ''
  return marked.parse(knowledgeStore.selectedContent) as string
})

// ── 生命周期 ──
onMounted(async () => {
  agentStore.ensureStatusListener()
  agentStore.ensureCrossContextListener()
  agentStore.ensureRoleStatusListener()

  window.addEventListener('mousemove', onWindowMousemove)
  window.addEventListener('mouseup', onWindowMouseup)
  window.addEventListener('keydown', onWindowKeydown)

  if (!projectStore.treeRoot && configStore.projectPath) {
    scanning.value = true
    try {
      await projectStore.scanProject(configStore.projectPath)
    } catch (err) {
      console.error('自动扫描失败:', (err as Error).message)
    } finally {
      scanning.value = false
    }
  }

  // 未找到模块节点时自动选择首个角色
  if (!projectStore.treeRoot) {
    await agentStore.fetchRoles()
    if (agentStore.roles.length > 0) {
      await agentStore.selectRoleAgentAndStart(agentStore.roles[0].name)
    }
  }
})

onUnmounted(() => {
  agentStore.stopRunningPoll()
  agentStore.stopRoleRunningPoll()
  window.removeEventListener('mousemove', onWindowMousemove)
  window.removeEventListener('mouseup', onWindowMouseup)
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>

<template>
  <div class="main-view">
    <!-- ── 工具栏 ── -->
    <header class="toolbar">
      <div class="toolbar-left">
        <el-tooltip content="扫描" placement="bottom" :show-after="400">
          <el-button text class="toolbar-btn" @click="rescan">
            <el-icon :size="16"><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="清空" placement="bottom" :show-after="400">
          <el-button text class="toolbar-btn" @click="clearAll">
            <el-icon :size="16"><Delete /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
      <div class="toolbar-center" v-if="configStore.projectPath">
        <!-- 项目名 + 路径层次化展示，悬浮显示完整路径 -->
        <div class="toolbar-project" :title="configStore.projectPath">
          <span class="toolbar-project-name">{{ projectName }}</span>
          <span class="toolbar-path">{{ configStore.projectPath }}</span>
        </div>
      </div>
      <div class="toolbar-right">
        <el-tooltip content="设置" placement="bottom" :show-after="400">
          <el-button text class="toolbar-btn" @click="showSettings = true">
            <el-icon :size="16"><Setting /></el-icon>
          </el-button>
        </el-tooltip>
        <ThemeToggle />
      </div>
    </header>

    <!-- ── 主内容区 ── -->
    <div class="main-content">
      <LeftSidebar
        :active-tab="activeTab"
        @tab-change="onTabChange"
      />

      <!-- 抽屉遮罩（点击关闭） -->
      <div
        class="drawer-overlay"
        :class="{ open: drawerOpen }"
        @click="closeDrawer"
      />

      <!-- 模块树抽屉（从左侧滑入） -->
      <div
        class="drawer"
        :class="{ open: activeTab === 'tree' }"
        :style="{ width: drawerWidth + 'px' }"
      >
        <div
          class="drawer-resize-handle"
          :class="{ dragging: resizeDragging }"
          @mousedown="onResizeMousedown"
        />
        <div class="drawer-inner">
          <div v-if="!projectStore.treeRoot && !scanning" class="empty-state">
            <div class="empty-icon">
              <el-icon :size="48"><FolderOpened /></el-icon>
            </div>
            <p class="empty-text">未发现模块文件</p>
            <p class="empty-hint">项目目录中尚无 module.md 文件</p>
            <el-button type="primary" class="empty-action" :loading="generating" @click="generateModules">
              <el-icon :size="15"><MagicStick /></el-icon>
              <span>调用 Agent 生成模块</span>
            </el-button>
          </div>
          <SVGTree
            v-else
            :root="projectStore.treeRoot"
            :selected-node="projectStore.selectedNode"
            :running-agents="agentStore.runningAgents"
            @select="onSelectNode"
          />
        </div>
      </div>

      <!-- 角色抽屉（从左侧滑入） -->
      <div
        class="drawer"
        :class="{ open: activeTab === 'roles' }"
        :style="{ width: drawerWidth + 'px' }"
      >
        <div
          class="drawer-resize-handle"
          :class="{ dragging: resizeDragging }"
          @mousedown="onResizeMousedown"
        />
        <div class="drawer-inner">
          <RolePanel @select="onSelectRole" />
        </div>
      </div>

      <!-- 知识抽屉（从左侧滑入） -->
      <div
        class="drawer"
        :class="{ open: activeTab === 'knowledge' }"
        :style="{ width: drawerWidth + 'px' }"
      >
        <div
          class="drawer-resize-handle"
          :class="{ dragging: resizeDragging }"
          @mousedown="onResizeMousedown"
        />
        <div class="drawer-inner">
          <KnowledgePanel @select="onSelectKnowledge" />
        </div>
      </div>

      <!-- 工作流抽屉（从左侧滑入） -->
      <div
        class="drawer"
        :class="{ open: activeTab === 'workflow' }"
        :style="{ width: drawerWidth + 'px' }"
      >
        <div
          class="drawer-resize-handle"
          :class="{ dragging: resizeDragging }"
          @mousedown="onResizeMousedown"
        />
        <div class="drawer-inner">
          <WorkflowPanel @select="onSelectWorkflow" />
        </div>
      </div>

      <!-- 主详情区（始终可见） -->
      <div class="detail-area">
        <!-- Node detail -->
        <NodeDetailPanel
          v-if="projectStore.selectedNode"
          :node="projectStore.selectedNode"
          @close="onCloseNodeDetail"
        />
        <!-- Role agent detail -->
        <div v-else-if="selectedRoleInfo" class="role-detail">
          <div class="role-detail-header">
            <span class="role-detail-title">{{ selectedRoleInfo.name }}</span>
            <button class="btn-close" @click="onCloseRoleDetail" title="关闭"><el-icon :size="14"><Close /></el-icon></button>
          </div>
          <div class="role-detail-body">
            <div class="role-info">
              <div class="role-desc">{{ selectedRoleInfo.description || '无描述' }}</div>
              <div class="role-paths">
                <span class="paths-label">可见模块:</span>
                <span class="paths-value">{{ selectedRoleInfo.visibleModulePaths.join(', ') || '(全部)' }}</span>
              </div>
              <div class="role-cmd">
                Agent: {{ selectedRoleInfo.agents.default.command }} {{ (selectedRoleInfo.agents.default.args || []).join(' ') }}
              </div>
            </div>
            <div class="role-ctx-area">
              <ContextCards
                v-if="agentStore.selectedRoleAgent"
                :module-name="agentStore.selectedRoleAgent"
                context-type="role"
                @clear="handleClearRoleContext"
              />
            </div>
            <div class="role-chat">
              <ChatInput
                v-if="agentStore.selectedRoleAgent"
                :module-name="agentStore.selectedRoleAgent"
                @send="handleRoleSendMessage"
              />
            </div>
          </div>
        </div>
        <!-- Knowledge detail -->
        <div v-else-if="selectedKnowledge" class="knowledge-detail">
          <div class="knowledge-detail-header">
            <span class="knowledge-detail-title">{{ selectedKnowledge.name }}</span>
            <button class="btn-close" @click="onCloseKnowledgeDetail" title="关闭"><el-icon :size="14"><Close /></el-icon></button>
          </div>
          <div class="knowledge-detail-body" v-html="renderedKnowledge" />
        </div>
        <!-- Workflow detail -->
        <div v-else-if="workflowStore.selectedWorkflow" class="workflow-detail">
          <div class="workflow-detail-header">
            <div class="workflow-title-row">
              <span class="workflow-detail-title">{{ workflowStore.selectedWorkflow.name }}</span>
              <button class="btn-close" @click="onCloseWorkflowDetail" title="关闭"><el-icon :size="14"><Close /></el-icon></button>
            </div>
            <div class="workflow-actions">
              <el-button type="primary" size="small" @click="onRunWorkflow">
                运行工作流
              </el-button>
            </div>
          </div>
          <div class="workflow-detail-body">
            <!-- 执行状态 -->
            <div v-if="workflowStore.executionState" class="execution-state">
              <el-tag :type="workflowStore.executionState.status === 'completed' ? 'success' : workflowStore.executionState.status === 'failed' ? 'danger' : 'warning'">
                {{ workflowStore.executionState.status === 'completed' ? '已完成' : workflowStore.executionState.status === 'failed' ? '失败' : workflowStore.executionState.status === 'running' ? '运行中' : workflowStore.executionState.status }}
              </el-tag>
              <span class="execution-progress">
                步骤 {{ workflowStore.executionState.currentStep }} / {{ workflowStore.executionState.totalSteps }}
              </span>
            </div>
            <!-- 步骤列表 -->
            <div class="step-list">
              <div
                v-for="(step, idx) in workflowStore.selectedWorkflow.steps"
                :key="step.name"
                class="step-card"
              >
                <div class="step-header">
                  <span class="step-number">{{ idx + 1 }}</span>
                  <div class="step-meta">
                    <strong>{{ step.definition.name }}</strong>
                    <span v-if="step.definition.description" class="step-desc">
                      — {{ step.definition.description }}
                    </span>
                  </div>
                  <el-tag
                    v-if="workflowStore.executionState?.results[idx]"
                    size="small"
                    :type="workflowStore.executionState.results[idx].success ? 'success' : 'danger'"
                  >
                    {{ workflowStore.executionState.results[idx].success ? '通过' : '失败' }}
                  </el-tag>
                </div>
                <div class="step-body-preview">
                  <pre>{{ step.body.slice(0, 300) }}{{ step.body.length > 300 ? '...' : '' }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- 占位 -->
        <div v-else class="detail-placeholder">
          <div class="placeholder-icon">
            <el-icon :size="48"><Pointer /></el-icon>
          </div>
          <p class="placeholder-title">尚未选择内容</p>
          <p class="placeholder-text">从左侧节点树选择模块，从角色面板选择角色 Agent，或从知识面板选择知识条目</p>
        </div>
      </div>
    </div>

    <!-- ── 状态栏 ── -->
    <footer class="status-bar">
      <span class="status-dot" :class="statusClass"></span>
      <span class="status-text">{{ statusText }}</span>
      <span class="status-path">{{ projectName }}</span>
    </footer>

    <!-- 设置对话框（模态） -->
    <SettingsDialog
      v-if="showSettings"
      :visible="showSettings"
      @close="showSettings = false"
    />
  </div>
</template>

<style scoped>
.main-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--el-bg-color-page);
}

/* ── 工具栏：毛玻璃 + 底部细分隔线 ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 var(--app-space-4);
  background: color-mix(in srgb, var(--el-bg-color) 82%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
  -webkit-app-region: drag;       /* 可从工具栏区域拖拽窗口 */
}

.toolbar :deep(button),
.toolbar :deep(.el-button) {
  -webkit-app-region: no-drag;    /* 按钮区域不拦截拖拽 */
}

/* 抵消 Element Plus 相邻按钮的 12px 间距，交由 flex gap 控制 */
.toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* macOS hiddenInset: 为 traffic lights 预留顶部空间 */
html.os-mac .toolbar {
  padding-left: 80px;             /* 避开左侧红黄绿按钮 (约 70px) */
}

.toolbar-left,
.toolbar-center,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--app-space-1);
}

.toolbar-center {
  flex: 1;
  justify-content: center;
  overflow: hidden;
  min-width: 0;
}

/* 32px 方形图标按钮：圆角 8px，hover 填充浅底 */
.toolbar :deep(.toolbar-btn) {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--app-radius-md);
  --el-button-text-color: var(--el-text-color-secondary);
  --el-button-hover-text-color: var(--el-text-color-primary);
  --el-button-hover-bg-color: var(--el-fill-color);
  --el-button-active-bg-color: var(--el-fill-color-dark);
  transition: background-color var(--app-transition-fast), color var(--app-transition-fast);
}

/* 项目名 + 路径层次化展示 */
.toolbar-project {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  max-width: 60vw;
  line-height: 1.3;
}

.toolbar-project-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-path {
  font-size: 11px;
  font-family: var(--app-mono);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* ── 主内容区 ── */
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

/* ── 抽屉遮罩：淡入 + 轻微模糊 ── */
.drawer-overlay {
  position: absolute;
  top: 0;
  left: 52px;
  right: 0;
  bottom: 0;
  background: rgba(17, 24, 39, 0.18);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 50;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--app-transition);
}

html.dark .drawer-overlay {
  background: rgba(0, 0, 0, 0.32);
}

.drawer-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

/* ── 抽屉：圆角右缘 + 悬浮阴影，滑入滑出统一缓动 ── */
.drawer {
  position: absolute;
  top: 0;
  left: 52px;
  height: 100%;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-light);
  border-radius: 0 var(--app-radius-lg) var(--app-radius-lg) 0;
  z-index: 60;
  transform: translateX(calc(-100% - 52px));
  transition: transform var(--app-transition-slow);
  box-shadow: var(--app-shadow-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;               /* 圆角裁剪内部内容 */
}

.drawer.open {
  transform: translateX(0);
}

/* resize handle：默认 1px 透明指示条，hover/拖拽时 3px 主色高亮 */
.drawer-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}

.drawer-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  height: 100%;
  background: transparent;
  transition: width var(--app-transition-fast), background var(--app-transition-fast);
}

.drawer-resize-handle:hover::after,
.drawer-resize-handle.dragging::after {
  width: 3px;
  background: var(--el-color-primary);
}

.drawer-inner {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── 详情区（填充剩余空间） ── */
.detail-area {
  flex: 1;
  overflow: hidden;
  margin-left: 0;
  transition: margin-left var(--app-transition-slow);
}

/* ── 状态栏：细 Typography ── */
.status-bar {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 var(--app-space-4);
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color-light);
  font-size: 12px;
  color: var(--el-text-color-secondary);
  gap: var(--app-space-2);
  flex-shrink: 0;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background var(--app-transition-fast);
}

.status-dot.idle { background: var(--el-text-color-placeholder); }
.status-dot.pending { background: var(--el-color-warning); }
.status-dot.error { background: var(--el-color-danger); }
.status-dot.interrupted { background: var(--el-color-warning); }

/* streaming 时呼吸脉冲光环 */
.status-dot.streaming {
  background: var(--el-color-primary);
  animation: status-dot-pulse 1.6s ease-in-out infinite;
}

@keyframes status-dot-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--el-color-primary) 40%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px transparent;
  }
}

.status-text {
  flex-shrink: 0;
}

.status-path {
  margin-left: auto;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 空状态：大号线性图标 + 主标题 + 辅助说明 + 主按钮 ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--app-space-2);
  padding: var(--app-space-5);
  text-align: center;
}

.empty-icon {
  color: var(--el-text-color-secondary);
  opacity: 0.75;
  margin-bottom: var(--app-space-1);
}

.empty-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.empty-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0 0 var(--app-space-2);
}

.empty-action {
  border-radius: var(--app-radius-md);
  font-weight: 600;
}

/* 按钮内图标与文字的间距 */
.empty-action :deep(.el-icon) {
  margin-right: var(--app-space-1);
}

/* ── 角色详情（主区域） ── */
.role-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color-light);
}

/* ── 面板头部（角色 / 知识 / 工作流详情统一样式） ── */
.role-detail-header,
.knowledge-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--app-space-3) var(--app-space-4);
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
}

.role-detail-title,
.knowledge-detail-title,
.workflow-detail-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* 图标关闭按钮：32px、圆角 8px、hover 浅底 */
.btn-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--app-transition-fast), color var(--app-transition-fast);
}

.btn-close:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.role-detail-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--app-space-3) var(--app-space-4);
}

.role-info {
  flex-shrink: 0;
  padding-bottom: var(--app-space-3);
  border-bottom: 1px solid var(--el-border-color-light);
}

.role-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: var(--app-space-2);
}

.role-paths {
  font-size: 11px;
  margin-bottom: var(--app-space-1);
}

.paths-label {
  color: var(--el-text-color-secondary);
  font-weight: 600;
}

.paths-value {
  color: var(--el-text-color-primary);
}

.role-cmd {
  font-size: 11px;
  font-family: var(--app-mono);
  color: var(--el-text-color-secondary);
}

.role-ctx-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: var(--app-space-3);
}

.role-chat {
  display: flex;
  gap: var(--app-space-2);
  padding: var(--app-space-3) 0 0;
  border-top: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
}

/* ── 知识详情（主区域） ── */
.knowledge-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color-light);
}

.knowledge-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--app-space-5) var(--app-space-6);
  line-height: 1.7;
  color: var(--el-text-color-primary);
  user-select: text;
  -webkit-user-select: text;
}

/* ── 工作流详情（主区域） ── */
.workflow-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color-light);
}

.workflow-detail-header {
  padding: var(--app-space-3) var(--app-space-4);
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
}

.workflow-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--app-space-2);
}

.workflow-actions {
  display: flex;
  gap: var(--app-space-2);
}

.workflow-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--app-space-4);
}

.execution-state {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  margin-bottom: var(--app-space-4);
  padding: var(--app-space-2) var(--app-space-3);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--app-radius-md);
}

.execution-progress {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-3);
}

/* 步骤卡片：hover 微浮起 */
.step-card {
  padding: var(--app-space-3);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--app-radius-lg);
  background: var(--el-bg-color);
  transition: box-shadow var(--app-transition), transform var(--app-transition);
}

.step-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--app-shadow-1);
}

.step-header {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  margin-bottom: var(--app-space-2);
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-white);
  background: var(--el-color-primary);
  border-radius: 50%;
}

.step-meta {
  flex: 1;
  min-width: 0;
}

.step-meta strong {
  font-size: 14px;
}

.step-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.step-body-preview pre {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
  margin: 0;
  padding: var(--app-space-2);
  background: var(--el-fill-color-light);
  border-radius: var(--app-radius-sm);
}

/* ── 详情占位：大号线性图标 + 主标题 + 辅助说明 ── */
.detail-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--app-space-2);
  padding: var(--app-space-5);
  color: var(--el-text-color-secondary);
  text-align: center;
}

.placeholder-icon {
  color: var(--el-text-color-secondary);
  opacity: 0.6;
  margin-bottom: var(--app-space-1);
}

.placeholder-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.placeholder-text {
  font-size: 13px;
  margin: 0;
  max-width: 420px;
  line-height: 1.6;
  text-align: center;
}
</style>
