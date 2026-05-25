<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useKnowledgeStore } from '../stores/knowledge'
import KnowledgeEditDialog from './KnowledgeEditDialog.vue'
import type { KnowledgeEntry } from '../types/preload'

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
      <button class="btn-add" @click="openAddDialog">+ 添加</button>
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
            <button class="btn-card-edit" @click.stop="openEditDialog(item)">✎</button>
            <button class="btn-card-delete" @click.stop="onDelete(item.filename)">✕</button>
          </div>
        </div>
      </div>

      <div v-if="knowledgeStore.entries.length === 0" class="knowledge-empty">
        <p>暂无知识条目</p>
        <p class="knowledge-empty-hint">点击"添加"创建新的知识条目</p>
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
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.btn-add {
  padding: 4px 12px;
  border: 1px solid var(--el-color-primary);
  border-radius: 6px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-add:hover {
  opacity: 0.85;
}

.knowledge-cards {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.knowledge-card {
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.knowledge-card:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.knowledge-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
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
  gap: 4px;
}

.btn-card-edit, .btn-card-delete {
  width: 24px;
  height: 24px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-card-edit:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.btn-card-delete:hover {
  color: var(--el-color-danger);
  border-color: var(--el-color-danger);
}

.knowledge-empty {
  text-align: center;
  padding: 40px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.knowledge-empty-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 4px;
}
</style>
