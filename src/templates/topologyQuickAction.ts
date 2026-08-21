import { templateRuntime } from './runtime'

const FIND_PATH_TEMPLATE_ID = 'findPath'
const RENDER_ROUTE_TEMPLATE_ID = 'renderRoute'
const REMOVE_ROUTE_TEMPLATE_ID = 'removeRoute'
const MAX_ID_LENGTH = 1024
const MAX_ROUTE_ITEMS = 20_000
const MAX_ROUTE_STEPS = 5_000
const MAX_POINTS_PER_STEP = 66
const MAX_ROUTE_POINT_VALUES = 50_000

const TRUSTED_EXECUTE_OPTIONS = Object.freeze({
  aiOnly: false,
  validateParams: true,
})

const ROUTE_STYLE = Object.freeze({
  color: '#FF5A36',
  width: 0.16,
  opacity: 0.95,
  depthTest: true,
})

const ROUTE_FLOW = Object.freeze({
  active: true,
  speed: 2,
  spacing: 1.4,
  color: '#FFF176',
  size: 0.14,
})

export type TopologyPathFailureCode =
  | 'GRAPH_NOT_FOUND'
  | 'START_NOT_FOUND'
  | 'GOAL_NOT_FOUND'
  | 'REQUIREMENT_NODE_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'NO_PATH'
  | 'NO_PATH_SATISFYING_REQUIREMENTS'
  | 'NO_PATH_WITHIN_WEIGHT'

export type TopologyRenderFailureCode = 'GRAPH_NOT_FOUND' | 'STALE_ROUTE'

export type TopologyQuickActionErrorCode =
  | 'INVALID_INPUT'
  | 'TEMPLATE_EXECUTION_FAILED'
  | 'MALFORMED_TEMPLATE_OUTPUT'

const PATH_FAILURE_MESSAGES: Readonly<Record<TopologyPathFailureCode, string>> = Object.freeze({
  GRAPH_NOT_FOUND: '当前拓扑图已不可用，请重新选择场景。',
  START_NOT_FOUND: '所选起点不在当前拓扑图中。',
  GOAL_NOT_FOUND: '所选终点不在当前拓扑图中。',
  REQUIREMENT_NODE_NOT_FOUND: '路径要求引用了不存在的节点。',
  REVISION_CONFLICT: '拓扑路由状态已更新，请重新执行。',
  NO_PATH: '当前起点与终点之间没有可用路径。',
  NO_PATH_SATISFYING_REQUIREMENTS: '当前路径要求无法同时满足。',
  NO_PATH_WITHIN_WEIGHT: '没有符合权重上限的路径。',
})

const RENDER_FAILURE_MESSAGES: Readonly<Record<TopologyRenderFailureCode, string>> = Object.freeze({
  GRAPH_NOT_FOUND: '当前拓扑图已不可用，路线未显示。',
  STALE_ROUTE: '拓扑路由状态已更新，本次路线未显示。',
})

const ERROR_MESSAGES: Readonly<Record<TopologyQuickActionErrorCode, string>> = Object.freeze({
  INVALID_INPUT: '路径操作参数无效。',
  TEMPLATE_EXECUTION_FAILED: '路径模板执行失败，请重试。',
  MALFORMED_TEMPLATE_OUTPUT: '路径模板返回了无效结果。',
})

export class TopologyQuickActionError extends Error {
  readonly code: TopologyQuickActionErrorCode
  readonly userMessage: string

  constructor(code: TopologyQuickActionErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'TopologyQuickActionError'
    this.code = code
    this.userMessage = ERROR_MESSAGES[code]
  }
}

export interface TopologyPathRequest {
  graphId: string
  startNodeId: string
  goalNodeId: string
}

interface RoutePoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface RouteStep {
  readonly edgeId: string
  readonly fromNodeId: string
  readonly toNodeId: string
  readonly fromLayerId: string
  readonly toLayerId: string
  readonly relation: 'LINK' | 'CONNECTOR'
  readonly traversalDirection: 'FORWARD' | 'REVERSE'
  readonly points: readonly RoutePoint[]
  readonly length: number
  readonly weight: number
  readonly mode?: string
}

interface RouteSnapshot {
  readonly graphId: string
  readonly graphRoutingRevision: number
  readonly startNodeId: string
  readonly goalNodeId: string
  readonly selectedRequirementNodeIds: readonly string[]
  readonly nodeIds: readonly string[]
  readonly layerIds: readonly string[]
  readonly steps: readonly RouteStep[]
  readonly flattenedPoints: readonly RoutePoint[]
  readonly totalLength: number
  readonly totalWeight: number
}

