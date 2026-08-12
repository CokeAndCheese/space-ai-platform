/**
 * useThreeScene — 统一的 Three.js 场景初始化
 *
 * 把原本 App.vue 里散落的 scene/camera/renderer/GLTF 加载逻辑抽出来。
 * 各路由页面 (Home、/sandbox) 都通过这个 composable 拿到一致的场景。
 *
 * v2 改造:
 *   - OrbitControls 替换成 camera-controls (内置 smooth tween + 更好的 API)
 *   - camera-controls 的 update() 每帧在 rAF 调一次, ctx.onBeforeRender 钩子暴露给 ssp-shim 用
 *
 * 模型切换:
 *   - modelUrl 改为必传 (不再硬编码)
 *   - 切换 modelUrl 时会自动 dispose 旧的 scene + GLTF,加载新模型
 *   - 切换前自动调用 onModelUnload 钩子清理 (高亮 / POI 等)
 */

import { ref, watch, onBeforeUnmount, type Ref, type WatchStopHandle } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import CameraControls from '@/vendor/camera-controls'
import { ssp } from '@/ssp'

export interface UseThreeSceneOptions {
  /** 模型路径 (可选;为空 = 不自动加载, 由调用方自己用 modelTool 管理) */
  modelUrl?: string | Ref<string>
  /** 是否加地面网格,默认 true */
  withGrid?: boolean
  /** 背景色,默认 #101218 */
  background?: string | number
  /** 模型整体缩放 */
  modelScale?: number
  /** 模型位置 */
  modelPosition?: [number, number, number]
  /** 加载完成回调 (新模型加载完后触发) */
  onModelLoaded?: (model: THREE.Object3D, gltf: any) => void
  /** 加载前 / 切换模型时清理钩子 (比如清掉高亮 / POI) */
  onModelUnload?: () => void
}

/** resolveOpts() 后,所有 ref 都被 unwrap 的版本 */
interface ResolvedOpts {
  modelUrl: string
  withGrid?: boolean
  background: string | number
  modelScale: number
  modelPosition: [number, number, number]
  onModelLoaded?: (model: THREE.Object3D, gltf: any) => void
  onModelUnload?: () => void
}

export interface UseThreeSceneReturn {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: CameraControls
  containerRef: Ref<HTMLDivElement | null>
  loading: Ref<boolean>
  errorMsg: Ref<string>
  currentModelUrl: Ref<string>
  /** 主动 dispose,通常 onBeforeUnmount 自动调 */
  dispose: () => void
}

