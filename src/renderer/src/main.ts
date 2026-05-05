import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import locale from 'element-plus/es/locale/lang/zh-cn'

// Placeholder App — actual App.vue created in Task 27
const App = { template: '<div id="app"></div>' }

const app = createApp(App)

app.use(ElementPlus, { locale })

app.mount('#app')
