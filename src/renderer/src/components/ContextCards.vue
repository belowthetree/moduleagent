<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMsg } from '../../../types/preload'
import { useAgentStore } from '../stores/agent'

const CTX_PAGE = 5

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

function escapeHtml(s: string): string {
  return s
}

// ── Pagination ──
const msgs = computed<ChatMsg[]>(() => agentStore.getMsgs(props.moduleName))

const totalPg = computed(() => Math.max(1, Math.ceil(msgs.value.length / CTX_PAGE)))

const cur = computed(() => {
  const p = agentStore.getPage(props.moduleName)
  return p >= totalPg.value ? totalPg.value - 1 : p
})

const pageMsgs = computed(() => {
  const start = cur.value * CTX_PAGE
  return msgs.value.slice(start, start + CTX_PAGE)
})

const pageNumbers = computed(() => {
  const nums: number[] = []
  for (let i = 0; i < totalPg.value; i++) {
    nums.push(i)
  }
  return nums
})

// ── Pagination actions ──
function goPage(p: number) {
  agentStore.setPage(props.moduleName, p)
}

function prevPage() {
  goPage(Math.max(0, cur.value - 1))
}

function nextPage() {
  goPage(Math.min(totalPg.value - 1, cur.value + 1))
}

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
</script>

<template>
  <div class="ctx-section">
    <!-- Header with clear button -->
    <div class="ctx-top-controls">
      <span class="section-title">上下文历史</span>
      <button class="btn-sm" @click="onClear">清空</button>
    </div>

    <!-- Card list -->
    <div v-if="msgs.length === 0" class="ctx-empty">No conversations yet</div>

    <div v-else class="ctx-card-list">
      <div
        v-for="msg in pageMsgs"
        :key="msg.id"
        class="ctx-card"
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

        <!-- Tools summary -->
        <div v-if="msg.tools" class="ctx-tools">
          <span class="ctx-tag tag-tools">工具</span>
          <span class="ctx-tools-count">{{ (msg.tools.match(/\[工具调用:/g) || []).length }} 个工具调用</span>
        </div>

        <!-- Content preview -->
        <div class="ctx-preview">
          <template v-if="msg.content">{{ msg.content.slice(0, 100) }}</template>
          <span v-else class="ctx-empty-preview">(无文本回复)</span>
        </div>

        <!-- Time -->
        <div class="ctx-time">{{ msg.time }}</div>
      </div>
    </div>

    <!-- Paginator -->
    <div v-if="msgs.length > 0" class="paginator">
      <button
        class="pg-btn"
        :disabled="cur <= 0"
        @click="prevPage"
      >◀</button>
      <button
        v-for="p in pageNumbers"
        :key="p"
        class="pg-btn"
        :class="{ active: p === cur }"
        @click="goPage(p)"
      >{{ p + 1 }}</button>
      <button
        class="pg-btn"
        :disabled="cur >= totalPg - 1"
        @click="nextPage"
      >▶</button>
      <span class="pg-info">{{ msgs.length }} 条</span>
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
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.ctx-top-controls .btn-sm {
  padding: 3px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--error);
  cursor: pointer;
}

.ctx-top-controls .btn-sm:hover {
  background: var(--error);
  color: #fff;
  border-color: var(--error);
}

/* ── Empty state ── */
.ctx-empty {
  font-size: 12px;
  color: var(--text-dim);
  padding: 16px;
  text-align: center;
  background: var(--node-bg);
  border-radius: 8px;
  border: 1px dashed var(--border);
}

/* ── Card list ── */
.ctx-card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

/* ── Card ── */
.ctx-card {
  padding: 10px 12px;
  background: var(--node-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: text;
  -webkit-user-select: text;
}

.ctx-card:hover {
  border-color: var(--accent);
  background: var(--node-hover);
}

.ctx-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.ctx-card .ctx-role {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ctx-card .ctx-role.user {
  color: var(--success);
}

.ctx-card .ctx-role.agent {
  color: var(--accent);
}

.ctx-card .ctx-role.cross {
  color: var(--warning);
}

/* ── Status badges ── */
.ctx-status {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 7px;
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

/* ── Content preview ── */
.ctx-card .ctx-preview {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
}

.ctx-empty-preview {
  color: var(--text-dim);
  font-style: italic;
  opacity: 0.5;
}

/* ── Time ── */
.ctx-card .ctx-time {
  font-size: 10px;
  color: var(--text-dim);
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
  color: var(--text);
}

.ctx-thinking-arrow {
  font-size: 9px;
  color: var(--text-dim);
}

.ctx-thinking-preview {
  color: var(--text-dim);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.ctx-thinking-content {
  font-size: 11px;
  color: var(--text-dim);
  font-style: italic;
  line-height: 1.4;
  margin-bottom: 4px;
  padding: 6px 8px;
  background: rgba(160, 160, 200, 0.06);
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
  color: #f0a000;
  vertical-align: middle;
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
  background: rgba(160, 160, 200, 0.2);
  color: var(--text-dim);
}

.tag-tools {
  background: rgba(240, 160, 0, 0.2);
  color: #f0a000;
}

/* ── Pagination ── */
.paginator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 20px 14px;
  flex-shrink: 0;
}

.paginator .pg-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--node-bg);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.paginator .pg-btn:hover {
  border-color: var(--accent);
}

.paginator .pg-btn.active {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
  font-weight: 700;
}

.paginator .pg-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.paginator .pg-info {
  font-size: 11px;
  color: var(--text-dim);
  padding: 0 4px;
}
</style>
