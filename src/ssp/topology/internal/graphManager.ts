import {
  TopologyError,
  type TopologyData,
  type TopologyEdgeDirection,
  type TopologyEdgeFlowStyle,
  type TopologyEdgeRelation,
  type TopologyEdgeRoutingState,
  type TopologyEdgeRoutingStatePatch,
  type TopologyEdgeSelector,
  type TopologyEdgeVisualState,
  type TopologyEdgeVisualStatePatch,
  type TopologyGraphApi,
  type TopologyGraphEdgeInput,
  type TopologyGraphEdgeSnapshot,
  type TopologyGraphInput,
  type TopologyGraphNodeInput,
  type TopologyGraphNodeSnapshot,
  type TopologyGraphPoint,
  type TopologyGraphSnapshot,
  type TopologyLayerInput,
  type TopologyLayerSnapshot,
  type TopologyPathQuery,
  type TopologyPathResult,
  type TopologyRevisionGuard,
  type TopologyRoutingMutationResult,
  type TopologyVisualMutationResult,
} from '../types'
import { findPathInGraph } from './pathfinding'

const MAX_GRAPHS = 16
const MAX_LAYERS = 32
const MAX_NODES = 2_000
const MAX_EDGES = 5_000
const MAX_VIA_PER_EDGE = 64
const MAX_SEGMENTS = 20_000
const MAX_ID_LENGTH = 160
const MIN_EDGE_LENGTH = 1e-6

const DEFAULT_EDGE_VISUAL: Readonly<TopologyEdgeVisualState> = Object.freeze({
  visible: false,
  color: '#29ccff',
  width: 0.06,
  opacity: 1,
  depthTest: true,
  flow: null,
})

let nextGraphId = 1

/** @internal 正规化后的 layer 记录。 */
export interface GraphLayerRecord extends TopologyLayerSnapshot {}

/** @internal 正规化后的 node 记录。 */
export interface GraphNodeRecord extends TopologyGraphNodeSnapshot {}

/** @internal 寻路邻接表中的一条有向 arc。 */
export interface GraphArc {
  edgeId: string
  from: string
  to: string
  traversalDirection: 'FORWARD' | 'REVERSE'
}

/** @internal 正规化后的 edge 记录。 */
export interface GraphEdgeRecord {
  id: string
  source: string
  target: string
  relation: TopologyEdgeRelation
  direction: TopologyEdgeDirection
  points: TopologyGraphPoint[]
  length: number
  baseWeight: number
  routingState: {
    enabled: boolean
    weightOverride: number | null
    blockerIds: string[]
  }
  visualState: {
    visible: boolean
    color: string | number
    width: number
    opacity: number
    depthTest: boolean
    flow: TopologyEdgeFlowStyle | null
  }
  mode?: string
  tags: string[]
  data?: TopologyData
}

/** @internal 一张不可变结构、可变 edge state 的纯数据图。 */
export interface GraphRecord {
  id: string
  routingRevision: number
  visualRevision: number
  layers: GraphLayerRecord[]
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
  layerById: Map<string, GraphLayerRecord>
  nodeById: Map<string, GraphNodeRecord>
  edgeById: Map<string, GraphEdgeRecord>
  adjacency: Map<string, GraphArc[]>
  tags: string[]
  data?: TopologyData
}

/** @internal graph manager 与 Three renderer 之间唯一的生命周期窄口。 */
export interface GraphLifecycleHooks {
  invalidateRoutes(graphId: string): readonly string[]
  syncEdgeVisuals(graph: GraphRecord, edgeIds: readonly string[]): void
  removeGraphVisuals(graphId: string): void
}

/** @internal factory 使用的 manager，包括公开原子 API 和有限内部访问。 */
export interface GraphManagerInternal extends TopologyGraphApi {
  getRecord(id: string): GraphRecord | null
  setHooks(hooks: GraphLifecycleHooks): void
}

