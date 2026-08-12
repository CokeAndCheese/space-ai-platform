/**
 * ssp-shim 上下文管理 (基础设施层)
 *
 * 用途: 各路由页面在 onMounted 里创建 Three.js 场景, 然后调 setSspContext() 注入。
 * ssp-shim 是 module 单例, 但场景由各页面持有 — 通过这个 context 桥接。
 *
 * 模式:
 *   1. useThreeScene 创建 scene/camera/renderer/controls
 *   2. 调 setSspContext(ctx) 注入
 *   3. 各 controller (cameraController / objectsTool / ...) 调 getSspContext() 拿到场景引用
 */

import type * as THREE from 'three'

/**
 * ssp-shim 持有的当前页面场景引用。
 * 必填: scene / camera / renderer / domElement。
 * 可选: controls (camera-controls 实例, cameraController 需要)、onBeforeRender (主循环钩子)。
 */
export interface SspContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  /**
   * 当前页面的 camera controls 实例。
   * 现在用的是本地化的 camera-controls (CameraControls), 类型用 unknown 避免循环依赖。
   * 用法: cast 成具体的 CameraControls 后调它的 setLookAt / getTarget 等。
   */
  controls?: unknown
  domElement: HTMLElement
  /** 主渲染循环里的额外钩子(如 TWEEN.update), 由各 controller 注入 */
  onBeforeRender?: () => void
}

let _ctx: SspContext | null = null

/**
 * 由路由页面在初始化完场景后调用。
 * 注入 scene / camera / renderer / controls 等, 各 controller 通过 getSspContext() 拿到。
 */
export function setSspContext(ctx: SspContext): void {
  _ctx = ctx
  console.log('[ssp] context set', {
    scene: !!ctx.scene,
    camera: !!ctx.camera,
    renderer: !!ctx.renderer,
    controls: !!ctx.controls,
  })
}

/**
 * 取当前 ssp 上下文。
 * 未初始化时抛错 — 提示用户先去 onMounted 里调 setSspContext。
 */
export function getSspContext(): SspContext {
  if (!_ctx) {
    throw new Error('[ssp] context not initialized. Call setSspContext() in onMounted first.')
  }
  return _ctx
}

/** 检查 context 是否已注入 (用于可选调用方判断, 不抛错) */
export function hasSspContext(): boolean {
  return _ctx !== null
}

/** 清掉当前 context — 路由切换时由 useThreeScene 调用 */
export function clearSspContext(): void {
  _ctx = null
}
