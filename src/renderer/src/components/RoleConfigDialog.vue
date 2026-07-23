<!--
  RoleConfigDialog.vue — 角色配置对话框
  创建/编辑角色 Agent 的名称、描述、可见模块路径
-->

<script setup lang="ts">
import { computed, reactive, watch, onMounted } from 'vue'
import { useProjectStore } from '../stores/project'
import { useKnowledgeStore } from '../stores/knowledge'
import type { RoleConfigData } from '../../../types/shared'

const props = defineProps<{
  visible: boolean
  role: RoleConfigData
}>()

const emit = defineEmits<{
  close: []
  save: [role: RoleConfigData]
}>()

const projectStore = useProjectStore()
const knowledgeStore = useKnowledgeStore()

const form = reactive({
  name: '',
  description: '',
  visibleModulePaths: [] as string[],
  knowledgeRefs: [] as { filename: string; name: string }[],
})

watch(() => props.role, (r) => {
  if (r) {
    form.name = r.name
    form.description = r.description
    form.visibleModulePaths = [...r.visibleModulePaths]
    form.knowledgeRefs = r.knowledgeRefs ? [...r.knowledgeRefs] : []
  }
}, { immediate: true })

const modulePathOptions = computed(() => {
  return projectStore.flattenedNodes
    .filter(n => n.data.path !== '.')
    .map(n => n.data.path)
})

const knowledgeOptions = computed(() => {
  return knowledgeStore.entries.map(e => ({
    filename: e.filename,
    name: e.name,
  }))
})

onMounted(() => {
  knowledgeStore.fetchList()
})

// 对话框打开时刷新知识列表
watch(() => props.visible, (v) => {
  if (v) knowledgeStore.fetchList()
})

function handleSave(): void {
  if (!form.name.trim()) return
  emit('save', {
    name: form.name.trim(),
    description: form.description,
    visibleModulePaths: [...form.visibleModulePaths],
    agents: {
      default: {},
    },
    knowledgeRefs: form.knowledgeRefs.length > 0 ? [...form.knowledgeRefs] : undefined,
  })
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="配置角色 Agent"
    width="520px"
    :close-on-click-modal="false"
    @update:model-value="$emit('close')"
  >
    <el-form label-position="top">
      <el-form-item label="角色名称">
        <el-input v-model="form.name" placeholder="如: architect, reviewer" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="form.description" type="textarea" :rows="3" placeholder="角色的职责描述" />
      </el-form-item>
      <el-form-item label="可见模块路径">
        <el-select
          v-model="form.visibleModulePaths"
          multiple
          placeholder="选择可见的模块路径（不选则全部可见）"
          style="width: 100%"
        >
          <el-option
            v-for="p in modulePathOptions"
            :key="p"
            :label="p"
            :value="p"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关联知识">
        <el-select
          v-model="form.knowledgeRefs"
          multiple
          value-key="filename"
          placeholder="选择关联的知识条目（可选，将在对话时作为参考上下文）"
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

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button type="primary" :disabled="!form.name.trim()" @click="handleSave">
        保存
      </el-button>
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
</style>
