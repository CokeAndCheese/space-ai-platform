/**
 * modelTool — 多 GLB 模型管理
 *
 * 用途: 数字孪生 / BIM 场景通常拆分成几十 / 几百个 GLB (按楼层 / 区域 / 类型),
 *       它们**逻辑上是一个建筑**,但**物理上是独立文件**。
 *       modelTool 负责加载 / 卸载这些 GLB, 把 floor roots 放进主场景。
 *
 * 设计原则:
 *   - 按原 GLB 的 matrix 直接 add 到主场景, 坐标**不重算** (避免破坏 GLB 内部 mesh 之间的相对位置)
 *   - 把 GLB metadata 写到 root.userData (floorName / building / level / floorType),
 *     让 objectsTool / cameraController 通过 getByUserDataProperty 找到
 *   - 批量加载限并发 8 (避免一次性开 55 个 HTTP 请求挤爆浏览器 / 服务器)
 *   - 卸载时 dispose geometry / material, 避免 GPU 显存泄漏
 *
 * 数据源: __modelManifest (window 全局变量, 由 composables/useModelLibrary 写入)
 *
 * API:
 *   - loadFloor / loadSubcategory / loadAll                   加载 (单 / 批 / 全)
 *   - unloadFloor / unloadSubcategory / unloadAll             卸载 (单 / 批 / 全)
 *   - getLoadedFloors / getLoadedSubcategories / getFloorInfo 查询
 *   - getFloorNamesByBuilding / getFloorNameByLevel           按 building / level 查
 *   - getSubcategories                                        manifest 里所有 sub
 *
 * 对应模板:
 *   - src/templates/ssp_templates/objects/floor.json (走 objectsTool 组合)
 *   - src/templates/ssp_templates/scene/clear.json (调 unloadAll)
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { getSspContext } from '../core/context'

/**
 * 楼层 metadata — 直接对应 GLB 的 scene.extras 字段。
 * 加载后 floorName / building / level / floorType 也会写到 root.userData,
 * 方便 objectsTool / cameraController 通过 userData 查询。
 *
 *   floorName  唯一标识 (A_6F / BASEMENT_B1 / LANDSCAPE_TERRAIN)
 *   building   楼栋 (A / B / C / COMMON / null)
 *   level      楼层号 (1~24 / -1~-4 / 99 / null)
 *   floorType  楼层类型 (v3: 7 种, ROOF_DECORATION 已并入 ROOF)
 *              FACILITY 是 renderType, 不是 floorType
 *   url        GLB 文件 URL
 *   root       加载后的 Object3D 根 (已 add 到 scene)
 */
export interface FloorInfo {
  /** 唯一标识, 如 'A_6F' / 'BASEMENT_B1' / 'LANDSCAPE_TERRAIN' */
  floorName: string
  /** 楼栋, 如 'A' / 'B' / 'C' / 'COMMON' / null */
  building: string | null
  /** 楼层号, 1~24 / -1~-4 / 99 / null */
  level: number | null
  /** 楼层类型 (v3: 7 种, ROOF_DECORATION 已并入 ROOF) */
  // v3.1: 仍 7 种, 没变化 (FACILITY 是 renderType 不是 floorType)
  floorType:
    | 'FLOOR'
    | 'TOWER'
    | 'ROOF'
    | 'BASEMENT'
    | 'LANDSCAPE_TERRAIN'
    | 'LANDSCAPE_FACADE'
    | 'FACILITY'
    | string
    | null
  /** GLB 文件 URL */
  url: string
  /** 加载后的 Object3D 根 (scene 节点) */
  root: THREE.Object3D
}

/**
 * 内部缓存条目 — floorName → 已加载的 GLB root + 它的 info。
 * 只在闭包内用, 不导出。
 */
interface LoadedFloor {
  info: FloorInfo
  gltf: THREE.Group
}

/**
 * 默认子目录 (没传 subcategory 时用, manifest 里第一条带 subcategory 的)
 * 在 loadSubcategory() 里会根据 manifest 动态识别
 */
const DEFAULT_SUB = 'hospital'

/**
 * manifest 单条 record (来自 model-manifest.json, 由 useModelLibrary 写到 __modelManifest)。
 *   subcategory  子目录 (hospital / office / plaza 等)
 *   filename     文件名 (A_6F.glb)
 *   url          完整 URL
 *   displayName  显示名
 *   sizeBytes    文件大小
 *   sizeMB       MB 单位
 *   mtime        修改时间
 */
interface ManifestRecord {
  subcategory: string
  filename: string
  url: string
  displayName: string
  sizeBytes: number
  sizeMB: number
  mtime: number
}

