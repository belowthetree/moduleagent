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

const showCodeSourcePath = ref(configStore.codeSourceType === 'local')

// ── Track original projectPath when dialog opens ──
watch(() => props.visible, (v) => {
  if (v) {
    originalProjectPath.value = configStore.projectPath
    error.value = ''
  }
})

// ── Watch codeSourceType changes ──
watch(() => configStore.codeSourceType, (v) => {
  showCodeSourcePath.value = v === 'local'
})

// ── Browse buttons ──
async function selectWorkspace(): Promise<void> {
  const d = await api.selectDir('选择工作目录')
  if (!d) return
  configStore.workspacePath = d
}

async function selectProject(): Promise<void> {
  const d = await api.selectDir('选择模块目录')
  if (!d) return
  configStore.projectPath = d
}

async function selectCodeSourcePath(): Promise<void> {
  const d = await api.selectDir('选择代码根目录')
  if (!d) return
  configStore.codeSourcePath = d
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

      <!-- Workspace Directory -->
      <el-form-item label="工作目录">
        <p class="field-hint">Agent 的工作空间，模块代码将同步到此目录</p>
        <el-input v-model="configStore.workspacePath" placeholder="输入或点击右侧按钮选择工作目录...">
          <template #append>
            <el-button @click="selectWorkspace">浏览</el-button>
          </template>
        </el-input>
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

      <!-- Code Source Type -->
      <el-form-item label="代码来源类型">
        <p class="field-hint">模块代码的来源</p>
        <el-select v-model="configStore.codeSourceType" class="full-width">
          <el-option label="本地目录" value="local" />
          <el-option label="Git 仓库" value="git" disabled />
        </el-select>
      </el-form-item>

      <!-- Local Code Path (conditional) -->
      <el-form-item v-if="showCodeSourcePath" label="本地代码路径">
        <p class="field-hint">源码所在的根目录，模块按相对路径从中映射</p>
        <el-input v-model="configStore.codeSourcePath" placeholder="输入或点击右侧按钮选择代码根目录...">
          <template #append>
            <el-button @click="selectCodeSourcePath">浏览</el-button>
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
.settings-error {
  margin-bottom: 16px;
}

.settings-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.settings-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.field-hint {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

.full-width {
  width: 100%;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
