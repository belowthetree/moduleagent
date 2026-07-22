<!--
  ContextCards.vue — 聊天消息卡片列表
  渲染 Agent 回复、思考、工具调用时间线，支持流式更新和 Markdown
-->

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Bottom, Cpu, Delete, Top, User } from '@element-plus/icons-vue'
import type { ChatMsg, TimelineEvent } from '../../../types/shared'
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

// ── 辅助方法 ──
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
  if (msg.crossDirection === 'sent') return `发送至 ${msg.crossModule || '?'}`
  return `来自 ${msg.crossModule || '?'}`
}

function crossPhaseLabel(msg: ChatMsg): string {
  return msg.crossPhase === 'request' ? '请求' : '响应'
}

function roleLabel(role: string): string {
  if (role === 'user') return '用户'
  if (role === 'agent') return 'Agent'
  return ''
}

// ── 消息列表（全部，无分页） ──
const msgs = computed<ChatMsg[]>(() => {
  if (props.contextType === 'role') {
    return agentStore.getRoleMsgs(props.moduleName)
  }
  return agentStore.getMsgs(props.moduleName)
})

const isEmpty = computed(() => msgs.value.length === 0)

// ── 自动滚动到底部 ──
function scrollToBottom() {
  nextTick(() => {
    if (cardListRef.value && cardListRef.value.lastElementChild) {
      cardListRef.value.lastElementChild.scrollIntoView({ behavior: 'instant', block: 'end' })
    }
  })
}

watch(() => msgs.value.length, scrollToBottom)
watch(() => msgs.value.map(m => m.content + m.thinking + m.tools + (m.timeline ? JSON.stringify(m.timeline) : '')).join(''), scrollToBottom)

// ── 思考过程切换 ──
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

// ── 时间线条目切换 ──
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

// ── 工具分类 ──
const CROSS_MODULE_TOOLS = ['module_call', 'module_query']

function isCrossModuleTool(ev: TimelineEvent): boolean {
  return CROSS_MODULE_TOOLS.some(name => ev.content.includes(name))
}

// ── 卡片点击 ──
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
    <!-- 标题与清空按钮 -->
    <div class="ctx-top-controls">
      <span class="section-title">上下文历史</span>
      <el-tooltip content="清空" placement="left">
        <button class="icon-btn" aria-label="清空" @click="onClear">
          <el-icon><Delete /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- 空状态 -->
    <div v-if="isEmpty" class="ctx-empty">No conversations yet</div>

    <!-- 消息列表（最新在底部） -->
    <div ref="cardListRef" v-else class="ctx-card-list">
      <div
        v-for="msg in msgs"
        :key="msg.id"
        class="ctx-card"
        :class="['ctx-card-' + msg.role, { 'ctx-card-streaming': msg.role === 'agent' && msg.status === 'executing' }]"
        @click="onCardClick(msg)"
      >
        <div class="ctx-card-top">
          <span
            v-if="msg.role === 'cross'"
            class="ctx-role cross"
          ><el-icon class="ctx-role-icon"><Top v-if="msg.crossDirection === 'sent'" /><Bottom v-else /></el-icon>{{ crossDirectionLabel(msg) }}</span>
          <span
            v-else
            class="ctx-role"
            :class="msg.role"
          ><el-icon class="ctx-role-icon"><User v-if="msg.role === 'user'" /><Cpu v-else /></el-icon>{{ roleLabel(msg.role) }}</span>
          <span class="ctx-status" :class="'st-' + msg.status">{{ statusLabel(msg.status) }}</span>
          <span v-if="msg.role === 'cross'" class="ctx-phase-tag">{{ crossPhaseLabel(msg) }}</span>
        </div>

        <!-- 交错时间线（新格式） -->
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
              <!-- 跨模块工具：通过工具名称检测 -->
              <template v-if="isCrossModuleTool(ev)">
                <div class="tl-tool-header" @click.stop="toggleTimelineItem(msg.id, idx)">
                  <span class="tl-arrow">{{ isTimelineItemExpanded(msg.id, idx) ? '▼' : '▶' }}</span>
                  <span class="ctx-tag tag-cross">跨模块</span>
                  <span>
                    <template v-if="ev.crossDirection"><el-icon class="tl-cross-icon"><Top v-if="ev.crossDirection === 'sent'" /><Bottom v-else /></el-icon>{{ ev.crossDirection === 'sent' ? '发送至' : '来自' }} <b>{{ ev.crossModule }}</b> ({{ ev.crossPhase === 'request' ? '请求' : '响应' }})</template>
                    <template v-else>{{ ev.content }}</template>
                  </span>
                </div>
                <div
                  v-if="isTimelineItemExpanded(msg.id, idx) && ev.detail"
                  class="tl-tool-detail"
                >{{ ev.detail }}</div>
              </template>
              <!-- 普通工具（含详情） -->
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
              <!-- 简单工具 -->
              <template v-else>
                <span class="ctx-tag tag-tools">工具</span>
                <span>{{ ev.content }}</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 回退：独立的思考切换（针对无时间线的旧消息） -->
        <div v-if="msg.thinking && (!msg.timeline || msg.timeline.length === 0)" class="ctx-thinking-toggle" @click.stop="toggleThinking(msg.id)">
          <span class="ctx-tag tag-thinking">思考</span>
          <span class="ctx-thinking-arrow">{{ isThinkingExpanded(msg.id) ? '▼' : '▶' }}</span>
          <span class="ctx-thinking-preview">{{ msg.thinking.slice(0, 40) }}...</span>
        </div>
        <div
          v-if="msg.thinking && (!msg.timeline || msg.timeline.length === 0) && isThinkingExpanded(msg.id)"
          class="ctx-thinking-content"
        >{{ msg.thinking }}</div>

        <!-- 回退：工具区（针对无时间线的旧消息） -->
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

        <!-- 内容 -->
        <div class="ctx-preview">
          <template v-if="msg.content">{{ msg.content }}<span v-if="msg.role === 'agent' && msg.status === 'executing'" class="ctx-cursor"></span></template>
          <span v-else-if="msg.role === 'agent' && msg.status === 'executing'" class="ctx-empty-preview">等待中...<span class="ctx-cursor"></span></span>
          <span v-else class="ctx-empty-preview">(无文本回复)</span>
        </div>

        <!-- 时间 -->
        <div class="ctx-time">{{ msg.time }}</div>

        <!-- 流式输出的取消按钮 -->
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
/* ── 区块标题 ── */
.ctx-section {
  margin-top: var(--app-space-1);
}

