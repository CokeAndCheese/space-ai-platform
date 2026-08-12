/**
 * topologyTool — 轻量 3D 拓扑图管理
 *
 * 用途: 把调用方显式提供的 nodes + edges 布局并渲染到当前 Three.js 场景。
 *
 * 设计原则 (Narrow Waist):
 *   - 只接收通用图数据,不解析 BIM SID,不推断业务连接关系
 *   - 只依赖 three + core/context,不调用其他 SSP controller
 *   - 模型查询、高亮、相机联动由模板/应用层组合
 *   - 每个 createTopologyTool() 都是独立 manager,记录和资源状态保存在自身闭包
 *   - 先完成输入校验和布局计算,再创建场景对象 / GPU 资源
 *   - 单图最多 200 节点 / 500 边,单个 manager 最多 400 个活动节点
 *
 * 渲染结构:
 *   - root: 每张图一个 THREE.Group,名字为 topology_N
 *   - node: 每个节点一个 Sprite + CanvasTexture
 *   - edge: 每张图共用一个 LineSegments,通过 vertexColors 表示边颜色
 *
 * API:
 *   - create(opts)   创建拓扑图,返回 TopologyHandle
 *   - show(id)       显示当前场景中的拓扑图
 *   - hide(id)       隐藏当前场景中的拓扑图
 *   - getById(id)    按 id 查询当前场景中的拓扑图
 *   - list()         列出当前场景中的拓扑图
 *   - remove(id)     删除指定拓扑图并释放资源
 *   - removeAll()    删除 manager 持有的全部拓扑图
 *
 * 路网 v2 API（与以上静态图兼容层并存）:
 *   - createGraph / getGraph / listGraphs / removeGraph / removeAllGraphs
 *   - setEdgeRoutingState / setEdgeVisualState / findPath
 *   - renderRoute / setRouteVisualState / showRoute / hideRoute
 *   - getRouteById / listRoutes / removeRoute / removeAllRoutes
 *
 * 对应模板:
 *   - src/templates/ssp_templates/topology/createTopology.json
 *   - src/templates/ssp_templates/topology/showTopology.json
 *   - src/templates/ssp_templates/topology/hideTopology.json
 *   - src/templates/ssp_templates/topology/getTopologyById.json
 *   - src/templates/ssp_templates/topology/listTopologies.json
 *   - src/templates/ssp_templates/topology/removeTopology.json
 *   - src/templates/ssp_templates/topology/removeAllTopologies.json
 */

import * as THREE from 'three'
import { getSspContext } from '../core/context'
import type { TopologyGraphApi, TopologyRouteApi } from './types'
import { createGraphManager } from './internal/graphManager'
import { createTopologyRenderer } from './internal/renderer'

export * from './types'

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

/** 拓扑颜色 — CSS/hex 字符串或 0x000000-0xffffff 数字。 */
export type TopologyColor = string | number

/** 轻量世界坐标,避免把 THREE.Vector3 暴露为必需输入。 */
export interface TopologyPoint {
  /** X 轴坐标。 */
  x: number
  /** Y 轴坐标。 */
  y: number
  /** Z 轴坐标。 */
  z: number
}

/**
 * 拓扑节点输入。
 *   id       图内唯一 id,同时写入 Sprite.userData
 *   label    节点显示文字,默认使用 id
 *   position manual 布局的节点坐标
 *   color    节点卡片背景色
 *   data     透传业务数据,topologyTool 不解释
 */
export interface TopologyNode {
  /** 图内唯一 ID。 */
  id: string
  /** 显示文字,默认使用 id。 */
  label?: string
  /** manual 布局时必填。 */
  position?: TopologyPoint
  /** 节点背景色。 */
  color?: TopologyColor
  /** 工具不解释的透明业务数据。 */
  data?: Readonly<Record<string, unknown>>
}

/** 一条有向边；source / target 必须引用同一 options.nodes 中的节点 id。 */
export interface TopologyEdge {
  /** 起点节点 id。 */
  source: string
  /** 终点节点 id。 */
  target: string
  /** 边颜色,默认青色。 */
  color?: TopologyColor
}

