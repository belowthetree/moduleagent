<!--
  MessageModal.vue — 消息详情模态框
  展示单条消息的完整内容，支持 Markdown 渲染
-->

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChatDotRound, Opportunity, Tools } from '@element-plus/icons-vue'
import type { ChatMsg } from '../../../types/shared'

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
          <el-icon class="section-icon"><Opportunity /></el-icon>思考过程
          <span class="ctx-thinking-arrow">{{ thinkingOpen ? '▼' : '▶' }}</span>
        </div>
        <div v-show="thinkingOpen" class="content-text thinking-text modal-thinking-content">
          {{ message.thinking }}
        </div>
      </div>

      <div v-if="message.tools" class="modal-section">
        <div class="modal-section-title"><el-icon class="section-icon"><Tools /></el-icon>工具调用</div>
        <div class="content-text tools-text">{{ message.tools }}</div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title"><el-icon class="section-icon"><ChatDotRound /></el-icon>回复</div>
        <div class="content-text">
          {{ message.content || '(无文本回复)' }}
        </div>
      </div>
    </template>

    <template v-else>
      <div class="content-text" style="color: var(--el-text-color-secondary)">无消息数据</div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ── 对话框统一视觉：圆角 16px + 弹层阴影 ── */
:deep(.el-dialog) {
  border-radius: var(--app-radius-xl);
  box-shadow: var(--app-shadow-3);
  animation: none !important;
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--el-border-color-light);
  padding: 20px 24px 16px;
  margin-right: 0;
}

:deep(.el-dialog__title) {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

:deep(.el-dialog__body) {
  padding: var(--app-space-5);
}

/* ── 状态行 ── */
.modal-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--app-space-4);
}

.modal-status-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: var(--app-radius-md);
  letter-spacing: 0.5px;
}

.st-sent { background: var(--el-color-info-light-8); color: var(--el-color-info); }
.st-pending { background: var(--el-color-warning-light-7); color: var(--el-color-warning); }
.st-thinking { background: var(--el-color-primary-light-7); color: var(--el-color-primary); }
.st-executing { background: var(--el-color-success-light-7); color: var(--el-color-success); }
.st-completed { background: var(--el-color-success-light-8); color: var(--el-color-success); }
.st-error { background: var(--el-color-danger-light-7); color: var(--el-color-danger); }
.st-interrupted { background: var(--el-color-warning-light-8); color: var(--el-color-warning); }

.modal-st-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: 600;
}

/* ── 信息网格 ── */
.modal-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 20px;
  padding-bottom: var(--app-space-3);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.mg-item {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
}

.mg-lbl {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-weight: 600;
}

.mg-val {
  font-size: 12px;
  color: var(--el-text-color-primary);
}

/* ── 区块 ── */
.modal-section {
  padding: var(--app-space-3) 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.modal-section:last-child {
  border-bottom: none;
}

.modal-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--app-space-1);
}

.section-icon {
  font-size: 13px;
}

/* ── 内容块：与 ContextCards 一致的排版语言 ── */
.content-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 6px;
  padding: 12px 14px;
  border-radius: var(--app-radius-lg);
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

.thinking-text {
  color: var(--el-text-color-secondary);
  font-style: italic;
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-lighter);
}

.tools-text {
  font-family: var(--app-mono);
  font-size: 12px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  border-color: var(--el-color-warning-light-8);
}

/* ── 思考切换 ── */
.modal-thinking-toggle {
  cursor: pointer;
  user-select: none;
  border-radius: var(--app-radius-sm);
  transition: color var(--app-transition-fast);
}

.modal-thinking-toggle:hover {
  color: var(--el-color-primary);
}

.ctx-thinking-arrow {
  font-size: 10px;
  margin-left: 2px;
}

.modal-thinking-content {
  margin-top: 6px;
}
</style>
