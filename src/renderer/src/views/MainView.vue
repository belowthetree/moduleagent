<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import SVGTree from '../components/SVGTree.vue'
import NodeDetailPanel from '../components/NodeDetailPanel.vue'
import LeftSidebar from '../components/LeftSidebar.vue'
import RolePanel from '../components/RolePanel.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import { useProjectStore } from '../stores/project'
import { useAgentStore } from '../stores/agent'
import { useConfigStore } from '../stores/config'

const projectStore = useProjectStore()
const agentStore = useAgentStore()
const configStore = useConfigStore()

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
}

async function generateModules(): Promise<void> {
  if (!configStore.projectPath) return
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
  projectStore.selectNode(node)
  closeDrawer() // auto-close drawer after selecting a node
}

function onCloseNodeDetail(): void {
  projectStore.selectedNode = null
}

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
          <RolePanel />
        </div>
      </div>

      <!-- Main detail area (always visible) -->
      <div class="detail-area">
        <NodeDetailPanel
          :node="projectStore.selectedNode"
          @close="onCloseNodeDetail"
        />
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
</style>
