/**
 * sceneTool — 场景管理 (背景色 / 雾 / 清空 / 释放)
 *
 * 用途: 整个 scene 的"大开关" — 改背景色、开雾、清空用户对象、释放 GPU、强制一帧。
 * 模型加载 / 拓扑 / POI 等业务层, 走对应的 modelTool / topologyTool / poiManager,
 * 跟 sceneTool 平行 (不互相依赖)。
 *
 * 设计:
 *   - clear 不递归收集 (只删顶层 obj.parent === scene), 避免重复
 *   - dispose 只释放 GPU 资源, 不 remove obj
 *   - clear + dispose 配合用, 中间用 disposeMeshResources helper 去重
 *
 * API:
 *   - 视觉 (2):   setBackgroundColor / setFog
 *   - 清空 (2):   clear / dispose
 *   - 渲染 (1):   update
 *
 * 对应模板:
 *   - src/templates/ssp_templates/scene/setBackgroundColor.json
 *   - src/templates/ssp_templates/scene/setFog.json
 *   - src/templates/ssp_templates/scene/clear.json
 *   - src/templates/ssp_templates/scene/dispose.json
 *   - src/templates/ssp_templates/scene/update.json
 */

import * as THREE from 'three'
import { getSspContext } from '../core/context'

export type SceneColor = string | number | THREE.Color

export interface FogOptions {
  /** 雾色,默认 '#888' */
  color?: SceneColor
  /** 线性 Fog 的 near 距离,默认 100 */
  near?: number
  /** 线性 Fog 的 far 距离,默认 1000 */
  far?: number
  /** 指数 FogExp2 的密度,默认 0.005 */
  density?: number
  /** 雾类型: 'linear' | 'exp2' (默认 'linear', 因为模板 code 用了 near/far) */
  type?: 'linear' | 'exp2'
  /** 是否开启雾,默认 true;false = 移除 fog */
  visible?: boolean
}

/**
 * SceneTool 公开接口。
 *   视觉 (2):   setBackgroundColor / setFog
 *   清空 (2):   clear / dispose
 *   渲染 (1):   update
 */
export interface SceneTool {
  setBackgroundColor(color: SceneColor): void
  setFog(opts?: FogOptions): void
  /**
   * 清空场景
   * @param keepCameraLight 是否保留相机和灯光, 默认 true
   */
  clear(keepCameraLight?: boolean): void
  /**
   * 释放场景内所有 mesh 的 GPU 资源 (geometry / material)。
   * 注意: 不从场景 remove 对象, 只释放 GPU 资源。
   * 切场景前推荐先 clear() 再 dispose(), 或 dispose() + 清空 modelTool.loaded Map。
   */
  dispose(): void
  /** 强制重渲染一帧 (用于 addObject / setVisible 后) */
  update(): void
}

/**
 * sceneTool 工厂。闭包内无状态, 每次调用通过 getSspContext() 拿当前 page 的 scene/camera/controls。
 */
