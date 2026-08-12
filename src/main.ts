import { createApp } from 'vue'
import * as THREE from 'three'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
// 引入 ssp-shim 顶层模块,触发 window.ssp 挂载
import './ssp'
// camera-controls 内部需要 THREE 子集,在启动时 install 一次
import CameraControls from './vendor/camera-controls'
CameraControls.install({ THREE })
import './style.css'

if (import.meta.env.DEV && typeof window !== 'undefined') {
  void import('./test/inspectModel').then(({ createModelInspector }) => {
    const devTools = (window as any).sspDev ?? {}
    devTools.modelInspector = createModelInspector()
    ;(window as any).sspDev = devTools
  })
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
