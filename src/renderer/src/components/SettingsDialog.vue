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

// ── Track original projectPath when dialog opens ──
watch(() => props.visible, (v) => {
  if (v) {
    originalProjectPath.value = configStore.projectPath
    error.value = ''
  }
})

// ── Browse buttons ──
async function selectProject(): Promise<void> {
  const d = await api.selectDir('选择模块目录')
  if (!d) return
  configStore.projectPath = d
}

// ── Save ──
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
    <!-- Error Alert -->
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
      <!-- Agent Command -->
      <el-form-item label="Agent 命令">
        <p class="field-hint">启动 Agent 的可执行文件名或路径</p>
        <el-input v-model="configStore.agentCmd" placeholder="opencode" />
      </el-form-item>

      <!-- Agent Args -->
      <el-form-item label="Agent 参数">
        <p class="field-hint">传给 Agent 的额外参数（空格分隔，如: acp）</p>
        <el-input v-model="configStore.agentArgs" placeholder="acp" />
      </el-form-item>

      <!-- Project (Module) Directory -->
      <el-form-item label="模块目录">
        <p class="field-hint">包含 module.md 的项目根目录</p>
        <el-input v-model="configStore.projectPath" placeholder="输入或点击右侧按钮选择模块目录...">
          <template #append>
            <el-button @click="selectProject">浏览</el-button>
          </template>
        </el-input>
      </el-form-item>

    </el-form>

    <!-- Footer -->
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
/* ── Dialog Header ── */
:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--el-border-color);
  padding-bottom: 12px;
}

/* ── Error ── */
.settings-error {
  margin-bottom: 16px;
}

/* ── Settings Form ── */
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

/* ── Field Hint ── */
.field-hint {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

/* ── Full Width ── */
.full-width {
  width: 100%;
}

/* ── Input / Select Wrapper (flat, no glow) ── */
:deep(.el-input__wrapper) {
  box-shadow: none !important;
}

:deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}

/* ── Footer ── */
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