interface PathStats {
  readonly algorithm: 'CONSTRAINED_DIJKSTRA'
  readonly visitedStateCount: number
  readonly durationMs: number
}

export interface TopologyPathReceipt {
  readonly kind: 'path'
  readonly graphId: string
  readonly startNodeId: string
  readonly goalNodeId: string
  readonly route: RouteSnapshot
  readonly stats: PathStats
}

export interface TopologyPathFailure {
  readonly kind: 'path-failure'
  readonly code: TopologyPathFailureCode
  readonly message: string
}

export type TopologyFindPathResult = TopologyPathReceipt | TopologyPathFailure

export interface TopologyRenderedRoute {
  readonly kind: 'rendered'
  readonly routeId: string
  readonly graphId: string
  readonly graphRoutingRevision: number
  readonly nodeIds: readonly string[]
  readonly layerIds: readonly string[]
  readonly edgeIds: readonly string[]
  readonly totalLength: number
  readonly totalWeight: number
}

export interface TopologyRenderFailure {
  readonly kind: 'render-failure'
  readonly code: TopologyRenderFailureCode
  readonly message: string
  readonly currentRevision?: number
}

export type TopologyRenderRouteResult = TopologyRenderedRoute | TopologyRenderFailure

export interface TopologyRemoveRouteResult {
  readonly routeId: string
  readonly removed: boolean
}

export interface TopologyQuickActionFacade {
  findPath(request: TopologyPathRequest): Promise<TopologyFindPathResult>
  renderRoute(path: TopologyPathReceipt): Promise<TopologyRenderRouteResult>
  removeRoute(routeId: string): Promise<TopologyRemoveRouteResult>
}

export interface TopologyQuickActionTemplateRuntime {
  execute(
    templateId: string,
    params?: Record<string, unknown>,
    options?: { aiOnly?: boolean; validateParams?: boolean },
  ): Promise<unknown>
}

function invalidInput(): never {
  throw new TopologyQuickActionError('INVALID_INPUT')
}

function malformedOutput(): never {
  throw new TopologyQuickActionError('MALFORMED_TEMPLATE_OUTPUT')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function inputId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) invalidInput()
  return value
}

function outputId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) malformedOutput()
  return value
}

function finiteNumber(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) malformedOutput()
  return value
}

function nonNegativeInteger(value: unknown): number {
  const parsed = finiteNumber(value)
  if (!Number.isInteger(parsed)) malformedOutput()
  return parsed
}

function boundedArray(value: unknown, limit = MAX_ROUTE_ITEMS): readonly unknown[] {
  if (!Array.isArray(value) || value.length > limit) malformedOutput()
  return value
}

function stringArray(value: unknown): readonly string[] {
  return Object.freeze(boundedArray(value).map(outputId))
}

function point(value: unknown): RoutePoint {
  if (!isRecord(value)) malformedOutput()
  return Object.freeze({
    x: finiteNumberAllowNegative(value.x),
    y: finiteNumberAllowNegative(value.y),
    z: finiteNumberAllowNegative(value.z),
  })
}

function finiteNumberAllowNegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) malformedOutput()
  return value
}

function routeStep(value: unknown): RouteStep {
  if (!isRecord(value)) malformedOutput()
  const relation = value.relation
  if (relation !== 'LINK' && relation !== 'CONNECTOR') malformedOutput()
  const traversalDirection = value.traversalDirection
  if (traversalDirection !== 'FORWARD' && traversalDirection !== 'REVERSE') malformedOutput()
  if (value.mode !== undefined && typeof value.mode !== 'string') malformedOutput()
  return Object.freeze({
    edgeId: outputId(value.edgeId),
    fromNodeId: outputId(value.fromNodeId),
    toNodeId: outputId(value.toNodeId),
    fromLayerId: outputId(value.fromLayerId),
    toLayerId: outputId(value.toLayerId),
    relation,
    traversalDirection,
    points: Object.freeze(boundedArray(value.points, MAX_POINTS_PER_STEP).map(point)),
    length: finiteNumber(value.length),
    weight: finiteNumber(value.weight),
    ...(value.mode === undefined ? {} : { mode: value.mode }),
  })
}