function fail(
  code: ConstructorParameters<typeof TopologyError>[0],
  message: string,
  path?: string,
  details?: TopologyData,
): never {
  throw new TopologyError(code, message, path, details)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', `${path} must be an object`, path)
  }
  return value as Record<string, unknown>
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_ARGUMENT', `${path} must be a finite number`, path)
  }
  return value
}

function nonNegative(value: unknown, path: string): number {
  const result = finite(value, path)
  if (result < 0) fail('INVALID_ARGUMENT', `${path} must be greater than or equal to 0`, path)
  return result
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path)
  if (result <= 0) fail('INVALID_ARGUMENT', `${path} must be greater than 0`, path)
  return result
}

function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_ARGUMENT', `${path} must be a non-empty string`, path)
  }
  const result = value.trim()
  if (result.length > MAX_ID_LENGTH) {
    fail('INVALID_ARGUMENT', `${path} must be at most ${MAX_ID_LENGTH} characters`, path)
  }
  return result
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  return id(value, path)
}

function point(value: unknown, path: string): TopologyGraphPoint {
  const source = record(value, path)
  return {
    x: finite(source.x, `${path}.x`),
    y: finite(source.y, `${path}.y`),
    z: finite(source.z, `${path}.z`),
  }
}

function data(value: unknown, path: string): TopologyData | undefined {
  if (value === undefined) return undefined
  return Object.freeze({ ...record(value, path) })
}

function strings(value: unknown, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail('INVALID_ARGUMENT', `${path} must be an array`, path)
  const unique = new Set<string>()
  value.forEach((item, index) => unique.add(id(item, `${path}[${index}]`)))
  return Array.from(unique)
}

function color(value: unknown, path: string): string | number {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffff
  ) return value
  return fail(
    'INVALID_ARGUMENT',
    `${path} must be a non-empty color string or an integer from 0 to 0xffffff`,
    path,
  )
}

