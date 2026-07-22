<!--
  ThemeToggle.vue — 主题切换按钮
  亮色/暗色主题切换开关（Sunny / Moon 图标 + 旋转过渡）
-->

<script setup lang="ts">
import { Sunny, Moon } from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'

const theme = useTheme()
</script>

<template>
  <el-tooltip :content="theme.isDark.value ? '切换为亮色' : '切换为深色'" placement="bottom" :show-after="400">
    <el-button text class="theme-toggle-btn" @click="theme.toggleTheme">
      <el-icon :size="16"><Sunny v-if="theme.isDark.value" /><Moon v-else /></el-icon>
    </el-button>
  </el-tooltip>
</template>

<style scoped>
/* 32px 方形图标按钮，与工具栏图标按钮一致 */
.theme-toggle-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--app-radius-md);
  --el-button-text-color: var(--el-text-color-secondary);
  --el-button-hover-text-color: var(--el-text-color-primary);
  --el-button-hover-bg-color: var(--el-fill-color);
  --el-button-active-bg-color: var(--el-fill-color-dark);
  transition: background-color var(--app-transition-fast), color var(--app-transition-fast);
}

/* 切换主题时新图标旋转淡入（v-if 换元素触发） */
.theme-toggle-btn :deep(.el-icon svg) {
  animation: theme-icon-in var(--app-transition-slow);
  transition: transform var(--app-transition);
}

/* hover 轻微旋转 */
.theme-toggle-btn:hover :deep(.el-icon svg) {
  transform: rotate(30deg);
}

@keyframes theme-icon-in {
  from {
    transform: rotate(-90deg) scale(0.6);
    opacity: 0;
  }
  to {
    transform: rotate(0) scale(1);
    opacity: 1;
  }
}
</style>
