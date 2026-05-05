<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMsg } from '../../../types/preload'
import { useAgentStore } from '../stores/agent'

const props = defineProps<{
  moduleName: string
}>()

const emit = defineEmits<{
  showDetail: [msg: ChatMsg]
  clear: []
}>()

const agentStore = useAgentStore()
const expandedThinking = ref(new Set<string>())

// ── Helpers ──
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

function roleIcon(role: string): string {
  if (role === 'user') return '👤'
  if (role === 'agent') return '🤖'
  return ''
}

function roleLabel(role: string): string {
  if (role === 'user') return '用户'
  if (role === 'agent') return 'Agent'
  return ''
}

// ── Messages (all, no pagination) ──
const msgs = computed<ChatMsg[]>(() => agentStore.getMsgs(props.moduleName))

const isEmpty = computed(() => msgs.value.length === 0)

// ── Thinking toggle ──
function toggleThinking(id: string) {
  const s = expandedThinking.value
  const next = new Set(s)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expandedThinking.value = next
}

function isThinkingExpanded(id: string): boolean {
  return expandedThinking.value.has(id)
}

// ── Card click ──
function onCardClick(msg: ChatMsg) {
  emit('showDetail', msg)
}

function onClear() {
  emit('clear')
}

function onCancelStream() {
  agentStore.cancelAgent(props.moduleName)
}
</script>

<template>
  <div class="ctx-section">
    <!-- Header with clear button -->
    <div class="ctx-top-controls">
      <span class="section-title">上下文历史</span>
      <button class="btn-sm" @click="onClear">清空</button>
    </div>

    <!-- Empty state -->
    <div v-if="isEmpty" class="ctx-empty">No conversations yet</div>

    <!-- Message list (newest at bottom) -->
    <div v-else class="ctx-card-list">
      <div
        v-for="msg in msgs"
        :key="msg.id"
        class="ctx-card"
        :class="{ 'ctx-card-streaming': msg.role === 'agent' && msg.status === 'executing' }"
        @click="onCardClick(msg)"
      >
        <div class="ctx-card-top">
          <span
            v-if="msg.role === 'cross'"
            class="ctx-role cross"
          >{{ msg.crossDirection === 'sent' ? '📤' : '📥' }} 跨模块 {{ msg.crossDirection === 'sent' ? '→ ' + (msg.crossModule || '') : '← ' + (msg.crossModule || '') }}</span>
          <span
            v-else
            class="ctx-role"
            :class="msg.role"
          >{{ roleIcon(msg.role) }} {{ roleLabel(msg.role) }}</span>
          <span class="ctx-status" :class="'st-' + msg.status">{{ statusLabel(msg.status) }}</span>
        </div>

        <!-- Thinking toggle -->
        <div v-if="msg.thinking" class="ctx-thinking-toggle" @click.stop="toggleThinking(msg.id)">
          <span class="ctx-tag tag-thinking">思考</span>
          <span class="ctx-thinking-arrow">{{ isThinkingExpanded(msg.id) ? '▼' : '▶' }}</span>
          <span class="ctx-thinking-preview">{{ msg.thinking.slice(0, 40) }}...</span>
        </div>
        <div
          v-if="msg.thinking && isThinkingExpanded(msg.id)"
          class="ctx-thinking-content"
        >{{ msg.thinking }}</div>

        <!-- Tools summary: show actual tool names -->
        <div v-if="msg.tools" class="ctx-tools">
          <span class="ctx-tag tag-tools">工具</span>
          <span class="ctx-tools-count">{{ msg.tools.split('\n').filter(Boolean).length }} 次调用</span>
          <div class="ctx-tools-list">
            <span
              v-for="(line, idx) in msg.tools.split('\n').filter(Boolean)"
              :key="idx"
              class="ctx-tool-line"
            >{{ line }}</span>
          </div>
        </div>

        <!-- Content -->
        <div class="ctx-preview">
          <template v-if="msg.content">{{ msg.content }}<span v-if="msg.role === 'agent' && msg.status === 'executing'" class="ctx-cursor"></span></template>
          <span v-else-if="msg.role === 'agent' && msg.status === 'executing'" class="ctx-empty-preview">等待中...<span class="ctx-cursor"></span></span>
          <span v-else class="ctx-empty-preview">(无文本回复)</span>
        </div>

        <!-- Time -->
        <div class="ctx-time">{{ msg.time }}</div>

        <!-- Cancel button for streaming -->
        <button
          v-if="msg.role === 'agent' && msg.status === 'executing'"
          class="btn-cancel-stream"
          @click.stop="onCancelStream"
        >取消</button>
      </div>

      <!-- ── Live streaming card ── -->
      <div
        v-if="isStreaming"
        class="ctx-card ctx-card-streaming"
      >
        <div class="ctx-card-top">
          <span class="ctx-role agent">🤖 Agent</span>
          <span class="ctx-status st-streaming">流式输出中</span>
        </div>

        <!-- Live thinking section -->
        <div
          v-if="streamState?.sections.thinking"
          class="ctx-stream-section ctx-stream-thinking"
        >
          <span class="ctx-stream-label">💭 思考</span>
          <div class="ctx-stream-body thinking-text">{{ streamState?.thinking || '' }}</div>
        </div>

        <!-- Live tools section -->
        <div
          v-if="streamState?.sections.tools"
          class="ctx-stream-section ctx-stream-tools"
        >
          <span class="ctx-stream-label">🔧 工具调用</span>
          <div class="ctx-stream-body tools-text">
            <span
              v-for="(line, idx) in (streamState?.tools || '').split('\n').filter(Boolean)"
              :key="idx"
              class="stream-tool-line"
            >{{ line }}</span>
          </div>
        </div>

        <!-- Live reply section -->
        <div
          v-if="streamState?.sections.reply"
          class="ctx-stream-section ctx-stream-reply"
        >
          <span class="ctx-stream-label">💬 回复</span>
          <div class="ctx-stream-body">{{ streamState?.reply || '' }}<span class="stream-cursor"></span></div>
        </div>

        <!-- Cancel button -->
        <button class="btn-cancel-stream" @click.stop="onCancelStream">
          取消
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Section header ── */
.ctx-section {
  margin-top: 4px;
}

