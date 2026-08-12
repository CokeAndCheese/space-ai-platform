/**
 * sceneUtils — 场景查询的通用 helper (基础设施层)
 *
 * 用途: 提供 findInScene / getObjectByName / getObjectsByUserDataProperty 等通用场景查询。
 * 任何 ssp 模块都能引 — 不破坏模块平行。
 *
 * 历史:
 *   - 之前 findInScene 在 objectsTool 内, findByName 在 cameraController 内 — 重复
 *   - 现在抽到 core, 所有 module 都能复用, 维护点单一
 */

import * as THREE from 'three'
import { getSspContext } from './context'

/**
 * 场景查询的通用选项。
 * @param fuzzy  模糊匹配 (默认 true): 'mesh_42' -> 找 'mesh_42*', 大小写不敏感
 * @param scope  限定查找范围: 只搜某个 subcategory 或 building 下的楼层 root, 例如 'hospital'
 */
export interface SceneFindOptions {
  /** 模糊匹配 (默认 true): 'mesh_42' -> 找 'mesh_42*' */
  fuzzy?: boolean
  /** 限定查找范围: 只搜某个 subcategory 的楼层 root, 例如 'hospital' */
  scope?: string
}

/**
 * 在 scene 整个 traverse 找所有匹配的 mesh。
 * 跳过 Camera / Light / `ssp_helper_*` 节点 (避免误匹配)。
 * @param predicate 匹配函数, 返回 true = 命中
 * @param opts.scope 限定到某个 subcategory 或 building 下
 * @returns 所有命中的 Object3D 数组 (无则空数组)
 */
export function findInScene(
  predicate: (obj: THREE.Object3D) => boolean,
  opts: SceneFindOptions = {},
): THREE.Object3D[] {
  const ctx = getSspContext()
  const out: THREE.Object3D[] = []
  ctx.scene.traverse((obj) => {
    // 跳过 camera / light / ssp helper
    if (obj instanceof THREE.Camera) return
    if (obj instanceof THREE.Light) return
    if (obj.name && obj.name.startsWith('ssp_helper_')) return
    // scope 限制: 只在某个 subcategory 下的楼层 root 内找
    if (opts.scope) {
      let p: THREE.Object3D | null = obj.parent
      let inScope = false
      while (p) {
        if (p.userData?.subcategory === opts.scope || p.userData?.building === opts.scope) {
          inScope = true
          break
        }
        p = p.parent
      }
      if (!inScope) return
    }
    if (predicate(obj)) out.push(obj)
  })
  return out
}

/**
 * 按 `obj.name` 找 mesh。
 * 默认模糊匹配 (大小写不敏感, includes): 'door' 能匹配 'Door_42'。
 * fuzzy=false 时严格 `===` 精确匹配。
 * @returns 第一个匹配的 Object3D, 或 null
 */
export function getObjectByName(
  name: string,
  opts: SceneFindOptions = {},
): THREE.Object3D | null {
  const fuzzy = opts.fuzzy !== false // 默认 true
  if (fuzzy === false) {
    const list = findInScene((o) => o.name === name, opts)
    return list[0] ?? null
  }
  // 模糊: 找 name 包含 query 的第一个, 大小写不敏感
  const list = findInScene(
    (o) => !!o.name && o.name.toLowerCase().includes(name.toLowerCase()),
    opts,
  )
  return list[0] ?? null
}

/**
 * 从 obj.userData 取字段值, 兜底兼容 GLTF extras 结构。
 *   1. 直接读 userData[key]
 *   2. fallback 读 userData.extras[key] (部分老版 gltf-loader 没把 extras 展平)
 * @returns 字段值或 undefined
 */
export function getUserDataValue(obj: THREE.Object3D, key: string): unknown {
  if (key in obj.userData) return obj.userData[key]
  const extras = (obj.userData as any).extras
  if (extras && key in extras) return extras[key]
  return undefined
}

/**
 * 按 `obj.userData[key] === value` 找所有匹配的 mesh。
 * 通用版 — 可查任意 userData 字段 (renderType / floorName / building / sid / level / subcategory 等)。
 * @returns 所有命中的 Object3D 数组 (无则空数组)
 */
export function getObjectsByUserDataProperty(
  key: string,
  value: unknown,
  opts: SceneFindOptions = {},
): THREE.Object3D[] {
  return findInScene((o) => {
    const v = getUserDataValue(o, key)
    return v === value
  }, opts)
}