<!--
  NodeDetailPanel.vue — 模块详情面板
  内联显示模块信息、描述、子模块，并支持对模块发送消息
-->

<script setup lang="ts">
import { computed, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'
import type { TreeNode } from '../../../types/shared'
import { useAgentStore } from '../stores/agent'
import ContextCards from './ContextCards.vue'
import ChatInput from './ChatInput.vue'

const props = defineProps<{
  node: TreeNode | null
}>()

const emit = defineEmits<{
  close: []
}>()

const agentStore = useAgentStore()

const agentCwd = computed(() => props.node?.cwd ?? '')

async function handleClearContext(): Promise<void> {
  if (!props.node) return
  await agentStore.clearContext(props.node.name)
}

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
      <button class="btn-close" aria-label="关闭" @click="emit('close')">
        <el-icon><Close /></el-icon>
      </button>
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
        <ContextCards :module-name="node.name" @clear="handleClearContext" />
      </div>

      <div class="ctx-chat">
        <ChatInput :module-name="node.name" @send="handleSendMessage" />
      </div>
    </div>
  </div>

</template>

<style scoped>
.detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-bg-color);
  border-left: 1px solid var(--el-border-color);
}

/* ── 面板头部：模块名 16px 600 + 关闭图标按钮 ── */
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
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background var(--app-transition-fast), color var(--app-transition-fast);
}

.btn-close:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.btn-close:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.detail-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 var(--app-space-4) var(--app-space-3);
}

.info-compact {
  padding: var(--app-space-3) 0;
  border-bottom: 1px solid var(--el-border-color-light);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 11px;
  flex-shrink: 0;
}

.ic-item {
  display: inline-flex;
  gap: var(--app-space-1);
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
  line-height: 1.6;
  user-select: text;
  -webkit-user-select: text;
  padding: var(--app-space-3) 0 0;
  flex-shrink: 0;
}

/* ── 消息区滚动细化 ── */
.ctx-list-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: var(--app-space-2) 0 var(--app-space-3);
  scrollbar-width: thin;
  scrollbar-color: var(--el-border-color-dark) transparent;
}

.ctx-list-area::-webkit-scrollbar {
  width: 8px;
}

.ctx-list-area::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}

.ctx-list-area::-webkit-scrollbar-track {
  background: transparent;
}

/* ── 输入组合区 ── */
.ctx-chat {
  display: flex;
  gap: 6px;
  padding: var(--app-space-3) 0 0;
  border-top: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
}

.ctx-chat :deep(.chat-input) {
  padding-left: 0;
  padding-right: 0;
  background: transparent;
}

</style>
