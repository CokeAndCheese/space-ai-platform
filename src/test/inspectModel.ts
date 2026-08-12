/**
 * 模型 inspector — 把 GLB 内部 metadata 打印到 console, 让用户验证模板能用到什么信息
 *
 * 输出的关键信息:
 *  1. 根节点 / 子节点的 name (影响 getByName / isolateFloor / flyToObject)
 *  2. 节点的 userData (影响 getByUserDataProperty / highlightIsolate)
 *  3. 节点的 renderType / type / sid / findId / spaceType / floorName 等常见 metadata
 *  4. 节点的 material.name / customData
 *
 * 调用方式 (仅开发环境):
 *   在 console 里跑 sspDev.modelInspector.scan() 或 sspDev.modelInspector.scan('url')
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

interface NodeSummary {
  name: string
  type?: string
  sid?: string
  userDataKeys: string[]
  /** 常见 BIM metadata 字段汇总 (floorName / building / level / renderType / spaceType / fireType) */
  bimMeta: Record<string, unknown>
}

function summarizeNode(obj: THREE.Object3D): NodeSummary {
  const u = obj.userData ?? {}
  // 常见 metadata 字段 (GLB v2 规范)
  const bimKeys = [
    'renderType',
    'renderTypeConfidence',
    'spaceType',
    'floorName',
    'floorNo',
    'sid',
    'findId',
    'id',
    'type',
    'category',
    'buildingName',
    'buildingNo',
    'owner',
    'state',
    'description',
  ]
  const bimMeta: Record<string, unknown> = {}
  for (const k of bimKeys) {
    if (u[k] !== undefined) bimMeta[k] = u[k]
  }
  return {
    name: obj.name || '(unnamed)',
    type: u.type,
    sid: u.sid,
    userDataKeys: Object.keys(u),
    bimMeta,
  }
}

async function scanModel(url: string): Promise<void> {
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath('/draco/')
  loader.setDRACOLoader(draco)

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const stats = {
          url,
          totalNodes: 0,
          meshes: 0,
          namedNodes: 0,
          /** 节点名去重后的样本 (只显示前 50 个有名字的) */
          uniqueNames: new Set<string>(),
          /** userData 有内容的所有节点 (前 50 个) */
          nodesWithUserData: [] as NodeSummary[],
          /** 按 renderType 聚合 (BIM 模型常见) */
          byRenderType: {} as Record<string, number>,
          /** 按 spaceType 聚合 (空间标注) */
          bySpaceType: {} as Record<string, number>,
          /** 按 floorName 聚合 */
          byFloorName: {} as Record<string, number>,
        }

        gltf.scene.updateMatrixWorld(true)
        gltf.scene.traverse((obj: THREE.Object3D) => {
          stats.totalNodes++
          if ((obj as THREE.Mesh).isMesh) stats.meshes++
          const name = obj.name
          if (name) {
            stats.namedNodes++
            stats.uniqueNames.add(name)
          }
          const ud = obj.userData ?? {}
          const hasMeta =
            ud.renderType || ud.spaceType || ud.floorName || ud.sid ||
            Object.keys(ud).length > 0
          if (hasMeta) {
            if (stats.nodesWithUserData.length < 50) {
              stats.nodesWithUserData.push(summarizeNode(obj))
            }
          }
          if (ud.renderType) {
            stats.byRenderType[ud.renderType] = (stats.byRenderType[ud.renderType] ?? 0) + 1
          }
          if (ud.spaceType) {
            stats.bySpaceType[ud.spaceType] = (stats.bySpaceType[ud.spaceType] ?? 0) + 1
          }
          if (ud.floorName) {
            stats.byFloorName[ud.floorName] = (stats.byFloorName[ud.floorName] ?? 0) + 1
          }
        })

        console.group('[modelInspector] scan result')
        console.log('url:', stats.url)
        console.log('total nodes:', stats.totalNodes)
        console.log('meshes:', stats.meshes)
        console.log('named nodes:', stats.namedNodes)
        console.log('unique names (first 50):', Array.from(stats.uniqueNames).slice(0, 50))
        console.log('nodes with userData (first 50):', stats.nodesWithUserData)
        console.log('by renderType:', stats.byRenderType)
        console.log('by spaceType:', stats.bySpaceType)
        console.log('by floorName:', stats.byFloorName)
        console.groupEnd()

        // 自动注册到 ssp-shim (一次扫描后随时可读)
        if (typeof window !== 'undefined') {
          ;(window as any).__modelStats = stats
        }
        resolve()
      },
      undefined,
      (err) => {
        console.error('[modelInspector] load failed:', err)
        reject(err)
      },
    )
  })
}

export function createModelInspector() {
  // 默认从 useThreeScene 拿当前 modelUrl
  function getCurrentUrl(): string | null {
    try {
      // 取 localStorage 里保存的当前选择 (useModelLibrary 维护)
      const saved = localStorage.getItem('space-ai:selected-model-url')
      if (saved) return saved
      // fallback 到 manifest 第一个
      const manifest = (window as any).__modelManifest as Array<{ url: string }> | undefined
      if (manifest && manifest.length > 0) return manifest[0].url
      return null
    } catch {
      return null
    }
  }

  return {
    /** 扫描指定 url (或当前 model) 的 metadata */
    async scan(url?: string) {
      const u = url ?? getCurrentUrl()
      if (!u) {
        console.error('[modelInspector] no url provided and no current model found')
        return
      }
      await scanModel(u)
    },
    /** 取上一次 scan 的结果 (节省重复扫描) */
    stats(): unknown {
      return (window as any).__modelStats
    },
  }
}