function routeSnapshot(value: unknown): RouteSnapshot {
  if (!isRecord(value)) malformedOutput()
  const rawSteps = boundedArray(value.steps, MAX_ROUTE_STEPS)
  const rawFlattenedPoints = boundedArray(value.flattenedPoints, MAX_ROUTE_POINT_VALUES)
  let pointValueCount = rawFlattenedPoints.length
  for (const rawStep of rawSteps) {
    if (!isRecord(rawStep)) malformedOutput()
    pointValueCount += boundedArray(rawStep.points, MAX_POINTS_PER_STEP).length
    if (pointValueCount > MAX_ROUTE_POINT_VALUES) malformedOutput()
  }
  const route: RouteSnapshot = Object.freeze({
    graphId: outputId(value.graphId),
    graphRoutingRevision: nonNegativeInteger(value.graphRoutingRevision),
    startNodeId: outputId(value.startNodeId),
    goalNodeId: outputId(value.goalNodeId),
    selectedRequirementNodeIds: stringArray(value.selectedRequirementNodeIds),
    nodeIds: stringArray(value.nodeIds),
    layerIds: stringArray(value.layerIds),
    steps: Object.freeze(rawSteps.map(routeStep)),
    flattenedPoints: Object.freeze(rawFlattenedPoints.map(point)),
    totalLength: finiteNumber(value.totalLength),
    totalWeight: finiteNumber(value.totalWeight),
  })
  if (route.nodeIds.length === 0 || route.layerIds.length === 0) malformedOutput()
  return route
}

function pathStats(value: unknown): PathStats {
  if (!isRecord(value) || value.algorithm !== 'CONSTRAINED_DIJKSTRA') malformedOutput()
  return Object.freeze({
    algorithm: value.algorithm,
    visitedStateCount: nonNegativeInteger(value.visitedStateCount),
    durationMs: finiteNumber(value.durationMs),
  })
}

const PATH_FAILURE_CODES = new Set<TopologyPathFailureCode>([
  'GRAPH_NOT_FOUND',
  'START_NOT_FOUND',
  'GOAL_NOT_FOUND',
  'REQUIREMENT_NODE_NOT_FOUND',
  'REVISION_CONFLICT',
  'NO_PATH',
  'NO_PATH_SATISFYING_REQUIREMENTS',
  'NO_PATH_WITHIN_WEIGHT',
])

function pathFailureCode(value: unknown): TopologyPathFailureCode {
  if (typeof value !== 'string' || !PATH_FAILURE_CODES.has(value as TopologyPathFailureCode)) {
    malformedOutput()
  }
  return value as TopologyPathFailureCode
}

function parseFindPathResult(
  value: unknown,
  request: Readonly<TopologyPathRequest>,
): TopologyFindPathResult {
  if (!isRecord(value)) malformedOutput()
  if (value.ok === false) {
    const code = pathFailureCode(value.code)
    if (typeof value.message !== 'string') malformedOutput()
    return Object.freeze({ kind: 'path-failure', code, message: PATH_FAILURE_MESSAGES[code] })
  }
  if (value.ok !== true) malformedOutput()

  const route = routeSnapshot(value.route)
  if (
    route.graphId !== request.graphId ||
    route.startNodeId !== request.startNodeId ||
    route.goalNodeId !== request.goalNodeId ||
    route.nodeIds[0] !== request.startNodeId ||
    route.nodeIds[route.nodeIds.length - 1] !== request.goalNodeId ||
    route.selectedRequirementNodeIds.length !== 0
  ) {
    malformedOutput()
  }
  return Object.freeze({
    kind: 'path',
    graphId: request.graphId,
    startNodeId: request.startNodeId,
    goalNodeId: request.goalNodeId,
    route,
    stats: pathStats(value.stats),
  })
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function parseRenderRouteResult(
  value: unknown,
  path: TopologyPathReceipt,
): TopologyRenderRouteResult {
  if (!isRecord(value)) malformedOutput()
  if (value.rendered === false) {
    if (value.code !== 'GRAPH_NOT_FOUND' && value.code !== 'STALE_ROUTE') malformedOutput()
    if (value.currentRevision !== undefined) nonNegativeInteger(value.currentRevision)
    return Object.freeze({
      kind: 'render-failure',
      code: value.code,
      message: RENDER_FAILURE_MESSAGES[value.code],
      ...(value.currentRevision === undefined
        ? {}
        : { currentRevision: value.currentRevision as number }),
    })
  }
  if (value.rendered !== true || value.status !== 'ACTIVE') malformedOutput()

  const nodeIds = stringArray(value.nodeIds)
  const layerIds = stringArray(value.layerIds)
  const edgeIds = stringArray(value.edgeIds)
  const graphId = outputId(value.graphId)
  const graphRoutingRevision = nonNegativeInteger(value.graphRoutingRevision)
  const totalLength = finiteNumber(value.totalLength)
  const totalWeight = finiteNumber(value.totalWeight)
  const expectedEdgeIds = path.route.steps.map((step) => step.edgeId)
  if (
    graphId !== path.graphId ||
    graphRoutingRevision !== path.route.graphRoutingRevision ||
    !sameStrings(nodeIds, path.route.nodeIds) ||
    !sameStrings(layerIds, path.route.layerIds) ||
    !sameStrings(edgeIds, expectedEdgeIds) ||
    totalLength !== path.route.totalLength ||
    totalWeight !== path.route.totalWeight
  ) {
    malformedOutput()
  }
  return Object.freeze({
    kind: 'rendered',
    routeId: outputId(value.id),
    graphId,
    graphRoutingRevision,
    nodeIds,
    layerIds,
    edgeIds,
    totalLength,
    totalWeight,
  })
}

function parseRemoveRouteResult(value: unknown, routeId: string): TopologyRemoveRouteResult {
  if (!isRecord(value) || value.id !== routeId || typeof value.removed !== 'boolean') malformedOutput()
  return Object.freeze({ routeId, removed: value.removed })
}

async function executeTrusted(
  runtime: TopologyQuickActionTemplateRuntime,
  templateId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await runtime.execute(templateId, params, TRUSTED_EXECUTE_OPTIONS)
  } catch {
    throw new TopologyQuickActionError('TEMPLATE_EXECUTION_FAILED')
  }
}

