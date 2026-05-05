<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useTheme } from './composables/useTheme'

// Trigger theme side effects — applyTheme() runs on module load,
// setting document.documentElement class from localStorage 'theme'
useTheme()
</script>

<style scoped>
html,
body {
  margin: 0;
  padding: 0;
  height: 100vh;
}

#app {
  height: 100vh;
}
</style>
