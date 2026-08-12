/**
 * cameraController — 相机控制适配层 (Three.js 风格)
 *
 * 设计要点:
 *   - 用本地化 camera-controls 做平滑过渡 (内置 smooth tween + await)
 *   - **共享 useThreeScene 的同一个 CameraControls 实例**(避免双实例覆盖位置)
 *   - flyTo 支持两种签名: (position) 或 ({position, target})
 *   - setLookAt 包装层 对 NaN / undefined 兜底防御
 *   - getViewpoint 读出的 viewpoint 字段对 NaN 兜底
 *
 * API:
 *   - flyTo(pos, opt?)             飞行到位置
 *   - flyToObject(id, opt?)        聚焦到某个对象
 *   - setViewpoint(vp) / getViewpoint()   瞬时视角 / 取当前
 *   - fitScene(objects, opt?)      fit 一组对象 (返回 {position, target, distance})
 *   - surroundOnTarget(target, opt?)  绕目标水平环绕 (返回 stop 函数)
 *
 * 对应可用模板:
 *   - src/templates/ssp_templates/camera/flyTo.json
 *   - src/templates/ssp_templates/camera/flyToObject.json
 *   - src/templates/ssp_templates/camera/setViewpoint.json
 *   - src/templates/ssp_templates/camera/getViewpoint.json
 *   - src/templates/ssp_templates/camera/fitScene.json
 *   - src/templates/ssp_templates/camera/surroundOnTarget.json
*/

import * as THREE from 'three'
import CameraControls from '@/vendor/camera-controls'
import { getSspContext } from '../core/context'
import { getObjectByName } from '../core/sceneUtils'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export interface FlyToOptions {
  /** 是否带过渡动画,默认 true */
  enableTransition?: boolean
  /** 完成回调 */
  done?: () => void
}

export interface Viewpoint {
  position: Vec3Like
  target: Vec3Like
  /** 相机本体欧拉角 (弧度, XYZ 顺序) — 不传则保持当前 rotation */
  rotation?: { x: number; y: number; z: number }
  fov?: number
}

export interface SurroundOptions {
  /** 角速度 (弧度/秒), 默认 0.2 (一周约 31 秒) */
  speed?: number
  /** 距 target 的水平距离 (米), 默认 50; 不传则用当前距离 */
  radius?: number
  /** 高度偏移 (米), 在 target.y 基础上加, 默认 5 */
  heightOffset?: number
}

export interface FitSceneOptions {
  /**
   * 视角预设:
   *   - 'iso' (默认): 45° 斜俯视, 三个轴均匀分布, 通用建筑/场景总览
   *   - 'front': 正面, 只看 +Z 方向
   *   - 'top':   鸟瞰, 看 -Y 方向 (俯视)
   *   - 'side':  侧面, 看 +X 方向
   *   - 'current': 保持当前相机朝向, 只重置距离和 target
   */
  view?: 'iso' | 'front' | 'top' | 'side' | 'current'
  /** 距离倍数: distance = radius × padding (默认 1.5, 即 50% 余量) */
  padding?: number
  /** 是否 flyTo (true, 默认) 或立即 setLookAt (false) */
  animate?: boolean
  /**
   * target.y 偏移 (米):
   *   - 默认 0, target 在 Box3 中心
   *   - 建筑场景常用 -size.y × 0.1 让主楼从画面下半开始 (同 useThreeScene 旧算法)
   */
  targetYOffsetFactor?: number
  /**
   * 最小距离 (米): 防极小模型 fit 时太近 (默认 10)
   */
  minDistance?: number
  /**
   * 最大距离 (米): 防极大模型 fit 时太远 (默认 undefined, 无上限)
   */
  maxDistance?: number
  /**
   * 安全最大距离 (米): 综合 far plane + 用户视觉上限 (默认 700).
   * 实际算法 distance = min(算法 distance, maxSafeDistance).
   * 注意: iso 视角实际相机距 = distance × 1.13, 所以 distance 上限 ≈ far / 1.13.
   * 设成 700, iso 下相机离 target 实际 ≈ 791 (在 camFar=1000 内).
   */
  maxSafeDistance?: number
  /**
   * 是否用 bounding sphere 真实半径 (默认 false).
   * false = 用 max(size.x, size.z) × 0.6 (适合建筑/地形/楼层等有 y 方向的场景)
   * true  = 用 Box3.getBoundingSphere().radius (适合球状/不规则形状, 但对扁平模型会过度估计)
   */
  useAccurateRadius?: boolean
}