export function createSceneTool(): SceneTool {
  // ===== 内部 helper =====

  /**
   * 内部 helper: 释放一个 obj 子树里所有 mesh 的 GPU 资源 (geometry / material)。
   * 兼容 multi-material (mesh.material 是数组的情况)。
   * clear 和 dispose 都用, 避免重复。
   */
  function disposeMeshResources(obj: THREE.Object3D): void {
    const disposedTextures = new Set<THREE.Texture>()
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
              disposedTextures.add(value)
              value.dispose()
            }
          }
          material.dispose()
        }
      }
    })
  }

  // ===== 公开 API =====

  /**
   * 改场景背景色。THREE.Color 实例会 clone 避免共享 (mutation 不会影响原值)。
   * @param color 颜色: 字符串 hex/css / 数字 0xffffff / THREE.Color 实例
   */
  function setBackgroundColor(color: SceneColor): void {
    const ctx = getSspContext()
    if (color instanceof THREE.Color) {
      ctx.scene.background = color.clone()
    } else {
      ctx.scene.background = new THREE.Color(color as string | number)
    }
  }

  /**
   * 开/关雾。
   *   - visible=false → 移除雾 (ctx.scene.fog = null)
   *   - type=linear (默认) → THREE.Fog(near, far)
   *   - type=exp2 → THREE.FogExp2(density)
   *
   * 默认: color='#888888', near=100, far=1000, density=0.005
   */
  function setFog(opts: FogOptions = {}): void {
    const ctx = getSspContext()
    // visible: false -> 移除雾
    if (opts.visible === false) {
      ctx.scene.fog = null
      return
    }
    const color = new THREE.Color(opts.color ?? '#888888')
    const type = opts.type ?? 'linear' // 默认 linear,因为模板 code 用了 near/far
    if (type === 'linear') {
      ctx.scene.fog = new THREE.Fog(color, opts.near ?? 100, opts.far ?? 1000)
    } else {
      ctx.scene.fog = new THREE.FogExp2(color, opts.density ?? 0.005)
    }
  }

  /**
   * 清空场景内用户对象 (保留相机和灯光)。
   *   - 只删顶层 (parent === scene), 避免重复
   *   - keepCameraLight=true (默认) 时跳过 Camera / Light / AmbientLight / DirectionalLight
   *     / PointLight / HemisphereLight / SpotLight
   *   - 顺手 dispose 子树的 geometry/material (通过 disposeMeshResources)
   *
   * @param keepCameraLight 是否保留相机和灯光, 默认 true
   */
  function clear(keepCameraLight = true): void {
    const ctx = getSspContext()
    const toRemove: THREE.Object3D[] = []
    ctx.scene.traverse((obj) => {
      // scene 本身永远不删
      if (obj === ctx.scene) return
      // keepCameraLight = true 时, 跳过相机和灯光
      if (keepCameraLight) {
        if (
          obj instanceof THREE.Camera ||
          obj instanceof THREE.Light ||
          obj instanceof THREE.AmbientLight ||
          obj instanceof THREE.DirectionalLight ||
          obj instanceof THREE.PointLight ||
          obj instanceof THREE.HemisphereLight ||
          obj instanceof THREE.SpotLight
        ) {
          return
        }
      }
      // 只对顶层 (parent === scene) 收集, 避免重复
      if (obj.parent === ctx.scene) toRemove.push(obj)
    })
    for (const obj of toRemove) {
      ctx.scene.remove(obj)
      // 顺手 dispose 该子树的资源
      disposeMeshResources(obj)
    }
  }

  /**
   * 释放场景内所有 mesh 的 GPU 资源 (geometry / material)。
   * 注意: 不从场景 remove 对象, 只释放 GPU 资源。
   * 切场景前推荐先 clear() 再 dispose(), 或 dispose() + 清空 modelTool.loaded Map。
   */
  function dispose(): void {
    const ctx = getSspContext()
    disposeMeshResources(ctx.scene)
  }

  /**
   * 强制触发一帧 (调 camera-controls.update(0), 让它知道有变化)。
   * 用于 addObject / setVisible 之后, 不等 RAF 自动渲染。
   * 注: Three.js renderer 在下一帧会自动渲染, 这里只是补个手动触发。
   */
  function update(): void {
    if (typeof window !== 'undefined') {
      const ctx = getSspContext()
      const c = ctx.controls as { update?: (dt: number) => void } | undefined
      c?.update?.(0)
    }
  }

  return {
    /** 改场景背景色 — 见 setBackgroundColor */
    setBackgroundColor,
    /** 开/关雾 — 见 setFog */
    setFog,
    /** 清空场景内用户对象 — 见 clear */
    clear,
    /** 释放 GPU 资源 — 见 dispose */
    dispose,
    /** 触发一帧重渲染 — 见 update */
    update,
  }
}
