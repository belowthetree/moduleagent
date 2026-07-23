<!--
  StepEditDialog.vue — 工作流步骤编辑对话框
  编辑步骤的名称、描述、输入源、验收标准、Agent 配置
-->

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { useKnowledgeStore } from '../stores/knowledge'
import type { WorkflowStepDetail } from '../../../types/shared'

const props = defineProps<{
  visible: boolean
  step: WorkflowStepDetail | null
}>()

const emit = defineEmits<{
  close: []
  save: [step: WorkflowStepDetail]
}>()

const projectStore = useProjectStore()
const knowledgeStore = useKnowledgeStore()

const form = reactive({
  name: '',
  description: '',
  inputFrom: 'previous' as string,
  inputSourceStep: '',
  body: '',
  acceptanceCriteria: '',
  visibleModulePaths: [] as string[],
  knowledgeRefs: [] as { filename: string; name: string }[],
})

const modulePathOptions = computed(() =>
  projectStore.flattenedNodes
    .filter(n => n.data.path !== '.')
    .map(n => n.data.path)
)

const knowledgeOptions = computed(() =>
  knowledgeStore.entries.map(e => ({
    filename: e.filename,
    name: e.name,
  }))
)

watch(() => props.visible, (v) => {
  if (v) knowledgeStore.fetchList()
})

watch(() => props.step, (s) => {
  if (s) {
    form.name = s.definition.name || s.name
    form.description = s.definition.description || ''
    form.inputFrom = s.definition.input?.from || 'previous'
    form.inputSourceStep = s.definition.input?.sourceStep || ''
    form.body = s.body || ''
    form.acceptanceCriteria = s.definition.acceptance?.criteria || ''
    form.visibleModulePaths = s.definition.agent?.visibleModulePaths || []
    form.knowledgeRefs = s.definition.agent?.knowledgeRefs || []
  }
}, { immediate: true })

function handleSave(): void {
  if (!form.name.trim()) return
  const updated: WorkflowStepDetail = {
    name: form.name.trim(),
    dir: props.step?.dir || '',
    definition: {
      name: form.name.trim(),
      description: form.description || undefined,
      input: { from: form.inputFrom, ...(form.inputSourceStep ? { sourceStep: form.inputSourceStep } : {}) },
      acceptance: form.acceptanceCriteria ? { criteria: form.acceptanceCriteria } : undefined,
      agent: form.visibleModulePaths.length > 0 || form.knowledgeRefs.length > 0
        ? {
            visibleModulePaths: form.visibleModulePaths.length > 0 ? form.visibleModulePaths : undefined,
            knowledgeRefs: form.knowledgeRefs.length > 0 ? form.knowledgeRefs : undefined,
          }
        : undefined,
    },
    body: form.body,
  }
  // Preserve original dir
  emit('save', updated)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="编辑步骤"
    width="640px"
    :close-on-click-modal="false"
    @update:model-value="$emit('close')"
  >
    <el-tabs model-value="config">
      <el-tab-pane label="基本配置" name="config">
        <el-form label-position="top" style="max-height: 420px; overflow-y: auto;">
          <el-form-item label="步骤名称">
            <el-input v-model="form.name" placeholder="如: 代码分析" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.description" placeholder="可选步骤描述" />
          </el-form-item>
          <el-form-item label="输入来源">
            <el-select v-model="form.inputFrom" style="width: 100%">
              <el-option label="用户输入" value="user" />
              <el-option label="前一步骤产出" value="previous" />
              <el-option label="用户输入 + 前一步骤" value="both" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.inputFrom !== 'user'" label="来源步骤">
            <el-input v-model="form.inputSourceStep" placeholder="默认为上一序号的步骤" />
          </el-form-item>
          <el-form-item label="验收标准（可选）">
            <el-input
              v-model="form.acceptanceCriteria"
              type="textarea"
              :rows="4"
              placeholder="步骤完成后的验收标准，例如:&#10;1. 所有 API 已文档化&#10;2. 没有遗漏的模块"
            />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="工作内容" name="body">
        <el-form label-position="top">
          <el-form-item label="Markdown 工作描述（将作为 Agent 的任务指令）">
            <el-input
              v-model="form.body"
              type="textarea"
              :rows="18"
              placeholder="# 工作内容&#10;&#10;请分析代码并..."
            />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="Agent 配置" name="agent">
        <el-form label-position="top" style="max-height: 420px; overflow-y: auto;">
          <el-form-item label="可见模块">
            <el-select
              v-model="form.visibleModulePaths"
              multiple
              placeholder="选择可见的模块（不选则使用项目上下文）"
              style="width: 100%"
            >
              <el-option v-for="p in modulePathOptions" :key="p" :label="p" :value="p" />
            </el-select>
          </el-form-item>
          <el-form-item label="关联知识">
            <el-select
              v-model="form.knowledgeRefs"
              multiple
              value-key="filename"
              placeholder="选择关联的知识条目"
              style="width: 100%"
            >
              <el-option
                v-for="k in knowledgeOptions"
                :key="k.filename"
                :label="k.name"
                :value="{ filename: k.filename, name: k.name }"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button type="primary" :disabled="!form.name.trim()" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
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

/* footer 按钮间距 8px */
:deep(.el-dialog__footer .el-button + .el-button) {
  margin-left: var(--app-space-2);
}

/* ── 页签细化 ── */
:deep(.el-tabs__item) {
  font-size: 13px;
  font-weight: 600;
  transition: color var(--app-transition-fast);
}

:deep(.el-tabs__active-bar) {
  border-radius: 2px;
}

/* ── 表单：label 13px 600，输入项圆角 8px ── */
:deep(.el-form-item) {
  margin-bottom: 18px;
}

:deep(.el-form-item__label) {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}

:deep(.el-input__wrapper),
:deep(.el-textarea__inner),
:deep(.el-select__wrapper) {
  border-radius: var(--app-radius-md);
}

/* Markdown 工作描述编辑区用等宽字体 */
:deep(.el-textarea__inner) {
  font-family: var(--app-mono);
  font-size: 12px;
  line-height: 1.6;
}
</style>
