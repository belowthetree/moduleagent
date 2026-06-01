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
import WorkspaceDiffPanel from '../components/WorkspaceDiffPanel.vue'
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
  agentStore.ensureDiffListener()

  window.addEventListener('mousemove', onWindowMousemove)
  window.addEventListener('mouseup', onWindowMouseup)

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
})
</script>

<template>
  <div class="main-view">
    <!-- ── 工具栏 ── -->
    <header class="toolbar">
      <div class="toolbar-left">
        <el-button text @click="rescan">↻ 扫描</el-button>
        <el-button text @click="clearAll">清空</el-button>
      </div>
      <div class="toolbar-center" v-if="configStore.projectPath">
        <span class="toolbar-path">{{ configStore.projectPath }}</span>
      </div>
      <div class="toolbar-right">
        <el-button
          v-if="agentStore.pendingDiffCount > 0"
          text
          type="warning"
          @click="agentStore.openDiffPanel()"
        >
          ⚡ {{ agentStore.pendingDiffCount }} 变更
        </el-button>
        <el-button text @click="showSettings = true">⚙ 设置</el-button>
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
        <div class="drawer-resize-handle" @mousedown="onResizeMousedown" />
        <div class="drawer-inner">
          <div v-if="!projectStore.treeRoot && !scanning" class="empty-state">
            <div class="empty-icon">📁</div>
            <p class="empty-text">未发现模块文件</p>
            <p class="empty-hint">项目目录中尚无 module.md 文件</p>
            <el-button type="primary" :loading="generating" @click="generateModules">
              🤖 调用 Agent 生成模块
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
        <div class="drawer-resize-handle" @mousedown="onResizeMousedown" />
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
        <div class="drawer-resize-handle" @mousedown="onResizeMousedown" />
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
        <div class="drawer-resize-handle" @mousedown="onResizeMousedown" />
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
            <button class="btn-close" @click="onCloseRoleDetail">✕</button>
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
            <button class="btn-close" @click="onCloseKnowledgeDetail">✕</button>
          </div>
          <div class="knowledge-detail-body" v-html="renderedKnowledge" />
        </div>
        <!-- Workflow detail -->
        <div v-else-if="workflowStore.selectedWorkflow" class="workflow-detail">
          <div class="workflow-detail-header">
            <div class="workflow-title-row">
              <span class="workflow-detail-title">{{ workflowStore.selectedWorkflow.name }}</span>
              <button class="btn-close" @click="onCloseWorkflowDetail">✕</button>
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
          <div class="placeholder-icon">📋</div>
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

    <!-- 工作区变更面板 -->
    <WorkspaceDiffPanel
      :module-name="agentStore.selectedModuleName || ''"
      :visible="agentStore.showDiffPanel"
      @close="agentStore.closeDiffPanel()"
      @applied="agentStore.clearDiffNotification()"
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

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
  backdrop-filter: blur(8px);
  -webkit-app-region: drag;       /* 可从工具栏区域拖拽窗口 */
}

.toolbar :deep(button),
.toolbar :deep(.el-button) {
  -webkit-app-region: no-drag;    /* 按钮区域不拦截拖拽 */
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
  gap: 4px;
}

.toolbar-center {
  flex: 1;
  justify-content: center;
  overflow: hidden;
}

.toolbar-path {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60vw;
}

/* ── 主内容区 ── */
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

/* ── 抽屉遮罩 ── */
.drawer-overlay {
  position: absolute;
  top: 0;
  left: 52px;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.08);
  z-index: 50;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s;
}

.drawer-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

/* ── 抽屉 ── */
.drawer {
  position: absolute;
  top: 0;
  left: 52px;
  height: 100%;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color);
  z-index: 60;
  transform: translateX(calc(-100% - 52px));
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 1px 0 6px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
}

.drawer.open {
  transform: translateX(0);
}

.drawer-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}

.drawer-resize-handle:hover {
  background: var(--el-color-primary);
  opacity: 0.3;
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
  transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── 状态栏 ── */
.status-bar {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color);
  font-size: 11px;
  color: var(--el-text-color-secondary);
  gap: 6px;
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.idle { background: var(--el-text-color-placeholder); }
.status-dot.pending { background: var(--el-color-warning); }
.status-dot.streaming { background: var(--el-color-primary); }
.status-dot.error { background: var(--el-color-danger); }
.status-dot.interrupted { background: var(--el-color-warning); }

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

/* ── 空状态 ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  padding: 16px;
}
.empty-icon { font-size: 48px; }
.empty-text { font-size: 16px; color: var(--el-text-color-primary); margin: 0; }
.empty-hint { font-size: 13px; color: var(--el-text-color-secondary); margin: 0; }

/* ── 角色详情（主区域） ── */
.role-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color);
}

.role-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.role-detail-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.role-detail .btn-close {
  width: 28px;
  height: 28px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.role-detail .btn-close:hover {
  background: var(--el-color-danger);
  color: var(--el-color-white);
  border-color: var(--el-color-danger);
}

.role-detail-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 16px;
}

.role-info {
  flex-shrink: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color);
}

.role-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.role-paths {
  font-size: 11px;
  margin-bottom: 4px;
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
  color: var(--el-text-color-secondary);
}

.role-ctx-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 12px;
}

.role-chat {
  display: flex;
  gap: 6px;
  padding: 12px 0 0;
  border-top: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

/* ── 知识详情（主区域） ── */
.knowledge-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color);
}

.knowledge-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.knowledge-detail-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.knowledge-detail .btn-close {
  width: 28px;
  height: 28px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.knowledge-detail .btn-close:hover {
  background: var(--el-color-danger);
  color: var(--el-color-white);
  border-color: var(--el-color-danger);
}

.knowledge-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  user-select: text;
  -webkit-user-select: text;
}

/* ── 工作流详情（主区域） ── */
.workflow-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color);
}

.workflow-detail-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.workflow-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.workflow-detail-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.workflow-actions {
  display: flex;
  gap: 8px;
}

.workflow-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.execution-state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.execution-progress {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.step-card {
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--el-color-primary);
  border-radius: 50%;
}

.step-meta {
  flex: 1;
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
  padding: 8px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

/* ── 详情占位 ── */
.detail-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--el-text-color-secondary);
}

.placeholder-icon {
  font-size: 48px;
}

.placeholder-text {
  font-size: 14px;
  margin: 0;
  text-align: center;
}
</style>