function distance(a: TopologyGraphPoint, b: TopologyGraphPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

function polylineLength(points: readonly TopologyGraphPoint[]): number {
  let total = 0
  for (let index = 1; index < points.length; index++) total += distance(points[index - 1], points[index])
  return total
}

function normalizeLayer(input: TopologyLayerInput, index: number): GraphLayerRecord {
  const source = record(input, `layers[${index}]`)
  const order = source.order === undefined ? undefined : finite(source.order, `layers[${index}].order`)
  const elevation = source.elevation === undefined
    ? undefined
    : finite(source.elevation, `layers[${index}].elevation`)
  return {
    id: id(source.id, `layers[${index}].id`),
    label: optionalString(source.label, `layers[${index}].label`),
    order,
    elevation,
    tags: strings(source.tags, `layers[${index}].tags`),
    data: data(source.data, `layers[${index}].data`),
  }
}

function normalizeNode(input: TopologyGraphNodeInput, index: number): GraphNodeRecord {
  const source = record(input, `nodes[${index}]`)
  return {
    id: id(source.id, `nodes[${index}].id`),
    layerId: id(source.layerId, `nodes[${index}].layerId`),
    position: point(source.position, `nodes[${index}].position`),
    connectorId: optionalString(source.connectorId, `nodes[${index}].connectorId`),
    label: optionalString(source.label, `nodes[${index}].label`),
    kind: optionalString(source.kind, `nodes[${index}].kind`),
    subtype: optionalString(source.subtype, `nodes[${index}].subtype`),
    tags: strings(source.tags, `nodes[${index}].tags`),
    data: data(source.data, `nodes[${index}].data`),
  }
}

function normalizeInitialState(
  value: unknown,
  path: string,
): GraphEdgeRecord['routingState'] {
  if (value === undefined) return { enabled: true, weightOverride: null, blockerIds: [] }
  const source = record(value, path)
  if (source.enabled !== undefined && typeof source.enabled !== 'boolean') {
    fail('INVALID_ARGUMENT', `${path}.enabled must be a boolean`, `${path}.enabled`)
  }
  return {
    enabled: source.enabled === undefined ? true : source.enabled,
    weightOverride: source.weightOverride == null
      ? null
      : nonNegative(source.weightOverride, `${path}.weightOverride`),
    blockerIds: strings(source.blockerIds, `${path}.blockerIds`),
  }
}

function normalizeEdge(
  input: TopologyGraphEdgeInput,
  index: number,
  nodeById: ReadonlyMap<string, GraphNodeRecord>,
): GraphEdgeRecord {
  const path = `edges[${index}]`
  const source = record(input, path)
  const edgeId = id(source.id, `${path}.id`)
  const sourceId = id(source.source, `${path}.source`)
  const targetId = id(source.target, `${path}.target`)
  if (sourceId === targetId) fail('INVALID_GRAPH', `${path} cannot be a self-loop`, path)
  const sourceNode = nodeById.get(sourceId)
  const targetNode = nodeById.get(targetId)
  if (!sourceNode) {
    fail('BROKEN_REFERENCE', `${path}.source references missing node "${sourceId}"`, `${path}.source`)
  }
  if (!targetNode) {
    fail('BROKEN_REFERENCE', `${path}.target references missing node "${targetId}"`, `${path}.target`)
  }
  if (source.relation !== 'LINK' && source.relation !== 'CONNECTOR') {
    fail('INVALID_ARGUMENT', `${path}.relation must be LINK or CONNECTOR`, `${path}.relation`)
  }
  if (source.direction !== 'FORWARD' && source.direction !== 'BIDIRECTIONAL') {
    fail(
      'INVALID_ARGUMENT',
      `${path}.direction must be FORWARD or BIDIRECTIONAL`,
      `${path}.direction`,
    )
  }

  const crossesLayer = sourceNode.layerId !== targetNode.layerId
  if (!crossesLayer && source.relation !== 'LINK') {
    fail('INVALID_GRAPH', `${path} connects one layer and must use relation LINK`, `${path}.relation`)
  }
  if (crossesLayer) {
    if (source.relation !== 'CONNECTOR') {
      fail('INVALID_GRAPH', `${path} crosses layers and must use relation CONNECTOR`, `${path}.relation`)
    }
    if (!sourceNode.connectorId || sourceNode.connectorId !== targetNode.connectorId) {
      fail(
        'INVALID_GRAPH',
        `${path} cross-layer endpoints must share the same non-empty connectorId`,
        path,
      )
    }
  }

  let via: TopologyGraphPoint[] = []
  if (source.path !== undefined) {
    const rawPath = record(source.path, `${path}.path`)
    if (rawPath.type !== 'POLYLINE') {
      fail('INVALID_ARGUMENT', `${path}.path.type must be POLYLINE`, `${path}.path.type`)
    }
    if (!Array.isArray(rawPath.via)) {
      fail('INVALID_ARGUMENT', `${path}.path.via must be an array`, `${path}.path.via`)
    }
    if (rawPath.via.length > MAX_VIA_PER_EDGE) {
      fail(
        'LIMIT_EXCEEDED',
        `${path}.path.via exceeds the ${MAX_VIA_PER_EDGE} point limit`,
        `${path}.path.via`,
      )
    }
    via = rawPath.via.map((item, viaIndex) => point(item, `${path}.path.via[${viaIndex}]`))
  }

  const points = [sourceNode.position, ...via, targetNode.position].map((item) => ({ ...item }))
  for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
    if (distance(points[pointIndex - 1], points[pointIndex]) <= MIN_EDGE_LENGTH) {
      fail(
        'INVALID_GRAPH',
        `${path} contains equal or effectively equal adjacent points`,
        `${path}.path`,
      )
    }
  }
  const length = polylineLength(points)
  if (length <= MIN_EDGE_LENGTH) fail('INVALID_GRAPH', `${path} has no effective length`, path)

  return {
    id: edgeId,
    source: sourceId,
    target: targetId,
    relation: source.relation as TopologyEdgeRelation,
    direction: source.direction as TopologyEdgeDirection,
    points,
    length,
    baseWeight: source.weight === undefined ? length : nonNegative(source.weight, `${path}.weight`),
    routingState: normalizeInitialState(source.initialState, `${path}.initialState`),
    visualState: {
      ...DEFAULT_EDGE_VISUAL,
      flow: null,
    },
    mode: optionalString(source.mode, `${path}.mode`),
    tags: strings(source.tags, `${path}.tags`),
    data: data(source.data, `${path}.data`),
  }
}

