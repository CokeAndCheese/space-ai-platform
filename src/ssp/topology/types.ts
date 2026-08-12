import type * as THREE from 'three'

/** topology v2 对外可用的颜色格式。 */
export type TopologyGraphColor = string | number

/** topology 不解释的只读业务元数据。 */
export type TopologyData = Readonly<Record<string, unknown>>

/** 与 Three.js 解耦的三维坐标值。 */
export interface TopologyGraphPoint {
  x: number
  y: number
  z: number
}

/**
 * 图的逻辑层。
 * layerId 是唯一身份；order / elevation 仅供业务读取，不参与自动连边。
 */
export interface TopologyLayerInput {
  id: string
  label?: string
  order?: number
  elevation?: number
  tags?: readonly string[]
  data?: TopologyData
}

/**
 * 通用拓扑节点。
 * kind / subtype（例如 STAIR、FACILITY、HYDRANT）只透传给模板层读取，
 * topology 内部算法不会按这些业务值分支。
 */
export interface TopologyGraphNodeInput {
  id: string
  layerId: string
  position: TopologyGraphPoint
  /** 跨层连接器的稳定身份，例如 A/stair/north-01。 */
  connectorId?: string
  label?: string
  kind?: string
  subtype?: string
  tags?: readonly string[]
  data?: TopologyData
}

/** source/target 之外的折线中间点。 */
export interface TopologyPolylineInput {
  type: 'POLYLINE'
  via: readonly TopologyGraphPoint[]
}

/** LINK 为同层普通边；CONNECTOR 为显式跨层边。 */
export type TopologyEdgeRelation = 'LINK' | 'CONNECTOR'

/** FORWARD 仅 source→target；BIDIRECTIONAL 可双向通行。 */
export type TopologyEdgeDirection = 'FORWARD' | 'BIDIRECTIONAL'

/** 创建边时的初始寻路状态。 */
export interface TopologyEdgeRoutingStateInput {
  /** 默认 true。 */
  enabled?: boolean
  /** null/省略表示使用边的 baseWeight。 */
  weightOverride?: number | null
  /** 非空时该边不可通行；值由业务适配层生成，topology 不解释。 */
  blockerIds?: readonly string[]
}

/**
 * 带稳定 ID 的图边。
 * mode / tags / data 是可读业务元数据，不参与 topology 的业务判断。
 */
export interface TopologyGraphEdgeInput {
  id: string
  source: string
  target: string
  relation: TopologyEdgeRelation
  direction: TopologyEdgeDirection
  path?: TopologyPolylineInput
  /** 省略时使用根据完整折线计算的几何长度。 */
  weight?: number
  initialState?: TopologyEdgeRoutingStateInput
  mode?: string
  tags?: readonly string[]
  data?: TopologyData
}

/** 不依赖 Three.js context 的纯数据图输入。 */
export interface TopologyGraphInput {
  /** 省略时生成 topology_graph_N。 */
  id?: string
  layers: readonly TopologyLayerInput[]
  nodes: readonly TopologyGraphNodeInput[]
  edges: readonly TopologyGraphEdgeInput[]
  tags?: readonly string[]
  data?: TopologyData
}

export interface TopologyLayerSnapshot {
  id: string
  label?: string
  order?: number
  elevation?: number
  tags: readonly string[]
  data?: TopologyData
}

export interface TopologyGraphNodeSnapshot {
  id: string
  layerId: string
  position: TopologyGraphPoint
  connectorId?: string
  label?: string
  kind?: string
  subtype?: string
  tags: readonly string[]
  data?: TopologyData
}

/** 网络边的流动方向始终以 edge.source / edge.target 为基准。 */
export type TopologyEdgeFlowDirection = 'FORWARD' | 'REVERSE' | 'BOTH'

/** 网络边的流动动画配置；只影响视觉，不影响寻路。 */
export interface TopologyEdgeFlowStyle {
  active: boolean
  direction?: TopologyEdgeFlowDirection
  /** 图坐标单位/秒。 */
  speed?: number
  /** 相邻流动点的图坐标距离。 */
  spacing?: number
  color?: TopologyGraphColor
  /** 流动点半径。 */
  size?: number
}

/** 单条网络边的视觉状态。 */
export interface TopologyEdgeVisualState {
  visible: boolean
  color: TopologyGraphColor
  /** 世界坐标直径。 */
  width: number
  opacity: number
  depthTest: boolean
  flow: TopologyEdgeFlowStyle | null
}

/** 单条边的有效寻路状态。 */
export interface TopologyEdgeRoutingState {
  enabled: boolean
  blockerIds: readonly string[]
  /** enabled=true 且 blockerIds 为空。 */
  traversable: boolean
  weightOverride: number | null
  effectiveWeight: number
}

