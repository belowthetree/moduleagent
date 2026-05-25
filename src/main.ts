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
import { installModuleAgent } from './composables/useModuleAgent'

// Install the API before anything else — this sets window.moduleAgent
installModuleAgent()

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale })

// Load saved config before first route resolves
const configStore = useConfigStore()
configStore.loadFromLocalStorage()

// Verify config file exists under stored path.
// When config is missing/corrupt, loadFromProject falls back to defaults (projectPath = '.'),
// so clear projectPath to force redirect to /setup.
async function initApp() {
  if (configStore.projectPath) {
    try {
      await configStore.loadFromProject(configStore.projectPath)
      if (configStore.projectPath === '.') {
        configStore.projectPath = ''
      }
    } catch {
      configStore.projectPath = ''
    }
  }
  app.mount('#app')
}

initApp()