/**
 * Model 工具接口。
 *   加载:  loadFloor / loadSubcategory / loadAll
 *   卸载:  unloadFloor / unloadSubcategory / unloadAll
 *   查询:  getLoadedFloors / getLoadedSubcategories / getFloorInfo
 *          getFloorNamesByBuilding / getFloorNameByLevel / getSubcategories
 */
export interface ModelTool {
  /**
   * 加载单个 GLB
   * @param floorNameOrUrl 接受: 'A_6F' | 'A_6F.glb' | '/models/hospital/A_6F.glb'
   *                       也支持自动从 manifest 找 (默认子目录)
   */
  loadFloor(floorNameOrUrl: string): Promise<FloorInfo>
  /**
   * 一次性加载整个 subcategory 的所有 GLB (例如 hospital 下 55 个)
   * 加载完成后, 所有 GLB 的 root 都 add 到主场景, 坐标由 GLB 内部 matrix 决定
   * @param subcategory 子目录名, 如 'hospital'。省略则用默认 (manifest 里第一条)
   */
  loadSubcategory(subcategory?: string): Promise<FloorInfo[]>
  /**
   * 加载所有 GLB (多个 subcategory 全部, 例如 hospital + office + plaza)
   */
  loadAll(): Promise<FloorInfo[]>
  /** 卸载单个 */
  unloadFloor(floorName: string): void
  /** 卸载某个 subcategory 的所有 GLB */
  unloadSubcategory(subcategory: string): void
  /** 卸载全部 */
  unloadAll(): void
  getLoadedFloors(): string[]
  getLoadedSubcategories(): string[]
  getFloorInfo(floorName: string): FloorInfo | undefined
  getFloorNamesByBuilding(building: string): string[]
  getFloorNameByLevel(building: string, level: number): string | undefined
  /** manifest 里有哪几个 subcategory */
  getSubcategories(): string[]
}

/**
 * modelTool 工厂。闭包内 loaded Map 跟踪已加载 GLB。
 * module 级 nextLightId 模式没用 — 这里用 Map 维护。
 */