.ctx-top-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--app-space-3);
}

.ctx-top-controls .section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* ── 图标按钮（清空等操作） ── */
.icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--app-transition-fast), color var(--app-transition-fast);
}

.icon-btn:hover {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.icon-btn:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

/* ── 空状态 ── */
.ctx-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: var(--app-space-4);
  text-align: center;
  background: var(--el-fill-color-blank);
  border-radius: var(--app-radius-lg);
  border: 1px dashed var(--el-border-color);
}

/* ── 消息列表：间距 12px ── */
.ctx-card-list {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-3);
}

/* ── 消息卡片基座（assistant/system/cross：左对齐卡片） ── */
.ctx-card {
  align-self: flex-start;
  width: 100%;
  min-width: 0;
  padding: 10px 14px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--app-radius-lg) var(--app-radius-lg) var(--app-radius-lg) var(--app-space-1);
  cursor: pointer;
  transition: border-color var(--app-transition-fast), box-shadow var(--app-transition-fast), background var(--app-transition-fast);
  user-select: text;
  -webkit-user-select: text;
}

.ctx-card:hover {
  border-color: var(--el-border-color-dark);
  box-shadow: var(--app-shadow-1);
}

/* ── 用户消息：右对齐气泡，主色软背景，右下角 4px ── */
.ctx-card-user {
  align-self: flex-end;
  width: auto;
  max-width: 88%;
  background: var(--app-accent-soft);
  border-color: var(--el-color-primary-light-8);
  border-radius: var(--app-radius-lg) var(--app-radius-lg) var(--app-space-1) var(--app-radius-lg);
}

.ctx-card-user:hover {
  border-color: var(--el-color-primary-light-5);
}

/* ── 流式输出中的卡片 ── */
.ctx-card-streaming {
  border-color: var(--el-color-primary-light-5);
  background: var(--app-accent-soft);
}

.ctx-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--app-space-1);
}

