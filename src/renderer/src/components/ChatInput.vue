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
    <el-input
      ref="inputRef"
      v-model="text"
      :disabled="isDisabled"
      placeholder="输入消息发送给 Agent..."
      @keyup.enter="sendMessage"
    />
    <el-button
      type="primary"
      :icon="Promotion"
      :disabled="!text.trim() || isDisabled"
      @click="sendMessage"
    >
      发送
    </el-button>
  </div>
</template>

<style scoped>
.chat-input {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 16px;
  background: var(--el-bg-color);
}

.chat-input :deep(.el-input) {
  flex: 1;
}

.chat-input :deep(.el-input__wrapper) {
  border-radius: 8px;
  box-shadow: none !important;
  transition: border-color 0.15s;
}

.chat-input :deep(.el-input__wrapper:hover) {
  border-color: var(--el-border-color-dark);
}

.chat-input :deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}

.chat-input :deep(.el-button) {
  background: var(--el-color-primary);
  border: none;
  border-radius: 6px;
  box-shadow: none;
  color: #fff;
  padding: 6px 14px;
  font-size: 13px;
  transition: background 0.15s;
}

.chat-input :deep(.el-button:hover) {
  background: var(--el-color-primary-dark-2);
  color: #fff;
}

.chat-input :deep(.el-button.is-disabled) {
  background: var(--el-fill-color);
  border: none;
  color: var(--el-text-color-placeholder);
}
</style>
