/**
 * lightTool — 灯光管理 (环境光 / 方向光)
 *
 * 用途: 给 3D 场景加 Three.js AmbientLight / DirectionalLight。
 *
 * 设计原则:
 *   - 用 obj.name 字段存灯 id (用户指定或自增), 方便 traverse 找
 *   - create 支持 id 同名替换 — 调灯 = remove 旧的 + create 新的
 *   - 不用 setXxx (避免"默认第一个"歧义 + 不对称问题)
 *   - DirectionalLight 的 target 必须 add 到 scene 才生效 (Three.js 坑)
 *
 * API:
 *   - createAmbientLight(opts)       加/替换环境光, 返回 handle
 *   - createDirectionalLight(opts)   加/替换方向光, 返回 handle
 *   - removeLight(id?)               按 id 移除 (不传 = 全部)
 *
 * 对应模板:
 *   - src/templates/ssp_templates/light/createAmbientLight.json
 *   - src/templates/ssp_templates/light/createDirectionalLight.json
 *   - src/templates/ssp_templates/light/removeLight.json
 */

import * as THREE from 'three'
import { getSspContext } from '../core/context'

/** 灯颜色 — 字符串 (hex/css) / 数字 (0xffffff) / THREE.Color */
export type LightColor = string | number | THREE.Color

/**
 * AmbientLight 配置项。
 *   id        灯 id (可选; 不传则自增 ambient_N; 同 id 再次 create 会自动 remove 旧的)
 *   color     灯颜色
 *   intensity 强度 (默认 1)
 */
export interface AmbientLightOptions {
  /** 灯 id (可选, 不传则自增 ambient_N, 同 id 再次 create 会替换旧的) */
  id?: string
  color?: LightColor
  intensity?: number
}

/**
 * DirectionalLight 配置项。
 *   id         灯 id (可选; 不传则自增 directional_N; 同 id 再次 create 会自动 remove 旧的)
 *   color      灯颜色
 *   intensity  强度 (默认 1)
 *   position   世界坐标位置 (默认 (100, 200, 100))
 *   target     光照指向的目标点 (默认 (0, 0, 0))
 *   castShadow 是否投射阴影 (默认 false; true 时配阴影相机参数)
 */
export interface DirectionalLightOptions {
  /** 灯 id (可选, 不传则自增 directional_N, 同 id 再次 create 会替换旧的) */
  id?: string
  color?: LightColor
  intensity?: number
  /** 位置 (世界坐标), 默认 (100, 200, 100) */
  position?: { x: number; y: number; z: number }
  /** 目标点 (光照指向哪里), 默认 (0, 0, 0) */
  target?: { x: number; y: number; z: number }
  /** 是否投射阴影, 默认 false (模板未要求) */
  castShadow?: boolean
}

/**
 * createXxxLight 返回的灯句柄。
 *   id   灯唯一 id (用户指定 或 ambient_N / directional_N 自增)
 *   type 灯类型 (ambient / directional)
 */
export interface LightHandle {
  id: string
  /** 用于 createAmbientLight / removeLight 找灯的引用 */
  type: 'ambient' | 'directional'
}

/**
 * Light 工具接口。
 *   createAmbientLight(opts)      加/替换环境光 (id 可选, 同 id 自动替换)
 *   createDirectionalLight(opts)  加/替换方向光 (id 可选, 同 id 自动替换)
 *   removeLight(id?)              按 id 移除 (不传 id = 移除所有灯)
 */
export interface LightTool {
  createAmbientLight(opts?: AmbientLightOptions): LightHandle
  createDirectionalLight(opts?: DirectionalLightOptions): LightHandle
  /** 移除一个或所有灯; 不传 id = 全部; 返回移除的数量 */
  removeLight(id?: string): number
}

/** 自增 id 计数器 (ambient_1, directional_1, ...), module 单例 */
let nextLightId = 1

