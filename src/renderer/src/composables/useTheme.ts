import { ref, watch } from 'vue'

const THEME_KEY = 'theme'

const isDark = ref<boolean>(localStorage.getItem(THEME_KEY) === 'dark')

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

// Apply initial theme class on module load
applyTheme()

// Watch for changes and persist + apply
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
