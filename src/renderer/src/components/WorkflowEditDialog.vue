<!--
  WorkflowEditDialog.vue — 工作流编辑对话框
  创建/编辑工作流名称、描述和步骤列表
-->

<script setup lang="ts">
import { reactive, watch, ref } from 'vue'
import { useWorkflowStore } from '../stores/workflow'
import StepEditDialog from './StepEditDialog.vue'
import type { WorkflowStepDetail } from '../../../types/shared'

const props = defineProps<{
  visible: boolean
  workflowName: string
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const workflowStore = useWorkflowStore()

const name = ref('')
const steps = ref<WorkflowStepDetail[]>([])
const stepDialogVisible = ref(false)
const editingStep = ref<WorkflowStepDetail | null>(null)

watch(() => props.visible, async (v) => {
  if (v && props.workflowName) {
    name.value = props.workflowName
    const wf = await workflowStore.loadWorkflow(props.workflowName)
    steps.value = wf?.steps ?? []
  }
})

function openStepEditor(step: WorkflowStepDetail): void {
  editingStep.value = step
  stepDialogVisible.value = true
}

function onAddStep(): void {
  // Create a placeholder step object for the next step
  const nextIndex = steps.value.length + 1
  const placeholder: WorkflowStepDetail = {
    name: `step${nextIndex}`,
    dir: '',
    definition: {
      name: `步骤 ${nextIndex}`,
    },
    body: '# 步骤描述\n\n请描述此步骤需要完成的工作...',
  }
  editingStep.value = placeholder
  stepDialogVisible.value = true
}

async function handleStepSave(updated: WorkflowStepDetail): Promise<void> {
  stepDialogVisible.value = false

  // Determine if this is a new step or existing
  const existingIndex = steps.value.findIndex(s => s.name === editingStep.value?.name)
  if (existingIndex >= 0) {
    // Existing step: save via IPC
    await workflowStore.saveStep(name.value, updated.name, {
      name: updated.definition.name,
      description: updated.definition.description,
      input: updated.definition.input as { from: string; sourceStep?: string } | undefined,
      acceptance: updated.definition.acceptance,
      agent: updated.definition.agent as {
        command?: string
        args?: string[]
        visibleModulePaths?: string[]
        knowledgeRefs?: { filename: string; name: string }[]
      } | undefined,
      body: updated.body,
    })
  } else {
    // New step: add via IPC
    const newStepName = await workflowStore.addStep(name.value)
    if (newStepName) {
      await workflowStore.saveStep(name.value, newStepName, {
        name: updated.definition.name,
        description: updated.definition.description,
        input: updated.definition.input as { from: string; sourceStep?: string } | undefined,
        acceptance: updated.definition.acceptance,
        agent: updated.definition.agent as {
          command?: string
          args?: string[]
          visibleModulePaths?: string[]
          knowledgeRefs?: { filename: string; name: string }[]
        } | undefined,
        body: updated.body,
      })
    }
  }

  // Reload
  const wf = await workflowStore.loadWorkflow(name.value)
  steps.value = wf?.steps ?? []
}

async function handleDeleteStep(stepName: string): Promise<void> {
  await workflowStore.deleteStep(name.value, stepName)
  const wf = await workflowStore.loadWorkflow(name.value)
  steps.value = wf?.steps ?? []
}

function handleClose(): void {
  emit('close')
  emit('saved')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="编辑工作流"
    width="640px"
    :close-on-click-modal="false"
    @update:model-value="handleClose"
  >
    <el-form label-position="top">
      <el-form-item label="工作流名称">
        <el-input v-model="name" disabled />
        <div class="field-hint">
          工作流名称即目录名，创建后不可修改
        </div>
      </el-form-item>

      <el-form-item label="步骤列表">
        <div v-if="steps.length === 0" class="steps-empty">
          暂无步骤，请点击下方按钮添加
        </div>
        <div v-for="(step, idx) in steps" :key="step.name" class="step-list-item">
          <div class="step-info">
            <span class="step-index">{{ idx + 1 }}</span>
            <div class="step-text">
              <strong>{{ step.definition.name }}</strong>
              <span v-if="step.definition.description" class="step-desc">
                — {{ step.definition.description }}
              </span>
            </div>
          </div>
          <div class="step-actions">
            <el-button size="small" text @click="openStepEditor(step)">编辑</el-button>
            <el-button size="small" text type="danger" @click="handleDeleteStep(step.name)">
              删除
            </el-button>
          </div>
        </div>
      </el-form-item>

      <el-button type="primary" plain @click="onAddStep">
        + 添加步骤
      </el-button>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
    </template>
  </el-dialog>

  <StepEditDialog
    :visible="stepDialogVisible"
    :step="editingStep"
    @close="stepDialogVisible = false"
    @save="handleStepSave"
  />
</template>

<style scoped>
/* ── 对话框统一视觉：圆角 16px + 弹层阴影 ── */
:deep(.el-dialog) {
  border-radius: var(--app-radius-xl);
  box-shadow: var(--app-shadow-3);
}

:deep(.el-dialog__header) {
  padding: 20px 24px 16px;
  margin-right: 0;
  border-bottom: 1px solid var(--el-border-color-light);
}

:deep(.el-dialog__title) {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

:deep(.el-dialog__body) {
  padding: var(--app-space-5);
}

:deep(.el-dialog__footer) {
  padding: 16px 24px 20px;
  border-top: 1px solid var(--el-border-color-light);
}

:deep(.el-dialog__footer .el-button + .el-button) {
  margin-left: var(--app-space-2);
}

/* ── 表单：label 13px 600，输入项圆角 8px ── */
:deep(.el-form-item__label) {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

:deep(.el-input__wrapper) {
  border-radius: var(--app-radius-md);
}

/* ── 描述性辅助文字 ── */
.field-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: var(--app-space-1);
  line-height: 1.4;
}

.steps-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  padding: var(--app-space-3) 0;
}

/* ── 步骤列表项 ── */
.step-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 6px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--app-radius-md);
  transition: border-color var(--app-transition-fast), background var(--app-transition-fast);
}

.step-list-item:hover {
  border-color: var(--el-border-color-dark);
  background: var(--el-fill-color);
}

.step-info {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  min-width: 0;
}

.step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-primary);
  background: var(--app-accent-soft);
  border-radius: 50%;
  flex-shrink: 0;
}

.step-text strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.step-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.step-actions {
  display: flex;
  gap: var(--app-space-1);
  flex-shrink: 0;
}
</style>
