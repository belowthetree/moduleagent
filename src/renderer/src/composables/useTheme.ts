// ---------------------------------------------------------------------------
// renderer/src/composables/useTheme.ts — 主题管理 composable
// 管理系统亮色/暗色主题切换，持久化到 localStorage
// ---------------------------------------------------------------------------

import { ref, watch } from 'vue'

const THEME_KEY = 'theme'

// 首次加载默认为深色主题（侘寂深色美学）
const isDark = ref<boolean>(localStorage.getItem(THEME_KEY) !== 'light')

function applyTheme(): void {
  if (isDark.value) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

function persistTheme(): void {
  localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light')
}

function toggleTheme(): void {
  isDark.value = !isDark.value
}

// 模块加载时应用初始主题类
applyTheme()

// 监听变化并持久化 + 应用
watch(isDark, () => {
  applyTheme()
  persistTheme()
})

export function useTheme() {
  return {
    isDark,
    toggleTheme
  }
}
