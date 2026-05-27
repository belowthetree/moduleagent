<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useTheme } from './composables/useTheme'

// 触发主题副作用——applyTheme() 在模块加载时运行，
// 从 localStorage 'theme' 设置 document.documentElement 类
useTheme()
</script>

