<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import SVGTree from '../components/SVGTree.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import { useProjectStore } from '../stores/project'
import { useAgentStore } from '../stores/agent'
import { useConfigStore } from '../stores/config'

const router = useRouter()
const projectStore = useProjectStore()
const agentStore = useAgentStore()
const configStore = useConfigStore()

// ── Settings dialog toggle ──
const showSettings = ref(false)
const scanning = ref(false)

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
  return 'idle'
})

const projectName = computed(() => {
  const p = configStore.projectPath
  if (!p) return ''
  return p.split(/[/\\]/).pop() || p
})

async function rescan(): Promise<void> {
  if (!configStore.workspacePath || !configStore.projectPath) return

  agentStore.stopRunningPoll()
  projectStore.treeRoot = null
  projectStore.flattenedNodes = []
  projectStore.selectedNode = null

  // Re-scan
  try {
    await projectStore.scanProject(configStore.projectPath, configStore.workspacePath)
  } catch (err) {
    console.error('重新扫描失败:', (err as Error).message)
  }

  // Re-start status listener
  agentStore.ensureStatusListener()
}

function clearAll(): void {
  agentStore.clearAllContexts()
}

// ── Tree events ──
function onSelectNode(node: Parameters<typeof projectStore.selectNode>[0]): void {
  projectStore.selectNode(node)
}

function onCloseDrawer(): void {
  projectStore.selectedNode = null
}

// ── Lifecycle ──
onMounted(async () => {
  agentStore.ensureStatusListener()
  agentStore.ensureCrossContextListener()

  // Auto-scan if tree not loaded yet (e.g., came directly from setup-skip)
  if (!projectStore.treeRoot && configStore.projectPath && configStore.workspacePath) {
    scanning.value = true
    try {
      await projectStore.scanProject(configStore.projectPath, configStore.workspacePath)
    } catch (err) {
      console.error('自动扫描失败:', (err as Error).message)
    } finally {
      scanning.value = false
    }
  }
})

onUnmounted(() => {
  agentStore.stopRunningPoll()
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
      <div class="toolbar-right">
        <el-button text @click="showSettings = true">⚙ 设置</el-button>
        <ThemeToggle />
      </div>
    </header>

    <!-- ── 主内容区 ── -->
    <div class="main-content">
      <div class="tree-area">
        <SVGTree
          :root="projectStore.treeRoot"
          :selected-node="projectStore.selectedNode"
          :running-agents="agentStore.runningAgents"
          @select="onSelectNode"
        />
      </div>

      <DrawerPanel
        v-if="projectStore.selectedNode"
        :node="projectStore.selectedNode"
        :visible="true"
        @close="onCloseDrawer"
      />
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
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── 主内容区 ── */
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.tree-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  padding: 16px;
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
</style>