/**
 * 布局配置。
 *   manual       完全使用 node.position (每个节点必填)
 *   grid         按输入顺序排成居中网格 (columns 默认 sqrt,gap 默认 6)
 *   hierarchical 对 DAG 做拓扑排序后按 rank 分层 (默认 top-down,间距 6)
 */
export type TopologyLayout =
  | { type: 'manual' }
  | { type: 'grid'; columns?: number; gap?: number }
  | {
      type: 'hierarchical'
      direction?: 'top-down' | 'left-right'
      rankGap?: number
      nodeGap?: number
    }

/** 创建拓扑图的完整输入。 */
export interface TopologyOptions {
  /** 节点数组,至少 1 个,单图最多 200 个。 */
  nodes: ReadonlyArray<TopologyNode>
  /** 边数组,允许为空,单图最多 500 条。 */
  edges: ReadonlyArray<TopologyEdge>
  /** 默认 grid。 */
  layout?: TopologyLayout
  /** 整张图的世界坐标,默认原点。 */
  position?: TopologyPoint
  /** 初始是否可见,默认 true。 */
  visible?: boolean
}

/**
 * create() 返回的拓扑句柄。
 * root 允许高级调用方调整整图 transform / parent；资源所有权仍属于 manager。
 */
export interface TopologyHandle {
  /** manager 自动生成的 topology_N id。 */
  readonly id: string
  /** 整张拓扑图的根 Group。 */
  readonly root: THREE.Group
  /** 幂等销毁。 */
  destroy(): void
}

/** TopologyTool 公开接口 — 创建(1) / 可见性(2) / 查询(2) / 清理(2)。 */
export interface TopologyTool extends TopologyGraphApi, TopologyRouteApi {
  /** 创建并挂载拓扑图；非法输入直接抛错,不留下场景对象。 */
  create(opts: TopologyOptions): TopologyHandle
  /** 显示当前 context 中的拓扑图；不存在或不属于当前场景时返回 false。 */
  show(id: string): boolean
  /** 隐藏当前 context 中的拓扑图；不存在或不属于当前场景时返回 false。 */
  hide(id: string): boolean
  /** 查询当前 context 中仍挂在 scene 下的拓扑图。 */
  getById(id: string): TopologyHandle | null
  /** 列出当前 context 中仍挂在 scene 下的全部拓扑图。 */
  list(): TopologyHandle[]
  /** 按 id 删除 manager 已知记录并释放资源；不存在时返回 false。 */
  remove(id: string): boolean
  /** 删除 manager 持有的全部记录；返回实际处理的记录数。 */
  removeAll(): number
}

// ---------------------------------------------------------------------------
// 内部状态类型
// ---------------------------------------------------------------------------

/** 校验并补齐默认值后的节点；后续布局/渲染只读取该类型。 */
interface NormalizedNode {
  id: string
  label: string
  position?: TopologyPoint
  color: TopologyColor
  data?: Readonly<Record<string, unknown>>
}

/** 已确认端点存在、颜色合法的内部边。 */
interface NormalizedEdge {
  source: string
  target: string
  color: TopologyColor
}

/** 经过完整正规化的 create 输入。 */
interface NormalizedOptions {
  nodes: NormalizedNode[]
  edges: NormalizedEdge[]
  layout: TopologyLayout
  position: TopologyPoint
  visible: boolean
}

/**
 * manager 内部记录。
 *   scene      创建时所属场景,用于阻止跨 context 误操作
 *   resources  manager 拥有并负责 dispose 的 GPU 资源
 *   nodeCount  manager 总节点预算计数
 *   onRemoved  root 脱离场景后的延迟清理监听器
 *   disposed   幂等销毁标记
 */
interface TopologyRecord {
  id: string
  scene: THREE.Scene
  root: THREE.Group
  handle: TopologyHandle
  resources: Set<{ dispose(): void }>
  nodeCount: number
  onRemoved: () => void
  disposed: boolean
}

