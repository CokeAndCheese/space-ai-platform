/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 让 vue-tsc 能识别 three/examples/jsm 下的命名导出
declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { Loader } from 'three'
  export class GLTFLoader extends Loader {
    load(url: string, onLoad: (gltf: any) => void, onProgress?: (xhr: any) => void, onError?: (err: any) => void): unknown
    setDRACOLoader(loader: any): this
  }
}

declare module 'three/examples/jsm/loaders/DRACOLoader.js' {
  import type { Loader } from 'three'
  export class DRACOLoader extends Loader {
    setDecoderPath(path: string): this
    setDecoderConfig(config: { type: string }): this
    dispose(): void
  }
}

declare module 'three/examples/jsm/controls/OrbitControls.js' {
  // 已不再使用,改用本地化 @/vendor/camera-controls
  // 保留这个 stub 防止 vue-tsc 扫到其它残留 import 时报错
  import type { EventDispatcher, Object3D, PerspectiveCamera } from 'three'
  export class OrbitControls extends EventDispatcher {
    constructor(camera: PerspectiveCamera, domElement: HTMLElement)
    enableDamping: boolean
    dampingFactor: number
    target: Object3D | any
    update(): boolean
    dispose(): void
  }
}
