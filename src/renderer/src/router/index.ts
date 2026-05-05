import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useConfigStore } from '../stores/config'
import SetupView from '../views/SetupView.vue'
import MainView from '../views/MainView.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/setup',
  },
  {
    path: '/setup',
    name: 'setup',
    component: SetupView,
  },
  {
    path: '/main',
    name: 'main',
    component: MainView,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  if (to.path === '/main' || to.name === 'main') {
    const configStore = useConfigStore()
    if (!configStore.projectPath) {
      next('/setup')
      return
    }
  }
  next()
})

export default router
