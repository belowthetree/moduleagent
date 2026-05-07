<script setup lang="ts">
import { computed, watch } from 'vue'
import type { TreeNode } from '../../../types/preload'
import { useConfigStore } from '../stores/config'
import { useAgentStore } from '../stores/agent'
import ContextCards from './ContextCards.vue'
import ChatInput from './ChatInput.vue'

const props = defineProps<{
  node: TreeNode | null
}>()

const emit = defineEmits<{
  close: []
}>()

const configStore = useConfigStore()
const agentStore = useAgentStore()

const agentCwd = computed(() => {
  if (!props.node) return ''
  if (props.node.path === '.') return configStore.projectPath
  const base = configStore.projectPath
  return base + '/' + props.node.path.replace(/^\.\//, '')
})

async function handleSendMessage(text: string): Promise<void> {
  if (!props.node) return
  await agentStore.sendMessage(props.node.name, text, agentCwd.value)
}

watch(() => props.node?.name, (newName) => {
  if (newName) {
    agentStore.restoreContext(newName)
  }
}, { immediate: true })
</script>

<template>
  <div class="detail-panel" v-if="node">
    <div class="detail-header">
      <span class="detail-title">{{ node.name }}</span>
      <button class="btn-close" @click="emit('close')">✕</button>
    </div>

    <div class="detail-body">
      <div class="info-compact">
        <span class="ic-item">
          <span class="ic-label">路径</span>
          <span class="ic-value">{{ node.path }}</span>
        </span>
        <span class="ic-item">
          <span class="ic-label">子模块</span>
          <span class="ic-value">{{ node.children?.length ?? 0 }} 个</span>
        </span>
        <span class="ic-item">
          <span class="ic-label">Agent CWD</span>
          <span class="ic-value">{{ agentCwd }}</span>
        </span>
      </div>

      <div class="desc">{{ node.description || '无描述' }}</div>

      <div class="ctx-list-area">
        <ContextCards :module-name="node.name" />
      </div>

      <div class="ctx-chat">
        <ChatInput :module-name="node.name" @send="handleSendMessage" />
      </div>
    </div>
  </div>

  <div v-else class="detail-placeholder">
    <div class="placeholder-icon">📋</div>
    <p class="placeholder-text">点击节点树中的模块节点查看详情和对话</p>
  </div>
</template>

<style scoped>
.detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-fill-color);
  border-left: 1px solid var(--el-border-color);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.detail-title {
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

.detail-body {
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
  flex-shrink: 0;
}

.ic-item {
  display: inline-flex;
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
  flex-shrink: 0;
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
}
</style>
