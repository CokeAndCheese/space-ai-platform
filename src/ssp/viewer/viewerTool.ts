/**
 * viewerTool — 多视角 / 子视图管理 + 截图
 *
 * v1: 快照模式 (snapshot)
 *   - 每个子画布每 N 毫秒从主 renderer 截一张图
 *   - 显示在 DOM <canvas> 上 (作为 ImageBitmap 渲染)
 *   - 子相机独立 (用户能调),但渲染是离散的
 *   - 优点: 不创建额外 WebGL context (主 canvas 不污染)
 *   - 缺点: 不是 60fps 实时(够用)
 *
 * v2 (未来): 独立 WebGLRenderer (60fps 但 context 多)
 *
 * 数据结构: 闭包 Map<subId, handle> + Map<subId, setInterval id> (快照定时器)。
 *
 * API:
 *   - 子画布 (5):  createCanvas / getById / remove / removeAll / list
 *   - 截图 (1):    screenshot
 *
 * 对应模板:
 *   - src/templates/ssp_templates/viewer/createCanvas3D.json
 *   - src/templates/ssp_templates/viewer/screenshot.json
 */

import * as THREE from 'three'
import CameraControls from '@/vendor/camera-controls'
import { getSspContext } from '../core/context'

export interface SubCanvasOptions {
  /** 子画布放哪, 默认 'top-right' */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** 像素大小, 默认 { width: 320, height: 240 } */
  size?: { width: number; height: number }
  /** 起始相机位置, 默认 { x: 100, y: 100, z: 100 } */
  cameraPosition?: { x: number; y: number; z: number }
  /** 相机看向哪, 默认原点 */
  cameraTarget?: { x: number; y: number; z: number }
  /** 视图名字 (DOM title 属性) */
  label?: string
  /** 快照间隔 (ms), 默认 200 (5fps). 0 = 不自动快照 */
  snapshotInterval?: number
}

/**
 * 子画布句柄 — createCanvas 返回, 用于后续 remove。
 *   id       唯一 ID (格式 'sub_N')
 *   canvas   DOM canvas 元素
 *   camera   子相机 (独立 PerspectiveCamera, 用户能拖)
 *   controls camera-controls 实例 (绑 canvas)
 *   destroy  销毁: 停快照定时器 + 释放 RT 缓存 + 从 DOM 移除 + dispose controls
 */
export interface SubCanvasHandle {
  id: string
  canvas: HTMLCanvasElement
  camera: THREE.PerspectiveCamera
  controls: CameraControls
  /** 销毁 */
  destroy(): void
}

/** 自增子画布 id 计数器 (module 级, 单调递增) */
let nextSubId = 1

/** 截图选项 */
export interface ScreenshotOptions {
  /** 输出格式 (默认 'png' — 无损) */
  format?: 'png' | 'jpeg' | 'webp'
  /** 图片质量 0-1 (jpeg/webp 有效, 默认 0.92) */
  quality?: number
  /** 直接触发浏览器下载 (默认 false, 返回 dataURL) */
  download?: boolean
  /** 下载文件名 (download=true 时用; 默认 'ssp-screenshot-<ISO 时间戳>.<ext>') */
  filename?: string
  /** 自定义宽度 (默认主 canvas width) */
  width?: number
  /** 自定义高度 (默认主 canvas height) */
  height?: number
}

/**
 * ViewerTool 公开接口。
 *   子画布 (5):  createCanvas / getById / remove / removeAll / list
 *   截图 (1):    screenshot
 */
export interface ViewerTool {
  createCanvas(opts?: SubCanvasOptions): SubCanvasHandle
  getById(id: string): SubCanvasHandle | null
  remove(id: string): boolean
  removeAll(): number
  list(): SubCanvasHandle[]
  /**
   * 截主场景当前帧。
   * 实现: 临时 RT + readRenderTargetPixels + 翻 Y, 不依赖 preserveDrawingBuffer。
   * @returns dataURL string (`data:image/<format>;base64,...`)。download=true 时也会返回 dataURL, 同时触发浏览器下载。
   */
  screenshot(opts?: ScreenshotOptions): Promise<string>
}

/**
 * viewerTool 工厂。闭包内维护 subs Map / snapshotTimers Map, 状态全在闭包内。
 */
