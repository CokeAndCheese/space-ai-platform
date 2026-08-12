import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('./views/HomeView.vue'),
  },
  {
    path: '/sandbox',
    name: 'sandbox',
    component: () => import('./test/sandbox/SandboxView.vue'),
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
