/**
 * ssp-shim 顶层入口 — 聚合 10 个 module 成单个 `ssp` 单例
 *
 * 用途: 整个 ssp-shim 的"门面"。LLM 模板 / 项目代码只需要 `import { ssp } from '@/ssp'`
 *       或 `window.ssp.xxx` 就能用所有功能, 不用关心 module 内部组织。
 *
 * 用法:
 *   import { ssp } from '@/ssp'
 *   await ssp.cameraController.flyTo({ x: 0, y: 10, z: 30 })
 *
 *   // 或在模板 code / console 里 (LLM 友好):
 *   await window.ssp.cameraController.flyTo({ x: 0, y: 10, z: 30 })
 *
 * 初始化流程 (各路由页面在 onMounted 里):
 *   1. 初始化 Three.js 场景 (useThreeScene)
 *   2. 调用 installTweenHook(ctx) 让每帧推进 tween
 *   3. 调用 setSspContext(ctx) 把场景注入 ssp-shim
 *   4. 现在可以 ssp.xxx 用了
 *
 * 设计:
 *   - module 单例: 各 controller 在模块加载时 create 一次, 整个 page 共享
 *   - 跨 module 不互相依赖, 只通过 core/sceneUtils / core/context 通信
 *   - __types 只在 TS 类型层面有用, 运行时是 {} as any
 *
 * 10 个 module 分组:
 *   - 上下文工具 (4):  setContext / getContext / hasContext / clearContext
 *   - 核心 controller (6): cameraController / sceneTool / lightTool / helperTool / modelTool / objectsTool
 *   - 业务 (4): topologyTool / poiManager / cssTool / viewerTool
 */

import { setSspContext, getSspContext, hasSspContext, clearSspContext, type SspContext } from './core/context'
import {
  createCameraController,
  type CameraController,
  type FlyToOptions,
  type Viewpoint,
  type Vec3Like,
} from './camera/cameraController'
import { createSceneTool, type SceneTool } from './scene/sceneTool'
import { createLightTool, type LightTool } from './light/lightTool'
import { createHelperTool, type HelperTool } from './helper/helperTool'
import { createModelTool, type ModelTool } from './model/modelTool'
import { createObjectsTool, type ObjectsTool } from './objects/objectsTool'
import { createTopologyTool, type TopologyTool } from './topology/topologyTool'
import { createPoiManager, type PoiManager } from './poi/poiManager'
import { createCSSTool, type CSSTool } from './css/cssTool'
import { createViewerTool, type ViewerTool } from './viewer/viewerTool'

/**
 * ssp namespace 公开类型。
 *   上下文工具 (4):  setContext / getContext / hasContext / clearContext
 *   核心 controller (6): cameraController / sceneTool / lightTool / helperTool / modelTool / objectsTool
 *   业务 (4): topologyTool / poiManager / cssTool / viewerTool
 *   类型导出 (1):  __types (TS only)
 */
export interface SspNamespace {
  // ===== 上下文工具 =====
  setContext: typeof setSspContext
  getContext: typeof getSspContext
  hasContext: typeof hasSspContext
  clearContext: typeof clearSspContext

  // ===== 核心 controller =====
  cameraController: CameraController
  sceneTool: SceneTool
  lightTool: LightTool
  helperTool: HelperTool
  modelTool: ModelTool
  objectsTool: ObjectsTool

  // ===== 业务 =====
  // 拓扑图管理
  topologyTool: TopologyTool

  // POI / CSS / Viewer
  poiManager: PoiManager
  cssTool: CSSTool
  viewerTool: ViewerTool

  // ===== 类型导出 (运行时是 {} as any, 只在 TS 类型层面有用) =====
  __types: {
    Vec3Like: Vec3Like
    FlyToOptions: FlyToOptions
    Viewpoint: Viewpoint
    SspContext: SspContext
  }
}

// ===== 单例创建 =====
// 各 controller 在模块加载时 create 一次, 整个 page 共享一个实例。
// 顺序跟 SspNamespace interface 字段对齐, 方便读。

/** 相机控制 (flyTo / fitScene / surroundOnTarget / setViewpoint / getViewpoint) */
const cameraController = createCameraController()
/** 场景管理 (背景色 / 雾 / clear / dispose / update) */
const sceneTool = createSceneTool()
/** 灯光管理 (AmbientLight / DirectionalLight) */
const lightTool = createLightTool()
/** 调试辅助 (AxesHelper / GridHelper) */
const helperTool = createHelperTool()
/** 模型加载 (loadFloor / loadSubcategory / loadAll) */
const modelTool = createModelTool()
/** 场景内对象操作 (查找 / 高亮 / 显隐 / 楼层炸开) */
const objectsTool = createObjectsTool()
/** 拓扑图管理 (节点 / 连线 / 布局 / 生命周期) */
const topologyTool = createTopologyTool()
/** POI 管理 (add / show / hide / remove / getById) */
const poiManager = createPoiManager()
/** CSS2D (实际是 Sprite, 性能更好) */
const cssTool = createCSSTool()
/** 多视角 + 截图 (createCanvas / screenshot) */
const viewerTool = createViewerTool()

// ===== ssp 顶层 namespace =====
// 把 10 个单例聚合成一个对象, 暴露给业务层 (import / window.ssp)。

export const ssp: SspNamespace = {
  // ----- 上下文工具 -----
  setContext: setSspContext,
  getContext: getSspContext,
  hasContext: hasSspContext,
  clearContext: clearSspContext,

  // ----- 核心 controller -----
  cameraController,
  sceneTool,
  lightTool,
  helperTool,
  modelTool,
  objectsTool,

  // ----- 业务 -----
  topologyTool,
  poiManager,
  cssTool,
  viewerTool,

  // ----- 类型导出 (运行时是 {} as any, 只在 TS 类型层面有用) -----
  __types: {} as any,
}

// 挂到 window,方便模板 code 直接用 (LLM 友好)
if (typeof window !== 'undefined') {
  ;(window as any).ssp = ssp
  console.log('[ssp] window.ssp mounted', Object.keys(ssp))
}

export type { SspContext } from './core/context'
export type {
  CameraController,
  FlyToOptions,
  Viewpoint,
  Vec3Like,
} from './camera/cameraController'