// ---------------------------------------------------------------------------
// 限制与渲染默认值
// ---------------------------------------------------------------------------

/** 单张图输入上限,避免一次 create 生成过多 Object3D / buffer。 */
const MAX_NODES = 200
const MAX_EDGES = 500
/** 单个 manager 的活动节点总预算,限制多图累计纹理占用。 */
const MAX_TOTAL_NODES = 400
/** 文本上限既控制 metadata 体积,也限制 canvas 测量成本。 */
const MAX_NODE_ID_LENGTH = 128
const MAX_LABEL_LENGTH = 256
/** 未显式传色时的节点/边颜色。 */
const DEFAULT_NODE_COLOR = '#1677ff'
const DEFAULT_EDGE_COLOR = '#67e8f9'
/** Sprite 的世界空间尺寸。 */
const NODE_WIDTH = 5
const NODE_HEIGHT = 1.8
/** 每节点纹理尺寸；关闭 mipmap 后兼顾清晰度与 demo 内存。 */
const TEXTURE_WIDTH = 256
const TEXTURE_HEIGHT = 96

/** 自动 id 计数器 (topology_1, topology_2, ...),module 级单调递增。 */
let nextTopologyId = 1

// ---------------------------------------------------------------------------
// 输入校验与正规化
// ---------------------------------------------------------------------------

/** 统一构造带 namespace 的参数错误。 */
function invalid(message: string): Error {
  return new Error(`[ssp.topologyTool] ${message}`)
}

