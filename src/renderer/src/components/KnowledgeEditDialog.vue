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
