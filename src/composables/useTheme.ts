import { ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

const THEME_KEY = 'theme'

const isDark = ref<boolean>(localStorage.getItem(THEME_KEY) !== 'light')

function updateMetaThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', isDark.value ? '#14161a' : '#f5f7fa')
  }
}

function updateWindowTheme(): void {
  try {
    getCurrentWindow().setTheme(isDark.value ? 'dark' : 'light')
  } catch {
    // not running inside Tauri (e.g. web dev mode)
  }
}

function applyTheme(): void {
  if (isDark.value) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  updateMetaThemeColor()
  updateWindowTheme()
}

function persistTheme(): void {
  localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light')
}

function toggleTheme(): void {
  isDark.value = !isDark.value
}

applyTheme()

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
