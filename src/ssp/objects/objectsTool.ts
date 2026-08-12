/**
 * objectsTool — 场景内对象操作 (查找 / 高亮 / 可见性 / 炸开)
 *
 * 用途: 在 3D 场景里查找 mesh、改高亮、控制可见性、楼层炸开, 是 cameraController / PlanExecutor 的上游。
 *
 * 设计原则:
 *   - 查找通过 THREE.Object3D 引用, 不存 id 字符串 (引用即真相)
 *   - 查找范围: 当前已加载 GLB 的整个 scene (modelTool 加载的 55 个 GLB)
 *   - 高亮通过改 material.emissive, 原始值存在 obj.userData.__originalEmissive
 *   - 可见性通过 obj.visible 切换
 *   - 不修改原始 obj.name / userData.renderType 等, 只追加高亮用的临时数据
 *   - 所有运行时状态存到 obj.userData (用 __ 前缀), 不污染闭包
 *
 * API:
 *   - 查找 (3):       getByName / getById / getByUserDataProperty
 *   - 高亮 (3):       setHighlight / unHighlight / clearAllHighlights
 *   - 可见性 (3):     setVisible / setVisibleByFloor / resetVisibility
 *   - 楼层炸开 (3):   explodeFloor / collapseFloor / isExploded
 *
 * 对应模板:
 *   - src/templates/ssp_templates/objects/getObjectById.json
 *   - src/templates/ssp_templates/objects/getObjectByUserDataProperty.json
 *   - src/templates/ssp_templates/objects/highlight-objects.json
 *   - src/templates/ssp_templates/objects/focus-on-object.json
 *   - src/templates/ssp_templates/objects/floor.json
 *   - src/templates/ssp_templates/objects/flash-alarm.json
 *   - src/templates/ssp_templates/objects/fly-to-floor.json
 *   - src/templates/ssp_templates/objects/highlightIsolate.json
 *   - src/templates/ssp_templates/objects/explode-floor.json
 *   - src/templates/ssp_templates/objects/clearAllHighlights.json
 *   - src/templates/ssp_templates/objects/resetVisibility.json
 */

import * as THREE from 'three'
import { getSspContext } from '../core/context'
import { findInScene, getObjectByName, getObjectsByUserDataProperty, getUserDataValue, type SceneFindOptions } from '../core/sceneUtils'

/** 灯 / 高亮用的颜色: 字符串 (hex/css) / 数字 (0xffffff) / THREE.Color */
export type SceneColor = string | number | THREE.Color

/** @deprecated 用 core/sceneUtils.ts 的 SceneFindOptions (兼容 alias) */
export type FindOptions = SceneFindOptions

/**
 * objectsTool 公开接口。
 *   查找 (3):       getByName / getById / getByUserDataProperty
 *   高亮 (3):       setHighlight / unHighlight / clearAllHighlights
 *   可见性 (3):     setVisible / setVisibleByFloor / resetVisibility
 *   楼层炸开 (3):   explodeFloor / collapseFloor / isExploded
 */
export interface ObjectsTool {
  getByName(name: string, opts?: FindOptions): THREE.Object3D | null
  getById(id: string, opts?: FindOptions): THREE.Object3D | null
  getByUserDataProperty(key: string, value: unknown, opts?: FindOptions): THREE.Object3D[]
  setHighlight(obj: THREE.Object3D, color?: SceneColor, pulse?: boolean): void
  unHighlight(obj: THREE.Object3D): void
  clearAllHighlights(): void
  setVisible(obj: THREE.Object3D, visible: boolean): void
  setVisibleByFloor(floorName: string, visible?: boolean): void
  /** 一键重置所有可见性 — 把 scene 里所有 mesh 设为 visible=true (跳过 Camera/Light/helper) */
  resetVisibility(): { restored: number; hiddenBefore: number }
  /** 楼层炸开 */
  explodeFloor(opts?: { gap?: number; axis?: 'x' | 'y' | 'z'; durationMs?: number }): void
  /** 楼层炸开收回 */
  collapseFloor(durationMs?: number): void
  /** 是否当前炸开 */
  isExploded(): boolean
}

/** userData 上存原始 emissive 的 key, 高亮时存, unHighlight 时还原 */
const ORIGINAL_EMISSIVE_KEY = '__originalEmissive'
/** 注: visible 不单独存, 因为可以直接 obj.visible 改回 */

