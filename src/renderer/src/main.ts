import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
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

app.mount('#app')
