<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useAgentStore } from '../stores/agent'

const props = defineProps<{
  moduleName: string
}>()

const agentStore = useAgentStore()
const streamArea = ref<HTMLElement | null>(null)
const thinkingExpanded = ref(false)

const streamState = computed(() => {
  return agentStore.streamState.get(props.moduleName)
})

const isStreaming = computed(() => {
  const st = streamState.value
  return !!st && !st.finished
})

const isEmpty = computed(() => {
  const st = streamState.value
  return !st || (!st.reply && !st.thinking && !st.tools)
})

function scrollToBottom() {
  nextTick(() => {
    if (streamArea.value) {
      streamArea.value.scrollTop = streamArea.value.scrollHeight
    }
  })
}

function onCancel() {
  agentStore.cancelAgent(props.moduleName)
}

// Auto-scroll when stream data changes
watch(() => streamState.value?.reply, scrollToBottom)
watch(() => streamState.value?.thinking, scrollToBottom)
watch(() => streamState.value?.tools, scrollToBottom)

// Reset thinking expanded when stream restarts
watch(() => streamState.value, (st) => {
  if (st && !st.finished) {
    thinkingExpanded.value = false
  }
})
</script>

<template>
  <div ref="streamArea" class="stream-area">
    <div
      class="stream-content"
      :class="{
        'stream-active': isStreaming,
        'stream-empty-state': isEmpty,
      }"
    >
      <!-- Empty state -->
      <div v-if="isEmpty" class="stream-empty">等待 Agent 响应...</div>

      <!-- Thinking section -->
      <div
        v-if="streamState?.thinking"
        class="stream-section stream-section-thinking"
      >
        <div class="stream-section-header">
          <span class="stream-section-icon">💭</span>
          <span class="stream-section-label">思考过程</span>
        </div>
        <div v-if="isStreaming" class="stream-section-body">
          <span class="stream-thinking">{{ streamState.thinking }}</span>
        </div>
        <div v-else class="stream-section-body">
          <div
            class="thinking-toggle"
            @click="thinkingExpanded = !thinkingExpanded"
          >
            <span class="ctx-tag tag-thinking">思考</span>
            <span class="thinking-arrow">{{ thinkingExpanded ? '▼' : '▶' }}</span>
          </div>
          <div
            v-show="thinkingExpanded"
            class="thinking-content"
          >{{ streamState.thinking }}</div>
        </div>
      </div>

      <!-- Tools section -->
      <div
        v-if="streamState?.tools"
        class="stream-section stream-section-tools"
      >
        <div class="stream-section-header">
          <span class="stream-section-icon">🔧</span>
          <span class="stream-section-label">工具调用</span>
        </div>
        <div class="stream-section-body">
          <span
            v-for="(line, idx) in streamState.tools.split('\n').filter(Boolean)"
            :key="idx"
            class="stream-tool"
          >{{ '\n' + line + '\n' }}</span>
        </div>
      </div>

      <!-- Reply section -->
      <div
        v-if="streamState?.reply"
        class="stream-section stream-section-reply"
      >
        <div class="stream-section-header">
          <span class="stream-section-icon">💬</span>
          <span class="stream-section-label">回复</span>
        </div>
        <div class="stream-section-body">{{ streamState.reply }}</div>
      </div>
    </div>

    <!-- Cancel button -->
    <button
      v-if="isStreaming"
      class="btn-cancel-stream"
      @click="onCancel"
    >
      取消
    </button>
  </div>
</template>

<style scoped>
/* ── Stream area container ── */
.stream-area {
  overflow-y: auto;
  padding: 12px 16px;
  min-height: 60px;
  height: 100%;
  background: var(--el-fill-color-lighter);
}

/* ── Empty state ── */
.stream-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-style: italic;
  padding: 20px 0;
  text-align: center;
}

/* ── Stream content ── */
.stream-content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 0;
  user-select: text;
  -webkit-user-select: text;
}

/* ── Active stream blinking cursor ── */
.stream-active::after {
  content: '';
  display: inline-block;
  width: 8px;
  height: 15px;
  background: var(--el-color-primary);
  margin-left: 2px;
  animation: blink 1s infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.stream-cursor {
  animation: blink 1s infinite;
}

/* ── Stream sections (unified neutral) ── */
.stream-section {
  margin-bottom: 12px;
  border-left: 2px solid var(--el-border-color);
  padding: 8px 12px;
  background: var(--el-color-primary-light-9);
}

.stream-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--el-text-color-secondary);
}

.stream-section-icon {
  font-size: 12px;
  line-height: 1;
}

.stream-section-label {
  text-transform: uppercase;
  opacity: 0.8;
}

.stream-section-body {
  padding: 4px 0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-primary);
}

/* ── Thinking inline (during streaming) ── */
.stream-thinking {
  color: var(--el-text-color-secondary);
  font-style: italic;
  opacity: 0.85;
}

/* ── Thinking toggle (finished state) ── */
.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-style: normal;
  opacity: 1;
  margin-bottom: 6px;
}

.ctx-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tag-thinking {
  background: var(--el-color-primary-light-7);
  color: var(--el-text-color-secondary);
}

.thinking-arrow {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  line-height: 1;
}

.thinking-content {
  color: var(--el-text-color-secondary);
  font-style: italic;
  opacity: 0.85;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Tools inline ── */
.stream-tool {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* ── Cancel button ── */
.btn-cancel-stream {
  display: block;
  width: 100%;
  padding: 8px;
  margin: 8px 0;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-cancel-stream:hover {
  background: var(--el-color-danger-light-8);
}
</style>
