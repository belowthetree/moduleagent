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

// 在路由解析第一条路由之前加载已保存的配置，
// 以便 beforeEach 守卫检查 projectPath 并跳过设置
const configStore = useConfigStore()
configStore.loadFromLocalStorage()

// 验证存储路径下配置文件是否存在。
// 当配置文件缺失、损坏或为空时，loadFromProject 回退到默认值（projectPath = '.'），
// 清空 projectPath 以使 beforeEach 守卫重定向到 /setup。
if (configStore.projectPath) {
  try {
    await configStore.loadFromProject(configStore.projectPath)
    // 未找到配置文件时，默认 projectPath 为 '.'
    if (configStore.projectPath === '.') {
      configStore.projectPath = ''
    }
  } catch {
    configStore.projectPath = ''
  }
}

app.mount('#app')
