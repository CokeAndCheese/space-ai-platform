/**
 * helperTool — 调试辅助线 (坐标轴 / 网格)
 *
 * 用途: 给场景加 Three.js AxesHelper / GridHelper, 调试时方便看坐标和位置。
 *
 * 设计原则:
 *   - 所有 helper 都加 `ssp_helper_` 前缀, 方便 removeAll / 计数
 *   - 命名约定跟 core/sceneUtils.ts 协调 — findInScene 会自动跳过这些对象
 *
 * API:
 *   - addAxes(opts?)      加坐标轴 (红 X / 绿 Y / 蓝 Z)
 *   - addGrid(opts?)      加网格地板
 *   - removeAll()         移除所有已加的 helper
 *
 * 对应模板:
 *   - src/templates/ssp_templates/helper/addAxes.json
 *   - src/templates/ssp_templates/helper/addGrid.json
 */

import * as THREE from 'three'
import { getSspContext } from '../core/context'

/**
 * AxesHelper 配置项。
 *   size      轴长 (默认 100 米)
 *   position  位置 (默认 (0, 0, 0))
 */
export interface AxesHelperOptions {
  /** 轴长 (默认 100) */
  size?: number
  /** 位置 (默认 (0, 0, 0)) */
  position?: { x: number; y: number; z: number }
}

/**
 * GridHelper 配置项。
 *   size         网格总边长 (默认 100 米)
 *   divisions    分格数 (默认 50)
 *   color        主线颜色 (默认 '#888888')
 *   centerColor  中线颜色 (默认跟 color 同色, fallback '#444444')
 *   position     位置 (默认 (0, 0, 0))
 *   infinite     是否无限延伸 (本版本不实现, 预留字段)
 */
export interface GridHelperOptions {
  /** 网格总边长 (默认 100) */
  size?: number
  /** 分格数 (默认 50) */
  divisions?: number
  /** 主线颜色, 默认 '#888888' */
  color?: string
  /** 中线颜色, 默认 '#444444' */
  centerColor?: string
  /** 位置 (默认 (0, 0, 0)) */
  position?: { x: number; y: number; z: number }
  /** 是否无限延伸 (用 GridHelper 时为 false, 用 InfinityGrid 时 true) */
  infinite?: boolean
}

/**
 * Helper 工具接口。
 *   addAxes(opts)    加坐标轴
 *   addGrid(opts)    加网格地板
 *   removeAll()      移除所有 helper
 */
export interface HelperTool {
  addAxes(opts?: AxesHelperOptions): { id: string; helper: THREE.AxesHelper }
  addGrid(opts?: GridHelperOptions): { id: string; helper: THREE.GridHelper }
  removeAll(): void
}

/** 自增 id 计数器 (axes_1, grid_1, ...), module 单例 */
let nextHelperId = 1

/**
 * helperTool 工厂。无闭包变量, 所有 helper 通过 name 前缀 + scene.traverse 找到。
 */
export function createHelperTool(): HelperTool {
  /** 所有 helper 的 name 前缀 — 跟 core/sceneUtils.ts 的跳过规则协调 */
  const NAME_PREFIX = 'ssp_helper_'

  /**
   * 加坐标轴 (红 X / 绿 Y / 蓝 Z)。
   * name 设为 `ssp_helper_axes_N`, 方便 removeAll 找。
   */
  function addAxes(opts: AxesHelperOptions = {}): { id: string; helper: THREE.AxesHelper } {
    const ctx = getSspContext()
    const helper = new THREE.AxesHelper(opts.size ?? 100)
    helper.name = NAME_PREFIX + 'axes_' + nextHelperId++
    if (opts.position) {
      helper.position.set(opts.position.x, opts.position.y, opts.position.z)
    }
    ctx.scene.add(helper)
    return { id: helper.name, helper }
  }

  /**
   * 加网格地板。
   * GridHelper 构造签名: (size, divisions, color1 主线, color2 中线十字)。
   * name 设为 `ssp_helper_grid_N`。
   */
  function addGrid(opts: GridHelperOptions = {}): { id: string; helper: THREE.GridHelper } {
    const ctx = getSspContext()
    // 注意: GridHelper 构造签名是 (size, divisions, color1, color2)
    // 颜色 1 是主线, 颜色 2 是中心十字线
    const helper = new THREE.GridHelper(
      opts.size ?? 100,
      opts.divisions ?? 50,
      new THREE.Color(opts.color ?? '#888888'),
      new THREE.Color(opts.centerColor ?? opts.color ?? '#444444'),
    )
    helper.name = NAME_PREFIX + 'grid_' + nextHelperId++
    if (opts.position) {
      helper.position.set(opts.position.x, opts.position.y, opts.position.z)
    }
    ctx.scene.add(helper)
    return { id: helper.name, helper }
  }

  /**
   * 移除所有 helper (按 NAME_PREFIX + parent === scene 双重保险)。
   * 先收集再删, 避免 traverse 中修改 scene 树。
   */
  function removeAll(): void {
    const ctx = getSspContext()
    const toRemove: THREE.Object3D[] = []
    ctx.scene.traverse((obj) => {
      if (obj.name && obj.name.startsWith(NAME_PREFIX) && obj.parent === ctx.scene) {
        toRemove.push(obj)
      }
    })
    for (const obj of toRemove) {
      ctx.scene.remove(obj)
    }
  }

  return {
    addAxes,
    addGrid,
    removeAll,
  }
}