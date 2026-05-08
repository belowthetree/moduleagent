<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ChatMsg, TimelineEvent } from '../../../types/preload'
import { useAgentStore } from '../stores/agent'

const props = defineProps<{
  moduleName: string
  contextType?: 'module' | 'role'
}>()

const emit = defineEmits<{
  showDetail: [msg: ChatMsg]
  clear: []
}>()

const agentStore = useAgentStore()
const cardListRef = ref<HTMLElement | null>(null)
const expandedThinking = ref(new Set<string>())
const expandedTimelineItems = ref(new Set<string>())

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

function crossDirectionLabel(msg: ChatMsg): string {
  if (msg.crossDirection === 'sent') return `📤 发送至 ${msg.crossModule || '?'}`
  return `📥 来自 ${msg.crossModule || '?'}`
}

function crossPhaseLabel(msg: ChatMsg): string {
  return msg.crossPhase === 'request' ? '请求' : '响应'
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
const msgs = computed<ChatMsg[]>(() => {
  if (props.contextType === 'role') {
    return agentStore.getRoleMsgs(props.moduleName)
  }
  return agentStore.getMsgs(props.moduleName)
})

const isEmpty = computed(() => msgs.value.length === 0)

// ── Auto-scroll to bottom ──
function scrollToBottom() {
  nextTick(() => {
    if (cardListRef.value && cardListRef.value.lastElementChild) {
      cardListRef.value.lastElementChild.scrollIntoView({ behavior: 'instant', block: 'end' })
    }
  })
}

watch(() => msgs.value.length, scrollToBottom)
watch(() => msgs.value.map(m => m.content + m.thinking + m.tools + (m.timeline ? JSON.stringify(m.timeline) : '')).join(''), scrollToBottom)

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

// ── Timeline item toggle ──
function timelineItemKey(msgId: string, idx: number): string {
  return `${msgId}:${idx}`
}

function toggleTimelineItem(msgId: string, idx: number) {
  const key = timelineItemKey(msgId, idx)
  const next = new Set(expandedTimelineItems.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expandedTimelineItems.value = next
}

function isTimelineItemExpanded(msgId: string, idx: number): boolean {
  return expandedTimelineItems.value.has(timelineItemKey(msgId, idx))
}

// ── Tool classification ──
const CROSS_MODULE_TOOLS = ['module_call', 'module_query']

function isCrossModuleTool(ev: TimelineEvent): boolean {
  return CROSS_MODULE_TOOLS.some(name => ev.content.includes(name))
}

// ── Card click ──
function onCardClick(msg: ChatMsg) {
  emit('showDetail', msg)
}

function onClear() {
  emit('clear')
}

function onCancelStream() {
  if (props.contextType === 'role') {
    agentStore.cancelRoleAgent(props.moduleName)
  } else {
    agentStore.cancelAgent(props.moduleName)
  }
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
    <div ref="cardListRef" v-else class="ctx-card-list">
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
          >{{ crossDirectionLabel(msg) }}</span>
          <span
            v-else
            class="ctx-role"
            :class="msg.role"
          >{{ roleIcon(msg.role) }} {{ roleLabel(msg.role) }}</span>
          <span class="ctx-status" :class="'st-' + msg.status">{{ statusLabel(msg.status) }}</span>
          <span v-if="msg.role === 'cross'" class="ctx-phase-tag">{{ crossPhaseLabel(msg) }}</span>
        </div>

        <!-- Interleaved timeline (new format) -->
        <div v-if="msg.timeline && msg.timeline.length > 0" class="ctx-timeline">
          <div
            v-for="(ev, idx) in msg.timeline"
            :key="idx"
            class="ctx-timeline-item"
            :class="'tl-' + ev.type"
          >
            <template v-if="ev.type === 'thinking'">
              <div class="tl-thinking-header" @click.stop="toggleTimelineItem(msg.id, idx)">
                <span class="tl-arrow">{{ isTimelineItemExpanded(msg.id, idx) ? '▼' : '▶' }}</span>
                <span class="ctx-tag tag-thinking">思考</span>
                <span class="tl-thinking-preview">{{ ev.content.slice(0, 60) }}{{ ev.content.length > 60 ? '...' : '' }}</span>
              </div>
              <div
                v-if="isTimelineItemExpanded(msg.id, idx)"
                class="tl-thinking-full"
              >{{ ev.content }}</div>
            </template>
            <div v-else class="tl-tool-line">
              <!-- Cross-module tool: detected by tool name -->
              <template v-if="isCrossModuleTool(ev)">
                <div class="tl-tool-header" @click.stop="toggleTimelineItem(msg.id, idx)">
                  <span class="tl-arrow">{{ isTimelineItemExpanded(msg.id, idx) ? '▼' : '▶' }}</span>
                  <span class="ctx-tag tag-cross">跨模块</span>
                  <span>
                    <template v-if="ev.crossDirection">{{ ev.crossDirection === 'sent' ? '📤 发送至' : '📥 来自' }} <b>{{ ev.crossModule }}</b> ({{ ev.crossPhase === 'request' ? '请求' : '响应' }})</template>
                    <template v-else>{{ ev.content }}</template>
                  </span>
                </div>
                <div
                  v-if="isTimelineItemExpanded(msg.id, idx) && ev.detail"
                  class="tl-tool-detail"
                >{{ ev.detail }}</div>
              </template>
              <!-- Regular tool with detail -->
              <template v-else-if="ev.detail">
                <div class="tl-tool-header" @click.stop="toggleTimelineItem(msg.id, idx)">
                  <span class="tl-arrow">{{ isTimelineItemExpanded(msg.id, idx) ? '▼' : '▶' }}</span>
                  <span class="ctx-tag tag-tools">工具</span>
                  <span>{{ ev.content }}</span>
                </div>
                <div
                  v-if="isTimelineItemExpanded(msg.id, idx)"
                  class="tl-tool-detail"
                >{{ ev.detail }}</div>
              </template>
              <!-- Simple tool -->
              <template v-else>
                <span class="ctx-tag tag-tools">工具</span>
                <span>{{ ev.content }}</span>
              </template>
            </div>
          </div>
        </div>

        <!-- Fallback: separate thinking toggle (for old messages without timeline) -->
        <div v-if="msg.thinking && (!msg.timeline || msg.timeline.length === 0)" class="ctx-thinking-toggle" @click.stop="toggleThinking(msg.id)">
          <span class="ctx-tag tag-thinking">思考</span>
          <span class="ctx-thinking-arrow">{{ isThinkingExpanded(msg.id) ? '▼' : '▶' }}</span>
          <span class="ctx-thinking-preview">{{ msg.thinking.slice(0, 40) }}...</span>
        </div>
        <div
          v-if="msg.thinking && (!msg.timeline || msg.timeline.length === 0) && isThinkingExpanded(msg.id)"
          class="ctx-thinking-content"
        >{{ msg.thinking }}</div>

        <!-- Fallback: tools section (for old messages without timeline) -->
        <div v-if="msg.tools && (!msg.timeline || msg.timeline.length === 0)" class="ctx-tools">
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

/* ── Cross phase tag ── */
.ctx-phase-tag {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 8px;
  background: var(--el-color-info-light-8);
  color: var(--el-color-info);
  margin-left: 4px;
}

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

/* ── Timeline ── */
.ctx-timeline {
  margin-bottom: 4px;
}

.ctx-timeline-item {
  margin-bottom: 2px;
}

.tl-thinking-header {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}

.tl-thinking-header:hover {
  color: var(--el-text-color-primary);
}

.tl-arrow {
  font-size: 9px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.tl-thinking-preview {
  color: var(--el-text-color-secondary);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.tl-thinking-full {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-style: italic;
  line-height: 1.4;
  padding: 4px 8px;
  margin: 2px 0 4px 14px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

.tl-tool-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: monospace;
  color: var(--el-text-color-secondary);
  padding: 1px 0;
}

.tl-tool-header {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  flex: 1;
}

.tl-tool-header:hover {
  color: var(--el-text-color-primary);
}

.tl-tool-detail {
  width: 100%;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
  padding: 4px 8px;
  margin: 2px 0 4px 14px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
  font-family: inherit;
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

.tag-cross {
  background: var(--el-color-success-light-7);
  color: var(--el-color-success);
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