.ctx-top-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.ctx-top-controls .section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.ctx-top-controls .btn-sm {
  padding: 3px 10px;
  font-size: 11px;
  border: 1px solid var(--el-border-color);
  border-radius: 5px;
  background: transparent;
  color: var(--el-color-danger);
  cursor: pointer;
}

.ctx-top-controls .btn-sm:hover {
  background: var(--el-color-danger);
  color: #fff;
  border-color: var(--el-color-danger);
}

/* ── Empty state ── */
.ctx-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 16px;
  text-align: center;
  background: var(--el-fill-color-blank);
  border-radius: 8px;
  border: 1px dashed var(--el-border-color-lighter);
}

/* ── Card list ── */
.ctx-card-list {
  display: flex;
  flex-direction: column;
}

/* ── Card ── */
.ctx-card {
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  transition: background 0.15s;
  user-select: text;
  -webkit-user-select: text;
}

.ctx-card:last-child {
  border-bottom: none;
}

.ctx-card:hover {
  background: var(--el-fill-color-light);
}

.ctx-card-streaming {
  background: var(--el-color-primary-light-9);
  border-bottom: 2px solid var(--el-color-primary-light-5);
}

.ctx-card-streaming:hover {
  background: var(--el-color-primary-light-9);
}

.ctx-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.ctx-card .ctx-role {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.ctx-card .ctx-role.user {
  color: var(--el-color-success);
}

.ctx-card .ctx-role.agent {
  color: var(--el-color-primary);
}

.ctx-card .ctx-role.cross {
  color: var(--el-color-warning);
}

/* ── Status badges ── */
.ctx-status {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 8px;
  letter-spacing: 0.5px;
}

.st-sent        { background: var(--el-color-info-light-8);    color: var(--el-color-info); }
.st-pending     { background: var(--el-color-warning-light-7); color: var(--el-color-warning); }
.st-thinking    { background: var(--el-color-primary-light-7); color: var(--el-color-primary); }
.st-executing   { background: var(--el-color-success-light-7); color: var(--el-color-success); }
.st-completed   { background: var(--el-color-success-light-8); color: var(--el-color-success); }
.st-error       { background: var(--el-color-danger-light-7);  color: var(--el-color-danger); }
.st-interrupted { background: var(--el-color-warning-light-8); color: var(--el-color-warning); }

/* ── Content ── */
.ctx-card .ctx-preview {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}

.ctx-empty-preview {
  color: var(--el-text-color-secondary);
  font-style: italic;
  opacity: 0.5;
}

/* ── Time ── */
.ctx-card .ctx-time {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  opacity: 0.5;
  margin-top: 4px;
}

/* ── Thinking toggle ── */
.ctx-thinking-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  margin-bottom: 2px;
  cursor: pointer;
  user-select: none;
}

.ctx-thinking-toggle:hover {
  color: var(--el-text-color-primary);
}

.ctx-thinking-arrow {
  font-size: 9px;
  color: var(--el-text-color-secondary);
}

.ctx-thinking-preview {
  color: var(--el-text-color-secondary);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.ctx-thinking-content {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-style: italic;
  line-height: 1.4;
  margin-bottom: 4px;
  padding: 6px 8px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

/* ── Tools ── */
.ctx-card .ctx-tools {
  font-size: 11px;
  margin-bottom: 2px;
}

.ctx-tools-count {
  color: var(--el-color-warning);
  vertical-align: middle;
}

.ctx-tools-list {
  margin-top: 4px;
  padding-left: 4px;
  border-left: 2px solid var(--el-color-warning-light-5);
}

.ctx-tool-line {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  padding: 1px 0;
  font-family: monospace;
}

.ctx-tag {
  font-size: 8px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  margin-right: 4px;
  vertical-align: middle;
  letter-spacing: 0.5px;
}

.tag-thinking {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.tag-tools {
  background: var(--el-color-warning-light-8);
  color: var(--el-color-warning);
}

/* ── Blinking cursor for streaming messages ── */
.ctx-cursor {
  display: inline-block;
  width: 6px;
  height: 14px;
  background: var(--el-color-primary);
  margin-left: 2px;
  animation: blink 1s infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ── Cancel button ── */
.btn-cancel-stream {
  display: block;
  width: 100%;
  padding: 6px;
  margin-top: 8px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-cancel-stream:hover {
  background: var(--el-color-danger-light-8);
}
</style>