/** unknown → 普通对象的运行时类型守卫。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验有限数值,统一带上字段路径。 */
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${path} must be a finite number`)
  }
  return value
}

/** 校验大于 0 的有限数值。 */
function positive(value: unknown, path: string): number {
  const result = finite(value, path)
  if (result <= 0) throw invalid(`${path} must be greater than 0`)
  return result
}

/** 校验并复制 {x,y,z},不保留调用方对象引用。 */
function point(value: unknown, path: string): TopologyPoint {
  if (!isRecord(value)) throw invalid(`${path} must be an object`)
  return {
    x: finite(value.x, `${path}.x`),
    y: finite(value.y, `${path}.y`),
    z: finite(value.z, `${path}.z`),
  }
}

/** 校验 topology v1 支持的颜色输入。 */
function color(value: unknown, path: string): TopologyColor {
  if (typeof value === 'string' && value.trim()) return value
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffff
  ) {
    return value
  }
  throw invalid(`${path} must be a non-empty color string or an integer from 0 to 0xffffff`)
}

/**
 * 正规化布局配置并补齐默认类型。
 * 只接受 manual / grid / hierarchical；各布局的正数参数在这里统一校验。
 */
function normalizeLayout(value: unknown): TopologyLayout {
  if (value === undefined) return { type: 'grid' }
  if (!isRecord(value)) throw invalid('layout must be an object')

  if (value.type === 'manual') return { type: 'manual' }

  if (value.type === 'grid') {
    let columns: number | undefined
    if (value.columns !== undefined) {
      columns = finite(value.columns, 'layout.columns')
      if (!Number.isInteger(columns) || columns <= 0) {
        throw invalid('layout.columns must be a positive integer')
      }
    }
    return {
      type: 'grid',
      columns,
      gap: value.gap === undefined ? undefined : positive(value.gap, 'layout.gap'),
    }
  }

  if (value.type === 'hierarchical') {
    if (
      value.direction !== undefined &&
      value.direction !== 'top-down' &&
      value.direction !== 'left-right'
    ) {
      throw invalid('layout.direction must be "top-down" or "left-right"')
    }
    return {
      type: 'hierarchical',
      direction: value.direction as 'top-down' | 'left-right' | undefined,
      rankGap: value.rankGap === undefined ? undefined : positive(value.rankGap, 'layout.rankGap'),
      nodeGap: value.nodeGap === undefined ? undefined : positive(value.nodeGap, 'layout.nodeGap'),
    }
  }

  throw invalid('layout.type must be "manual", "grid", or "hierarchical"')
}

/**
 * create() 的完整运行时校验入口。
 * 校验容量、唯一 id、边端点、文本长度、坐标、颜色和布局约束,
 * 并把后续阶段需要的所有默认值补齐。
 */
function normalizeOptions(value: unknown): NormalizedOptions {
  if (!isRecord(value)) throw invalid('options must be an object')
  if (!Array.isArray(value.nodes)) throw invalid('nodes must be an array')
  if (!Array.isArray(value.edges)) throw invalid('edges must be an array')
  if (value.nodes.length === 0) throw invalid('nodes must contain at least one node')
  if (value.nodes.length > MAX_NODES) throw invalid(`nodes exceeds the ${MAX_NODES} node limit`)
  if (value.edges.length > MAX_EDGES) throw invalid(`edges exceeds the ${MAX_EDGES} edge limit`)

  const ids = new Set<string>()
  const nodes = value.nodes.map((raw, index): NormalizedNode => {
    const path = `nodes[${index}]`
    if (!isRecord(raw)) throw invalid(`${path} must be an object`)
    if (typeof raw.id !== 'string' || !raw.id.trim()) {
      throw invalid(`${path}.id must be a non-empty string`)
    }
    const id = raw.id.trim()
    if (id.length > MAX_NODE_ID_LENGTH) {
      throw invalid(`${path}.id must be at most ${MAX_NODE_ID_LENGTH} characters`)
    }
    if (ids.has(id)) throw invalid(`duplicate node id "${id}"`)
    ids.add(id)
    if (raw.label !== undefined && typeof raw.label !== 'string') {
      throw invalid(`${path}.label must be a string`)
    }
    if (typeof raw.label === 'string' && raw.label.length > MAX_LABEL_LENGTH) {
      throw invalid(`${path}.label must be at most ${MAX_LABEL_LENGTH} characters`)
    }
    if (raw.data !== undefined && !isRecord(raw.data)) {
      throw invalid(`${path}.data must be an object`)
    }
    return {
      id,
      label: raw.label ?? id,
      position: raw.position === undefined ? undefined : point(raw.position, `${path}.position`),
      color: raw.color === undefined ? DEFAULT_NODE_COLOR : color(raw.color, `${path}.color`),
      data: raw.data as Readonly<Record<string, unknown>> | undefined,
    }
  })

  const edges = value.edges.map((raw, index): NormalizedEdge => {
    const path = `edges[${index}]`
    if (!isRecord(raw)) throw invalid(`${path} must be an object`)
    if (typeof raw.source !== 'string' || !raw.source.trim()) {
      throw invalid(`${path}.source must be a non-empty string`)
    }
    if (typeof raw.target !== 'string' || !raw.target.trim()) {
      throw invalid(`${path}.target must be a non-empty string`)
    }
    const source = raw.source.trim()
    const target = raw.target.trim()
    if (source.length > MAX_NODE_ID_LENGTH || target.length > MAX_NODE_ID_LENGTH) {
      throw invalid(`${path} endpoints must be at most ${MAX_NODE_ID_LENGTH} characters`)
    }
    if (!ids.has(source)) throw invalid(`${path}.source references missing node "${source}"`)
    if (!ids.has(target)) throw invalid(`${path}.target references missing node "${target}"`)
    return {
      source,
      target,
      color: raw.color === undefined ? DEFAULT_EDGE_COLOR : color(raw.color, `${path}.color`),
    }
  })

  const layout = normalizeLayout(value.layout)
  if (layout.type === 'manual') {
    nodes.forEach((node, index) => {
      if (!node.position) throw invalid(`nodes[${index}].position is required for manual layout`)
    })
  }
  if (value.visible !== undefined && typeof value.visible !== 'boolean') {
    throw invalid('visible must be a boolean')
  }

  return {
    nodes,
    edges,
    layout,
    position: value.position === undefined ? { x: 0, y: 0, z: 0 } : point(value.position, 'position'),
    visible: value.visible ?? true,
  }
}

// ---------------------------------------------------------------------------
// 布局算法
// ---------------------------------------------------------------------------

/** manual: 直接把每个 node.position 转为独立 Vector3。 */
function manualPositions(options: NormalizedOptions): Map<string, THREE.Vector3> {
  return new Map(options.nodes.map((node) => {
    const position = node.position!
    return [node.id, new THREE.Vector3(position.x, position.y, position.z)]
  }))
}

/**
 * grid: 按 nodes 输入顺序逐行排布。
 * 默认列数为 ceil(sqrt(nodeCount)),最后一行按自身节点数单独居中。
 */
function gridPositions(
  options: NormalizedOptions,
  layout: Extract<TopologyLayout, { type: 'grid' }>,
): Map<string, THREE.Vector3> {
  const count = options.nodes.length
  const columns = Math.min(layout.columns ?? Math.ceil(Math.sqrt(count)), count)
  const rows = Math.ceil(count / columns)
  const gap = layout.gap ?? 6
  const result = new Map<string, THREE.Vector3>()

  options.nodes.forEach((node, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const inRow = Math.min(columns, count - row * columns)
    result.set(node.id, new THREE.Vector3(
      (column - (inRow - 1) / 2) * gap,
      ((rows - 1) / 2 - row) * gap,
      0,
    ))
  })
  return result
}

/**
 * hierarchical: 使用 Kahn 拓扑排序给 DAG 计算 rank。
 *   - 同 rank 节点保持原始 nodes 顺序,保证同一输入得到确定性布局
 *   - top-down 沿 Y 轴分层,left-right 沿 X 轴分层
 *   - 无法消费全部节点说明存在有向环,直接抛错
 */
function hierarchicalPositions(
  options: NormalizedOptions,
  layout: Extract<TopologyLayout, { type: 'hierarchical' }>,
): Map<string, THREE.Vector3> {
  const indegree = new Map(options.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(options.nodes.map((node) => [node.id, [] as string[]]))
  const ranks = new Map(options.nodes.map((node) => [node.id, 0]))

  for (const edge of options.edges) {
    outgoing.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, indegree.get(edge.target)! + 1)
  }

  const queue = options.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]
    for (const target of outgoing.get(source)!) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(source)! + 1))
      const remaining = indegree.get(target)! - 1
      indegree.set(target, remaining)
      if (remaining === 0) queue.push(target)
    }
  }
  if (queue.length !== options.nodes.length) {
    throw invalid('hierarchical layout requires a directed acyclic graph')
  }

  const byRank = new Map<number, NormalizedNode[]>()
  for (const node of options.nodes) {
    const rank = ranks.get(node.id)!
    const row = byRank.get(rank) ?? []
    row.push(node)
    byRank.set(rank, row)
  }

  const rankGap = layout.rankGap ?? 6
  const nodeGap = layout.nodeGap ?? 6
  const rankCount = Math.max(...byRank.keys()) + 1
  const result = new Map<string, THREE.Vector3>()

  for (const [rank, nodes] of byRank) {
    nodes.forEach((node, index) => {
      const alongRank = (index - (nodes.length - 1) / 2) * nodeGap
      const betweenRanks = ((rankCount - 1) / 2 - rank) * rankGap
      result.set(
        node.id,
        layout.direction === 'left-right'
          ? new THREE.Vector3(-betweenRanks, -alongRank, 0)
          : new THREE.Vector3(alongRank, betweenRanks, 0),
      )
    })
  }
  return result
}

/** 按正规化后的 layout.type 路由到唯一布局实现。 */
function layoutPositions(options: NormalizedOptions): Map<string, THREE.Vector3> {
  if (options.layout.type === 'manual') return manualPositions(options)
  if (options.layout.type === 'grid') return gridPositions(options, options.layout)
  return hierarchicalPositions(options, options.layout)
}

// ---------------------------------------------------------------------------
// 渲染与资源 helper
// ---------------------------------------------------------------------------

/** 数字颜色转为 Canvas2D 可识别的 #rrggbb；字符串原样透传。 */
function colorCss(value: TopologyColor): string {
  return typeof value === 'number' ? `#${value.toString(16).padStart(6, '0')}` : value
}

