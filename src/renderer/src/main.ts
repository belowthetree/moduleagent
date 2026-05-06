import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/wabi-sabi.css'
import locale from 'element-plus/es/locale/lang/zh-cn'
import router from './router'
import App from './App.vue'
import { useConfigStore } from './stores/config'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale })

// Load saved config BEFORE the router resolves the first route,
// so the beforeEach guard can check projectPath and skip setup
const configStore = useConfigStore()
configStore.loadFromLocalStorage()

// Validate config file exists at the stored path.
// loadFromProject falls back to defaults (projectPath = '.') when
// the config file is missing, corrupt, or empty — clear projectPath
// so the beforeEach guard redirects to /setup.
if (configStore.projectPath) {
  try {
    await configStore.loadFromProject(configStore.projectPath)
    // Default projectPath is '.' when config file wasn't found
    if (configStore.projectPath === '.') {
      configStore.projectPath = ''
    }
  } catch {
    configStore.projectPath = ''
  }
}

app.mount('#app')