export interface TopologyGraphEdgeSnapshot {
  id: string
  source: string
  target: string
  relation: TopologyEdgeRelation
  direction: TopologyEdgeDirection
  path: TopologyPolylineInput
  /** 根据 source.position + via + target.position 计算，调用方不能写入。 */
  length: number
  baseWeight: number
  routingState: TopologyEdgeRoutingState
  visualState: TopologyEdgeVisualState
  mode?: string
  tags: readonly string[]
  data?: TopologyData
}

/** 可序列化、与内部 Map 和 Three.js 对象分离的图快照。 */
export interface TopologyGraphSnapshot {
  schemaVersion: 2
  id: string
  routingRevision: number
  visualRevision: number
  layers: readonly TopologyLayerSnapshot[]
  nodes: readonly TopologyGraphNodeSnapshot[]
  edges: readonly TopologyGraphEdgeSnapshot[]
  tags: readonly string[]
  data?: TopologyData
}

/** 批量选择若干稳定 edge ID，或明确选择整张图。 */
export type TopologyEdgeSelector =
  | { edgeIds: readonly string[] }
  | { all: true }

/**
 * 寻路状态补丁。
 * blockerIds 是全量替换；add/remove 用于增量更新，不能与 blockerIds 同时出现。
 */
export interface TopologyEdgeRoutingStatePatch {
  enabled?: boolean
  /** number 设置覆盖；null 清除覆盖；undefined 不修改。 */
  weightOverride?: number | null
  blockerIds?: readonly string[]
  addBlockerIds?: readonly string[]
  removeBlockerIds?: readonly string[]
}

/** 网络边视觉补丁。flow=null 表示停止流动。 */
export interface TopologyEdgeVisualStatePatch {
  visible?: boolean
  color?: TopologyGraphColor
  width?: number
  opacity?: number
  depthTest?: boolean
  flow?: TopologyEdgeFlowStyle | null
}

export interface TopologyRevisionGuard {
  expectedRevision?: number
}

export type TopologyMutationFailureCode =
  | 'GRAPH_NOT_FOUND'
  | 'EDGE_NOT_FOUND'
  | 'REVISION_CONFLICT'

export type TopologyRoutingMutationResult =
  | {
      ok: true
      changed: boolean
      routingRevision: number
      edges: readonly TopologyGraphEdgeSnapshot[]
      invalidatedRouteIds: readonly string[]
    }
  | {
      ok: false
      code: TopologyMutationFailureCode
      edgeId?: string
      currentRevision?: number
    }

export type TopologyVisualMutationResult =
  | {
      ok: true
      changed: boolean
      visualRevision: number
      edges: readonly TopologyGraphEdgeSnapshot[]
    }
  | {
      ok: false
      code: TopologyMutationFailureCode
      edgeId?: string
      currentRevision?: number
    }

/** 每个 requirement 是“任意一个节点”；多个 requirement 之间是 AND。 */
export interface TopologyVisitRequirement {
  anyOfNodeIds: readonly string[]
}

/** 精确约束最短路查询；当前实现使用带 requirement bitmask 的 Dijkstra。 */
export interface TopologyPathQuery {
  graphId: string
  startNodeId: string
  goalNodeId: string
  requirements?: readonly TopologyVisitRequirement[]
  /** 对 opaque edge.mode 做精确字符串过滤，不解释其业务含义。 */
  allowedModes?: readonly string[]
  excludedNodeIds?: readonly string[]
  excludedEdgeIds?: readonly string[]
  maxWeight?: number
  expectedRoutingRevision?: number
}

export type TopologyTraversalDirection = 'FORWARD' | 'REVERSE'

/** 路径中的一步；points 已按实际行进方向排列。 */
export interface TopologyRouteStep {
  edgeId: string
  fromNodeId: string
  toNodeId: string
  fromLayerId: string
  toLayerId: string
  relation: TopologyEdgeRelation
  traversalDirection: TopologyTraversalDirection
  points: readonly TopologyGraphPoint[]
  length: number
  weight: number
  mode?: string
}

/** findPath 成功后返回的自包含路线值对象。 */
export interface TopologyRouteSnapshot {
  graphId: string
  graphRoutingRevision: number
  startNodeId: string
  goalNodeId: string
  selectedRequirementNodeIds: readonly string[]
  nodeIds: readonly string[]
  layerIds: readonly string[]
  steps: readonly TopologyRouteStep[]
  flattenedPoints: readonly TopologyGraphPoint[]
  totalLength: number
  totalWeight: number
}

export interface TopologyPathStats {
  algorithm: 'CONSTRAINED_DIJKSTRA'
  visitedStateCount: number
  durationMs: number
}

