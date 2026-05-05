<script setup lang="ts">
import { Sunny, Moon } from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'

const theme = useTheme()
</script>

<template>
  <el-tooltip :content="theme.isDark.value ? 'Switch to light' : 'Switch to dark'" placement="bottom">
    <el-button text @click="theme.toggleTheme">
      <el-icon><Sunny v-if="theme.isDark.value" /><Moon v-else /></el-icon>
    </el-button>
  </el-tooltip>
</template>