// ---------------------------------------------------------------------------
// 主 controller
// ---------------------------------------------------------------------------

/**
 * CameraController 公开接口。
 *   飞行 (3):       flyTo / flyToObject / surroundOnTarget
 *   视角 (2):       setViewpoint / getViewpoint
 *   自适应 (1):     fitScene
 *   底层:           controls (camera-controls 实例)
 */
export interface CameraController {
  flyTo(position: Vec3Like, opt?: FlyToOptions): Promise<void>
  flyToObject(idOrObj: string | THREE.Object3D, opt?: FlyToOptions): Promise<void>
  setViewpoint(vp: Viewpoint): void
  getViewpoint(): Viewpoint
  /**
   * 绕目标水平环绕 (拍电影模式)
   * @returns stop 函数, 调用后停止环绕
   */
  surroundOnTarget(target: THREE.Object3D, opts?: SurroundOptions): () => void
  /**
   * 自动 fit 相机到一组对象 (多 GLB 合并 Box3 + bounding sphere + aspect 校正)
   * @param objects GLB root 或任何 Object3D 数组
   * @param opts.view 视角预设 (默认 'iso')
   * @returns Promise<{ position, target, distance }>
   */
  fitScene(objects: Array<THREE.Object3D | null | undefined>, opts?: FitSceneOptions): Promise<{ position: Vec3Like; target: Vec3Like; distance: number }>
  /** 暴露底层的 camera-controls 实例,方便高级用法 */
  controls: CameraControls
}

// ---------------------------------------------------------------------------
// FUNCTION
// ---------------------------------------------------------------------------

/**
 * cameraController 工厂。闭包内无状态, 通过 context.controls 共享 useThreeScene 的 CameraControls 实例。
 */