function ensureUnique<T extends { id: string }>(items: readonly T[], path: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) fail('DUPLICATE_ID', `duplicate ${path} id "${item.id}"`, path)
    seen.add(item.id)
  }
}

function normalizeGraph(input: TopologyGraphInput, generatedId: string): GraphRecord {
  const source = record(input, 'input')
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    fail('INVALID_ARGUMENT', 'layers must contain at least one layer', 'layers')
  }
  if (!Array.isArray(source.nodes) || source.nodes.length === 0) {
    fail('INVALID_ARGUMENT', 'nodes must contain at least one node', 'nodes')
  }
  if (!Array.isArray(source.edges)) fail('INVALID_ARGUMENT', 'edges must be an array', 'edges')
  if (source.layers.length > MAX_LAYERS) {
    fail('LIMIT_EXCEEDED', `layers exceeds the ${MAX_LAYERS} layer limit`, 'layers')
  }
  if (source.nodes.length > MAX_NODES) {
    fail('LIMIT_EXCEEDED', `nodes exceeds the ${MAX_NODES} node limit`, 'nodes')
  }
  if (source.edges.length > MAX_EDGES) {
    fail('LIMIT_EXCEEDED', `edges exceeds the ${MAX_EDGES} edge limit`, 'edges')
  }

  const layers = source.layers.map((item, index) => normalizeLayer(item, index))
  ensureUnique(layers, 'layer')
  const layerById = new Map(layers.map((item) => [item.id, item]))
  const nodes = source.nodes.map((item, index) => normalizeNode(item, index))
  ensureUnique(nodes, 'node')
  for (const [index, node] of nodes.entries()) {
    if (!layerById.has(node.layerId)) {
      fail(
        'BROKEN_REFERENCE',
        `nodes[${index}].layerId references missing layer "${node.layerId}"`,
        `nodes[${index}].layerId`,
      )
    }
  }
  const nodeById = new Map(nodes.map((item) => [item.id, item]))
  const edges = source.edges.map((item, index) => normalizeEdge(item, index, nodeById))
  ensureUnique(edges, 'edge')
  const segmentCount = edges.reduce((total, edge) => total + edge.points.length - 1, 0)
  if (segmentCount > MAX_SEGMENTS) {
    fail('LIMIT_EXCEEDED', `graph exceeds the ${MAX_SEGMENTS} segment limit`, 'edges')
  }

  const edgeById = new Map(edges.map((item) => [item.id, item]))
  const adjacency = new Map(nodes.map((node) => [node.id, [] as GraphArc[]]))
  for (const edge of edges) {
    adjacency.get(edge.source)!.push({
      edgeId: edge.id,
      from: edge.source,
      to: edge.target,
      traversalDirection: 'FORWARD',
    })
    if (edge.direction === 'BIDIRECTIONAL') {
      adjacency.get(edge.target)!.push({
        edgeId: edge.id,
        from: edge.target,
        to: edge.source,
        traversalDirection: 'REVERSE',
      })
    }
  }

  return {
    id: source.id === undefined ? generatedId : id(source.id, 'id'),
    routingRevision: 1,
    visualRevision: 1,
    layers,
    nodes,
    edges,
    layerById,
    nodeById,
    edgeById,
    adjacency,
    tags: strings(source.tags, 'tags'),
    data: data(source.data, 'data'),
  }
}

