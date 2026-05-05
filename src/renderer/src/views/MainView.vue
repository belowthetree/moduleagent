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

const projectName = computed(() => {
  const p = configStore.projectPath
  if (!p) return ''
  return p.split(/[/\\]/).pop() || p
})

// ── FAB actions ──
function goBack(): void {
  // Clean up stream listener + polling before leaving
  if (agentStore.streamListenerCleanup) {
    agentStore.streamListenerCleanup()
    agentStore.streamListenerCleanup = null
  }
  agentStore.stopRunningPoll()
  router.push('/setup')
}

async function rescan(): Promise<void> {
  if (!configStore.workspacePath || !configStore.projectPath) return

  // Clean up
  if (agentStore.streamListenerCleanup) {
    agentStore.streamListenerCleanup()
    agentStore.streamListenerCleanup = null
  }
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

  // Re-start polling
  agentStore.startRunningPoll()
}

function clearAll(): void {
  agentStore.clearAllContexts()
  // Refresh the current drawer pagination if a node is selected
  if (projectStore.selectedNode) {
    agentStore.setPage(projectStore.selectedNode.name, 0)
  }
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
  agentStore.startRunningPoll()

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
  <div class="main-screen">
    <!-- FAB button group -->
    <el-button
      class="fab fab-back"
      title="返回"
      @click="goBack"
    >
      ←
    </el-button>
    <el-button
      class="fab fab-rescan"
      title="重新扫描"
      @click="rescan"
    >
      🔄
    </el-button>
    <el-button
      class="fab fab-clear-all"
      title="清空所有上下文"
      @click="clearAll"
    >
      🗑
    </el-button>
    <el-button
      class="fab fab-settings"
      title="设置"
      @click="showSettings = true"
    >
      ⚙
    </el-button>

    <ThemeToggle />

    <!-- SVG Tree panel -->
    <SVGTree
      :root="projectStore.treeRoot"
      :selected-node="projectStore.selectedNode"
      :running-agents="agentStore.runningAgents"
      @select="onSelectNode"
    />

    <!-- Drawer panel (shown when a node is selected) -->
    <DrawerPanel
      v-if="projectStore.selectedNode"
      :node="projectStore.selectedNode"
      :visible="true"
      @close="onCloseDrawer"
    />

    <!-- Settings dialog -->
    <SettingsDialog
      v-if="showSettings"
      :visible="showSettings"
      @close="showSettings = false"
    />

    <!-- Status bar -->
    <div class="status-bar">
      <span class="dot" :class="{ scanning }" />
      <span class="status-text">{{ statusText }}</span>
      <span class="spacer" />
      <span class="status-path">{{ projectName }}</span>
    </div>
  </div>
</template>

<style scoped>
.main-screen {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.fab {
  position: fixed;
  z-index: 50;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  padding: 0;
  min-width: 0;
}

.fab-back {
  top: 10px;
  left: 12px;
}

.fab-rescan {
  top: 10px;
  left: 56px;
}

.fab-clear-all {
  top: 10px;
  right: 56px;
  font-size: 14px;
}

.fab-settings {
  top: 10px;
  right: 12px;
  font-size: 18px;
}

.status-bar {
  display: flex;
  align-items: center;
  padding: 5px 16px;
  background: var(--el-bg-color-page);
  border-top: 1px solid var(--el-border-color-light);
  font-size: 11px;
  color: var(--el-text-color-secondary);
  gap: 8px;
  flex-shrink: 0;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-success);
}

.dot.scanning {
  background: var(--el-color-warning);
  animation: pulse-dot 0.8s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.spacer {
  flex: 1;
}
</style>

<!-- Global overrides for child component root elements -->
<style>
.tree-panel {
  z-index: 1;
}
</style>
