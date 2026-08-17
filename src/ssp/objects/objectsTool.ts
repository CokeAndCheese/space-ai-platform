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
import {
  createHighlightLeaseManager,
  type HighlightLease,
  type HighlightOptions,
} from './highlightLeaseManager'

export type { HighlightLease, HighlightOptions } from './highlightLeaseManager'

/** 灯 / 高亮用的颜色: 字符串 (hex/css) / 数字 (0xffffff) / THREE.Color */
export type SceneColor = string | number | THREE.Color

/** @deprecated 用 core/sceneUtils.ts 的 SceneFindOptions (兼容 alias) */
export type FindOptions = SceneFindOptions

export type SceneQueryScalar = string | number | boolean | null

export type SceneMetadataField =
  | 'sid'
  | 'findId'
  | 'floorName'
  | 'building'
  | 'level'
  | 'floorType'
  | 'renderType'
  | 'renderTypeConfidence'
  | 'spaceType'
  | 'fireType'

export type SceneQueryField = SceneMetadataField | 'name'
export type SceneDescriptorField = SceneMetadataField

export type SceneQueryCondition =
  | { field: SceneQueryField; op: 'equals'; value: SceneQueryScalar }
  | { field: SceneQueryField; op: 'in'; values: readonly SceneQueryScalar[] }

export interface ObjectQueryCriteria {
  /** Conditions are always a flat AND; same-field OR is represented by `in`. */
  all?: readonly SceneQueryCondition[]
}

export interface ObjectQueryOptions {
  /** Required result limit, from 1 through 200. */
  limit: number
}

export interface ObjectDescribeOptions {
  fields?: readonly SceneDescriptorField[]
}

export interface SceneObjectDescriptor {
  id: string
  name: string
  type: string
  visible: boolean
  metadata: Readonly<Record<string, SceneQueryScalar | readonly SceneQueryScalar[]>>
}

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
  query(criteria: ObjectQueryCriteria, options: ObjectQueryOptions): THREE.Object3D[]
  describe(objects: readonly THREE.Object3D[], options?: ObjectDescribeOptions): SceneObjectDescriptor[]
  setHighlight(obj: THREE.Object3D, color?: SceneColor, pulse?: boolean): void
  unHighlight(obj: THREE.Object3D): void
  clearAllHighlights(): void
  applyHighlight(objects: readonly THREE.Object3D[], options?: HighlightOptions): HighlightLease
  releaseHighlight(lease: HighlightLease): boolean
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

/** 注: visible 不单独存, 因为可以直接 obj.visible 改回 */

/**
 * 注: getUserDataValue 已抽到 core/sceneUtils.ts (作为私有 helper)
 * 这里不再重复定义
 */

/**
 * objectsTool 工厂。查询复用 core/sceneUtils；高亮状态由实例内的 lease manager
 * 管理，材质状态不会写入模型 userData。楼层炸开仍使用既有 userData 内部标记。
 */