.ctx-card .ctx-role {
  display: inline-flex;
  align-items: center;
  gap: var(--app-space-1);
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.ctx-role-icon {
  font-size: 12px;
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

/* ── 状态徽章 — 小圆点 + 文字 ── */
.ctx-status {
  font-size: 10px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: var(--app-space-1);
}

.ctx-status::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.st-sent        { color: var(--el-color-info); }
.st-sent::before        { background: var(--el-color-info); }
.st-pending     { color: var(--el-color-warning); }
.st-pending::before     { background: var(--el-color-warning); }
.st-thinking    { color: var(--el-color-primary); }
.st-thinking::before    { background: var(--el-color-primary); }
.st-executing   { color: var(--el-color-success); }
.st-executing::before   { background: var(--el-color-success); animation: pulse-dot 1.2s infinite; }
.st-completed   { color: var(--el-color-success); }
.st-completed::before   { background: var(--el-color-success); }
.st-error       { color: var(--el-color-danger); }
.st-error::before       { background: var(--el-color-danger); }
.st-interrupted { color: var(--el-color-warning); }
.st-interrupted::before { background: var(--el-color-warning); }

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── 跨阶段标签 ── */
.ctx-phase-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--app-radius-sm);
  background: var(--el-color-info-light-9);
  color: var(--el-color-info);
  margin-left: var(--app-space-1);
}

/* ── 内容排版 ── */
.ctx-card .ctx-preview {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}

.ctx-empty-preview {
  color: var(--el-text-color-secondary);
  font-style: italic;
  opacity: 0.5;
}

/* ── 时间 ── */
.ctx-card .ctx-time {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  opacity: 0.6;
  margin-top: var(--app-space-1);
}

/* ── 时间线 ── */
.ctx-timeline {
  margin-bottom: var(--app-space-1);
}

.ctx-timeline-item {
  margin-bottom: 2px;
}

.tl-thinking-header {
  display: flex;
  align-items: center;
  gap: var(--app-space-1);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
  border-radius: var(--app-radius-sm);
  transition: color var(--app-transition-fast);
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
  line-height: 1.5;
  padding: 8px 12px;
  margin: 2px 0 var(--app-space-1) 14px;
  background: var(--el-fill-color);
  border-radius: var(--app-radius-md);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

.tl-tool-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--app-space-1);
  font-size: 11px;
  font-family: var(--app-mono);
  color: var(--el-text-color-secondary);
  padding: 1px 0;
}

.tl-cross-icon {
  font-size: 11px;
  margin-right: 2px;
  vertical-align: -1px;
}

.tl-tool-header {
  display: flex;
  align-items: center;
  gap: var(--app-space-1);
  cursor: pointer;
  user-select: none;
  flex: 1;
  border-radius: var(--app-radius-sm);
  transition: color var(--app-transition-fast);
}

.tl-tool-header:hover {
  color: var(--el-text-color-primary);
}

.tl-tool-detail {
  width: 100%;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  padding: 8px 12px;
  margin: 2px 0 var(--app-space-1) 14px;
  background: var(--el-fill-color);
  border-radius: var(--app-radius-md);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
  font-family: inherit;
}

/* ── 思考切换 ── */
.ctx-thinking-toggle {
  display: flex;
  align-items: center;
  gap: var(--app-space-1);
  font-size: 11px;
  margin-bottom: 2px;
  cursor: pointer;
  user-select: none;
  transition: color var(--app-transition-fast);
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
  line-height: 1.5;
  margin-bottom: var(--app-space-1);
  padding: 8px 12px;
  background: var(--el-fill-color);
  border-radius: var(--app-radius-md);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

/* ── 工具 ── */
.ctx-card .ctx-tools {
  font-size: 11px;
  margin-bottom: 2px;
}

.ctx-tools-count {
  color: var(--el-color-warning);
  vertical-align: middle;
}

.ctx-tools-list {
  margin-top: var(--app-space-1);
  padding-left: var(--app-space-2);
  border-left: 2px solid var(--el-color-warning-light-5);
}

.ctx-tool-line {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  padding: 1px 0;
  font-family: var(--app-mono);
}

.ctx-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--app-radius-sm);
  margin-right: var(--app-space-1);
  vertical-align: middle;
}

.tag-thinking {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.tag-tools {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}

.tag-cross {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

/* ── 流式消息的闪烁光标 ── */
.ctx-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--el-color-primary);
  border-radius: 1px;
  margin-left: 2px;
  animation: blink 1s infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ── 取消按钮 ── */
.btn-cancel-stream {
  display: block;
  width: 100%;
  padding: 6px;
  margin-top: var(--app-space-2);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: var(--app-radius-md);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--app-transition-fast), border-color var(--app-transition-fast);
}

.btn-cancel-stream:hover {
  background: var(--el-color-danger-light-8);
}
</style>
