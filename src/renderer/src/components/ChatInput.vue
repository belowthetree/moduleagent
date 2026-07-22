<!--
  ChatInput.vue — 聊天消息输入组件
  支持多行输入、发送、模型模式切换、模块选择
-->

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Promotion } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'

const props = defineProps<{
  moduleName: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
}>()

const agentStore = useAgentStore()
const text = ref('')
const inputRef = ref<{ focus: () => void } | null>(null)

const isDisabled = computed(() => props.disabled || agentStore.sendingLock)

function sendMessage() {
  const trimmed = text.value.trim()
  if (!trimmed || isDisabled.value) return
  emit('send', trimmed)
  text.value = ''
  nextTick(() => {
    inputRef.value?.focus()
  })
}
</script>

<template>
  <div class="chat-input">
    <div class="input-shell" :class="{ 'is-disabled': isDisabled }">
      <el-input
        ref="inputRef"
        v-model="text"
        :disabled="isDisabled"
        placeholder="输入消息发送给 Agent..."
        @keyup.enter="sendMessage"
      />
      <el-tooltip content="发送" placement="top">
        <el-button
          class="send-btn"
          type="primary"
          :icon="Promotion"
          circle
          :disabled="!text.trim() || isDisabled"
          aria-label="发送"
          @click="sendMessage"
        />
      </el-tooltip>
    </div>
    <div class="input-hint">Enter 发送</div>
  </div>
</template>

<style scoped>
.chat-input {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: var(--app-space-2) var(--app-space-4) 10px;
  background: var(--el-bg-color);
}

/* ── 圆角 12px 输入容器：1px 边框，focus-within 主色边框 + 2px 软光环 ── */
.input-shell {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  padding: 4px 4px 4px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--app-radius-lg);
  background: var(--el-bg-color);
  transition: border-color var(--app-transition-fast), box-shadow var(--app-transition-fast), background var(--app-transition-fast);
}

.input-shell:hover {
  border-color: var(--el-border-color-dark);
}

.input-shell:focus-within {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--app-accent-soft);
}

.input-shell.is-disabled {
  background: var(--el-fill-color-light);
}

.chat-input :deep(.el-input) {
  flex: 1;
}

/* 内层输入框去边框，由外层容器承载边框与焦点态 */
.chat-input :deep(.el-input__wrapper) {
  border: none;
  box-shadow: none !important;
  background: transparent;
  padding: 0 2px;
  min-height: 32px;
  border-radius: 0;
}

/* ── 发送图标按钮：主色圆形，禁态降低透明度 ── */
.chat-input :deep(.send-btn) {
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  flex-shrink: 0;
  transition: background var(--app-transition-fast), opacity var(--app-transition-fast), transform var(--app-transition-fast);
}

.chat-input :deep(.send-btn:not(.is-disabled):hover) {
  background: var(--el-color-primary-dark-2);
}

.chat-input :deep(.send-btn:not(.is-disabled):active) {
  transform: scale(0.94);
}

.chat-input :deep(.send-btn.is-disabled) {
  opacity: 0.45;
}

/* ── 底部辅助提示 ── */
.input-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 6px;
  padding-left: var(--app-space-1);
  user-select: none;
}
</style>
