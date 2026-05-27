<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { DiffFile, DiffSummary } from '../../types/shared'

const props = defineProps<{
  moduleName: string
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  applied: []
}>()

// ── 状态 ──
const summary = ref<DiffSummary | null>(null)
const loading = ref(false)
const error = ref('')
const expandedFile = ref<string | null>(null)
const fileDiffs = ref<Map<string, string>>(new Map())
const diffLoading = ref<Set<string>>(new Set())
const selectedFiles = ref<Set<string>>(new Set())
const applying = ref(false)
const applyResult = ref('')

// ── 计算属性 ──
const totalChanges = computed(() => {
  if (!summary.value) return 0
  return summary.value.addedCount + summary.value.modifiedCount + summary.value.deletedCount
})

const statusIcon = (s: string): string => {
  if (s === 'added') return '+'
  if (s === 'modified') return '~'
  if (s === 'deleted') return '−'
  return ' '
}

const statusLabel = (s: string): string => {
  if (s === 'added') return '新增'
  if (s === 'modified') return '修改'
  if (s === 'deleted') return '删除'
  return s
}

const statusClass = (s: string): string => `status-${s}`

// ── 加载 diff 数据 ──
async function loadDiff(): Promise<void> {
  if (!props.visible || !props.moduleName) return
  loading.value = true
  error.value = ''
  try {
    const result = await window.moduleAgent.workspaceDiff(props.moduleName)
    if ('error' in result) {
      error.value = result.error
      summary.value = null
    } else {
      summary.value = result
      // 默认全选所有变更
      selectedFiles.value = new Set(result.files.map(f => f.relativePath))
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

// ── 展开/收起文件 diff ──
async function toggleFile(file: DiffFile): Promise<void> {
  if (expandedFile.value === file.relativePath) {
    expandedFile.value = null
    return
  }
  expandedFile.value = file.relativePath

  if (fileDiffs.value.has(file.relativePath)) return

  diffLoading.value.add(file.relativePath)
  try {
    const result = await window.moduleAgent.workspaceDiffFile(props.moduleName, file.relativePath)
    if ('error' in result) {
      fileDiffs.value.set(file.relativePath, `Error: ${result.error}`)
    } else {
      fileDiffs.value.set(file.relativePath, result.hunks)
    }
  } catch (err) {
    fileDiffs.value.set(file.relativePath, `Error: ${(err as Error).message}`)
  } finally {
    diffLoading.value.delete(file.relativePath)
  }
}

// ── 选中/取消文件 ──
function toggleSelect(relativePath: string): void {
  const next = new Set(selectedFiles.value)
  if (next.has(relativePath)) {
    next.delete(relativePath)
  } else {
    next.add(relativePath)
  }
  selectedFiles.value = next
}

function toggleSelectAll(): void {
  if (!summary.value) return
  if (selectedFiles.value.size === summary.value.files.length) {
    selectedFiles.value = new Set()
  } else {
    selectedFiles.value = new Set(summary.value.files.map(f => f.relativePath))
  }
}

// ── 应用变更 ──
async function applyChanges(): Promise<void> {
  if (!summary.value) return
  applying.value = true
  applyResult.value = ''
  try {
    const files = selectedFiles.value.size === summary.value.files.length
      ? undefined  // 全选 → 不传 files 参数，写回所有
      : [...selectedFiles.value]
    const result = await window.moduleAgent.workspaceApply(props.moduleName, files)
    if (result.errors.length > 0) {
      applyResult.value = `已应用 ${result.applied} 个文件，${result.errors.length} 个失败:\n${result.errors.join('\n')}`
    } else {
      applyResult.value = `已应用 ${result.applied} 个文件`
      emit('applied')
      // 重新加载 diff（已应用的变更应消失）
      fileDiffs.value.clear()
      expandedFile.value = null
      await loadDiff()
      if (totalChanges.value === 0) {
        emit('close')
      }
    }
  } catch (err) {
    applyResult.value = `Error: ${(err as Error).message}`
  } finally {
    applying.value = false
  }
}

// ── 丢弃变更 ──
async function discardChanges(): Promise<void> {
  applying.value = true
  try {
    await window.moduleAgent.workspaceDiscard(props.moduleName)
    summary.value = null
    fileDiffs.value.clear()
    expandedFile.value = null
    emit('close')
  } catch (err) {
    applyResult.value = `Error: ${(err as Error).message}`
  } finally {
    applying.value = false
  }
}

// ── 监听 visible 变化 ──
watch(() => props.visible, (v) => {
  if (v) {
    loadDiff()
  } else {
    fileDiffs.value.clear()
    expandedFile.value = null
    applyResult.value = ''
  }
})
</script>

<template>
  <!-- 遮罩 -->
  <div
    class="diff-overlay"
    :class="{ open: visible }"
    @click="emit('close')"
  />

  <!-- 面板 -->
  <div class="diff-panel" :class="{ open: visible }">
    <div class="diff-header">
      <span class="diff-title">工作区变更</span>
      <button class="btn-close" @click="emit('close')">✕</button>
    </div>

    <div class="diff-body">
      <!-- 加载中 -->
      <div v-if="loading" class="diff-loading">正在分析变更...</div>

      <!-- 错误 -->
      <div v-else-if="error" class="diff-error">{{ error }}</div>

      <!-- 无变更 -->
      <div v-else-if="summary && totalChanges === 0" class="diff-empty">
        <span class="empty-icon">✓</span>
        <span>没有检测到文件变更</span>
      </div>

      <!-- 变更列表 -->
      <template v-else-if="summary && totalChanges > 0">
        <!-- 摘要 -->
        <div class="diff-summary">
          <span class="summary-count">{{ totalChanges }} 个文件变更</span>
          <span class="summary-detail">
            <span class="cnt-added">{{ summary.addedCount }} 新增</span>
            <span class="cnt-modified">{{ summary.modifiedCount }} 修改</span>
            <span class="cnt-deleted">{{ summary.deletedCount }} 删除</span>
          </span>
        </div>

        <!-- 全选 -->
        <label class="select-all">
          <input
            type="checkbox"
            :checked="selectedFiles.size === summary.files.length"
            :indeterminate="selectedFiles.size > 0 && selectedFiles.size < summary.files.length"
            @change="toggleSelectAll"
          />
          全选
        </label>

        <!-- 文件列表 -->
        <div class="diff-file-list">
          <div
            v-for="file in summary.files"
            :key="file.relativePath"
            class="diff-file-item"
          >
            <div class="diff-file-row" @click="toggleFile(file)">
              <input
                type="checkbox"
                :checked="selectedFiles.has(file.relativePath)"
                class="file-check"
                @click.stop
                @change="toggleSelect(file.relativePath)"
              />
              <span class="file-status" :class="statusClass(file.status)">
                {{ statusIcon(file.status) }}
              </span>
              <span class="file-name">{{ file.relativePath }}</span>
              <span class="file-tag" :class="statusClass(file.status)">
                {{ statusLabel(file.status) }}
              </span>
              <span v-if="file.sizeDiff !== undefined && file.sizeDiff !== 0" class="file-size">
                {{ file.sizeDiff > 0 ? '+' : '' }}{{ file.sizeDiff }} B
              </span>
              <span class="file-arrow">
                {{ expandedFile === file.relativePath ? '▾' : '▸' }}
              </span>
            </div>

            <!-- Diff 展开区 -->
            <div
              v-if="expandedFile === file.relativePath"
              class="diff-expand"
            >
              <div v-if="diffLoading.has(file.relativePath)" class="diff-expand-loading">
                加载中...
              </div>
              <pre v-else class="diff-hunks">{{ fileDiffs.get(file.relativePath) || '(无内容差异)' }}</pre>
            </div>
          </div>
        </div>

        <!-- 操作反馈 -->
        <div v-if="applyResult" class="diff-result">{{ applyResult }}</div>

        <!-- 操作按钮 -->
        <div class="diff-actions">
          <button
            class="btn-apply"
            :disabled="applying || selectedFiles.size === 0"
            @click="applyChanges"
          >
            {{ applying ? '应用中...' : `应用选中 (${selectedFiles.size})` }}
          </button>
          <button
            class="btn-discard"
            :disabled="applying"
            @click="discardChanges"
          >
            丢弃全部
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── 遮罩 ── */
.diff-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.2);
  z-index: 110;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

.diff-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

/* ── 面板 ── */
.diff-panel {
  position: fixed;
  top: 0;
  right: -480px;
  width: 460px;
  height: 100%;
  background: var(--el-bg-color);
  border-left: 1px solid var(--el-border-color);
  z-index: 120;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 16px rgba(0, 0, 0, 0.1);
  transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.diff-panel.open {
  right: 0;
}

/* ── 头部 ── */
.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.diff-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.btn-close {
  width: 28px;
  height: 28px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
}

.btn-close:hover {
  background: var(--el-color-danger);
  color: #fff;
  border-color: var(--el-color-danger);
}

/* ── Body ── */
.diff-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.diff-loading,
.diff-error,
.diff-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.diff-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-icon {
  font-size: 28px;
  color: var(--el-color-success);
}

/* ── 摘要 ── */
.diff-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.summary-count {
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.summary-detail {
  display: flex;
  gap: 6px;
  font-size: 11px;
}

.cnt-added { color: var(--el-color-success); }
.cnt-modified { color: var(--el-color-warning); }
.cnt-deleted { color: var(--el-color-danger); }

/* ── 全选 ── */
.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  user-select: none;
}

.select-all input {
  accent-color: var(--el-color-primary);
}

/* ── 文件列表 ── */
.diff-file-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.diff-file-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

.diff-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.1s;
  user-select: none;
}

.diff-file-row:hover {
  background: var(--el-fill-color-light);
}

.file-check {
  flex-shrink: 0;
  accent-color: var(--el-color-primary);
  pointer-events: auto;
}

.file-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
  font-family: monospace;
}

.status-added     { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.status-modified  { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.status-deleted   { background: var(--el-color-danger-light-9);  color: var(--el-color-danger); }

.file-name {
  flex: 1;
  font-size: 12px;
  color: var(--el-text-color-primary);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.status-added .file-tag,
.file-tag.status-added     { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.status-modified .file-tag,
.file-tag.status-modified  { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.status-deleted .file-tag,
.file-tag.status-deleted   { background: var(--el-color-danger-light-9);  color: var(--el-color-danger); }

.file-size {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.file-arrow {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

/* ── Diff 展开 ── */
.diff-expand {
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 0;
}

.diff-expand-loading {
  padding: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.diff-hunks {
  margin: 0;
  padding: 10px;
  font-size: 11px;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  max-height: 360px;
  overflow-y: auto;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
  border-radius: 0 0 6px 6px;
  user-select: text;
  -webkit-user-select: text;
}

/* ── 结果反馈 ── */
.diff-result {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
  white-space: pre-wrap;
}

/* ── 操作按钮 ── */
.diff-actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

.btn-apply,
.btn-discard {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
}

.btn-apply {
  background: var(--el-color-primary);
  color: #fff;
}

.btn-apply:hover:not(:disabled) {
  background: var(--el-color-primary-dark-2);
}

.btn-apply:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-discard {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  border: 1px solid var(--el-border-color);
}

.btn-discard:hover:not(:disabled) {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  border-color: var(--el-color-danger-light-7);
}

.btn-discard:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
