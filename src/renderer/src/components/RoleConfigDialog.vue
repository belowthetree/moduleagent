<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import type { RoleConfigData } from '../../../types/preload'

const props = defineProps<{
  visible: boolean
  role: RoleConfigData
}>()

const emit = defineEmits<{
  close: []
  save: [role: RoleConfigData]
}>()

const projectStore = useProjectStore()

const form = reactive({
  name: '',
  description: '',
  visibleModulePaths: [] as string[],
  command: 'opencode',
  args: 'acp',
})

watch(() => props.role, (r) => {
  if (r) {
    form.name = r.name
    form.description = r.description
    form.visibleModulePaths = [...r.visibleModulePaths]
    form.command = r.agents.default.command
    form.args = (r.agents.default.args || ['acp']).join(' ')
  }
}, { immediate: true })

const modulePathOptions = computed(() => {
  return projectStore.flattenedNodes
    .filter(n => n.data.path !== '.')
    .map(n => n.data.path)
})

function handleSave(): void {
  if (!form.name.trim()) return
  emit('save', {
    name: form.name.trim(),
    description: form.description,
    visibleModulePaths: [...form.visibleModulePaths],
    agents: {
      default: {
        command: form.command,
        args: form.args.split(/\s+/).filter(Boolean),
      },
    },
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
      <el-form-item label="Agent 命令">
        <el-input v-model="form.command" placeholder="opencode" />
      </el-form-item>
      <el-form-item label="Agent 参数">
        <el-input v-model="form.args" placeholder="acp" />
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