function routingSnapshot(edge: GraphEdgeRecord): TopologyEdgeRoutingState {
  const blockerIds = [...edge.routingState.blockerIds]
  return {
    enabled: edge.routingState.enabled,
    blockerIds,
    traversable: edge.routingState.enabled && blockerIds.length === 0,
    weightOverride: edge.routingState.weightOverride,
    effectiveWeight: edge.routingState.weightOverride ?? edge.baseWeight,
  }
}

function cloneFlow(flow: TopologyEdgeFlowStyle | null): TopologyEdgeFlowStyle | null {
  return flow ? { ...flow } : null
}

/** @internal 为 renderer / pathfinding 生成 detached edge 快照。 */
export function snapshotEdge(edge: GraphEdgeRecord): TopologyGraphEdgeSnapshot {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    direction: edge.direction,
    path: { type: 'POLYLINE', via: edge.points.slice(1, -1).map((item) => ({ ...item })) },
    length: edge.length,
    baseWeight: edge.baseWeight,
    routingState: routingSnapshot(edge),
    visualState: {
      ...edge.visualState,
      flow: cloneFlow(edge.visualState.flow),
    },
    mode: edge.mode,
    tags: [...edge.tags],
    data: edge.data,
  }
}

/** @internal 生成不泄漏 Map / 可变数组的完整图快照。 */
export function snapshotGraph(graph: GraphRecord): TopologyGraphSnapshot {
  return {
    schemaVersion: 2,
    id: graph.id,
    routingRevision: graph.routingRevision,
    visualRevision: graph.visualRevision,
    layers: graph.layers.map((layer) => ({ ...layer, tags: [...layer.tags] })),
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      tags: [...node.tags],
    })),
    edges: graph.edges.map(snapshotEdge),
    tags: [...graph.tags],
    data: graph.data,
  }
}

function selectedEdges(
  graph: GraphRecord,
  selector: TopologyEdgeSelector,
): GraphEdgeRecord[] | { missing: string } {
  if (typeof selector !== 'object' || selector === null || Array.isArray(selector)) {
    fail('INVALID_ARGUMENT', 'selector must be { edgeIds } or { all: true }', 'selector')
  }
  if ('all' in selector) {
    if (selector.all !== true) fail('INVALID_ARGUMENT', 'selector.all must be true', 'selector.all')
    return [...graph.edges]
  }
  if (!Array.isArray(selector.edgeIds)) {
    fail('INVALID_ARGUMENT', 'selector.edgeIds must be an array', 'selector.edgeIds')
  }
  const ids = strings(selector.edgeIds, 'selector.edgeIds')
  const result: GraphEdgeRecord[] = []
  for (const edgeId of ids) {
    const edge = graph.edgeById.get(edgeId)
    if (!edge) return { missing: edgeId }
    result.push(edge)
  }
  return result
}

function normalizeRoutingPatch(patch: TopologyEdgeRoutingStatePatch): TopologyEdgeRoutingStatePatch {
  const source = record(patch, 'patch')
  if (source.enabled !== undefined && typeof source.enabled !== 'boolean') {
    fail('INVALID_ARGUMENT', 'patch.enabled must be a boolean', 'patch.enabled')
  }
  if (source.weightOverride !== undefined && source.weightOverride !== null) {
    nonNegative(source.weightOverride, 'patch.weightOverride')
  }
  const hasReplace = source.blockerIds !== undefined
  const hasIncremental = source.addBlockerIds !== undefined || source.removeBlockerIds !== undefined
  if (hasReplace && hasIncremental) {
    fail(
      'INVALID_ARGUMENT',
      'patch.blockerIds cannot be combined with addBlockerIds/removeBlockerIds',
      'patch',
    )
  }
  return {
    enabled: source.enabled as boolean | undefined,
    weightOverride: source.weightOverride as number | null | undefined,
    blockerIds: hasReplace ? strings(source.blockerIds, 'patch.blockerIds') : undefined,
    addBlockerIds: source.addBlockerIds === undefined
      ? undefined
      : strings(source.addBlockerIds, 'patch.addBlockerIds'),
    removeBlockerIds: source.removeBlockerIds === undefined
      ? undefined
      : strings(source.removeBlockerIds, 'patch.removeBlockerIds'),
  }
}