/**
 * 用二分查找截断过宽 label,避免逐字符 measureText 的二次方成本。
 * 返回值只用于 canvas 绘制,不会修改原始 node.label。
 */
function fitLabel(context: CanvasRenderingContext2D, label: string, maxWidth: number): string {
  if (context.measureText(label).width <= maxWidth) return label
  let low = 0
  let high = label.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(`${label.slice(0, middle)}…`).width <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${label.slice(0, low)}…`
}

/**
 * 为一个节点创建文字卡片 CanvasTexture。
 * 纹理关闭 mipmap 并使用线性过滤；所有权交给 buildRoot 的 resources Set。
 */
function nodeTexture(node: NormalizedNode): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_WIDTH
  canvas.height = TEXTURE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw invalid('Canvas 2D context is unavailable')

  context.fillStyle = colorCss(node.color)
  context.beginPath()
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 12)
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = '600 24px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(fitLabel(context, node.label, canvas.width - 16), canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

/**
 * best-effort 释放资源集合。
 * 单个 dispose 监听器抛错不会阻断后续资源；每项最终都从 Set 删除。
 */
function dispose(resources: Set<{ dispose(): void }>): void {
  for (const resource of Array.from(resources)) {
    try {
      resource.dispose()
    } catch (error) {
      console.warn('[ssp.topologyTool] resource cleanup failed', error)
    } finally {
      resources.delete(resource)
    }
  }
}

/** 判断 object 当前是否仍在 ancestor 子树中 (包含 object === ancestor)。 */
function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

/**
 * 构建一张拓扑图的完整 Three.js 子树。
 *   - 边统一写入一份 BufferGeometry + LineSegments
 *   - 每个节点创建一个 Sprite
 *   - 任何步骤失败都会清空 root 并释放已创建资源
 * 此函数只构建,不把 root 加到 scene。
 */
function buildRoot(
  id: string,
  options: NormalizedOptions,
  positions: Map<string, THREE.Vector3>,
): { root: THREE.Group; resources: Set<{ dispose(): void }> } {
  const root = new THREE.Group()
  const resources = new Set<{ dispose(): void }>()
  root.name = id
  root.userData.__sspTopology = true

  try {
    const edgePositions = new Float32Array(options.edges.length * 6)
    const edgeColors = new Float32Array(options.edges.length * 6)
    options.edges.forEach((edge, index) => {
      const source = positions.get(edge.source)!
      const target = positions.get(edge.target)!
      const edgeColor = new THREE.Color(edge.color)
      const offset = index * 6
      edgePositions.set([source.x, source.y, source.z, target.x, target.y, target.z], offset)
      edgeColors.set(
        [edgeColor.r, edgeColor.g, edgeColor.b, edgeColor.r, edgeColor.g, edgeColor.b],
        offset,
      )
    })

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3))
    resources.add(geometry)
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
    })
    resources.add(lineMaterial)
    const lines = new THREE.LineSegments(geometry, lineMaterial)
    lines.name = `${id}_edges`
    lines.renderOrder = 900
    root.add(lines)

    for (const node of options.nodes) {
      const texture = nodeTexture(node)
      resources.add(texture)
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
      resources.add(material)
      const sprite = new THREE.Sprite(material)
      sprite.name = `${id}_node_${node.id}`
      sprite.position.copy(positions.get(node.id)!)
      sprite.scale.set(NODE_WIDTH, NODE_HEIGHT, 1)
      sprite.renderOrder = 901
      sprite.userData.__sspTopologyNodeId = node.id
      if (node.data) sprite.userData.__sspTopologyData = node.data
      root.add(sprite)
    }

    root.position.set(options.position.x, options.position.y, options.position.z)
    root.visible = options.visible
    return { root, resources }
  } catch (error) {
    root.clear()
    dispose(resources)
    throw error
  }
}

// ---------------------------------------------------------------------------
// 工厂与生命周期
// ---------------------------------------------------------------------------

/**
 * 创建一个独立 topology manager。
 *
 * 状态与所有权:
 *   - records Map 只属于当前 factory 实例
 *   - manager 拥有 create 产生的 root / geometry / material / texture
 *   - 查询和显隐只对当前 SSP context 且仍在原 scene 子树中的记录生效
 *   - destroy/remove/removeAll 都走同一幂等释放路径
 */
export function createTopologyTool(): TopologyTool {
  /** topology id → 内部记录；不暴露给调用方。 */
  const records = new Map<string, TopologyRecord>()
  /** v2 纯数据图 manager；不依赖 Three.js context。 */
  const graphManager = createGraphManager()
  /** v2 edge / route renderer；只通过 graph manager 的生命周期窄口协作。 */
  const topologyRenderer = createTopologyRenderer(graphManager)
  graphManager.setHooks({
    invalidateRoutes: topologyRenderer.invalidateRoutes,
    syncEdgeVisuals: topologyRenderer.syncEdgeVisuals,
    removeGraphVisuals: topologyRenderer.removeGraphVisuals,
  })

  // ===== 记录生命周期 =====

  /**
   * 幂等销毁一条记录。
   * 先停 removed 监听,再尝试脱离 root/children,最后 best-effort 释放全部资源。
   */
  function disposeRecord(record: TopologyRecord): void {
    if (record.disposed) return
    record.disposed = true
    record.root.removeEventListener('removed', record.onRemoved)
    try {
      record.root.removeFromParent()
    } catch (error) {
      console.warn('[ssp.topologyTool] root detach failed', error)
    }
    for (const child of [...record.root.children]) {
      try {
        record.root.remove(child)
      } catch (error) {
        console.warn('[ssp.topologyTool] child detach failed', error)
      }
    }
    dispose(record.resources)
  }

  /** 先从 registry 删除,再释放记录；handle.destroy() 和 remove() 共用。 */
  function removeRecord(record: TopologyRecord): void {
    if (records.get(record.id) === record) records.delete(record.id)
    disposeRecord(record)
  }

  /**
   * 判断记录是否属于当前可操作场景。
   * 只读 API 用该过滤器避免把旧 context 或已脱离 scene 的 root 返回给上层。
   */
  function isCurrentRecord(record: TopologyRecord): boolean {
    if (record.disposed || !isDescendantOf(record.root, record.scene)) return false
    try {
      return getSspContext().scene === record.scene
    } catch {
      return false
    }
  }

  // ===== 公开 API 实现 =====

  /**
   * 创建并挂载一张拓扑图。
   *
   * 顺序保证:
   *   1. 校验输入并计算布局 (失败时 scene 零修改)
   *   2. 回收旧 context / 已脱离 scene 的记录
   *   3. 检查 manager 400 活动节点总预算
   *   4. 构建 root 和 GPU 资源
   *   5. add 到当前 scene 并登记 record
   *
   * @throws 输入非法、hierarchical 存在环、超过容量或 context 未初始化
   */
  function create(opts: TopologyOptions): TopologyHandle {
    // 校验与布局先完成,失败时不修改 scene 或创建 GPU 资源。
    const options = normalizeOptions(opts)
    const positions = layoutPositions(options)
    const { scene } = getSspContext()

    // manager 只服务当前 context；新场景首次创建时回收旧场景记录。
    for (const record of Array.from(records.values())) {
      if (record.scene !== scene || !isDescendantOf(record.root, record.scene)) removeRecord(record)
    }
    const activeNodeCount = Array.from(records.values()).reduce(
      (count, record) => count + (isCurrentRecord(record) ? record.nodeCount : 0),
      0,
    )
    if (activeNodeCount + options.nodes.length > MAX_TOTAL_NODES) {
      throw invalid(`active topologies exceed the ${MAX_TOTAL_NODES} total node limit`)
    }

    const id = `topology_${nextTopologyId++}`
    const built = buildRoot(id, options, positions)

    let record!: TopologyRecord
    const onRemoved = (): void => {
      // 延后一轮微任务: 允许 Three.js 在同一同步调用中完成 remove → add 重挂载,
      // 仅当 root 到微任务执行时仍不在原 scene 子树中才真正销毁。
      queueMicrotask(() => {
        if (!record.disposed && !isDescendantOf(record.root, record.scene)) removeRecord(record)
      })
    }
    const handle: TopologyHandle = {
      id,
      root: built.root,
      destroy: () => removeRecord(record),
    }
    record = {
      id,
      scene,
      root: built.root,
      handle,
      resources: built.resources,
      nodeCount: options.nodes.length,
      onRemoved,
      disposed: false,
    }

    try {
      record.root.addEventListener('removed', record.onRemoved)
      scene.add(record.root)
      records.set(id, record)
      return handle
    } catch (error) {
      disposeRecord(record)
      throw error
    }
  }

  /** show/hide 的统一实现；只修改 root.visible。 */
  function setVisible(id: string, visible: boolean): boolean {
    const record = records.get(id)
    if (!record || !isCurrentRecord(record)) return false
    record.root.visible = visible
    return true
  }

  /** 按 id 查询当前 context 中仍有效的只读 handle。 */
  function getById(id: string): TopologyHandle | null {
    const record = records.get(id)
    return record && isCurrentRecord(record) ? record.handle : null
  }

  /** 列出当前 context 中的有效 handle,保持 create 的登记顺序。 */
  function list(): TopologyHandle[] {
    return Array.from(records.values())
      .filter(isCurrentRecord)
      .map((record) => record.handle)
  }

  /** 删除 manager 已知 id；即使记录已不属于当前 context 也允许显式回收。 */
  function remove(id: string): boolean {
    const record = records.get(id)
    if (!record) return false
    removeRecord(record)
    return true
  }

  /** 清空 manager 的全部记录 (包括旧 context 记录),返回清理前数量。 */
  function removeAll(): number {
    const active = Array.from(records.values())
    for (const record of active) removeRecord(record)
    return active.length
  }

  return {
    /** 创建拓扑图 — 见 create */
    create,
    /** 显示拓扑图 — 见 setVisible */
    show: (id) => setVisible(id, true),
    /** 隐藏拓扑图 — 见 setVisible */
    hide: (id) => setVisible(id, false),
    /** 按 id 查询 — 见 getById */
    getById,
    /** 列出当前图 — 见 list */
    list,
    /** 删除指定图 — 见 remove */
    remove,
    /** 删除全部 legacy 静态图；v2 图和路线由各自的原子 API 管理。 */
    removeAll,

    // ===== 路网 v2：纯数据图 =====
    createGraph: graphManager.createGraph,
    getGraph: graphManager.getGraph,
    listGraphs: graphManager.listGraphs,
    removeGraph: graphManager.removeGraph,
    removeAllGraphs: graphManager.removeAllGraphs,
    setEdgeRoutingState: graphManager.setEdgeRoutingState,
    setEdgeVisualState: graphManager.setEdgeVisualState,
    findPath: graphManager.findPath,

    // ===== 路网 v2：Three.js 路线渲染 =====
    renderRoute: topologyRenderer.renderRoute,
    setRouteVisualState: topologyRenderer.setRouteVisualState,
    showRoute: topologyRenderer.showRoute,
    hideRoute: topologyRenderer.hideRoute,
    getRouteById: topologyRenderer.getRouteById,
    listRoutes: topologyRenderer.listRoutes,
    removeRoute: topologyRenderer.removeRoute,
    removeAllRoutes: topologyRenderer.removeAllRoutes,
  }
}