export function createModelTool(): ModelTool {
  /** floorName → 已加载的 GLB root + info。闭包内单例。 */
  const loaded = new Map<string, LoadedFloor>()
  /** 正在加载的 floorName → 本次加载会话。避免同一 GLB 被并发请求两次。 */
  const pending = new Map<string, { generation: number; promise: Promise<FloorInfo> }>()
  /** 卸载时递增。网络请求本身不可中止，但过期结果绝不能重新写回场景。 */
  let loadGeneration = 0
  /** GLTFLoader 单例, lazy init (需要 setSspContext 才能用) */
  let loader: GLTFLoader | null = null

  /**
   * 拿 GLTFLoader 单例, 配 DRACOLoader 解码器。
   * DRACO 解码器路径 /draco/ (静态目录)。
   */
  function getLoader(): GLTFLoader {
    if (loader) return loader
    const l = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    l.setDRACOLoader(draco)
    loader = l
    return l
  }

  /** 推算 floorName from URL ('/models/hospital/A_6F.glb' -> 'A_6F') */
  function urlToFloorName(url: string): string {
    const filename = url.split('/').pop() ?? ''
    return filename.replace(/\.glb$/i, '').replace(/\.gltf$/i, '')
  }

  /** 推算 url from floorName ('A_6F' -> '/models/<sub>/A_6F.glb') */
  function floorNameToUrl(floorName: string): string {
    return `/models/${DEFAULT_SUB}/${floorName}.glb`
  }

  /** 从 GLB scene 读 metadata (scene.extras + asset.extras fallback) */
  function readFloorMeta(gltf: any, url: string): FloorInfo {
    const scene: any = gltf.scene
    const extras = scene?.extras ?? scene?.userData ?? {}
    const assetExtras: any = gltf.asset?.extras ?? {}
    const floorName = extras.floorName ?? assetExtras.floorName ?? urlToFloorName(url)
    return {
      floorName,
      building: extras.building ?? assetExtras.building ?? null,
      level: extras.level ?? assetExtras.level ?? null,
      floorType: extras.floorType ?? assetExtras.floorType ?? null,
      url,
      root: gltf.scene,
    }
  }

  /** Promise 化 GLTFLoader.load (兼容老 API 风格) */
  async function loadGltf(url: string): Promise<any> {
    const l = getLoader()
    return new Promise((resolve, reject) => {
      l.load(url, (g: any) => resolve(g), undefined, (err: any) => reject(err))
    })
  }

  /** 释放未挂入场景的过期 GLB，包含材质引用的贴图。 */
  function disposeObjectResources(root: THREE.Object3D): void {
    const disposedTextures = new Set<THREE.Texture>()
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      mesh.geometry?.dispose()
      const materials = mesh.material
        ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        : []
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
            disposedTextures.add(value)
            value.dispose()
          }
        }
        material.dispose()
      }
    })
  }

  /**
   * 加载单个 GLB。
   *   - 输入可以是 floorName / 裸文件名 / 完整 URL / 远程 URL
   *   - 已加载的走缓存, 不重复 load
   *   - 加载完后: add 到主场景, 写 userData, 写 root.name
   */
  async function loadFloor(floorNameOrUrl: string): Promise<FloorInfo> {
    // 接受 floorName (A_6F) 或 URL (/models/hospital/A_6F.glb) 或裸文件名 (A_6F.glb)
    let url: string
    let key: string
    if (floorNameOrUrl.endsWith('.glb') || floorNameOrUrl.endsWith('.gltf')) {
      // 是文件名 / URL
      if (floorNameOrUrl.startsWith('/') || floorNameOrUrl.startsWith('http')) {
        url = floorNameOrUrl
      } else {
        // 裸文件名, 加默认子目录
        url = `/models/${DEFAULT_SUB}/${floorNameOrUrl}`
      }
      key = urlToFloorName(url)
    } else {
      // 纯 floorName
      key = floorNameOrUrl
      url = floorNameToUrl(floorNameOrUrl)
    }

    if (loaded.has(key)) {
      return loaded.get(key)!.info
    }

    const generation = loadGeneration
    const pendingEntry = pending.get(key)
    if (pendingEntry?.generation === generation) {
      return pendingEntry.promise
    }

    const promise = (async (): Promise<FloorInfo> => {
      const ctx = getSspContext()
      const gltf = await loadGltf(url)
      if (generation !== loadGeneration) {
        disposeObjectResources(gltf.scene)
        throw new Error(`[modelTool] load cancelled: ${url}`)
      }
      const info = readFloorMeta(gltf, url)
      // 关键: 直接 add 到主场景, GLB 内部 matrix 决定位置 (不重算)
      ctx.scene.add(gltf.scene)
      // 把 floorName 写到 root.name, 方便后续 getByName 找
      gltf.scene.name = info.floorName
      // 把 metadata 复制到 userData (让 objectsTool 的 traverse 能读到)
      Object.assign(gltf.scene.userData, {
        floorName: info.floorName,
        building: info.building,
        level: info.level,
        floorType: info.floorType,
      })
      loaded.set(key, { info, gltf: gltf.scene })
      return info
    })()
    pending.set(key, { generation, promise })
    try {
      return await promise
    } finally {
      if (pending.get(key)?.promise === promise) pending.delete(key)
    }
  }

  /**
   * 批量加载某 subcategory 下的所有 GLB, 限并发 8。
   *   - cursor 共享游标, 多个 worker 抢任务
   *   - 单个失败不阻塞其他
   */
  async function loadSubcategory(subcategory?: string): Promise<FloorInfo[]> {
    const manifest = getManifest()
    const sub = subcategory ?? detectDefaultSub(manifest)
    if (!sub) {
      throw new Error('[modelTool] manifest 里没有 subcategory, 无法批量加载')
    }
    const glbs = manifest.filter((m) => m.subcategory === sub)
    // 并行加载, 限并发到 8 (避免一次性开 55 个 HTTP 请求挤爆浏览器 / 服务器)
    const CONCURRENCY = 8
    const infos: FloorInfo[] = []
    const generation = loadGeneration
    let cursor = 0
    async function worker(): Promise<void> {
      while (generation === loadGeneration && cursor < glbs.length) {
        const idx = cursor++
        const m = glbs[idx]
        try {
          const info = await loadFloor(m.url)
          infos.push(info)
        } catch (e) {
          if (generation !== loadGeneration) return
          console.warn('[modelTool] load failed', m.url, e)
        }
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, glbs.length) }, () => worker())
    await Promise.all(workers)
    return infos
  }

  /**
   * 加载所有 subcategory 的所有 GLB。串行 subcategory (避免并行多个 worker)。
   */
  async function loadAll(): Promise<FloorInfo[]> {
    const subs = getSubcategories()
    const infos: FloorInfo[] = []
    const generation = loadGeneration
    for (const sub of subs) {
      if (generation !== loadGeneration) break
      const subInfos = await loadSubcategory(sub)
      infos.push(...subInfos)
    }
    return infos
  }

  /**
   * 卸载某 subcategory 的所有 GLB。
   * 通过 url 反查 manifest 拿 subcategory (FloorInfo 没存)。
   */
  function unloadSubcategory(subcategory: string): void {
    loadGeneration++
    for (const k of Array.from(loaded.keys())) {
      const info = loaded.get(k)?.info
      // floorInfo 没存 subcategory, 从 url 反查 manifest
      const rec = getManifest().find((m) => m.url === info?.url)
      if (rec?.subcategory === subcategory) {
        unloadFloorInternal(k)
      }
    }
  }

  /** 已加载的所有 subcategory (去重)。通过 url 反查 manifest。 */
  function getLoadedSubcategories(): string[] {
    const manifest = getManifest()
    const subs = new Set<string>()
    for (const item of loaded.values()) {
      const rec = manifest.find((m) => m.url === item.info.url)
      if (rec?.subcategory) subs.add(rec.subcategory)
    }
    return Array.from(subs)
  }

  /** manifest 里有 subcategory 的所有条目 (去重)。 */
  function getSubcategories(): string[] {
    const manifest = getManifest()
    const subs = new Set<string>()
    for (const m of manifest) {
      if (m.subcategory) subs.add(m.subcategory)
    }
    return Array.from(subs)
  }

  /** 取 manifest 里第一个有 subcategory 的, 作为 loadSubcategory 默认值。 */
  function detectDefaultSub(manifest: ManifestRecord[]): string | undefined {
    // 取第一个有 subcategory 的
    for (const m of manifest) {
      if (m.subcategory) return m.subcategory
    }
    return undefined
  }

  /** 拿 manifest。来源: window.__modelManifest (由 useModelLibrary 写入)。 */
  function getManifest(): ManifestRecord[] {
    const m = (window as any).__modelManifest as ManifestRecord[] | undefined
    if (!m) {
      throw new Error('[modelTool] __modelManifest 未初始化 (useModelLibrary 必须先 import)')
    }
    return m
  }

  /**
   * 卸载单个 GLB。
   *   - 从 scene 移除
   *   - dispose 所有子 mesh 的 geometry / material (防显存泄漏)
   *   - 从 loaded Map 删
   */
  function unloadFloorInternal(floorName: string): void {
    const item = loaded.get(floorName)
    if (!item) return
    const ctx = getSspContext()
    ctx.scene.remove(item.gltf)
    disposeObjectResources(item.gltf)
    loaded.delete(floorName)
  }

  function unloadFloor(floorName: string): void {
    loadGeneration++
    unloadFloorInternal(floorName)
  }

  /** 卸载所有已加载的 GLB (遍历 loaded Map 调 unloadFloor) */
  function unloadAll(): void {
    loadGeneration++
    for (const k of Array.from(loaded.keys())) {
      unloadFloorInternal(k)
    }
  }

  /** 已加载的 floorName 列表。 */
  function getLoadedFloors(): string[] {
    return Array.from(loaded.keys())
  }

  /** 取单个 floor 的 metadata (loaded Map 查)。 */
  function getFloorInfo(floorName: string): FloorInfo | undefined {
    return loaded.get(floorName)?.info
  }

  /**
   * 按楼栋取所有 floorName, 按 level 排序。
   *   - 排序: level 为 null 的排最后
   *   - 没 building 的 floorName 不在结果里
   */
  function getFloorNamesByBuilding(building: string): string[] {
    const out: string[] = []
    for (const { info } of loaded.values()) {
      if (info.building === building) out.push(info.floorName)
    }
    // 按 level 排序
    out.sort((a, b) => {
      const la = loaded.get(a)?.info.level
      const lb = loaded.get(b)?.info.level
      if (la == null && lb == null) return 0
      if (la == null) return 1
      if (lb == null) return -1
      return la - lb
    })
    return out
  }

  /** 按 building + level 查 floorName (双向索引)。 */
  function getFloorNameByLevel(building: string, level: number): string | undefined {
    for (const { info } of loaded.values()) {
      if (info.building === building && info.level === level) return info.floorName
    }
    return undefined
  }

  return {
    /** 加载单个 GLB — 见 loadFloor */
    loadFloor,
    /** 批量加载某 subcategory — 见 loadSubcategory */
    loadSubcategory,
    /** 加载所有 subcategory — 见 loadAll */
    loadAll,
    /** 卸载单个 — 见 unloadFloor */
    unloadFloor,
    /** 卸载某 subcategory — 见 unloadSubcategory */
    unloadSubcategory,
    /** 卸载全部 — 见 unloadAll */
    unloadAll,
    /** 已加载 floorName 列表 — 见 getLoadedFloors */
    getLoadedFloors,
    /** 已加载 subcategory 列表 — 见 getLoadedSubcategories */
    getLoadedSubcategories,
    /** 单个 floor metadata — 见 getFloorInfo */
    getFloorInfo,
    /** 按楼栋取 floorName (按 level 排序) — 见 getFloorNamesByBuilding */
    getFloorNamesByBuilding,
    /** 按 building + level 查 floorName — 见 getFloorNameByLevel */
    getFloorNameByLevel,
    /** manifest 里所有 subcategory — 见 getSubcategories */
    getSubcategories,
  }
}