export function createCameraController(): CameraController {
  // ===== 内部 helper =====

  /**
   * 拿 context 里挂着的 CameraControls 实例。
   * 关键: 复用 useThreeScene 已 new 的实例, 不再 new, 避免双实例互相覆盖位置。
   */
  function ensureControls(): CameraControls {
    const ctx = getSspContext()
    if (ctx.controls) return ctx.controls as CameraControls
    // 容错: 如果 useThreeScene 还没 new 过, 这里兜底 new 一个
    const c = new CameraControls(ctx.camera as any, ctx.renderer.domElement)
    ctx.controls = c
    return c
  }
  
  // ===== setLookAt =====

  /**
   * 内部 helper: 包装 c.setLookAt, Vec3Like → 6 个数 + NaN 防御 + ensureControls 拿 instance。
   * 所有 fly 类方法的统一入口 (除 flyTo 签名 B 等直接调 c.setLookAt 的少数场景)。
   */
  function setLookAt(
    pos: Vec3Like,
    target: Vec3Like,
    enableTransition: boolean,
  ): Promise<void> {
    const safe = (v: number | undefined, fb = 0) => (Number.isFinite(v) ? (v as number) : fb)
    const c = ensureControls()
    return c.setLookAt(
      safe(pos.x), safe(pos.y), safe(pos.z),
      safe(target.x), safe(target.y), safe(target.z),
      enableTransition,
    )
  }
  
  // ===== flyTo =====

  /**
   * 飞相机 — 多签名支持:
   *   - (position: Vec3Like)               飞到位置, target 保持当前
   *   - ({position, target}: 双点)         同时设 position + target
   * 签名 B 走 c.setLookAt, 签名 A 走 setLookAt (自动取当前 target)。
   */
  async function flyTo(position: Vec3Like | { position: Vec3Like; target: Vec3Like }, opt: FlyToOptions = {}): Promise<void> {
    // 多签名兼容: 接受 (position) 或 ({position, target})
    let targetPos: Vec3Like
    let targetTarget: Vec3Like | undefined
    if ('position' in (position as any)) {
      // 选项对象形式
      const opts = position as { position: Vec3Like; target: Vec3Like }
      targetPos = opts.position
      targetTarget = opts.target
    } else {
      targetPos = position as Vec3Like
    }
    const enableTransition = opt.enableTransition ?? true
    if (targetTarget) {
      // 同时设置位置 + 注视点 (内部走 setLookAt, 不动 controls.target)
      const c = ensureControls()
      await c.setLookAt(
        targetPos.x, targetPos.y, targetPos.z,
        targetTarget.x, targetTarget.y, targetTarget.z,
        enableTransition,
      )
    } else {
      // 只设置位置, target 保持当前 (从 camera-controls 实例拿)
      const c = ensureControls()
      const target = c.getTarget(new THREE.Vector3())
      await setLookAt(targetPos, { x: target.x, y: target.y, z: target.z }, enableTransition)
    }
    opt.done?.()
  }
  
  // ===== flyToObject =====

  /**
   * 聚焦某个 mesh (string 或 Object3D)。
   * 算法: Box3 → maxDim → fov 距离 → 当前朝向反方向放相机 (抬高 size.y × 0.2) → flyTo。
   * 找不到 mesh 抛 Error。
   */
  async function flyToObject(
    idOrObj: string | THREE.Object3D,
    opt: FlyToOptions = {},
  ): Promise<void> {
    const ctx = getSspContext()
    const obj = typeof idOrObj === 'string'
      ? getObjectByName(idOrObj, { fuzzy: false })  // 精确匹配 (兼容原 findByName 行为)
      : idOrObj
    if (!obj) throw new Error(`[ssp.camera] flyToObject: not found "${idOrObj}"`)

    const box = new THREE.Box3().setFromObject(obj)
    if (box.isEmpty()) {
      throw new Error(`[ssp.camera] flyToObject: empty bounding box for "${idOrObj}"`)
    }
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = (ctx.camera.fov * Math.PI) / 180
    const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.6

    const cam = ctx.camera
    const camDir = new THREE.Vector3()
    cam.getWorldDirection(camDir)
    // 在面向目标的反方向上放相机
    const pos = center.clone().sub(camDir.multiplyScalar(dist))
    await flyTo({ x: pos.x, y: pos.y + size.y * 0.2, z: pos.z }, opt)
  }

  // ===== setViewpoint =====

  /**
   * 瞬时设完整视角 (position + target + rotation + fov)。
   * rotation/fov 直接改 Three.js camera, position/target 走 c.setLookAt(false) 瞬时。
   * CR001 修复: position + target 必须同时设, 否则 camera-controls 每帧会拉回。
   */
  function setViewpoint(vp: Viewpoint): void {
    const ctx = getSspContext()
    if (vp.rotation !== undefined) {
      // 欧拉角 (弧度, 'XYZ' 顺序 — 跟 Three.js 默认一致)
      ctx.camera.rotation.set(vp.rotation.x, vp.rotation.y, vp.rotation.z, 'XYZ')
    }
    if (vp.fov !== undefined) {
      ctx.camera.fov = vp.fov
      ctx.camera.updateProjectionMatrix()
    }
    // ⚠️ CR001: 必须用 setLookAt 同时设置 position + target
    // (camera-controls 内部每帧会把 camera 拉回它记住的位置, 仅 setTarget 会被覆盖)
    const c = ensureControls()
    c.setLookAt(
      vp.position.x, vp.position.y, vp.position.z,
      vp.target.x, vp.target.y, vp.target.z,
      false,  // 不开 transition, 瞬时设置
    )
  }
  
  // ===== getViewpoint =====
  
  /**
   * 读当前完整视角 (position + target + fov) — 只读, 不动相机。
   * NaN 防御: 所有数字字段兜底 0, 保证返回数据安全可存到 store。
   * 配 setViewpoint 使用: getViewpoint() → 保存 → setViewpoint() 还原。
   */
  function getViewpoint(): Viewpoint {
    const ctx = getSspContext()
    const c = ctx.controls as CameraControls | undefined
    const target = c ? c.getTarget(new THREE.Vector3()) : new THREE.Vector3()
    // 防御: 如果 camera.position 或 target 任一字段是 NaN / undefined, 兜底为 0
    const safe = (v: number, fb = 0) => (Number.isFinite(v) ? v : fb)
    return {
      position: {
        x: safe(ctx.camera.position.x),
        y: safe(ctx.camera.position.y),
        z: safe(ctx.camera.position.z),
      },
      target: {
        x: safe(target.x),
        y: safe(target.y),
        z: safe(target.z),
      },
      fov: ctx.camera.fov,
    }
  }

  // ===== surroundOnTarget =====

  /** 当前正在运行的环绕控制器 (单例: 新环绕会停掉旧的) */
  let activeSurround: { rafId: number; cleanup: () => void } | null = null

  /**
   * 绕目标水平环绕 (拍电影模式)
   *
   * 实现思路:
   *   1. 锁定 target 世界坐标 (Vector3.clone 防对象移动干扰)
   *   2. 计算初始角 = atan2(cam.x - target.x, cam.z - target.z) (从当前相对方位开始)
   *   3. 计算半径 = 水平距离 (xz 平面投影到 target)
   *   4. 每帧用 rAF 推进 angle += speed * dt
   *   5. 用 setLookAt(x, y, z, tx, ty, tz, false) 不开过渡,直接设位姿
   *   6. stop 函数清除 rAF, 并清掉 activeSurround 标记
   *
   * @param target 环绕的目标对象 (它的世界位置作为圆心)
   * @param opts.speed 角速度 (rad/s), 默认 0.2
   * @param opts.radius 距 target 的水平距离, 不传用当前
   * @param opts.heightOffset 高度偏移, 默认 5
   * @returns stop 函数
   */
  function surroundOnTarget(target: THREE.Object3D, opts: SurroundOptions = {}): () => void {
    const ctx = getSspContext()
    const c = ensureControls()
    const speed = opts.speed ?? 0.2
    const heightOffset = opts.heightOffset ?? 5

    // 停掉之前的环绕 (单例)
    if (activeSurround) {
      activeSurround.cleanup()
    }

    // 1. 锁定 target 世界坐标 (用 Object3D.getWorldPosition 防被 transform 干扰)
    const center = new THREE.Vector3()
    target.getWorldPosition(center)

    // 2. 计算初始角: 当前 camera 在水平面上相对 target 的方位
    const cam = ctx.camera
    const dx = cam.position.x - center.x
    const dz = cam.position.z - center.z
    let angle = Math.atan2(dx, dz) // 注意 atan2(y, x) — 顺时针从 +Z 开始

    // 3. 半径: 用当前距离 (或者 opts.radius 覆盖)
    let radius = opts.radius ?? Math.sqrt(dx * dx + dz * dz)
    if (!Number.isFinite(radius) || radius < 0.1) radius = 50 // 兜底

    // 5. rAF 循环
    let rafId = 0
    let lastTime = performance.now()
    let stopped = false

    function step(now: number): void {
      if (stopped) return
      const dt = Math.min((now - lastTime) / 1000, 0.1) // 防止 tab 切回时大跳
      lastTime = now
      angle += speed * dt
      // target 可能在动画中移动，圆心要每帧同步世界坐标。
      target.getWorldPosition(center)

      const x = center.x + radius * Math.sin(angle)
      const z = center.z + radius * Math.cos(angle)
      // setLookAt 第三参数 false = 瞬时设置, 不开过渡 (我们自己 rAF 模拟过渡)
      c.setLookAt(x, center.y + heightOffset, z, center.x, center.y, center.z, false)
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)

    function cleanup(): void {
      stopped = true
      cancelAnimationFrame(rafId)
      if (activeSurround && activeSurround.rafId === rafId) {
        activeSurround = null
      }
    }
    activeSurround = { rafId, cleanup }
    return cleanup
  }

  // ===== fitScene =====
  
  /**
   * fitScene —— 自动 fit 相机到一组对象
   *
   * 核心算法:
   *   1. 合并 Box3: 多 GLB 各自的 Box3 取并集
   *   2. 算 bounding sphere (center + radius): 比 diag 更准确
   *   3. aspect ratio 校正: 同时满足垂直 FOV 和水平 FOV,取较大距离
   *      (老算法用 diag, 不考虑 FOV, 极端 aspect 下视野不够)
   *   4. padding: distance = radius × padding (默认 1.5, 留 50% 余量)
   *   5. minDistance / maxDistance 限位
   *   6. view 决定朝向:
   *      - iso:    相机在 (x, y, z) 各加偏移, 45° 斜俯视
   *      - front:  相机在 +Z 方向 (看向 -Z)
   *      - top:    相机在 +Y 方向 (看向 -Y, 鸟瞰)
   *      - side:   相机在 +X 方向 (看向 -X)
   *      - current:保持当前朝向, 只重置距离和 target
   *
   * 替代:
   *   - useThreeScene.fitModelToView (单 GLB, 不考虑 aspect, diag 算法)
   *   - Sandbox.flyToSceneCenter (多 GLB 合并, 不考虑 aspect, diag 算法, 硬编码 iso)
   */
  async function fitScene(
    objects: Array<THREE.Object3D | null | undefined>,
    opts: FitSceneOptions = {},
  ): Promise<{ position: Vec3Like; target: Vec3Like; distance: number }> {
    const ctx = getSspContext()
    const cam = ctx.camera

    // 过滤掉 null/undefined 和 empty box
    const valid = objects.filter((o): o is THREE.Object3D => !!o && o instanceof THREE.Object3D)
    if (valid.length === 0) {
      console.warn('[ssp.camera] fitScene: 没有有效对象, 跳过')
      return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, distance: 0 }
    }

    // 1. 合并 Box3
    const merged = new THREE.Box3()
    for (const o of valid) {
      const b = new THREE.Box3().setFromObject(o)
      if (!b.isEmpty()) merged.union(b)
    }
    if (merged.isEmpty()) {
      console.warn('[ssp.camera] fitScene: 合并 Box3 为空, 跳过')
      return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, distance: 0 }
    }

    const size = merged.getSize(new THREE.Vector3())
    const center = merged.getCenter(new THREE.Vector3())

    // 2. radius 计算 — 防 flat 模型过度估计
    //    bounding sphere 对极扁模型(如 LANDSCAPE_TERRAIN 500×5×500)会算成
    //      radius = √(250² + 2.5² + 250²) ≈ 354, 但实际模型可以"贴地看"
    //    用 max(size.x, size.z) 更适合建筑/地形场景 — 用 y 当俯仰参考
    //
    //    公式: radius = max(size.x, size.z) × 0.6 (iso 视角斜看)
    //    如果用户传了 useAccurateRadius: true, 用真实 bounding sphere
    const useAccurateRadius = opts.useAccurateRadius ?? false
    const radius = useAccurateRadius
      ? merged.getBoundingSphere(new THREE.Sphere()).radius
      : Math.max(size.x, size.z) * 0.6

    // 3. aspect ratio 校正
    //    透视相机: 水平 FOV 由 fov (垂直) 和 aspect 推算
    //    required distance = radius / sin(min(fovV/2, fovH/2))
    const fovV = (cam.fov * Math.PI) / 180
    const aspect = cam.aspect
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect)
    const fovMin = Math.min(fovV, fovH) / 2
    // 兜底: fovMin 异常时 (0 或 NaN) 用 30°
    const fov = Number.isFinite(fovMin) && fovMin > 0.001 ? fovMin : (30 * Math.PI / 180)
    const distanceFromFov = radius / Math.sin(fov)

    // 4. padding + 限位
    const padding = opts.padding ?? 1.5
    const minDist = opts.minDistance ?? 10
    const maxDist = opts.maxDistance ?? Infinity
    let distance = distanceFromFov * padding
    distance = Math.max(minDist, Math.min(maxDist, distance))

    // 4.5 防 far plane 裁剪 — camera.far 是 perspective camera 的远裁面
    //     distance 必须 < far - margin, 否则相机虽然能 fit, 但 mesh 在 far 之外被裁掉, 看不见
    //     注意: iso 视角下 camera 到 target 实际距离 = distance × √(0.7²+0.55²+0.7²) ≈ 1.13×distance
    //     所以 farSafe 必须 < camFar / 1.13 才能保证 mesh 在 far 之内
    const camFar = (cam as THREE.PerspectiveCamera).far ?? 1000
    const camNear = (cam as THREE.PerspectiveCamera).near ?? 0.1
    // iso 放大系数 ≈ 1.13, farSafe 取 camFar / 1.13 × 0.9 (10% 余量)
    const ISO_FACTOR = 1.13
    const farSafe = (camFar / ISO_FACTOR) * 0.9  // = 1000/1.13*0.9 ≈ 796
    // 用户硬上限 (默认 700) — 视觉上"离远点"就调小
    const userMaxDist = opts.maxSafeDistance ?? 700
    const effectiveMax = Math.min(farSafe, userMaxDist)
    if (distance > effectiveMax) {
      console.warn(`[ssp.camera] fitScene: distance ${distance.toFixed(1)} > effectiveMax ${effectiveMax.toFixed(1)} (farSafe=${farSafe.toFixed(1)}, userMax=${userMaxDist}), 限制到 ${effectiveMax.toFixed(1)}`)
      distance = effectiveMax
    }
    // 防 near plane — distance > near × 5 (留 5x 余量, 否则 mesh 在相机里面)
    const nearSafe = camNear * 5
    if (distance < nearSafe) distance = nearSafe

    // 5. target.y 偏移
    const yOffset = center.y - size.y * (opts.targetYOffsetFactor ?? 0)
    const target = { x: center.x, y: yOffset, z: center.z }

    // 6. view 决定 position
    const view = opts.view ?? 'iso'
    let position: Vec3Like
    switch (view) {
      case 'iso':
        // 45° 斜俯视: x/y/z 各取分量, 距离相同
        position = {
          x: center.x + distance * 0.7,
          y: center.y + distance * 0.55,  // 抬高一点, 优先俯视
          z: center.z + distance * 0.7,
        }
        break
      case 'front':
        position = { x: center.x, y: center.y, z: center.z + distance }
        break
      case 'top':
        position = { x: center.x, y: center.y + distance, z: center.z }
        break
      case 'side':
        position = { x: center.x + distance, y: center.y, z: center.z }
        break
      case 'current': {
        // 保持当前朝向, 只重置距离和 target
        const curDir = new THREE.Vector3()
        cam.getWorldDirection(curDir)
        // 反方向拉 distance
        position = {
          x: center.x - curDir.x * distance,
          y: center.y - curDir.y * distance,
          z: center.z - curDir.z * distance,
        }
        break
      }
      default:
        position = { x: center.x, y: center.y, z: center.z + distance }
    }

    // 7. 应用: flyTo (animate=true) 或立即 setLookAt (animate=false)
    const animate = opts.animate ?? true
    if (animate) {
      await flyTo({ position, target }, { enableTransition: true })
    } else {
      const c = ensureControls()
      c.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
    }

    console.log(`[ssp.camera] fitScene: ${valid.length} obj, view=${view}, radius=${radius.toFixed(1)}, distance=${distance.toFixed(1)}, target=(${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)})`)
    return { position, target, distance }
  }

  return {
    /** 飞相机 — 见 flyTo */
    flyTo,
    /** 聚焦某个 mesh — 见 flyToObject */
    flyToObject,
    /** 瞬时设视角 — 见 setViewpoint */
    setViewpoint,
    /** 取当前视角 — 见 getViewpoint */
    getViewpoint,
    /** 绕目标水平环绕 — 见 surroundOnTarget */
    surroundOnTarget,
    /** fit 相机到一组对象 — 见 fitScene */
    fitScene,
    /** 暴露底层 camera-controls 实例, 内部首次访问时 lazy init 避免 context 未就绪时崩 */
    get controls(): CameraControls {
      return ensureControls()
    },
  } as any
}