function normalizeFlow(value: unknown, path: string): TopologyEdgeFlowStyle | null {
  if (value === null) return null
  const source = record(value, path)
  if (typeof source.active !== 'boolean') {
    fail('INVALID_ARGUMENT', `${path}.active must be a boolean`, `${path}.active`)
  }
  if (
    source.direction !== undefined &&
    source.direction !== 'FORWARD' &&
    source.direction !== 'REVERSE' &&
    source.direction !== 'BOTH'
  ) {
    fail(
      'INVALID_ARGUMENT',
      `${path}.direction must be FORWARD, REVERSE, or BOTH`,
      `${path}.direction`,
    )
  }
  return {
    active: source.active,
    direction: source.direction as TopologyEdgeFlowStyle['direction'],
    speed: source.speed === undefined ? undefined : positive(source.speed, `${path}.speed`),
    spacing: source.spacing === undefined ? undefined : positive(source.spacing, `${path}.spacing`),
    color: source.color === undefined ? undefined : color(source.color, `${path}.color`),
    size: source.size === undefined ? undefined : positive(source.size, `${path}.size`),
  }
}

function normalizeVisualPatch(patch: TopologyEdgeVisualStatePatch): TopologyEdgeVisualStatePatch {
  const source = record(patch, 'patch')
  if (source.visible !== undefined && typeof source.visible !== 'boolean') {
    fail('INVALID_ARGUMENT', 'patch.visible must be a boolean', 'patch.visible')
  }
  if (source.depthTest !== undefined && typeof source.depthTest !== 'boolean') {
    fail('INVALID_ARGUMENT', 'patch.depthTest must be a boolean', 'patch.depthTest')
  }
  const opacity = source.opacity === undefined ? undefined : finite(source.opacity, 'patch.opacity')
  if (opacity !== undefined && (opacity < 0 || opacity > 1)) {
    fail('INVALID_ARGUMENT', 'patch.opacity must be between 0 and 1', 'patch.opacity')
  }
  return {
    visible: source.visible as boolean | undefined,
    color: source.color === undefined ? undefined : color(source.color, 'patch.color'),
    width: source.width === undefined ? undefined : positive(source.width, 'patch.width'),
    opacity,
    depthTest: source.depthTest as boolean | undefined,
    flow: source.flow === undefined ? undefined : normalizeFlow(source.flow, 'patch.flow'),
  }
}

function routingStatesEqual(
  a: GraphEdgeRecord['routingState'],
  b: GraphEdgeRecord['routingState'],
): boolean {
  return a.enabled === b.enabled &&
    a.weightOverride === b.weightOverride &&
    a.blockerIds.length === b.blockerIds.length &&
    a.blockerIds.every((value, index) => value === b.blockerIds[index])
}

function flowEqual(a: TopologyEdgeFlowStyle | null, b: TopologyEdgeFlowStyle | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.active === b.active &&
    a.direction === b.direction &&
    a.speed === b.speed &&
    a.spacing === b.spacing &&
    a.color === b.color &&
    a.size === b.size
}

function visualStatesEqual(
  a: GraphEdgeRecord['visualState'],
  b: GraphEdgeRecord['visualState'],
): boolean {
  return a.visible === b.visible &&
    a.color === b.color &&
    a.width === b.width &&
    a.opacity === b.opacity &&
    a.depthTest === b.depthTest &&
    flowEqual(a.flow, b.flow)
}

