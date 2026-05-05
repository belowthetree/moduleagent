<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '../stores/config'
import { useProjectStore } from '../stores/project'
import { useModuleAgent } from '../composables/useModuleAgent'

const router = useRouter()
const configStore = useConfigStore()
const projectStore = useProjectStore()
const api = useModuleAgent()

const error = ref('')
const scanning = ref(false)

// ── Computed ──
const startDisabled = computed(() => !configStore.workspacePath || !configStore.projectPath)
const showCodeSourcePath = computed(() => configStore.codeSourceType === 'local')

// ── Browse buttons ──
async function selectWorkspace(): Promise<void> {
  const d = await api.selectDir('选择工作目录')
  if (!d) return
  configStore.workspacePath = d
  configStore.saveToLocalStorage()
}

async function selectProject(): Promise<void> {
  const d = await api.selectDir('选择模块目录')
  if (!d) return
  configStore.projectPath = d
  configStore.saveToLocalStorage()
}

async function selectCodeSourcePath(): Promise<void> {
  const d = await api.selectDir('选择代码根目录')
  if (!d) return
  configStore.codeSourcePath = d
  configStore.saveToLocalStorage()
}

// ── Start scan ──
async function startScan(): Promise<void> {
  if (!configStore.workspacePath || !configStore.projectPath) return

  error.value = ''
  scanning.value = true

  configStore.saveToLocalStorage()

  try {
    await configStore.saveToProject(configStore.projectPath)
    await projectStore.scanProject(configStore.projectPath, configStore.workspacePath)
    router.push('/main')
  } catch (err) {
    error.value = '扫描失败: ' + (err instanceof Error ? err.message : String(err))
  } finally {
    scanning.value = false
  }
}

// ── Init ──
onMounted(() => {
  configStore.loadFromLocalStorage()
})
</script>

<template>
  <div class="setup-screen">
    <el-card class="setup-card" shadow="hover">
      <!-- Header -->
      <div class="setup-header">
        <h1 class="setup-logo">ModuleAgent</h1>
        <p class="setup-subtitle">配置工作目录、模块目录和 Agent 命令后开始</p>
      </div>

      <!-- Error Alert -->
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        show-icon
        closable
        @close="error = ''"
        class="setup-error"
      />

      <!-- Form -->
      <el-form
        label-position="top"
        :disabled="scanning"
        class="setup-form"
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
            <el-option label="Git 仓库（即将支持）" value="git" disabled />
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

      <!-- Start Button -->
      <div class="setup-actions">
        <el-button
          type="primary"
          size="large"
          :disabled="startDisabled"
          :loading="scanning"
          @click="startScan"
          class="btn-start"
        >
          {{ scanning ? '扫描中...' : '开始扫描' }}
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

.setup-actions {
  margin-top: 8px;
}

.btn-start {
  width: 100%;
}
</style>
