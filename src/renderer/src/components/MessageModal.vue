<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatMsg } from '../../../types/preload'

const props = defineProps<{
  visible: boolean
  message: ChatMsg | null
}>()

const emit = defineEmits<{
  close: []
}>()

const visibleModel = computed({
  get: () => props.visible,
  set: (val) => { if (!val) emit('close') },
})

const title = computed(() => {
  if (!props.message) return ''
  const msg = props.message
  if (msg.role === 'cross') {
    return msg.crossDirection === 'sent'
      ? `跨模块发送 → ${msg.crossModule || ''}`
      : `跨模块接收 ← ${msg.crossModule || ''}`
  }
  return msg.role === 'user' ? '用户消息详情' : 'Agent 回复详情'
})

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    sent: '已发送',
    pending: '等待中',
    thinking: '思考中',
    executing: '执行中',
    completed: '已完成',
    error: '失败',
    interrupted: '中断',
  }
  return map[s] || s
}

const roleLabel = computed(() => {
  if (!props.message) return ''
  return props.message.role === 'user' ? '用户' : 'Agent'
})

const roleDisplay = computed(() => {
  if (!props.message) return ''
  return props.message.role === 'user' ? '输入' : '回复'
})

const thinkingOpen = ref(false)

watch(
  () => props.visible,
  (v) => {
    if (v) thinkingOpen.value = false
  },
)

function toggleThinking() {
  thinkingOpen.value = !thinkingOpen.value
}
</script>

<template>
  <el-dialog
    v-model="visibleModel"
    :title="title"
    width="680px"
    top="5vh"
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    destroy-on-close
    class="msg-modal"
  >
    <template v-if="message">
      <div class="modal-status-row">
        <span :class="['modal-status-badge', `st-${message.status}`]">
          {{ statusLabel(message.status) }}
        </span>
        <span class="modal-st-label">{{ roleLabel }}</span>
      </div>

      <div class="modal-info-grid">
        <div class="mg-item">
          <span class="mg-lbl">时间</span>
          <span class="mg-val">{{ message.time }}</span>
        </div>
        <div class="mg-item">
          <span class="mg-lbl">模块</span>
          <span class="mg-val">{{ message.moduleName }}</span>
        </div>
        <div class="mg-item">
          <span class="mg-lbl">Agent</span>
          <span class="mg-val">{{ message.agentCmd }}</span>
        </div>
        <div class="mg-item">
          <span class="mg-lbl">角色</span>
          <span class="mg-val">{{ roleDisplay }}</span>
        </div>
      </div>

      <div v-if="message.thinking" class="modal-section">
        <div class="modal-section-title modal-thinking-toggle" @click="toggleThinking">
          💭 思考过程
          <span class="ctx-thinking-arrow">{{ thinkingOpen ? '▼' : '▶' }}</span>
        </div>
        <div v-show="thinkingOpen" class="content-text thinking-text modal-thinking-content">
          {{ message.thinking }}
        </div>
      </div>

      <div v-if="message.tools" class="modal-section">
        <div class="modal-section-title">🔧 工具调用</div>
        <div class="content-text tools-text">{{ message.tools }}</div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title">💬 回复</div>
        <div class="content-text">
          {{ message.content || '(无文本回复)' }}
        </div>
      </div>
    </template>

    <template v-else>
      <div class="content-text" style="color: var(--text-dim)">无消息数据</div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ── Status Row ── */
.modal-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.modal-status-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 8px;
  letter-spacing: 0.5px;
}

.st-sent { background: #2a3f5f; color: #7aa2f7; }
.st-pending { background: #3d3520; color: #e0af68; }
.st-thinking { background: #2a2040; color: #bb9af7; }
.st-executing { background: #1f3a2f; color: #9ece6a; }
.st-completed { background: #1a3220; color: #9ece6a; }
.st-error { background: #3a1520; color: #f7768e; }
.st-interrupted { background: #3d3520; color: #e0af68; }

.modal-st-label {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 600;
}

/* ── Info Grid ── */
.modal-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 20px;
  padding-bottom: 6px;
}

.mg-item {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
}

.mg-lbl {
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 600;
}

.mg-val {
  font-size: 12px;
  color: var(--text);
}

/* ── Sections ── */
.modal-section {
  margin-bottom: 12px;
}

.modal-section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.content-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 6px;
  padding: 14px;
  background: var(--bg);
  border-radius: 10px;
  border: 1px solid var(--border);
}

.thinking-text {
  color: var(--text-dim);
  font-style: italic;
  border-color: rgba(160, 160, 200, 0.15);
}

.tools-text {
  color: #f0a000;
  border-color: rgba(240, 160, 0, 0.15);
}

/* ── Thinking Toggle ── */
.modal-thinking-toggle {
  cursor: pointer;
  user-select: none;
}

.modal-thinking-toggle:hover {
  color: var(--accent);
}

.ctx-thinking-arrow {
  font-size: 10px;
  margin-left: 4px;
}

.modal-thinking-content {
  margin-top: 6px;
}

/* ── el-dialog overrides ── */
:deep(.el-dialog__header) {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}

:deep(.el-dialog__title) {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent2);
}

:deep(.el-dialog__body) {
  padding: 20px;
}
</style>
