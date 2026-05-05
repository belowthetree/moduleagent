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
  gap: 6px;
  width: 100%;
}

.chat-input .el-input {
  flex: 1;
}
</style>
