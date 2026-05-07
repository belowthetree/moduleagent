<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import SVGTree from '../components/SVGTree.vue'
import NodeDetailPanel from '../components/NodeDetailPanel.vue'
import LeftSidebar from '../components/LeftSidebar.vue'
import RolePanel from '../components/RolePanel.vue'
import KnowledgePanel from '../components/KnowledgePanel.vue'
import ContextCards from '../components/ContextCards.vue'
import ChatInput from '../components/ChatInput.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import { useProjectStore } from '../stores/project'
import { useAgentStore } from '../stores/agent'
import { useConfigStore } from '../stores/config'
import { useKnowledgeStore } from '../stores/knowledge'

const projectStore = useProjectStore()
const agentStore = useAgentStore()
const configStore = useConfigStore()
const knowledgeStore = useKnowledgeStore()

// ── Settings dialog toggle ──
const showSettings = ref(false)
const scanning = ref(false)
const generating = ref(false)

// ── Sidebar tab ('' = no drawer open) ──
const activeTab = ref('')

// ── Drawer resize ──
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

// ── Computed ──
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

// ── Tab toggle ──
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

  // Auto-select first role if no module nodes found
  if (!projectStore.treeRoot) {
    await agentStore.fetchRoles()
    if (agentStore.roles.length > 0) {
      await agentStore.selectRoleAgentAndStart(agentStore.roles[0].name)
    }
  }
}

async function generateModules(): Promise<void> {
  if (!configStore.projectPath) return

  // Try to use the "模块生成角色" role agent
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

  // Fallback: legacy agent-based generation
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

// ── Tree events ──
function onSelectNode(node: Parameters<typeof projectStore.selectNode>[0]): void {
  agentStore.selectedRoleAgent = null // clear role selection
  projectStore.selectNode(node)
  closeDrawer() // auto-close drawer after selecting a node
}

function onCloseNodeDetail(): void {
  projectStore.selectedNode = null
}

// ── Role selection (from drawer) ──
function onSelectRole(name: string): void {
  projectStore.selectedNode = null // clear node selection
  agentStore.selectRoleAgentAndStart(name)
  closeDrawer()
}

function onCloseRoleDetail(): void {
  agentStore.selectedRoleAgent = null
}

async function handleRoleSendMessage(text: string): Promise<void> {
  if (!agentStore.selectedRoleAgent) return
  await agentStore.sendRoleMessage(agentStore.selectedRoleAgent, text)
}

// ── Knowledge selection (from drawer) ──
async function onSelectKnowledge(filename: string): Promise<void> {
  projectStore.selectedNode = null
  agentStore.selectedRoleAgent = null
  await knowledgeStore.selectByFilename(filename)
  closeDrawer()
}

function onCloseKnowledgeDetail(): void {
  knowledgeStore.clearSelection()
}

// ── Computed: selected role info ──
const selectedRoleInfo = computed(() => {
  if (!agentStore.selectedRoleAgent) return null
  return agentStore.roles.find(r => r.name === agentStore.selectedRoleAgent) || null
})

const selectedKnowledge = computed(() => knowledgeStore.selectedEntry)

const renderedKnowledge = computed(() => {
  if (!knowledgeStore.selectedContent) return ''
  return marked.parse(knowledgeStore.selectedContent) as string
})

// ── Lifecycle ──
onMounted(async () => {
  agentStore.ensureStatusListener()
  agentStore.ensureCrossContextListener()
  agentStore.ensureRoleStatusListener()

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

  // Auto-select first role if no module nodes found
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

      <!-- Drawer overlay (click to close) -->
      <div
        class="drawer-overlay"
        :class="{ open: drawerOpen }"
        @click="closeDrawer"
      />

      <!-- Tree drawer (slides from left) -->
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

      <!-- Role drawer (slides from left) -->
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

      <!-- Knowledge drawer (slides from left) -->
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

      <!-- Main detail area (always visible) -->
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
        <!-- Placeholder -->
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

    <!-- Settings dialog (modal) -->
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

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 12px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
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

/* ── Drawer overlay ── */
.drawer-overlay {
  position: absolute;
  top: 0;
  left: 52px;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.15);
  z-index: 50;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s;
}

.drawer-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

/* ── Drawer ── */
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
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.08);
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

/* ── Detail area (fills remaining space) ── */
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
  height: 32px;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color);
  font-size: 12px;
  color: var(--el-text-color-secondary);
  gap: 8px;
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

/* ── Role detail (main area) ── */
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

/* ── Knowledge detail (main area) ── */
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

/* ── Detail placeholder ── */
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