export function useThreeScene(
  options: UseThreeSceneOptions,
): UseThreeSceneReturn {
  const containerRef = ref<HTMLDivElement | null>(null)
  const loading = ref(true)
  const errorMsg = ref('')

  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: CameraControls | null = null
  let mixer: THREE.AnimationMixer | null = null
  let currentModel: THREE.Object3D | null = null
  let animationId = 0
  const clock = new THREE.Clock()
  let disposed = false
  let onResize: (() => void) | null = null
  let stopModelUrlWatch: WatchStopHandle | null = null
  let currentLoadToken = 0  // 防止旧加载覆盖新 model

  const currentModelUrl = ref<string>('')

  function resolveOpts(): ResolvedOpts {
    const raw: any = { ...options }
    const unwrapped: any = { ...raw }
    for (const k of Object.keys(raw)) {
      const v = raw[k]
      if (v && typeof v === 'object' && 'value' in v && typeof (v as any).value !== 'undefined') {
        unwrapped[k] = (v as any).value
      }
    }
    return unwrapped as ResolvedOpts
  }

  function syncContextToSsp() {
    if (!scene || !camera || !renderer || !controls) return
    // camera-controls 的 update 每帧推进 transition / 阻尼
    ssp.setContext({
      scene,
      camera,
      renderer,
      controls: controls as any,
      domElement: renderer.domElement,
      onBeforeRender: () => controls!.update(clock.getDelta()),
    })
  }

  function initCore(el: HTMLDivElement, opts: ResolvedOpts) {
    const width = el.clientWidth
    const height = el.clientHeight

    // 渲染器
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    el.appendChild(renderer.domElement)

    // 场景
    scene = new THREE.Scene()
    const bg = opts.background ?? 0x101218
    scene.background = new THREE.Color(bg)

    // 相机
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    camera.position.set(0, 1.5, 4)

    // 灯光
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 1.0)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 1.5)
    dir.position.set(5, 10, 7)
    scene.add(dir)

    // 网格 (自适应大小)
    if (opts.withGrid ?? true) {
      // 让网格比模型最宽边大 50%,足够覆盖
      const probe = new THREE.Box3()
      // 注意:此时模型还没加载,用一个够大的网格兜底
      const gridSize = 500
      const gridDivisions = 50
      const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222)
      scene.add(grid)
      void probe  // 暂未使用,留给后续按需扩展
    }

    // camera-controls (替代 OrbitControls)
    // install 在 main.ts 启动时已调过,这里直接 new
    controls = new CameraControls(camera as any, renderer.domElement)

    // ssp context 注入 (把 controls.update 挂到主循环钩子上)
    syncContextToSsp()
  }

  function loadModel(opts: ResolvedOpts) {
    if (!scene || !camera) return
    const url = opts.modelUrl
    const token = ++currentLoadToken

    // 卸载旧模型
    if (currentModel) {
      scene.remove(currentModel)
      disposeObject(currentModel)
      currentModel = null
    }
    currentModelUrl.value = ''
    mixer?.stopAllAction()
    mixer = null

    // 通知业务方做清理
    opts.onModelUnload?.()

    if (!url) {
      // 切到空 URL 也必须完成上面的卸载/请求失效。
      loading.value = false
      errorMsg.value = ''
      return
    }
    // 防御: scene URL (/models/<sub>) 不是 GLB, 不能直接加载
    // 这种 URL 应该由 modelTool.loadSubcategory() 处理, useThreeScene 跳过
    if (!/\.(glb|gltf)$/i.test(url)) {
      console.log('[useThreeScene] skip non-GLB url:', url, '(use modelTool to load scene)')
      loading.value = false
      return
    }

    loading.value = true
    errorMsg.value = ''

    const loader = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    draco.setDecoderConfig({ type: 'wasm' })
    loader.setDRACOLoader(draco)

    loader.load(
      url,
      (gltf) => {
        if (disposed || token !== currentLoadToken) return
        const model = gltf.scene
        model.scale.setScalar(opts.modelScale ?? 1)
        model.position.set(...(opts.modelPosition ?? [0, 0, 0]))
        scene!.add(model)
        currentModel = model
        currentModelUrl.value = url

        // 把模型底面贴到 Y=0 (让 Box3.center.y 是模型高度一半, 方便后面 fitScene 计算 target)
        const initialBox = new THREE.Box3().setFromObject(model)
        const initialMin = initialBox.min
        model.position.y -= initialMin.y
        model.updateMatrixWorld(true)

        // 单 GLB 直接 fit (useThreeScene 直接 load 的场景)
        // multi-GLB (scene) 走 modelTool.loadSubcategory, 由调用方在 .then() 调 fitScene 统一 fit
        if (ssp.hasContext() && ssp.cameraController) {
          ssp.cameraController.fitScene([model], { animate: false }).catch((err: any) => {
            console.warn('[useThreeScene] fitScene failed:', err)
          })
        }

        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model)
          gltf.animations.forEach((clip: THREE.AnimationClip) => {
            const action = mixer!.clipAction(clip)
            action.play()
          })
        }

        loading.value = false
        opts.onModelLoaded?.(model, gltf)
      },
      () => {},
      (err) => {
        if (disposed || token !== currentLoadToken) return
        console.error('[useThreeScene] 模型加载失败:', err)
        const reason = err instanceof ErrorEvent ? err.message : (err as any)?.message ?? '未知错误'
        errorMsg.value = `模型加载失败：${url}\n${reason}`
        loading.value = false
      },
    )
  }

  function init(el: HTMLDivElement) {
    if (renderer) return  // 已初始化
    const opts = resolveOpts()
    initCore(el, opts)

    // 渲染循环
    const tick = () => {
      if (disposed) return
      animationId = requestAnimationFrame(tick)
      const dt = clock.getDelta()
      mixer?.update(dt)
      // camera-controls 的 update (含阻尼 / transition 推进)
      controls?.update(dt)
      renderer!.render(scene!, camera!)
    }
    tick()

    // resize
    onResize = () => {
      if (!renderer || !camera) return
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // 首次加载模型
    loadModel(opts)

    // 监听 modelUrl 变化 → 重新加载
    stopModelUrlWatch = watch(
      () => {
        if (options.modelUrl === undefined) return ''
        return typeof options.modelUrl === 'string'
          ? options.modelUrl
          : options.modelUrl.value
      },
      (newUrl, oldUrl) => {
        if (newUrl === oldUrl) return
        if (!renderer || !scene) return
        loadModel(resolveOpts())
      },
    )
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    currentLoadToken++
    cancelAnimationFrame(animationId)
    if (onResize) window.removeEventListener('resize', onResize)
    stopModelUrlWatch?.()
    stopModelUrlWatch = null

    // modelTool 管理的 GLB 必须在 context 清空前卸载。
    // 业务清理失败也不能阻断 renderer/context 的释放。
    try {
      resolveOpts().onModelUnload?.()
    } catch (err) {
      console.warn('[useThreeScene] onModelUnload failed during dispose:', err)
    }

    mixer?.stopAllAction()
    if (currentModel) {
      disposeObject(currentModel)
      currentModel = null
    }
    controls?.dispose()
    renderer?.dispose()
    if (renderer?.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
    renderer = null
    scene = null
    camera = null
    controls = null
    ssp.clearContext()
  }

  // 自动 watch containerRef,有值时 init
  const stopWatch = (function startWatch() {
    let cancelled = false
    const interval = setInterval(() => {
      if (cancelled) return
      if (containerRef.value && !renderer) {
        clearInterval(interval)
        init(containerRef.value)
      }
    }, 50)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  })()

  onBeforeUnmount(() => {
    stopWatch()
    dispose()
  })

  return {
    get scene() { return scene! },
    get camera() { return camera! },
    get renderer() { return renderer! },
    get controls() { return controls! },
    containerRef,
    loading,
    errorMsg,
    currentModelUrl,
    dispose,
  }
}

// 释放 Object3D 的几何 / 材质
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose?.()
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m: any) => m.dispose?.())
    }
  })
}
