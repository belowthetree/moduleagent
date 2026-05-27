<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { TreeNode } from '../../../types/shared'
import { useAgentStore } from '../stores/agent'
import ContextCards from './ContextCards.vue'
import ChatInput from './ChatInput.vue'

const props = defineProps<{
  node: TreeNode | null
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const agentStore = useAgentStore()

// ── 引用 ──
const drawerRef = ref<HTMLElement | null>(null)

// ── 调整大小状态 ──
const resizeDragging = ref(false)
let resizeStartX = 0
let resizeStartWidth = 0

// ── Agent 工作目录 ──
const agentCwd = computed(() => props.node?.cwd ?? '')

// ── 发送处理 ──
async function handleSendMessage(text: string): Promise<void> {
  if (!props.node) return
  const cwd = agentCwd.value
  await agentStore.sendMessage(props.node.name, text, cwd)
}

// ── 调整大小事件 ──
function onResizeMousedown(e: MouseEvent) {
  e.preventDefault()
  resizeDragging.value = true
  resizeStartX = e.clientX
  resizeStartWidth = drawerRef.value?.getBoundingClientRect().width ?? 420
}

// ── 窗口级鼠标事件 ──
function onWindowMousemove(e: MouseEvent) {
  if (resizeDragging.value) {
    const delta = resizeStartX - e.clientX
    const newWidth = Math.min(800, Math.max(280, resizeStartWidth + delta))
    document.documentElement.style.setProperty('--drawer-width', newWidth + 'px')
  }
}

function onWindowMouseup() {
  if (resizeDragging.value) {
    resizeDragging.value = false
    const currentWidth = document.documentElement.style.getPropertyValue('--drawer-width')
    localStorage.setItem('drawerWidth', currentWidth || '420')
  }
}

// ── 节点变化时恢复上下文 ──
watch(() => props.node?.name, (newName) => {
  if (newName) {
    agentStore.restoreContext(newName)
  }
}, { immediate: true })

// ── 生命周期 ──
onMounted(() => {
  // 恢复抽屉宽度
  const savedWidth = localStorage.getItem('drawerWidth')
  if (savedWidth) {
    const w = parseInt(savedWidth, 10) || 420
    document.documentElement.style.setProperty('--drawer-width', w + 'px')
  }

  window.addEventListener('mousemove', onWindowMousemove)
  window.addEventListener('mouseup', onWindowMouseup)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onWindowMousemove)
  window.removeEventListener('mouseup', onWindowMouseup)
})
</script>

<template>
  <div
    class="drawer-overlay"
    :class="{ open: visible }"
    @click="emit('close')"
  />

  <div
    ref="drawerRef"
    class="drawer"
    :class="{ open: visible }"
  >
    <div
      class="drawer-resize-handle"
      :class="{ dragging: resizeDragging }"
      @mousedown="onResizeMousedown"
    />

    <div class="drawer-header">
      <span class="drawer-title">{{ node?.name ?? '' }}</span>
      <button class="btn-close" @click="emit('close')">✕</button>
    </div>

    <div class="drawer-body">
      <div class="info-compact">
        <span class="ic-item">
          <span class="ic-label">路径</span>
          <span class="ic-value">{{ node?.path ?? '' }}</span>
        </span>
        <span class="ic-item">
          <span class="ic-label">子模块</span>
          <span class="ic-value">{{ (node?.children?.length ?? 0) }} 个</span>
        </span>
        <span class="ic-item">
          <span class="ic-label">Agent CWD</span>
          <span class="ic-value">{{ agentCwd }}</span>
        </span>
      </div>

      <div class="desc">{{ node?.description || '无描述' }}</div>

      <div class="ctx-list-area">
        <ContextCards v-if="node" :module-name="node.name" />
      </div>

      <div class="ctx-chat">
        <ChatInput v-if="node" :module-name="node.name" @send="handleSendMessage" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: transparent;
  z-index: 90;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s;
}

.drawer-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

.drawer {
  position: fixed;
  top: 0;
  right: calc(-1 * var(--drawer-width));
  width: var(--drawer-width);
  height: 100%;
  background: var(--el-fill-color);
  border-left: 1px solid var(--el-border-color);
  z-index: 100;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.06);
  transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer.open {
  right: 0;
}

.drawer-resize-handle {
  position: absolute;
  top: 0;
  left: -2px;
  width: 2px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: var(--el-border-color);
}

.drawer-resize-handle:hover,
.drawer-resize-handle.dragging {
  background: var(--el-color-primary);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
}

.drawer-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.btn-close {
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
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.btn-close:hover {
  background: var(--el-color-danger);
  color: var(--el-color-white);
  border-color: var(--el-color-danger);
}

.drawer-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 16px;
}

.info-compact {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 11px;
}

.ic-item {
  display: flex;
  gap: 4px;
}

.ic-label {
  color: var(--el-text-color-secondary);
  font-weight: 600;
}

.ic-value {
  color: var(--el-text-color-primary);
}

.desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;
  padding: 12px 0 0;
}

.ctx-list-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 12px;
}

.ctx-chat {
  display: flex;
  gap: 6px;
  padding: 12px 0 0;
  border-top: 1px solid var(--el-border-color);
  flex-shrink: 0;
}
</style>