/**
 * lightTool 工厂。无闭包变量, 所有灯通过 traverse + obj.name 找。
 * module 级 nextLightId 自增 id (用户没指定 id 时用)。
 */
export function createLightTool(): LightTool {
  /**
   * 加/替换环境光 (AmbientLight)。
   *   - opts.id  不传 → 自增 ambient_N
   *   - opts.id  传 → 同 id 已有灯会被自动 remove 替换 (调 removeLight)
   * id 存到 light.name, add 到 scene, 返回 handle。
   */
  function createAmbientLight(opts: AmbientLightOptions = {}): LightHandle {
    const ctx = getSspContext()
    const id = opts.id ?? `ambient_${nextLightId++}`
    // 同 id 替换: 直接调 removeLight (忽略返回值)
    removeLight(id)
    const light = new THREE.AmbientLight()
    light.name = id
    if (opts.color !== undefined) {
      light.color = new THREE.Color(opts.color as string | number)
    }
    if (opts.intensity !== undefined) {
      light.intensity = opts.intensity
    }
    ctx.scene.add(light)
    return { id, type: 'ambient' }
  }

  /**
   * 加/替换方向光 (DirectionalLight)。
   *   - opts.id   不传 → 自增 directional_N
   *   - opts.id   传 → 同 id 已有灯会被自动 remove 替换
   *   - position  默认 (100, 200, 100)
   *   - target    默认 (0, 0, 0); 注意 DirectionalLight 的 target 必须 add 到 scene 才生效
   *   - castShadow=true 时配阴影相机参数 (范围 ±500, 1024² 阴影纹理)
   */
  function createDirectionalLight(opts: DirectionalLightOptions = {}): LightHandle {
    const ctx = getSspContext()
    const id = opts.id ?? `directional_${nextLightId++}`
    // 同 id 替换: 直接调 removeLight (忽略返回值)
    removeLight(id)
    const light = new THREE.DirectionalLight()
    light.name = id
    if (opts.color !== undefined) {
      light.color = new THREE.Color(opts.color as string | number)
    }
    if (opts.intensity !== undefined) {
      light.intensity = opts.intensity
    }
    if (opts.position) {
      light.position.set(opts.position.x, opts.position.y, opts.position.z)
    } else {
      light.position.set(100, 200, 100)
    }
    if (opts.target) {
      light.target.position.set(opts.target.x, opts.target.y, opts.target.z)
      ctx.scene.add(light.target) // DirectionalLight 的 target 需要加到 scene 才生效
    }
    if (opts.castShadow) {
      light.castShadow = true
      // 阴影相机框选场景大致范围, 避免阴影被裁
      light.shadow.camera.left = -500
      light.shadow.camera.right = 500
      light.shadow.camera.top = 500
      light.shadow.camera.bottom = -500
      light.shadow.camera.near = 0.5
      light.shadow.camera.far = 2000
      light.shadow.mapSize.set(1024, 1024)
    }
    ctx.scene.add(light)
    return { id, type: 'directional' }
  }

  /**
   * 移除一个或所有灯。
   *   - 传 id: 找 scene 里 name === id 的所有对象 (不止 Light) 并 remove
   *   - 不传 id: remove 所有 Light 类型对象
   * @returns 实际移除的数量
   */
  function removeLight(id?: string): number {
    const ctx = getSspContext()
    const toRemove: THREE.Object3D[] = []
    ctx.scene.traverse((obj) => {
      if (id) {
        if (obj.name === id) toRemove.push(obj)
      } else {
        if (obj instanceof THREE.Light) toRemove.push(obj)
      }
    })
    toRemove.forEach((o) => ctx.scene.remove(o))
    return toRemove.length
  }

  return {
    /** 加/替换环境光 — 见 createAmbientLight */
    createAmbientLight,
    /** 加/替换方向光 — 见 createDirectionalLight */
    createDirectionalLight,
    /** 移除灯 — 见 removeLight */
    removeLight,
  }
}