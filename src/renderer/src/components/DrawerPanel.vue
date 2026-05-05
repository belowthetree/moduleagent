<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { TreeNode } from '../../../types/preload'
import { useConfigStore } from '../stores/config'
import StreamArea from './StreamArea.vue'
import ContextCards from './ContextCards.vue'
import ChatInput from './ChatInput.vue'

const props = defineProps<{
  node: TreeNode | null
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const configStore = useConfigStore()

// ── refs ──
const drawerRef = ref<HTMLElement | null>(null)
const splitZoneRef = ref<HTMLElement | null>(null)

// ── resize state ──
const resizeDragging = ref(false)
let resizeStartX = 0
let resizeStartWidth = 0

// ── splitter state ──
const splitRatio = ref(0.4)
const splitterDragging = ref(false)

// ── agent CWD ──
const agentCwd = computed(() => {
  if (!props.node) return ''
  if (props.node.path === '.') return configStore.projectPath
  const base = configStore.workspacePath || configStore.projectPath
  return base + '/' + props.node.path.replace(/^\.\//, '')
})

// ── splitter styles ──
const streamAreaStyle = computed(() => ({
  flex: `0 0 ${(splitRatio.value * 100).toFixed(1)}%`,
}))

const ctxBottomStyle = computed(() => ({
  flex: `0 0 ${((1 - splitRatio.value) * 100).toFixed(1)}%`,
}))

// ── resize handlers ──
function onResizeMousedown(e: MouseEvent) {
  e.preventDefault()
  resizeDragging.value = true
  resizeStartX = e.clientX
  resizeStartWidth = drawerRef.value?.getBoundingClientRect().width ?? 420
}

// ── splitter handlers ──
function onSplitterMousedown(e: MouseEvent) {
  e.preventDefault()
  splitterDragging.value = true
}

// ── window-level mouse events ──
function onWindowMousemove(e: MouseEvent) {
  if (resizeDragging.value) {
    const delta = resizeStartX - e.clientX
    const newWidth = Math.min(800, Math.max(280, resizeStartWidth + delta))
    document.documentElement.style.setProperty('--drawer-width', newWidth + 'px')
  }
  if (splitterDragging.value && splitZoneRef.value) {
    const rect = splitZoneRef.value.getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = Math.min(0.75, Math.max(0.15, y / rect.height))
    splitRatio.value = ratio
  }
}

function onWindowMouseup() {
  if (resizeDragging.value) {
    resizeDragging.value = false
    const currentWidth = document.documentElement.style.getPropertyValue('--drawer-width')
    localStorage.setItem('drawerWidth', currentWidth || '420')
  }
  if (splitterDragging.value) {
    splitterDragging.value = false
    localStorage.setItem('splitRatio', String(splitRatio.value))
  }
}

// ── lifecycle ──
onMounted(() => {
  // Restore drawer width
  const savedWidth = localStorage.getItem('drawerWidth')
  if (savedWidth) {
    const w = parseInt(savedWidth, 10) || 420
    document.documentElement.style.setProperty('--drawer-width', w + 'px')
  }

  // Restore split ratio
  const savedRatio = localStorage.getItem('splitRatio')
  if (savedRatio) {
    const ratio = parseFloat(savedRatio)
    if (!isNaN(ratio) && ratio >= 0.15 && ratio <= 0.75) {
      splitRatio.value = ratio
    }
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

      <div ref="splitZoneRef" class="split-zone">
        <div class="stream-area" :style="streamAreaStyle">
          <StreamArea v-if="node" :module-name="node.name" />
        </div>
        <div
          class="splitter"
          :class="{ dragging: splitterDragging }"
          @mousedown="onSplitterMousedown"
        />
        <div class="ctx-bottom" :style="ctxBottomStyle">
          <ContextCards v-if="node" :module-name="node.name" />
        </div>
      </div>

      <div class="ctx-chat">
        <ChatInput v-if="node" :module-name="node.name" />
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
  background: rgba(0, 0, 0, 0.3);
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
  background: var(--surface);
  border-left: 1px solid var(--border);
  z-index: 100;
  display: flex;
  flex-direction: column;
  transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
}

.drawer.open {
  right: 0;
}

.drawer-resize-handle {
  position: absolute;
  top: 0;
  left: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}

.drawer-resize-handle:hover,
.drawer-resize-handle.dragging {
  background: var(--accent);
  opacity: 0.4;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.drawer-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
}

.btn-close {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--node-bg);
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-close:hover {
  background: var(--error);
  color: #fff;
  border-color: var(--error);
}

.drawer-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.info-compact {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
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
  color: var(--text-dim);
  font-weight: 600;
}

.ic-value {
  color: var(--text);
}

.desc {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 10px;
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;
  padding: 10px 20px 0;
}

.split-zone {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.stream-area {
  overflow-y: auto;
  padding: 12px 20px;
  min-height: 60px;
}

.splitter {
  height: 6px;
  flex-shrink: 0;
  cursor: row-resize;
  background: var(--border);
  margin: 0 20px;
  border-radius: 3px;
  transition: background 0.15s;
}

.splitter:hover,
.splitter.dragging {
  background: var(--accent);
}

.ctx-bottom {
  display: flex;
  flex-direction: column;
  min-height: 60px;
  overflow: hidden;
}

.ctx-chat {
  display: flex;
  gap: 6px;
  padding: 10px 20px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
</style>
