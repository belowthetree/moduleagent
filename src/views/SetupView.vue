<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '../stores/config'

const router = useRouter()
const configStore = useConfigStore()

const error = ref('')

// ── 计算属性 ──
const confirmDisabled = computed(() => !configStore.projectPath)

// ── 浏览按钮 ──
async function selectProject(): Promise<void> {
  const d = await window.moduleAgent.selectDir('选择项目目录')
  if (!d) return
  configStore.projectPath = d
  configStore.saveLastProject()
}

// ── 确认设置 ──
async function confirmSetup(): Promise<void> {
  if (!configStore.projectPath) return

  error.value = ''
  configStore.saveLastProject()

  try {
    await configStore.saveToProject(configStore.projectPath)
    router.push('/main')
  } catch (err) {
    error.value = '保存配置失败: ' + (err instanceof Error ? err.message : String(err))
  }
}

// ── 初始化 ──
onMounted(() => {
  configStore.loadLastProject()
})
</script>

<template>
  <div class="setup-screen">
    <el-card class="setup-card" shadow="hover">
      <!-- 标题 -->
      <div class="setup-header">
        <h1 class="setup-logo">ModuleAgent</h1>
        <p class="setup-subtitle">选择项目目录，配置 Agent 命令后确认进入</p>
      </div>

      <!-- 错误提示 -->
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        show-icon
        closable
        @close="error = ''"
        class="setup-error"
      />

      <!-- 表单 -->
      <el-form
        label-position="top"
        class="setup-form"
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

        <!-- 项目路径 -->
        <el-form-item label="项目目录">
          <p class="field-hint">项目根目录，模块文件存储在 .module-agent/module/ 中，工作空间在 .module-agent/workspace/</p>
          <el-input v-model="configStore.projectPath" placeholder="输入或点击右侧按钮选择项目目录...">
            <template #append>
              <el-button @click="selectProject">浏览</el-button>
            </template>
          </el-input>
        </el-form-item>

        <!-- 自动创建目录提示 -->
        <el-alert
          type="info"
          :closable="false"
          class="setup-note"
        >
          <template #title>
            模块描述文件存储在 <code>.module-agent/module/</code>，Agent 工作空间在 <code>.module-agent/workspace/</code>
          </template>
        </el-alert>
      </el-form>

      <!-- 确认按钮 -->
      <div class="setup-actions">
        <el-button
          type="primary"
          size="large"
          :disabled="confirmDisabled"
          @click="confirmSetup"
          class="btn-confirm"
        >
          确认
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.setup-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--el-bg-color-page);
}

.setup-card {
  width: 100%;
  max-width: 520px;
  border-radius: 10px;
  box-shadow: var(--el-box-shadow-light);
}

.setup-header {
  text-align: center;
  margin-bottom: 24px;
}

.setup-logo {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-color-primary);
  margin: 0 0 8px 0;
  letter-spacing: -0.5px;
}

.setup-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.setup-error {
  margin-bottom: 16px;
}

.setup-form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.setup-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.field-hint {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

.setup-note {
  margin-bottom: 0;
}

.setup-note code {
  background: var(--el-color-info-light-9);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
}

.setup-actions {
  margin-top: 8px;
}

.btn-confirm {
  width: 100%;
}

/* ── 侘寂风格：扁平输入框，无聚焦光晕 ── */
.setup-form :deep(.el-input__wrapper) {
  box-shadow: none !important;
}

.setup-form :deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}
</style>