/**
 * 注: getUserDataValue 已抽到 core/sceneUtils.ts (作为私有 helper)
 * 这里不再重复定义
 */

/**
 * objectsTool 工厂。无闭包变量, 所有运行时状态通过 obj.userData 跟踪。
 * 查找通过 core/sceneUtils.ts 的 findInScene / getObjectsByUserDataProperty。
 */
export function createObjectsTool(): ObjectsTool {
  /** 在 scene 整个 traverse 找 (排除 lights, cameras, helpers) */
  // ↑ 注: findInScene 已抽到 core/sceneUtils.ts, 此处直接复用

  // ===== 查找 =====

  /**
   * 按 `obj.name` 找第一个 — 转发到 core/sceneUtils.ts 的 getObjectByName (单一来源)。
   * 默认模糊匹配 (大小写不敏感, includes), opts.fuzzy=false 时精确匹配 ===。
   * @returns 第一个匹配的 Object3D, 或 null
   */
  function getByName(name: string, opts: FindOptions = {}): THREE.Object3D | null {
    // 转发到 core (跟 getByUserDataProperty 对称)
    return getObjectByName(name, opts)
  }

  /**
   * 按业务 id 找 mesh — 一次 traverse 同时检查 sid 和 findId。
   *   - sid    业务唯一短 ID (e.g. 'DOOR_A_6F_1')
   *   - findId GLB 内自动派生的 ID (e.g. 'A_6F_mesh_42')
   * 两者不应该重叠 (业务建模时唯一), 所以一次 traverse 等价于之前两次的逻辑。
   * @returns 第一个匹配的 Object3D, 或 null
   */
  function getById(id: string, opts: FindOptions = {}): THREE.Object3D | null {
    return findInScene(
      (o) => o.userData?.sid === id || o.userData?.findId === id,
      opts,
    )[0] ?? null
  }

  function getByUserDataProperty(key: string, value: unknown, opts: FindOptions = {}): THREE.Object3D[] {
    // 转发到 core/sceneUtils.ts 的 getObjectsByUserDataProperty (单一来源)
    return getObjectsByUserDataProperty(key, value, opts)
  }

  // ===== 内部 helper (highlight) =====

  /**
   * 内部 helper: 遍历 obj 的所有子 mesh, 调 getColor 拿到颜色后赋给 material.emissive。
   *   - 跳过没有 material 的 mesh
   *   - 兼容 multi-material (mesh.material 是数组的情况)
   *   - 只对有 emissive 字段的材质生效 (MeshStandard / MeshPhysical / MeshLambert / MeshPhong)
   *   - getColor 返回 null 表示跳过这个 mesh
   */
  function applyEmissive(
    obj: THREE.Object3D,
    getColor: (mesh: THREE.Mesh, material: THREE.Material) => THREE.Color | null,
  ): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!(mesh instanceof THREE.Mesh) || !mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const em = (m as any).emissive as THREE.Color | undefined
        if (!em) continue
        const c = getColor(mesh, m)
        if (!c) continue
        em.copy(c)
      }
    })
  }

  /** 内部 helper: 停 obj 上的 pulse 定时器, 清 userData key。无定时器则 no-op。 */
  function clearPulseTimer(obj: THREE.Object3D): void {
    const timer = obj.userData['__pulseTimer'] as ReturnType<typeof setInterval> | undefined
    if (timer) {
      clearInterval(timer)
      delete obj.userData['__pulseTimer']
    }
  }

  // ===== 公开 API (highlight) =====

  /**
   * 高亮 + 可选闪烁。
   *   - 改 obj 及其所有子 mesh 的 material.emissive
   *   - 第一次高亮时把原始 emissive 存到 userData.__originalEmissive (按 mesh 路径)
   *     用于 unHighlight 还原
   *   - 再次 setHighlight 会停掉之前的 pulse 定时器 (即使新调用 pulse=false)
   *
   *   @param obj     要高亮的 Object3D (递归到所有子 mesh)
   *   @param color   高亮颜色, 默认 '#ff0000' (红)
   *   @param pulse   是否闪烁 (setInterval 500ms 切换 0/1), 默认 false
   */
  function setHighlight(obj: THREE.Object3D, color: SceneColor = '#ff0000', pulse = false): void {
    // 先停止上次的 pulse (如果有)
    clearPulseTimer(obj)

    const c = color instanceof THREE.Color ? color : new THREE.Color(color as string | number)
    // 先把"原始色"基础 = 之前的 origEmissiveMap (之前已存过原始色)
    // 这样再次高亮时, 不会把上次的高亮色当成"原始色"
    const prev = obj.userData[ORIGINAL_EMISSIVE_KEY] as Map<THREE.Material, THREE.Color> | undefined
    const origEmissiveMap = prev ? new Map(prev) : new Map<THREE.Material, THREE.Color>()

    // 应用高亮色; 第一次高亮时把原始色存进 origEmissiveMap
    applyEmissive(obj, (_mesh, material) => {
      if (!origEmissiveMap.has(material)) {
        const em = (material as any).emissive as THREE.Color
        origEmissiveMap.set(material, em.clone())
      }
      return c.clone()
    })

    obj.userData[ORIGINAL_EMISSIVE_KEY] = origEmissiveMap

    // pulse: 每 500ms 切换 0/1 emissive 模拟闪烁
    if (pulse) {
      let on = true
      const timer = setInterval(() => {
        on = !on
        applyEmissive(obj, () => (on ? c.clone() : new THREE.Color(0, 0, 0)))
      }, 500)
      obj.userData['__pulseTimer'] = timer
    }
  }

  /**
   * 还原高亮 — 读 userData.__originalEmissive 恢复原始 emissive, 停 pulse 定时器, 清 userData key。
   * 多次高亮时, 只有最后一次 unHighlight 才能完全还原 (中间状态是叠加)。
   */
  function unHighlight(obj: THREE.Object3D): void {
    clearPulseTimer(obj)
    const orig = obj.userData[ORIGINAL_EMISSIVE_KEY] as Map<THREE.Material, THREE.Color> | undefined
    if (!orig) return
    applyEmissive(obj, (_mesh, material) => orig.get(material)?.clone() ?? null)
    delete obj.userData[ORIGINAL_EMISSIVE_KEY]
  }

  /**
   * 清掉所有高亮 — traverse scene 找有 __originalEmissive 的 obj, 逐个 unHighlight。
   * 给"还原一切"按钮用。
   */
  function clearAllHighlights(): void {
    const ctx = getSspContext()
    ctx.scene.traverse((obj) => {
      if (obj.userData[ORIGINAL_EMISSIVE_KEY]) {
        unHighlight(obj)
      }
    })
  }

  // ===== 可见性 =====

  /** 单个 obj 显示/隐藏: obj.visible = visible (纯 Three.js 操作) */
  function setVisible(obj: THREE.Object3D, visible: boolean): void {
    obj.visible = visible
  }

  /**
   * 按 floorName 显示/隐藏所有属于该楼层的 mesh。
   *   - traverse 整个 scene, 跳过 Camera / Light / ssp_helper_*
   *   - 用 getUserDataValue 读 userData.floorName (兜底 userData.extras.floorName)
   *   - 匹配 floorName → visible, 不匹配 → !visible
   *   - 默认 visible=true (isolate 语义: 只显示该楼层, 其他隐藏)
   *
   * 坐标兜底思路 (未来扩展, 当前不实现):
   *   如果 userData.floorName 完全缺失 (GLB 数据丢失/不规范), 可用世界 Y 坐标范围推断。
   *   - modelTool 加载时用 Box3 算每个 floor root 的 [min.y, max.y]
   *   - 存到 FloorInfo.yRange, 这里兜底层用 mesh.getWorldPosition().y 跟各 floor 范围对比
   *   - 难点: 多楼层 Y 重叠, LANDSCAPE 在 Y<0, 复杂场景不一定按 Y 排
   *   - 当前 spec 强制每个 mesh 都填 floorName (§2 + §14.2), 不需要这层兜底
   */
  function setVisibleByFloor(floorName: string, visible = true): void {
    const ctx = getSspContext()
    ctx.scene.traverse((obj) => {
      if (obj instanceof THREE.Camera) return
      if (obj instanceof THREE.Light) return
      if (obj.name && obj.name.startsWith('ssp_helper_')) return
      const objFloor = getUserDataValue(obj, 'floorName')
      obj.visible = objFloor === floorName ? visible : !visible
    })
  }

  /**
   * 一键重置所有可见性 — 把 scene 里所有 mesh 设为 visible=true。
   *   - 跳过 Camera / Light / ssp_helper_* (跟 findInScene / setVisibleByFloor 一致)
   *   - 对应 clearAllHighlights (一个清高亮, 一个清可见性)
   *   - LLM 友好: "还原所有可见性" / "全部显示" / "恢复显示" 都对应这个 API
   *   - 单 mesh / 单 floor 的重置:
   *     - setVisible(obj, true)         (单 obj)
   *     - setVisibleByFloor(fn, true)   (单 floor)
   * @returns restored       被设为 visible=true 的 mesh 数
   * @returns hiddenBefore   还原前已隐藏的 mesh 数 (UI 反馈用)
   */
  function resetVisibility(): { restored: number; hiddenBefore: number } {
    const ctx = getSspContext()
    let restored = 0
    let hiddenBefore = 0
    ctx.scene.traverse((obj) => {
      if (obj instanceof THREE.Camera) return
      if (obj instanceof THREE.Light) return
      if (obj.name && obj.name.startsWith('ssp_helper_')) return
      if (!obj.visible) hiddenBefore++
      obj.visible = true
      restored++
    })
    return { restored, hiddenBefore }
  }

  // ===== 楼层炸开 =====

  /**
   * userData 上存原始 position 的 key — explodeFloor 第一次炸开时存, collapseFloor 还原用。
   */
  const ORIGINAL_POSITION_KEY = '__originalPosition'
  /**
   * userData 上标记是否已炸开的 key — explodeFloor 设 true, collapseFloor 删。
   */
  const EXPLODED_KEY = '__isExploded'
  /** 当前正在跑的 animatePosition rAF id (闭包内单例), 用于 cancel 旧动画避免叠加 */
  let activeAnim: number | null = null

  /**
   * 楼层炸开: 把每个楼层的 root 沿指定轴拉开间距, 便于看到内部结构
   *
   * @param opts.gap    每层间距 (米), 默认 20
   * @param opts.axis   炸开方向 'y' | 'x' | 'z', 默认 'y' (垂直)
   * @param opts.durationMs  动画过渡毫秒数, 默认 600; 0 = 立刻
   *
   * 实现:
   *   1. 缓存每层 root 的原始 position (第一次炸开时)
   *   2. 按 level 排序, 找到 midLevel
   *   3. 每层 root.position[axis] = originalPos[axis] + (level - midLevel) * gap
   *   4. 简单动画: requestAnimationFrame 插值
   */
  function explodeFloor(opts: { gap?: number; axis?: 'x' | 'y' | 'z'; durationMs?: number } = {}): void {
    const ctx = getSspContext()
    const gap = opts.gap ?? 20
    const axis = opts.axis ?? 'y'
    const durationMs = opts.durationMs ?? 600

    // 收集所有楼层 root
    const floors: Array<{ root: THREE.Object3D; level: number }> = []
    ctx.scene.children.forEach((root) => {
      if (root instanceof THREE.Light || root instanceof THREE.Camera) return
      if (root.name && root.name.startsWith('ssp_helper_')) return
      const level = root.userData?.level
      if (typeof level !== 'number') return
      // 缓存原始 position (只第一次)
      if (!root.userData[ORIGINAL_POSITION_KEY]) {
        root.userData[ORIGINAL_POSITION_KEY] = root.position.clone()
      }
      floors.push({ root, level })
    })

    if (floors.length === 0) return

    // 找 midLevel (中位数: 偶数时取中间两值的平均)
    const levels = floors.map((f) => f.level).sort((a, b) => a - b)
    const midLevel =
      levels.length % 2 === 1
        ? levels[Math.floor(levels.length / 2)]
        : (levels[levels.length / 2 - 1] + levels[levels.length / 2]) / 2

    // 计算每层的目标 position
    const targets = floors.map(({ root, level }) => {
      const orig = root.userData[ORIGINAL_POSITION_KEY] as THREE.Vector3
      const target = orig.clone()
      target[axis] += (level - midLevel) * gap
      return { root, from: root.position.clone(), to: target }
    })

    // 动画 (或立刻)
    animatePosition(targets, durationMs)
    floors.forEach((f) => (f.root.userData[EXPLODED_KEY] = true))
  }

  /**
   * 楼层炸开收回: 读 userData.__originalPosition 还原每层 root 到原始 position, 清除 __isExploded 标记。
   * @param durationMs 动画过渡毫秒数, 默认 600; 0 = 立刻
   */
  function collapseFloor(durationMs = 600): void {
    const ctx = getSspContext()
    const targets: Array<{ root: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3 }> = []
    ctx.scene.children.forEach((root) => {
      // 跳过 Camera / Light / ssp_helper_* (跟 explodeFloor 风格一致)
      if (root instanceof THREE.Light || root instanceof THREE.Camera) return
      if (root.name && root.name.startsWith('ssp_helper_')) return
      if (root.userData[EXPLODED_KEY] && root.userData[ORIGINAL_POSITION_KEY]) {
        const orig = root.userData[ORIGINAL_POSITION_KEY] as THREE.Vector3
        targets.push({ root, from: root.position.clone(), to: orig })
        delete root.userData[EXPLODED_KEY]
      }
    })
    if (targets.length === 0) return
    animatePosition(targets, durationMs)
  }

  /**
   * 是否当前有楼层处于炸开状态 — traverse scene 检查 userData.__isExploded 标记。
   *
   * 当前定位: 闭包内只为"楼层炸开"服务, 逻辑已固定 (查 __isExploded 标记)。
   *
   * 未来扩展 (如果加 设备炸开 / 空间炸开 等其他维度):
   *   - 方案 A (推荐): 改名为 isFloorsExploded, 语义更明确 — 命名清晰优先
   *   - 方案 B: 抽通用 isExplodedFor(key: string), 传 userData key 区分
   *   当前不实现, 等真有第二维度需求时再选
   */
  function isExploded(): boolean {
    const ctx = getSspContext()
    let result = false
    ctx.scene.traverse((root) => {
      if (root.userData?.[EXPLODED_KEY] === true) {
        result = true
      }
    })
    return result
  }

  /**
   * 通用 position 插值动画 (基于 rAF, easeInOutQuad 缓动)。
   * 给 explodeFloor / collapseFloor 用, 不导出。
   *
   * 注: 用闭包 activeAnim 存 rAF id, 新调用会自动 cancel 旧的动画, 避免重复动画叠加 (同时跑两个 step 会互相覆盖 position)。
   *
   * @param targets     [{ root, from, to }] 数组, from/to 是 THREE.Vector3
   * @param durationMs  过渡毫秒数, 0 = 立刻 (不走动画, 直接设 to)
   */
  function animatePosition(
    targets: Array<{ root: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3 }>,
    durationMs: number,
  ): void {
    // 取消上次的 rAF (如果有) — 避免多个动画叠加
    if (activeAnim !== null) {
      cancelAnimationFrame(activeAnim)
      activeAnim = null
    }

    if (durationMs <= 0 || targets.length === 0) {
      // 立刻设置
      targets.forEach(({ root, to }) => {
        root.position.copy(to)
      })
      return
    }
    const start = performance.now()
    function step() {
      const elapsed = performance.now() - start
      const t = Math.min(elapsed / durationMs, 1)
      // easeInOutQuad
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      targets.forEach(({ root, from, to }) => {
        root.position.x = from.x + (to.x - from.x) * e
        root.position.y = from.y + (to.y - from.y) * e
        root.position.z = from.z + (to.z - from.z) * e
      })
      if (t < 1) {
        activeAnim = requestAnimationFrame(step)
      } else {
        activeAnim = null  // 动画完成, 清掉
      }
    }
    activeAnim = requestAnimationFrame(step)
  }

  return {
    /** 按 name 找 — 见 getByName */
    getByName,
    /** 按 sid/findId 找 — 见 getById */
    getById,
    /** 按 userData 字段找 — 见 getByUserDataProperty */
    getByUserDataProperty,
    /** 高亮 — 见 setHighlight */
    setHighlight,
    /** 还原高亮 — 见 unHighlight */
    unHighlight,
    /** 清掉所有高亮 — 见 clearAllHighlights */
    clearAllHighlights,
    /** 单个显示/隐藏 — 见 setVisible */
    setVisible,
    /** 按楼层名显示/隐藏 — 见 setVisibleByFloor */
    setVisibleByFloor,
    /** 一键重置所有可见性 — 见 resetVisibility */
    resetVisibility,
    /** 楼层炸开 — 见 explodeFloor */
    explodeFloor,
    /** 楼层炸开收回 — 见 collapseFloor */
    collapseFloor,
    /** 是否炸开 — 见 isExploded */
    isExploded,
  }
}