export function createViewerTool(): ViewerTool {
  /** 子画布 handle 缓存: id → handle。闭包内单例, 整个 page 共享。 */
  const subs = new Map<string, SubCanvasHandle>()
  /** 子画布快照定时器缓存: id → setInterval id (destroy 时清)。 */
  const snapshotTimers = new Map<string, ReturnType<typeof setInterval>>()
  /** 首帧延迟快照。destroy 前必须清掉，避免销毁后重新申请 RenderTarget。 */
  const initialSnapshotTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // ===== 内部 helper =====

  // ===== makeCanvasEl =====

  /**
   * 内部 helper: 创建 canvas DOM 元素 + 默认 style (固定右上 + 边框阴影)。
   * position 样式由 positionStyle 后追加。
   */
  function makeCanvasEl(size: { width: number; height: number }, label?: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    canvas.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      width: ${size.width}px;
      height: ${size.height}px;
      border: 1px solid #888;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      background: #000;
      z-index: 999;
      border-radius: 6px;
      overflow: hidden;
    `
    if (label) canvas.title = label
    return canvas
  }

  // ===== positionStyle =====

  /**
   * 内部 helper: 算 position 样式 (top/right/bottom/left 各 16px)。
   * 解析 'top-right' / 'top-left' / 'bottom-right' / 'bottom-left'。
   */
  function positionStyle(pos: SubCanvasOptions['position']): string {
    const top = pos?.includes('top') ? '16px' : 'auto'
    const bottom = pos?.includes('bottom') ? '16px' : 'auto'
    const left = pos?.includes('left') ? '16px' : 'auto'
    const right = pos?.includes('right') ? '16px' : 'auto'
    return `top:${top};bottom:${bottom};left:${left};right:${right};`
  }

  // ===== snapshotMainCanvas =====

  /**
   * 从主 renderer.domElement (主 canvas) 截一张图
   * 主 renderer 必须 preserveDrawingBuffer: true (我们 useThreeScene 已经设了)
   *
   * 性能优化:
   *   - Uint8Array (pixel buffer) 复用, 不每次 new (避免 GC 抖动)
   *   - WebGLRenderTarget 缓存 (同一 canvas 同一 size), size 变了再 dispose+new
   */
  function snapshotMainCanvas(
    handle: SubCanvasHandle,
    targetCanvas: HTMLCanvasElement,
    subCamera: THREE.PerspectiveCamera,
    _aspect: number,
  ): void {
    const ctx = getSspContext()
    const mainCanvas = ctx.renderer.domElement
    if (!mainCanvas) return

    const w = targetCanvas.width
    const h = targetCanvas.height
    const mainRenderer = ctx.renderer

    // 复用 RT: 缓存挂在 handle 上, size 变了再重建
    const cache = (handle as any).__snapshotCache as
      | { rt: THREE.WebGLRenderTarget; pixels: Uint8Array }
      | undefined
    let rt: THREE.WebGLRenderTarget
    let pixels: Uint8Array
    if (cache && cache.rt.width === w && cache.rt.height === h) {
      // 复用
      rt = cache.rt
      pixels = cache.pixels
    } else {
      // 重建 (先 dispose 旧的)
      if (cache) {
        cache.rt.dispose()
      }
      rt = new THREE.WebGLRenderTarget(w, h)
      pixels = new Uint8Array(w * h * 4)
      ;(handle as any).__snapshotCache = { rt, pixels }
    }

    const oldAspect = subCamera.aspect
    subCamera.aspect = w / h
    subCamera.updateProjectionMatrix()

    try {
      mainRenderer.setRenderTarget(rt)
      mainRenderer.render(ctx.scene, subCamera)
      mainRenderer.setRenderTarget(null)

      // 把 RT 内容画到 targetCanvas
      const targetCtx = targetCanvas.getContext('2d')!
      targetCtx.clearRect(0, 0, w, h)
      mainRenderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels)
      const imageData = new ImageData(new Uint8ClampedArray(pixels), w, h)
      targetCtx.putImageData(imageData, 0, 0)
    } finally {
      subCamera.aspect = oldAspect
      subCamera.updateProjectionMatrix()
    }
  }

  // ===== 公开 API =====

  return {
    /** 创建子画布 — 见 createCanvas */
    createCanvas(opts: SubCanvasOptions = {}): SubCanvasHandle {
      const id = `sub_${nextSubId++}`
      const size = opts.size ?? { width: 320, height: 240 }
      const camPos = opts.cameraPosition ?? { x: 100, y: 100, z: 100 }
      const camTarget = opts.cameraTarget ?? { x: 0, y: 0, z: 0 }
      const position = opts.position ?? 'top-right'
      const interval = opts.snapshotInterval ?? 200

      // 1. canvas DOM
      const canvas = makeCanvasEl(size, opts.label)
      canvas.style.cssText += positionStyle(position)
      document.body.appendChild(canvas)

      // 2. camera (独立的)
      const subCamera = new THREE.PerspectiveCamera(60, size.width / size.height, 0.1, 5000)
      subCamera.position.set(camPos.x, camPos.y, camPos.z)

      // 3. controls (用户能拖)
      const subControls = new CameraControls(subCamera as any, canvas)
      subControls.setTarget(camTarget.x, camTarget.y, camTarget.z, false)
      subControls.update(0)

      // 4. handle 先建 (snapshotMainCanvas 需要挂在 handle 上做缓存)
      const handle: SubCanvasHandle = {
        id,
        canvas,
        camera: subCamera,
        controls: subControls,
        destroy() {
          const timer = snapshotTimers.get(id)
          if (timer) {
            clearInterval(timer)
            snapshotTimers.delete(id)
          }
          const initialTimer = initialSnapshotTimers.get(id)
          if (initialTimer) {
            clearTimeout(initialTimer)
            initialSnapshotTimers.delete(id)
          }
          // 释放 RT 缓存 (避免 GPU 资源泄漏)
          const cache = (handle as any).__snapshotCache as
            | { rt: THREE.WebGLRenderTarget; pixels: Uint8Array }
            | undefined
          if (cache) {
            cache.rt.dispose()
            delete (handle as any).__snapshotCache
          }
          canvas.remove()
          subControls.dispose()
          subs.delete(id)
        },
      }
      subs.set(id, handle)

      // 5. 快照循环 (handle 已建, snapshotMainCanvas 可以挂缓存)
      if (interval > 0) {
        const timer = setInterval(() => {
          try {
            snapshotMainCanvas(handle, canvas, subCamera, size.width / size.height)
          } catch (e) {
            console.warn('[viewer] snapshot failed', e)
          }
        }, interval)
        snapshotTimers.set(id, timer)
        // 立即拍一张
        const initialTimer = setTimeout(() => {
          initialSnapshotTimers.delete(id)
          if (!subs.has(id)) return
          try {
            snapshotMainCanvas(handle, canvas, subCamera, size.width / size.height)
          } catch {}
        }, 50)
        initialSnapshotTimers.set(id, initialTimer)
      }

      return handle
    },
    /** 按 id 查 handle — 找不到返回 null */
    getById(id: string): SubCanvasHandle | null {
      return subs.get(id) ?? null
    },
    /** 移除单个子画布 (调 handle.destroy) — 见 remove */
    remove(id: string): boolean {
      const s = subs.get(id)
      if (!s) return false
      s.destroy()
      return true
    },
    /** 移除全部子画布 — 返回移除数 */
    removeAll(): number {
      const ids = Array.from(subs.keys())
      ids.forEach((id) => this.remove(id))
      return ids.length
    },
    /** 列出全部子画布 handle */
    list(): SubCanvasHandle[] {
      return Array.from(subs.values())
    },

    /**
     * 截主场景当前帧
     *
     * 流程:
     *   1. 取尺寸 (默认主 canvas 大小, 也可自定义)
     *   2. 创建临时 RT (跟主 canvas 同 size, RGBA + SRGBColorSpace)
     *   3. 渲染场景到 RT
     *   4. readRenderTargetPixels 拿像素
     *   5. 创建 2D canvas, Y 翻转 + putImageData
     *   6. canvas.toDataURL() (或 toBlob + 触发下载)
     *   7. 释放 RT
     *
     * @returns dataURL string. `download: true` 时同时触发浏览器下载。
     */
    async screenshot(opts: ScreenshotOptions = {}): Promise<string> {
      const ctx = getSspContext()
      const renderer = ctx.renderer
      const camera = ctx.camera
      const scene = ctx.scene

      const format = opts.format ?? 'png'
      const quality = opts.quality ?? 0.92
      const mime = `image/${format}`

      // 1. 尺寸: 默认主 canvas 大小
      const mainCanvas = renderer.domElement
      const w = opts.width ?? mainCanvas?.width ?? mainCanvas?.clientWidth ?? 1920
      const h = opts.height ?? mainCanvas?.height ?? mainCanvas?.clientHeight ?? 1080

      // 安全上限: 超过 4096 warn (大部分浏览器 / 设备扛不住)
      const MAX_DIM = 4096
      if (w > MAX_DIM || h > MAX_DIM) {
        console.warn(`[viewer.screenshot] size ${w}x${h} 超过 ${MAX_DIM},可能 OOM 或慢`)
      }

      // 2. 临时 RT
      const rt = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace,
        type: THREE.UnsignedByteType,
      })

      // 3. 渲染到 RT (保存/还原当前 renderTarget)
      const prevTarget = renderer.getRenderTarget()
      const prevAutoClear = renderer.autoClear
      try {
        renderer.autoClear = true
        renderer.setRenderTarget(rt)
        renderer.clear()
        renderer.render(scene, camera)
      } finally {
        renderer.setRenderTarget(prevTarget)
        renderer.autoClear = prevAutoClear
      }

      // 4. 读像素
      const pixels = new Uint8Array(w * h * 4)
      try {
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels)
      } catch (e) {
        rt.dispose()
        console.warn('[viewer.screenshot] readRenderTargetPixels failed', e)
        throw e
      }

      // 5. Y 翻转 (WebGL Y 朝上, 2D canvas Y 朝下) + putImageData
      const canvas2d = document.createElement('canvas')
      canvas2d.width = w
      canvas2d.height = h
      const ctx2d = canvas2d.getContext('2d')!
      const imageData = ctx2d.createImageData(w, h)
      const stride = w * 4
      for (let y = 0; y < h; y++) {
        const srcStart = (h - 1 - y) * stride
        const dstStart = y * stride
        // copy 一整行 (4 字节 * w 像素)
        imageData.data.set(pixels.subarray(srcStart, srcStart + stride), dstStart)
      }
      ctx2d.putImageData(imageData, 0, 0)

      // 7. 释放 RT
      rt.dispose()

      // 6. toDataURL
      let dataURL: string
      try {
        dataURL = canvas2d.toDataURL(mime, quality)
      } catch (e) {
        console.warn('[viewer.screenshot] toDataURL failed', e)
        throw e
      }

      // 7. download=true: 触发浏览器下载 (不影响返回值)
      if (opts.download) {
        const filename =
          opts.filename ?? `ssp-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`
        console.log(`[viewer.screenshot] triggering download: ${filename} (${(dataURL.length / 1024).toFixed(1)} KB dataURL)`)
        try {
          // 优先 toBlob (省内存); 失败回退 dataURL
          canvas2d.toBlob(
            (blob) => {
              if (!blob) {
                console.warn('[viewer.screenshot] toBlob returned null, fallback to dataURL download')
                triggerDownloadFromDataURL(dataURL, filename)
                return
              }
              const url = URL.createObjectURL(blob)
              triggerAnchorDownload(url, filename, () => {
                // 1s 后释放 blob URL (浏览器需要时间下载)
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              })
              console.log(`[viewer.screenshot] download dispatched: ${filename} (${(blob.size / 1024).toFixed(1)} KB)`)
            },
            mime,
            quality,
          )
        } catch (e) {
          console.warn('[viewer.screenshot] toBlob threw, fallback to dataURL download', e)
          // fallback
          triggerDownloadFromDataURL(dataURL, filename)
        }
      }

      return dataURL
    },
  }
}

/**
 * 通过创建隐藏 <a download> 触发浏览器下载 (dataURL 或 blob URL 都行)。
 * 用完从 DOM 移除, 不污染页面。
 */
function triggerAnchorDownload(href: string, filename: string, cleanup?: () => void): void {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  cleanup?.()
}

/**
 * 从 dataURL 触发下载 (triggerAnchorDownload 的 fallback 入口 — toBlob 失败时用)。
 */
function triggerDownloadFromDataURL(dataURL: string, filename: string): void {
  triggerAnchorDownload(dataURL, filename)
}
