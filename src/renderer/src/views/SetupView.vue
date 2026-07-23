<!--
  SetupView.vue — 项目配置视图
  项目扫描/初始化向导：配置 Agent 命令、项目路径，生成 module.md
-->

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '../stores/config'
// 品牌区图标
import { Box } from '@element-plus/icons-vue'

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
  configStore.saveToLocalStorage()
}

// ── 确认设置 ──
async function confirmSetup(): Promise<void> {
  if (!configStore.projectPath) return

  error.value = ''
  configStore.saveToLocalStorage()

  try {
    await configStore.saveToProject(configStore.projectPath)
    router.push('/main')
  } catch (err) {
    error.value = '保存配置失败: ' + (err instanceof Error ? err.message : String(err))
  }
}

// ── 初始化 ──
onMounted(() => {
  configStore.loadFromLocalStorage()
})
</script>

<template>
  <div class="setup-screen">
    <el-card class="setup-card" shadow="hover">
      <!-- 品牌区：产品标识 + 产品名 + 一句话说明 -->
      <div class="setup-header">
        <div class="setup-brand-mark">
          <el-icon :size="26"><Box /></el-icon>
        </div>
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
/* ── 首屏：居中卡片 + 顶部主色微光背景 ── */
.setup-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--app-space-5);
  background:
    radial-gradient(640px 320px at 50% -80px, var(--app-accent-soft), transparent 70%),
    var(--el-bg-color-page);
}

.setup-card {
  width: 100%;
  max-width: 520px;
  border-radius: var(--app-radius-lg);
  border: 1px solid var(--el-border-color-light);
  box-shadow: var(--app-shadow-2);
}

.setup-card :deep(.el-card__body) {
  padding: var(--app-space-6);
}

/* ── 品牌区 ── */
.setup-header {
  text-align: center;
  margin-bottom: var(--app-space-5);
}

.setup-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: var(--app-space-3);
  border-radius: var(--app-radius-lg);
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
}

.setup-logo {
  font-size: 26px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin: 0 0 var(--app-space-2) 0;
  letter-spacing: -0.5px;
}

.setup-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.setup-error {
  margin-bottom: var(--app-space-4);
  border-radius: var(--app-radius-md);
}

/* ── 表单间距规范化 ── */
.setup-form :deep(.el-form-item) {
  margin-bottom: var(--app-space-4);
}

.setup-form :deep(.el-form-item__label) {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: var(--app-space-1);
}

.field-hint {
  margin: 0 0 var(--app-space-1) 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.setup-note {
  margin-bottom: 0;
  border-radius: var(--app-radius-md);
}

.setup-note code {
  font-family: var(--app-mono);
  background: var(--el-fill-color);
  padding: 1px 6px;
  border-radius: var(--app-radius-sm);
  font-size: 12px;
  font-weight: 600;
}

.setup-actions {
  margin-top: var(--app-space-2);
}

/* 主操作按钮：加大 + 全宽 */
.btn-confirm {
  width: 100%;
  height: 40px;
  font-weight: 600;
  border-radius: var(--app-radius-md);
}

/* ── 扁平输入框：细边框，聚焦时主色描边（无光晕） ── */
.setup-form :deep(.el-input__wrapper) {
  border-radius: var(--app-radius-md);
  box-shadow: 0 0 0 1px var(--el-border-color) inset;
  transition: box-shadow var(--app-transition-fast);
}

.setup-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
</style>