<!--
  KnowledgePanel.vue — 知识库面板
  显示和管理知识条目列表，支持创建/编辑/删除
-->

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Collection, Delete, Edit, Plus } from '@element-plus/icons-vue'
import { useKnowledgeStore } from '../stores/knowledge'
import KnowledgeEditDialog from './KnowledgeEditDialog.vue'
import type { KnowledgeEntry } from '../../../types/shared'

const knowledgeStore = useKnowledgeStore()

const emit = defineEmits<{
  select: [filename: string]
}>()

const showConfigDialog = ref(false)
const editingEntry = ref<KnowledgeEntry | null>(null)

onMounted(() => {
  knowledgeStore.fetchList()
})

async function openAddDialog(): Promise<void> {
  const entry = await knowledgeStore.create('新知识条目')
  if (entry) {
    editingEntry.value = entry
    showConfigDialog.value = true
  }
}

async function openEditDialog(item: { name: string; filename: string }): Promise<void> {
  const entry = await knowledgeStore.read(item.filename)
  if (entry) {
    editingEntry.value = entry
    showConfigDialog.value = true
  }
}

async function onSave(entry: KnowledgeEntry): Promise<void> {
  await knowledgeStore.save(entry)
  showConfigDialog.value = false
  editingEntry.value = null
}

async function onDelete(filename: string): Promise<void> {
  await knowledgeStore.remove(filename)
}

function selectEntry(item: { filename: string }): void {
  emit('select', item.filename)
}
</script>

<template>
  <div class="knowledge-panel">
    <div class="knowledge-list-header">
      <span class="knowledge-list-title">知识</span>
      <button class="btn-add" @click="openAddDialog">
        <el-icon><Plus /></el-icon>添加
      </button>
    </div>

    <div class="knowledge-cards">
      <div
        v-for="item in knowledgeStore.entries"
        :key="item.filename"
        class="knowledge-card"
        :class="{ active: knowledgeStore.selectedEntry?.filename === item.filename }"
        @click="selectEntry(item)"
      >
        <div class="knowledge-card-header">
          <span class="knowledge-card-name">{{ item.name }}</span>
          <div class="knowledge-card-actions">
            <el-tooltip content="编辑" placement="top">
              <button class="btn-card-edit" aria-label="编辑" @click.stop="openEditDialog(item)">
                <el-icon><Edit /></el-icon>
              </button>
            </el-tooltip>
            <el-tooltip content="删除" placement="top">
              <button class="btn-card-delete" aria-label="删除" @click.stop="onDelete(item.filename)">
                <el-icon><Delete /></el-icon>
              </button>
            </el-tooltip>
          </div>
        </div>
      </div>

      <div v-if="knowledgeStore.entries.length === 0" class="knowledge-empty">
        <el-icon class="empty-icon"><Collection /></el-icon>
        <p>暂无知识条目</p>
        <p class="knowledge-empty-hint">点击"添加"创建新的知识条目</p>
        <button class="btn-empty-add" @click="openAddDialog">
          <el-icon><Plus /></el-icon>添加知识
        </button>
      </div>
    </div>

    <KnowledgeEditDialog
      v-if="showConfigDialog && editingEntry"
      :visible="showConfigDialog"
      :entry="editingEntry"
      @close="showConfigDialog = false; editingEntry = null"
      @save="onSave"
    />
  </div>
</template>

<style scoped>
.knowledge-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.knowledge-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.knowledge-list-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* ── 主操作按钮：主色软背景 ── */
.btn-add {
  display: inline-flex;
  align-items: center;
  gap: var(--app-space-1);
  padding: 5px 12px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--app-radius-md);
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--app-transition-fast), border-color var(--app-transition-fast);
}

.btn-add:hover {
  border-color: var(--el-color-primary);
}

.btn-add:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.knowledge-cards {
  flex: 1;
  overflow-y: auto;
  padding: var(--app-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
}

/* ── 条目卡片：圆角 + 1px 边框 + hover 微浮起 ── */
.knowledge-card {
  padding: var(--app-space-3);
  border: 1px solid var(--el-border-color);
  border-radius: var(--app-radius-lg);
  background: var(--el-bg-color);
  cursor: pointer;
  transition: border-color var(--app-transition-fast), box-shadow var(--app-transition-fast), transform var(--app-transition-fast), background var(--app-transition-fast);
}

.knowledge-card:hover {
  border-color: var(--el-border-color-dark);
  box-shadow: var(--app-shadow-1);
  transform: translateY(-1px);
}

.knowledge-card.active {
  border-color: var(--el-color-primary);
  background: var(--app-accent-soft);
}

.knowledge-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.knowledge-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.knowledge-card-actions {
  display: flex;
  gap: var(--app-space-1);
}

/* ── 卡片操作图标按钮 ── */
.btn-card-edit, .btn-card-delete {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--app-transition-fast), color var(--app-transition-fast);
}

.btn-card-edit:hover {
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
}

.btn-card-delete:hover {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.btn-card-edit:focus-visible,
.btn-card-delete:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

/* ── 空态：图标 + 文案 + 引导按钮 ── */
.knowledge-empty {
  text-align: center;
  padding: 48px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.empty-icon {
  font-size: 32px;
  color: var(--el-text-color-placeholder);
  margin-bottom: var(--app-space-3);
}

.knowledge-empty p {
  margin: 0;
}

.knowledge-empty-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: var(--app-space-1) !important;
}

.btn-empty-add {
  display: inline-flex;
  align-items: center;
  gap: var(--app-space-1);
  margin-top: var(--app-space-4);
  padding: 6px 14px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--app-radius-md);
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--app-transition-fast), border-color var(--app-transition-fast);
}

.btn-empty-add:hover {
  border-color: var(--el-color-primary);
}
</style>
