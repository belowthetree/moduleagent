<script setup lang="ts">
import { Sunny, Moon } from '@element-plus/icons-vue'
import { useTheme } from '../composables/useTheme'

const theme = useTheme()
</script>

<template>
  <el-tooltip :content="theme.isDark.value ? 'Switch to light' : 'Switch to dark'">
    <el-button circle :icon="theme.isDark.value ? Sunny : Moon" @click="theme.toggleTheme" />
  </el-tooltip>
</template>

<style scoped>
.el-button {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 50;
}
</style>
