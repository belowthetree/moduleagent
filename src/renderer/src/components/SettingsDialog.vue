<!--
  SettingsDialog.vue — 设置对话框
  配置 Agent 命令、模型、参数和项目路径
-->

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { useModuleAgent } from '../composables/useModuleAgent'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  rescanNeeded: []
}>()

const configStore = useConfigStore()
const api = useModuleAgent()

const saving = ref(false)
const error = ref('')
const originalProjectPath = ref('')

// ── 对话框打开时追踪原始 projectPath ──
watch(() => props.visible, (v) => {
  if (v) {
    originalProjectPath.value = configStore.projectPath
    error.value = ''
  }
})

// ── 浏览按钮 ──
async function selectProject(): Promise<void> {
  const d = await api.selectDir('选择项目目录')
  if (!d) return
  configStore.projectPath = d
}

// ── 保存 ──
async function onSave(): Promise<void> {
  error.value = ''
  saving.value = true

  try {
    configStore.saveToLocalStorage()

    if (configStore.projectPath) {
      await configStore.saveToProject(configStore.projectPath)
    }

    const projectChanged = configStore.projectPath !== originalProjectPath.value
    if (projectChanged) {
      emit('rescanNeeded')
    }

    emit('close')
  } catch (err) {
    error.value = '保存失败: ' + (err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}

function onCancel(): void {
  emit('close')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="设置"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @close="onCancel"
  >
    <!-- 错误提示 -->
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      closable
      @close="error = ''"
      class="settings-error"
    />

    <el-form
      label-position="top"
      :disabled="saving"
      class="settings-form"
    >
      <!-- Agent 命令 -->
      <el-form-item label="Agent 命令">
        <p class="field-hint">启动 Agent 的可执行文件名或路径</p>
        <el-input v-model="configStore.agentCmd" placeholder="opencode" />
      </el-form-item>

      <!-- Agent 参数 -->
      <el-form-item label="Agent 参数">
        <p class="field-hint">传给 Agent 的额外参数（空格分隔，如: acp）</p>
        <el-input v-model="configStore.agentArgs" placeholder="acp" />
      </el-form-item>

      <!-- 项目目录 -->
      <el-form-item label="项目目录">
        <p class="field-hint">项目根目录，模块文件存储在 .module-agent/module/ 中</p>
        <el-input v-model="configStore.projectPath" placeholder="输入或点击右侧按钮选择项目目录...">
          <template #append>
            <el-button @click="selectProject">浏览</el-button>
          </template>
        </el-input>
      </el-form-item>

      <!-- 自动文档更新 -->
      <el-form-item label="自动文档更新">
        <p class="field-hint">任务完成后自动评估并更新模块文档（module.md）、任务经验和修改规范</p>
        <el-switch v-model="configStore.autoDocUpdate" />
      </el-form-item>

    </el-form>

    <!-- 底部按钮 -->
    <template #footer>
      <div class="settings-footer">
        <el-button @click="onCancel">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">
          {{ saving ? '保存中...' : '保存' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ── 对话框标题 ── */
:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--el-border-color);
  padding-bottom: 12px;
}

/* ── 错误 ── */
.settings-error {
  margin-bottom: 16px;
}

/* ── 设置表单 ── */
.settings-form {
  border-radius: 10px;
}

.settings-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.settings-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}

/* ── 字段提示 ── */
.field-hint {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

/* ── 全宽 ── */
.full-width {
  width: 100%;
}

/* ── 输入/选择包装器（扁平，无发光） ── */
:deep(.el-input__wrapper) {
  box-shadow: none !important;
}

:deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}

/* ── 底部 ── */
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
