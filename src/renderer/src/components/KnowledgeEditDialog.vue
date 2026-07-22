<!--
  KnowledgeEditDialog.vue — 知识条目编辑对话框
  创建/编辑知识库条目的名称和 Markdown 内容
-->

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { KnowledgeEntry } from '../../../types/shared'

const props = defineProps<{
  visible: boolean
  entry: KnowledgeEntry
}>()

const emit = defineEmits<{
  close: []
  save: [entry: KnowledgeEntry]
}>()

const form = reactive({
  name: '',
  content: '',
})

watch(() => props.entry, (e) => {
  if (e) {
    form.name = e.name
    form.content = e.content
  }
}, { immediate: true })

function handleSave(): void {
  if (!form.name.trim()) return
  emit('save', {
    name: form.name.trim(),
    filename: props.entry.filename,
    content: form.content,
  })
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="编辑知识条目"
    width="640px"
    :close-on-click-modal="false"
    @update:model-value="$emit('close')"
  >
    <el-form label-position="top">
      <el-form-item label="名称">
        <el-input v-model="form.name" placeholder="条目名称" />
      </el-form-item>
      <el-form-item label="内容 (Markdown)">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="15"
          placeholder="支持 Markdown 格式"
        />
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
:deep(.el-textarea__inner) {
  border-radius: var(--app-radius-md);
}

/* Markdown 内容编辑区用等宽字体 */
:deep(.el-textarea__inner) {
  font-family: var(--app-mono);
  font-size: 12px;
  line-height: 1.6;
}
</style>
