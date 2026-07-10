<!--
  SettingsDialog.vue — 设置对话框
  配置 LLM 提供商、API 密钥、模型和项目路径
-->

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
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

const providers = [
  { value: 'anthropic', label: 'Anthropic (Claude)', defaultBaseUrl: 'https://api.anthropic.com' },
  { value: 'openai', label: 'OpenAI (GPT)', defaultBaseUrl: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com' },
  { value: 'google', label: 'Google (Gemini)', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)', defaultBaseUrl: '' },
]

const showApiKey = ref(false)
const customBaseUrl = computed(() => {
  const p = providers.find(p => p.value === configStore.provider)
  return p?.defaultBaseUrl || ''
})

watch(() => props.visible, (v) => {
  if (v) {
    originalProjectPath.value = configStore.projectPath
    error.value = ''
  }
})

watch(() => configStore.provider, (newProvider) => {
  if (!configStore.baseUrl) {
    const p = providers.find(p => p.value === newProvider)
    if (p) configStore.baseUrl = p.defaultBaseUrl
  }
})

async function selectProject(): Promise<void> {
  const d = await api.selectDir('选择项目目录')
  if (!d) return
  configStore.projectPath = d
}

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
      <el-form-item label="LLM 提供商">
        <p class="field-hint">选择要使用的 AI 模型提供商</p>
        <el-select v-model="configStore.provider" class="full-width">
          <el-option
            v-for="p in providers"
            :key="p.value"
            :label="p.label"
            :value="p.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="API 密钥">
        <p class="field-hint">提供商 API 密钥（存储在项目 .module-agent.json 中）</p>
        <el-input
          v-model="configStore.apiKey"
          :type="showApiKey ? 'text' : 'password'"
          placeholder="sk-..."
        >
          <template #suffix>
            <el-button link @click="showApiKey = !showApiKey">
              {{ showApiKey ? '隐藏' : '显示' }}
            </el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label="API 基础 URL" v-if="configStore.provider === 'custom'">
        <p class="field-hint">自定义 OpenAI 兼容 API 端点</p>
        <el-input v-model="configStore.baseUrl" placeholder="https://api.openai.com/v1" />
      </el-form-item>

      <el-form-item label="模型">
        <p class="field-hint">模型名称（如 claude-sonnet-4-20250514、gpt-4o、deepseek-chat）</p>
        <el-input v-model="configStore.model" placeholder="claude-sonnet-4-20250514" />
      </el-form-item>

      <el-form-item label="项目目录">
        <p class="field-hint">项目根目录，模块文件存储在 .module-agent/module/ 中</p>
        <el-input v-model="configStore.projectPath" placeholder="输入或点击右侧按钮选择项目目录...">
          <template #append>
            <el-button @click="selectProject">浏览</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label="自动文档更新">
        <p class="field-hint">任务完成后自动评估并更新模块文档（module.md）、任务经验和修改规范</p>
        <el-switch v-model="configStore.autoDocUpdate" />
      </el-form-item>

    </el-form>

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
:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--el-border-color);
  padding-bottom: 12px;
}

.settings-error {
  margin-bottom: 16px;
}

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

.field-hint {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

.full-width {
  width: 100%;
}

:deep(.el-input__wrapper) {
  box-shadow: none !important;
}

:deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