export type TopologyPathFailureCode =
  | 'GRAPH_NOT_FOUND'
  | 'START_NOT_FOUND'
  | 'GOAL_NOT_FOUND'
  | 'REQUIREMENT_NODE_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'NO_PATH'
  | 'NO_PATH_SATISFYING_REQUIREMENTS'
  | 'NO_PATH_WITHIN_WEIGHT'

export type TopologyPathResult =
  | { ok: true; route: TopologyRouteSnapshot; stats: TopologyPathStats }
  | {
      ok: false
      code: TopologyPathFailureCode
      message: string
      requirementIndex?: number
      currentRevision?: number
    }

/** 路线主体样式；route flow 始终沿实际 route step 方向。 */
export interface TopologyRouteStyle {
  color?: TopologyGraphColor
  width?: number
  opacity?: number
  depthTest?: boolean
}

export interface TopologyRouteFlowStyle {
  active?: boolean
  speed?: number
  spacing?: number
  color?: TopologyGraphColor
  size?: number
}

export interface TopologyRouteRenderOptions {
  route: TopologyRouteSnapshot
  visible?: boolean
  position?: TopologyGraphPoint
  style?: TopologyRouteStyle
  edgeStyles?: Readonly<Record<string, TopologyRouteStyle>>
  modeStyles?: Readonly<Record<string, TopologyRouteStyle>>
  flow?: TopologyRouteFlowStyle | null
  /** 默认 REJECT；SNAPSHOT 明确允许渲染旧 revision 的自包含几何。 */
  stalePolicy?: 'REJECT' | 'SNAPSHOT'
}

export type TopologyRouteStatus = 'ACTIVE' | 'HIDDEN' | 'STALE' | 'DISPOSED'

/** renderer 持有的路线句柄；生命周期操作仍通过原子 API 完成。 */
export interface TopologyRouteHandle {
  readonly id: string
  readonly root: THREE.Group
  readonly route: TopologyRouteSnapshot
  readonly status: TopologyRouteStatus
}

export type TopologyRouteRenderResult =
  | { rendered: true; handle: TopologyRouteHandle }
  | {
      rendered: false
      code: 'GRAPH_NOT_FOUND' | 'STALE_ROUTE'
      currentRevision?: number
    }

/** route 视觉状态补丁；不改变图的 routing revision。 */
export interface TopologyRouteVisualStatePatch extends TopologyRouteStyle {
  visible?: boolean
  flow?: TopologyRouteFlowStyle | null
}

/** topology v2 的纯数据图原子 API。 */
export interface TopologyGraphApi {
  createGraph(input: TopologyGraphInput): TopologyGraphSnapshot
  getGraph(id: string): TopologyGraphSnapshot | null
  listGraphs(): TopologyGraphSnapshot[]
  removeGraph(id: string): boolean
  removeAllGraphs(): number
  setEdgeRoutingState(
    graphId: string,
    selector: TopologyEdgeSelector,
    patch: TopologyEdgeRoutingStatePatch,
    guard?: TopologyRevisionGuard,
  ): TopologyRoutingMutationResult
  setEdgeVisualState(
    graphId: string,
    selector: TopologyEdgeSelector,
    patch: TopologyEdgeVisualStatePatch,
    guard?: TopologyRevisionGuard,
  ): TopologyVisualMutationResult
  findPath(query: TopologyPathQuery): TopologyPathResult
}

/** topology v2 的 Three.js 路线原子 API。 */
export interface TopologyRouteApi {
  renderRoute(options: TopologyRouteRenderOptions): TopologyRouteRenderResult
  setRouteVisualState(id: string, patch: TopologyRouteVisualStatePatch): boolean
  showRoute(id: string): boolean
  hideRoute(id: string): boolean
  getRouteById(id: string): TopologyRouteHandle | null
  listRoutes(): TopologyRouteHandle[]
  removeRoute(id: string): boolean
  removeAllRoutes(): number
}

export type TopologyErrorCode =
  | 'INVALID_ARGUMENT'
  | 'DUPLICATE_ID'
  | 'BROKEN_REFERENCE'
  | 'INVALID_GRAPH'
  | 'LIMIT_EXCEEDED'
  | 'CONTEXT_UNAVAILABLE'
  | 'RENDER_FAILED'

/** 输入/容量/渲染错误；正常的“无路线”使用 TopologyPathResult 表达。 */
export class TopologyError extends Error {
  readonly name = 'TopologyError'

  constructor(
    readonly code: TopologyErrorCode,
    message: string,
    readonly path?: string,
    readonly details?: TopologyData,
  ) {
    super(`[ssp.topologyTool] ${message}`)
  }
}
