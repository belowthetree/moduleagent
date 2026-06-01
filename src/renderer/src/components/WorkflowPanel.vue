<!--
  WorkflowPanel.vue — 工作流面板
  显示工作流列表，支持执行、状态查看和管理
-->

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWorkflowStore } from '../stores/workflow'
import WorkflowEditDialog from './WorkflowEditDialog.vue'

const workflowStore = useWorkflowStore()

const emit = defineEmits<{
  select: [name: string]
}>()

const showCreateDialog = ref(false)
const newWorkflowName = ref('')
const showEditDialog = ref(false)
const editingWorkflowName = ref('')

onMounted(() => {
  workflowStore.fetchList()
})

async function handleCreate(): Promise<void> {
  const name = newWorkflowName.value.trim()
  if (!name) return
  const ok = await workflowStore.createWorkflow(name)
  if (ok) {
    newWorkflowName.value = ''
    showCreateDialog.value = false
  }
}

function openEditDialog(name: string): void {
  editingWorkflowName.value = name
  showEditDialog.value = true
}

function onEditDialogSaved(): void {
  showEditDialog.value = false
  editingWorkflowName.value = ''
  workflowStore.fetchList()
}

async function handleDelete(name: string): Promise<void> {
  await workflowStore.deleteWorkflow(name)
}

function selectWorkflow(name: string): void {
  workflowStore.selectWorkflow(name)
  emit('select', name)
}
</script>

<template>
  <div class="workflow-panel">
    <div class="panel-header">
      <span class="panel-title">工作流</span>
      <button class="btn-add" @click="showCreateDialog = true">+ 新建</button>
    </div>

    <div class="workflow-cards">
      <div
        v-for="item in workflowStore.workflows"
        :key="item.name"
        class="workflow-card"
        :class="{ active: workflowStore.selectedWorkflow?.name === item.name }"
        @click="selectWorkflow(item.name)"
      >
        <div class="card-header">
          <span class="card-name">{{ item.name }}</span>
          <div class="card-actions">
            <button class="btn-card-edit" @click.stop="openEditDialog(item.name)">✎</button>
            <button class="btn-card-delete" @click.stop="handleDelete(item.name)">✕</button>
          </div>
        </div>
        <div class="card-meta">
          {{ item.stepCount }} 个步骤
        </div>
      </div>

      <div v-if="workflowStore.workflows.length === 0" class="empty-state">
        <p>暂无工作流</p>
        <p class="hint">点击「新建」创建工作流</p>
      </div>
    </div>

    <!-- 新建工作流对话框 -->
    <el-dialog
      :model-value="showCreateDialog"
      title="新建工作流"
      width="400px"
      :close-on-click-modal="false"
      @update:model-value="showCreateDialog = false"
    >
      <el-form label-position="top">
        <el-form-item label="工作流名称">
          <el-input
            v-model="newWorkflowName"
            placeholder="如: code-review"
            @keyup.enter="handleCreate"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!newWorkflowName.trim()" @click="handleCreate">
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- 编辑工作流对话框 -->
    <WorkflowEditDialog
      v-if="showEditDialog"
      :visible="showEditDialog"
      :workflow-name="editingWorkflowName"
      @close="onEditDialogSaved"
      @saved="onEditDialogSaved"
    />
  </div>
</template>

<style scoped>
.workflow-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.panel-title {
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

.workflow-cards {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workflow-card {
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.workflow-card:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.workflow-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.card-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.card-actions {
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

.empty-state {
  text-align: center;
  padding: 40px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 4px;
}
</style>