export function createTopologyQuickActionFacade(
  runtime: TopologyQuickActionTemplateRuntime = templateRuntime,
): TopologyQuickActionFacade {
  const issuedPathReceipts = new WeakSet<TopologyPathReceipt>()
  const issuedRouteIds = new Set<string>()
  const pendingRouteRemovals = new Set<string>()
  return Object.freeze({
    async findPath(request: TopologyPathRequest): Promise<TopologyFindPathResult> {
      const graphId = inputId(request.graphId)
      const startNodeId = inputId(request.startNodeId)
      const goalNodeId = inputId(request.goalNodeId)
      if (startNodeId === goalNodeId) invalidInput()
      const exactRequest = Object.freeze({ graphId, startNodeId, goalNodeId })
      const value = await executeTrusted(runtime, FIND_PATH_TEMPLATE_ID, {
        query: exactRequest,
      })
      const result = parseFindPathResult(value, exactRequest)
      if (result.kind === 'path') issuedPathReceipts.add(result)
      return result
    },

    async renderRoute(path: TopologyPathReceipt): Promise<TopologyRenderRouteResult> {
      if (path.kind !== 'path' || !issuedPathReceipts.delete(path)) invalidInput()
      const value = await executeTrusted(runtime, RENDER_ROUTE_TEMPLATE_ID, {
        options: {
          route: path.route,
          visible: true,
          style: ROUTE_STYLE,
          flow: ROUTE_FLOW,
        },
      })
      const result = parseRenderRouteResult(value, path)
      if (result.kind === 'rendered') issuedRouteIds.add(result.routeId)
      return result
    },

    async removeRoute(routeIdValue: string): Promise<TopologyRemoveRouteResult> {
      const routeId = inputId(routeIdValue)
      if (!issuedRouteIds.has(routeId) || pendingRouteRemovals.has(routeId)) invalidInput()
      pendingRouteRemovals.add(routeId)
      try {
        const value = await executeTrusted(runtime, REMOVE_ROUTE_TEMPLATE_ID, { routeId })
        const result = parseRemoveRouteResult(value, routeId)
        issuedRouteIds.delete(routeId)
        return result
      } finally {
        pendingRouteRemovals.delete(routeId)
      }
    },
  })
}

export function normalizeTopologyQuickActionError(error: unknown): Readonly<{
  code: TopologyQuickActionErrorCode
  message: string
}> {
  if (error instanceof TopologyQuickActionError) {
    return Object.freeze({ code: error.code, message: error.userMessage })
  }
  return Object.freeze({
    code: 'TEMPLATE_EXECUTION_FAILED',
    message: ERROR_MESSAGES.TEMPLATE_EXECUTION_FAILED,
  })
}

export const topologyQuickActionFacade = createTopologyQuickActionFacade()