function validateGuard(guard: TopologyRevisionGuard, path: string): void {
  if (typeof guard !== 'object' || guard === null || Array.isArray(guard)) {
    fail('INVALID_ARGUMENT', `${path} must be an object`, path)
  }
  if (
    guard.expectedRevision !== undefined &&
    (!Number.isInteger(guard.expectedRevision) || guard.expectedRevision < 1)
  ) {
    fail(
      'INVALID_ARGUMENT',
      `${path}.expectedRevision must be a positive integer`,
      `${path}.expectedRevision`,
    )
  }
}

/**
 * 创建一套纯数据图 manager。
 * Three 渲染只通过 GraphLifecycleHooks 接入，图模型不读取场景或其他 SSP 模块。
 */
export function createGraphManager(): GraphManagerInternal {
  const graphs = new Map<string, GraphRecord>()
  let hooks: GraphLifecycleHooks = {
    invalidateRoutes: () => [],
    syncEdgeVisuals: () => undefined,
    removeGraphVisuals: () => undefined,
  }

  function createGraph(input: TopologyGraphInput): TopologyGraphSnapshot {
    if (graphs.size >= MAX_GRAPHS) {
      fail('LIMIT_EXCEEDED', `graph manager exceeds the ${MAX_GRAPHS} graph limit`)
    }
    const generatedId = `topology_graph_${nextGraphId++}`
    const graph = normalizeGraph(input, generatedId)
    if (graphs.has(graph.id)) fail('DUPLICATE_ID', `graph id "${graph.id}" already exists`, 'id')
    graphs.set(graph.id, graph)
    return snapshotGraph(graph)
  }

  function getGraph(graphId: string): TopologyGraphSnapshot | null {
    const graph = graphs.get(graphId)
    return graph ? snapshotGraph(graph) : null
  }

  function listGraphs(): TopologyGraphSnapshot[] {
    return Array.from(graphs.values(), snapshotGraph)
  }

  function removeGraph(graphId: string): boolean {
    if (!graphs.has(graphId)) return false
    hooks.removeGraphVisuals(graphId)
    graphs.delete(graphId)
    return true
  }

  function removeAllGraphs(): number {
    const ids = Array.from(graphs.keys())
    ids.forEach(removeGraph)
    return ids.length
  }

  function setEdgeRoutingState(
    graphId: string,
    selector: TopologyEdgeSelector,
    patch: TopologyEdgeRoutingStatePatch,
    guard: TopologyRevisionGuard = {},
  ): TopologyRoutingMutationResult {
    const graph = graphs.get(graphId)
    if (!graph) return { ok: false, code: 'GRAPH_NOT_FOUND' }
    validateGuard(guard, 'guard')
    if (
      guard.expectedRevision !== undefined &&
      guard.expectedRevision !== graph.routingRevision
    ) {
      return {
        ok: false,
        code: 'REVISION_CONFLICT',
        currentRevision: graph.routingRevision,
      }
    }
    const selected = selectedEdges(graph, selector)
    if (!Array.isArray(selected)) return { ok: false, code: 'EDGE_NOT_FOUND', edgeId: selected.missing }
    const normalized = normalizeRoutingPatch(patch)
    const staged = selected.map((edge) => {
      let blockerIds = [...edge.routingState.blockerIds]
      if (normalized.blockerIds !== undefined) blockerIds = [...normalized.blockerIds]
      if (normalized.addBlockerIds) {
        blockerIds = Array.from(new Set([...blockerIds, ...normalized.addBlockerIds]))
      }
      if (normalized.removeBlockerIds) {
        const removed = new Set(normalized.removeBlockerIds)
        blockerIds = blockerIds.filter((item) => !removed.has(item))
      }
      blockerIds.sort()
      return {
        edge,
        state: {
          enabled: normalized.enabled ?? edge.routingState.enabled,
          weightOverride: normalized.weightOverride === undefined
            ? edge.routingState.weightOverride
            : normalized.weightOverride,
          blockerIds,
        },
      }
    })
    const changed = staged.some(({ edge, state }) => !routingStatesEqual(edge.routingState, state))
    let invalidatedRouteIds: readonly string[] = []
    if (changed) {
      staged.forEach(({ edge, state }) => { edge.routingState = state })
      graph.routingRevision += 1
      invalidatedRouteIds = hooks.invalidateRoutes(graph.id)
    }
    return {
      ok: true,
      changed,
      routingRevision: graph.routingRevision,
      edges: selected.map(snapshotEdge),
      invalidatedRouteIds,
    }
  }

  function setEdgeVisualState(
    graphId: string,
    selector: TopologyEdgeSelector,
    patch: TopologyEdgeVisualStatePatch,
    guard: TopologyRevisionGuard = {},
  ): TopologyVisualMutationResult {
    const graph = graphs.get(graphId)
    if (!graph) return { ok: false, code: 'GRAPH_NOT_FOUND' }
    validateGuard(guard, 'guard')
    if (
      guard.expectedRevision !== undefined &&
      guard.expectedRevision !== graph.visualRevision
    ) {
      return {
        ok: false,
        code: 'REVISION_CONFLICT',
        currentRevision: graph.visualRevision,
      }
    }
    const selected = selectedEdges(graph, selector)
    if (!Array.isArray(selected)) return { ok: false, code: 'EDGE_NOT_FOUND', edgeId: selected.missing }
    const normalized = normalizeVisualPatch(patch)
    const staged = selected.map((edge) => ({
      edge,
      state: {
        visible: normalized.visible ?? edge.visualState.visible,
        color: normalized.color ?? edge.visualState.color,
        width: normalized.width ?? edge.visualState.width,
        opacity: normalized.opacity ?? edge.visualState.opacity,
        depthTest: normalized.depthTest ?? edge.visualState.depthTest,
        flow: normalized.flow === undefined ? cloneFlow(edge.visualState.flow) : cloneFlow(normalized.flow),
      },
    }))
    const changed = staged.some(({ edge, state }) => !visualStatesEqual(edge.visualState, state))
    if (changed) {
      const previous = staged.map(({ edge }) => ({ edge, state: edge.visualState }))
      staged.forEach(({ edge, state }) => { edge.visualState = state })
      try {
        hooks.syncEdgeVisuals(graph, selected.map((edge) => edge.id))
        graph.visualRevision += 1
      } catch (error) {
        previous.forEach(({ edge, state }) => { edge.visualState = state })
        try {
          hooks.syncEdgeVisuals(graph, selected.map((edge) => edge.id))
        } catch {
          // 原错误更能说明失败原因；renderer 自身会清理未提交资源。
        }
        throw error
      }
    } else if (selected.some((edge) => edge.visualState.visible)) {
      // Graph 数据可跨 context 保留；同值调用也负责把可见边同步到当前 scene。
      hooks.syncEdgeVisuals(graph, selected.map((edge) => edge.id))
    }
    return {
      ok: true,
      changed,
      visualRevision: graph.visualRevision,
      edges: selected.map(snapshotEdge),
    }
  }

  function findPath(query: TopologyPathQuery): TopologyPathResult {
    const source = record(query, 'query')
    const graphId = id(source.graphId, 'query.graphId')
    const graph = graphs.get(graphId)
    if (!graph) {
      return { ok: false, code: 'GRAPH_NOT_FOUND', message: `graph "${graphId}" was not found` }
    }
    return findPathInGraph(graph, query)
  }

  return {
    createGraph,
    getGraph,
    listGraphs,
    removeGraph,
    removeAllGraphs,
    setEdgeRoutingState,
    setEdgeVisualState,
    findPath,
    getRecord: (graphId) => graphs.get(graphId) ?? null,
    setHooks: (nextHooks) => { hooks = nextHooks },
  }
}