export function createObjectsTool(): ObjectsTool {
  const highlightLeases = createHighlightLeaseManager()

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

  const QUERY_FIELDS: ReadonlySet<string> = new Set<SceneQueryField>([
    'name',
    'sid',
    'findId',
    'floorName',
    'building',
    'level',
    'floorType',
    'renderType',
    'renderTypeConfidence',
    'spaceType',
    'fireType',
  ])
  const DESCRIPTOR_FIELDS: readonly SceneDescriptorField[] = [
    'sid',
    'findId',
    'floorName',
    'building',
    'level',
    'floorType',
    'renderType',
    'renderTypeConfidence',
    'spaceType',
    'fireType',
  ]

  function isQueryScalar(value: unknown): value is SceneQueryScalar {
    return value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
  }

  function hasStrictShape(
    value: unknown,
    allowed: readonly string[],
    required: readonly string[] = [],
  ): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key !== 'string' || !allowed.includes(key))) return false
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) return false
    return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  }

  function isStrictArray(value: unknown, maxLength: number): boolean {
    if (!Array.isArray(value) || value.length > maxLength || Object.getPrototypeOf(value) !== Array.prototype) return false
    const expectedKeys = new Set<string>(['length'])
    for (let index = 0; index < value.length; index++) expectedKeys.add(String(index))
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key)) || ownKeys.length !== expectedKeys.size) return false
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) return false
    }
    return true
  }

  function validateQueryScalar(value: unknown): asserts value is SceneQueryScalar {
    if (!isQueryScalar(value)) throw new Error('[objectsTool] query values must be JSON scalars')
    if (typeof value === 'string' && value.length > 256) {
      throw new Error('[objectsTool] query string values must be at most 256 characters')
    }
  }

  function readSceneField(object: THREE.Object3D, field: SceneQueryField): unknown {
    return field === 'name' ? object.name : getUserDataValue(object, field)
  }

  function stableObjectId(object: THREE.Object3D): string | null {
    const sid = getUserDataValue(object, 'sid')
    if (typeof sid === 'string' && sid.length > 0 && sid.length <= 256) return sid
    const findId = getUserDataValue(object, 'findId')
    if (typeof findId === 'string' && findId.length > 0 && findId.length <= 256) return findId
    return null
  }

  function isCurrentStableObject(object: THREE.Object3D, scene: THREE.Scene): boolean {
    if (!(object instanceof THREE.Object3D)) return false
    if (object instanceof THREE.Camera || object instanceof THREE.Light) return false
    if (object.name.startsWith('ssp_helper_')) return false
    return !!stableObjectId(object) && isDescendantOf(object, scene)
  }

  function isDescendantOf(object: THREE.Object3D, scene: THREE.Scene): boolean {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      if (current === scene) return true
    }
    return false
  }

  /** Pre-order traversal with a real early-stop, preserving Object3D child order. */
  function walkScene(scene: THREE.Scene, visit: (object: THREE.Object3D) => boolean): void {
    const stack = scene.children.slice().reverse()
    while (stack.length > 0) {
      const object = stack.pop()!
      if (!visit(object)) return
      for (let index = object.children.length - 1; index >= 0; index--) {
        stack.push(object.children[index])
      }
    }
  }

  function validateQuery(criteria: ObjectQueryCriteria): readonly SceneQueryCondition[] {
    if (!hasStrictShape(criteria, ['all'])) {
      throw new Error('[objectsTool] query criteria only supports flat all conditions')
    }
    const conditions = criteria.all === undefined ? [] : criteria.all
    if (!isStrictArray(conditions, 8)) {
      throw new Error('[objectsTool] query supports at most 8 conditions')
    }
    for (const condition of conditions) {
      if (!hasStrictShape(condition, ['field', 'op', 'value', 'values'], ['field', 'op']) || !QUERY_FIELDS.has(String(condition.field))) {
        throw new Error('[objectsTool] query condition field is not allowed')
      }
      if (condition.op === 'equals') {
        if (!hasStrictShape(condition, ['field', 'op', 'value'], ['field', 'op', 'value'])) {
          throw new Error('[objectsTool] equals condition contains unsupported fields')
        }
        validateQueryScalar(condition.value)
      } else if (condition.op === 'in') {
        if (!hasStrictShape(condition, ['field', 'op', 'values'], ['field', 'op', 'values'])) {
          throw new Error('[objectsTool] in condition contains unsupported fields')
        }
        if (!isStrictArray(condition.values, 50)) {
          throw new Error('[objectsTool] query in supports at most 50 values')
        }
        condition.values.forEach(validateQueryScalar)
      } else {
        throw new Error('[objectsTool] query operator must be equals or in')
      }
    }
    return conditions
  }

  function matchesCondition(object: THREE.Object3D, condition: SceneQueryCondition): boolean {
    const actual = readSceneField(object, condition.field)
    if (condition.op === 'equals') return isQueryScalar(actual) && actual === condition.value
    return isQueryScalar(actual) && condition.values.some((value) => actual === value)
  }

  function query(criteria: ObjectQueryCriteria, options: ObjectQueryOptions): THREE.Object3D[] {
    if (!hasStrictShape(options, ['limit'], ['limit']) || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200) {
      throw new Error('[objectsTool] query limit must be an integer from 1 to 200')
    }
    const conditions = validateQuery(criteria)
    const scene = getSspContext().scene
    const result: THREE.Object3D[] = []
    walkScene(scene, (object) => {
      if (isCurrentStableObject(object, scene) && conditions.every((condition) => matchesCondition(object, condition))) {
        result.push(object)
        if (result.length >= options.limit) return false
      }
      return true
    })
    return result
  }

  function boundedMetadataValue(value: unknown): SceneQueryScalar | readonly SceneQueryScalar[] | undefined {
    if (isQueryScalar(value)) {
      if (typeof value === 'string' && value.length > 256) return undefined
      return value
    }
    if (!isStrictArray(value, 50)) return undefined
    const values: SceneQueryScalar[] = []
    for (const item of value as readonly unknown[]) {
      if (!isQueryScalar(item) || (typeof item === 'string' && item.length > 256)) return undefined
      values.push(item)
    }
    return Object.freeze(values)
  }

  function describe(objects: readonly THREE.Object3D[], options: ObjectDescribeOptions = {}): SceneObjectDescriptor[] {
    if (!isStrictArray(objects, 200)) {
      throw new Error('[objectsTool] describe accepts at most 200 objects')
    }
    if (!hasStrictShape(options, ['fields'])) {
      throw new Error('[objectsTool] describe options only supports fields')
    }
    const fields = options.fields === undefined ? DESCRIPTOR_FIELDS : options.fields
    if (!isStrictArray(fields, 16) || fields.some((field) => !DESCRIPTOR_FIELDS.includes(field as SceneDescriptorField))) {
      throw new Error('[objectsTool] describe fields are not allowed or exceed 16 fields')
    }
    const scene = getSspContext().scene
    // Validate every reference before constructing any result so the operation is atomic.
    for (const object of objects) {
      if (!isCurrentStableObject(object, scene)) {
        throw new Error('[objectsTool] describe object is stale, foreign, or has no stable id')
      }
    }
    return objects.map((object) => {
      const metadata: Record<string, SceneQueryScalar | readonly SceneQueryScalar[]> = {}
      for (const field of fields) {
        const value = boundedMetadataValue(getUserDataValue(object, field))
        if (value !== undefined) metadata[field] = value
      }
      return {
        id: stableObjectId(object)!,
        name: object.name.slice(0, 256),
        type: object.type.slice(0, 256),
        visible: object.visible,
        metadata: Object.freeze(metadata),
      }
    })
  }

  // ===== 公开 API (highlight) =====

  /**
   * 高亮 + 可选闪烁。
   *   - 作为兼容层接入统一 lease manager，不向 userData 写高亮状态
   *   - 共享材质使用 clone-on-write，unHighlight 时恢复原材质引用
   *   - 再次 setHighlight 会释放该对象先前的 legacy owner layer
   *
   *   @param obj     要高亮的 Object3D (递归到所有子 mesh)
   *   @param color   高亮颜色, 默认 '#ff0000' (红)
   *   @param pulse   是否闪烁（manager 每 500ms 调度）, 默认 false
   */
  function setHighlight(obj: THREE.Object3D, color: SceneColor = '#ff0000', pulse = false): void {
    const previous = highlightLeases.getLegacyLease(obj)
    if (previous) highlightLeases.releaseLegacyForObject(obj)
    const lease = highlightLeases.apply([obj], { color, pulse }, false)
    highlightLeases.setLegacyLease(obj, lease)
  }

  /**
   * 还原该对象的 legacy 高亮层；不会释放 applyHighlight 创建的 scoped 租约。
   */
  function unHighlight(obj: THREE.Object3D): void {
    highlightLeases.releaseLegacyForObject(obj)
  }

  /**
   * 宿主紧急全局恢复：释放当前 manager 的 legacy 与 scoped 高亮。
   * 新模板和补偿流程不得用它代替 releaseHighlight。
   */
  function clearAllHighlights(): void {
    highlightLeases.releaseAll()
  }

  function applyHighlight(objects: readonly THREE.Object3D[], options?: HighlightOptions): HighlightLease {
    return highlightLeases.apply(objects, options, true)
  }

  function releaseHighlight(lease: HighlightLease): boolean {
    return highlightLeases.release(lease)
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
    /** 结构化查询 — 见 query */
    query,
    /** 有界对象描述 — 见 describe */
    describe,
    /** 高亮 — 见 setHighlight */
    setHighlight,
    /** 还原高亮 — 见 unHighlight */
    unHighlight,
    /** 清掉所有高亮 — 见 clearAllHighlights */
    clearAllHighlights,
    /** 创建作用域高亮租约 — 见 applyHighlight */
    applyHighlight,
    /** 释放作用域高亮租约 — 见 releaseHighlight */
    releaseHighlight,
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
