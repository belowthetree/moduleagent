<!--
  ThemeToggle.vue — 主题切换按钮
  亮色/暗色主题切换开关
-->

<script setup lang="ts">
import { Sunny, Moon } from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'

const theme = useTheme()
</script>

<template>
  <el-tooltip :content="theme.isDark.value ? '切换为亮色' : '切换为深色'" placement="bottom">
    <el-button text @click="theme.toggleTheme">
      <el-icon><Sunny v-if="theme.isDark.value" /><Moon v-else /></el-icon>
    </el-button>
  </el-tooltip>
</template>
