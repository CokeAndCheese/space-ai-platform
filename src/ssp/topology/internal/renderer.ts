import * as THREE from 'three'
import { getSspContext } from '../../core/context'
import {
  TopologyError,
  type TopologyEdgeFlowDirection,
  type TopologyGraphColor,
  type TopologyGraphPoint,
  type TopologyRouteApi,
  type TopologyRouteFlowStyle,
  type TopologyRouteHandle,
  type TopologyRouteRenderOptions,
  type TopologyRouteRenderResult,
  type TopologyRouteSnapshot,
  type TopologyRouteStatus,
  type TopologyRouteStyle,
  type TopologyRouteVisualStatePatch,
} from '../types'
import type { GraphManagerInternal, GraphRecord } from './graphManager'

const DEFAULT_ROUTE_STYLE: Required<TopologyRouteStyle> = Object.freeze({
  color: '#ff3b30',
  width: 0.12,
  opacity: 1,
  depthTest: true,
})

const DEFAULT_EDGE_FLOW = Object.freeze({
  direction: 'FORWARD' as TopologyEdgeFlowDirection,
  speed: 2,
  spacing: 2,
  color: '#ffffff' as TopologyGraphColor,
  size: 0.11,
})

const DEFAULT_ROUTE_FLOW = Object.freeze({
  speed: 2.5,
  spacing: 2,
  color: '#ffe066' as TopologyGraphColor,
  size: 0.13,
})

const MAX_FLOW_MARKERS_PER_PATH = 48

let nextRouteId = 1

interface VisualBuild {
  root: THREE.Group
  resources: Set<{ dispose(): void }>
  flowTrack: FlowTrack | null
}

interface EdgeVisualRecord extends VisualBuild {
  key: string
  graphId: string
  edgeId: string
  scene: THREE.Scene
}

interface NormalizedRouteOptions {
  visible: boolean
  position: TopologyGraphPoint
  style: Required<TopologyRouteStyle>
  edgeStyles: Readonly<Record<string, TopologyRouteStyle>>
  modeStyles: Readonly<Record<string, TopologyRouteStyle>>
  flow: Required<TopologyRouteFlowStyle> | null
}

interface RouteRecord {
  id: string
  graphId: string
  scene: THREE.Scene
  route: TopologyRouteSnapshot
  root: THREE.Group
  resources: Set<{ dispose(): void }>
  flowTrack: FlowTrack | null
  status: TopologyRouteStatus
  options: NormalizedRouteOptions
  handle: TopologyRouteHandle
}

interface FlowMarker {
  mesh: THREE.Mesh
  offset: number
  direction: 1 | -1
}

interface FlowTrack {
  id: string
  root: THREE.Object3D
  points: THREE.Vector3[]
  cumulative: number[]
  totalLength: number
  speed: number
  phase: number
  markers: FlowMarker[]
}

/** @internal renderer 公开路线 API 之外，仅暴露给 graph manager 的三个生命周期入口。 */
export interface TopologyRendererInternal extends TopologyRouteApi {
  invalidateRoutes(graphId: string): readonly string[]
  syncEdgeVisuals(graph: GraphRecord, edgeIds: readonly string[]): void
  removeGraphVisuals(graphId: string): void
}

function fail(
  code: ConstructorParameters<typeof TopologyError>[0],
  message: string,
  path?: string,
): never {
  throw new TopologyError(code, message, path)
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_ARGUMENT', `${path} must be a finite number`, path)
  }
  return value
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path)
  if (result <= 0) fail('INVALID_ARGUMENT', `${path} must be greater than 0`, path)
  return result
}

function opacity(value: unknown, path: string): number {
  const result = finite(value, path)
  if (result < 0 || result > 1) fail('INVALID_ARGUMENT', `${path} must be between 0 and 1`, path)
  return result
}

function color(value: unknown, path: string): TopologyGraphColor {
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

function point(value: unknown, path: string): TopologyGraphPoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', `${path} must be an object`, path)
  }
  const source = value as Record<string, unknown>
  return {
    x: finite(source.x, `${path}.x`),
    y: finite(source.y, `${path}.y`),
    z: finite(source.z, `${path}.z`),
  }
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', `${path} must be an object`, path)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_ARGUMENT', `${path} must be a non-empty string`, path)
  }
  return value
}

function validateRoute(value: unknown): asserts value is TopologyRouteSnapshot {
  const route = plainRecord(value, 'options.route')
  nonEmptyString(route.graphId, 'options.route.graphId')
  if (!Number.isInteger(route.graphRoutingRevision) || (route.graphRoutingRevision as number) < 1) {
    fail(
      'INVALID_ARGUMENT',
      'options.route.graphRoutingRevision must be a positive integer',
      'options.route.graphRoutingRevision',
    )
  }
  if (!Array.isArray(route.steps)) fail('INVALID_ARGUMENT', 'options.route.steps must be an array')
  route.steps.forEach((rawStep, index) => {
    const step = plainRecord(rawStep, `options.route.steps[${index}]`)
    nonEmptyString(step.edgeId, `options.route.steps[${index}].edgeId`)
    if (!Array.isArray(step.points) || step.points.length < 2) {
      fail(
        'INVALID_ARGUMENT',
        `options.route.steps[${index}].points must contain at least two points`,
        `options.route.steps[${index}].points`,
      )
    }
    step.points.forEach((rawPoint, pointIndex) => {
      point(rawPoint, `options.route.steps[${index}].points[${pointIndex}]`)
    })
  })
  if (!Array.isArray(route.flattenedPoints) || route.flattenedPoints.length === 0) {
    fail(
      'INVALID_ARGUMENT',
      'options.route.flattenedPoints must contain at least one point',
      'options.route.flattenedPoints',
    )
  }
  route.flattenedPoints.forEach((rawPoint, index) => {
    point(rawPoint, `options.route.flattenedPoints[${index}]`)
  })
  finite(route.totalLength, 'options.route.totalLength')
  finite(route.totalWeight, 'options.route.totalWeight')
}

function normalizeStyle(
  value: TopologyRouteStyle | undefined,
  fallback: Required<TopologyRouteStyle>,
  path: string,
): Required<TopologyRouteStyle> {
  if (value === undefined) return { ...fallback }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', `${path} must be an object`, path)
  }
  if (value.depthTest !== undefined && typeof value.depthTest !== 'boolean') {
    fail('INVALID_ARGUMENT', `${path}.depthTest must be a boolean`, `${path}.depthTest`)
  }
  return {
    color: value.color === undefined ? fallback.color : color(value.color, `${path}.color`),
    width: value.width === undefined ? fallback.width : positive(value.width, `${path}.width`),
    opacity: value.opacity === undefined ? fallback.opacity : opacity(value.opacity, `${path}.opacity`),
    depthTest: value.depthTest ?? fallback.depthTest,
  }
}

function normalizeRouteFlow(
  value: TopologyRouteFlowStyle | null | undefined,
  path: string,
): Required<TopologyRouteFlowStyle> | null {
  if (value == null || value.active === false) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', `${path} must be an object or null`, path)
  }
  if (value.active !== undefined && typeof value.active !== 'boolean') {
    fail('INVALID_ARGUMENT', `${path}.active must be a boolean`, `${path}.active`)
  }
  return {
    active: true,
    speed: value.speed === undefined ? DEFAULT_ROUTE_FLOW.speed : positive(value.speed, `${path}.speed`),
    spacing: value.spacing === undefined
      ? DEFAULT_ROUTE_FLOW.spacing
      : positive(value.spacing, `${path}.spacing`),
    color: value.color === undefined ? DEFAULT_ROUTE_FLOW.color : color(value.color, `${path}.color`),
    size: value.size === undefined ? DEFAULT_ROUTE_FLOW.size : positive(value.size, `${path}.size`),
  }
}

function normalizeRouteOptions(options: TopologyRouteRenderOptions): NormalizedRouteOptions {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    fail('INVALID_ARGUMENT', 'options must be an object', 'options')
  }
  if (options.visible !== undefined && typeof options.visible !== 'boolean') {
    fail('INVALID_ARGUMENT', 'options.visible must be a boolean', 'options.visible')
  }
  if (
    options.stalePolicy !== undefined &&
    options.stalePolicy !== 'REJECT' &&
    options.stalePolicy !== 'SNAPSHOT'
  ) {
    fail(
      'INVALID_ARGUMENT',
      'options.stalePolicy must be REJECT or SNAPSHOT',
      'options.stalePolicy',
    )
  }
  plainRecord(options.edgeStyles ?? {}, 'options.edgeStyles')
  plainRecord(options.modeStyles ?? {}, 'options.modeStyles')
  return {
    visible: options.visible ?? true,
    position: options.position === undefined
      ? { x: 0, y: 0, z: 0 }
      : point(options.position, 'options.position'),
    style: normalizeStyle(options.style, DEFAULT_ROUTE_STYLE, 'options.style'),
    edgeStyles: options.edgeStyles ?? {},
    modeStyles: options.modeStyles ?? {},
    flow: normalizeRouteFlow(options.flow, 'options.flow'),
  }
}

function disposeResources(resources: Set<{ dispose(): void }>): void {
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

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function vectors(points: readonly TopologyGraphPoint[]): THREE.Vector3[] {
  return points.map((item) => new THREE.Vector3(item.x, item.y, item.z))
}

function cumulativeLengths(points: readonly THREE.Vector3[]): number[] {
  const result = [0]
  for (let index = 1; index < points.length; index++) {
    result.push(result[index - 1] + points[index - 1].distanceTo(points[index]))
  }
  return result
}

function positionAt(
  points: readonly THREE.Vector3[],
  cumulative: readonly number[],
  totalLength: number,
  distance: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const normalized = ((distance % totalLength) + totalLength) % totalLength
  let segment = 0
  while (segment + 1 < cumulative.length && cumulative[segment + 1] < normalized) segment += 1
  const start = cumulative[segment]
  const end = cumulative[segment + 1] ?? totalLength
  const span = Math.max(end - start, Number.EPSILON)
  return target.lerpVectors(points[segment], points[Math.min(segment + 1, points.length - 1)], (
    normalized - start
  ) / span)
}

function addPolyline(
  root: THREE.Group,
  resources: Set<{ dispose(): void }>,
  points: readonly TopologyGraphPoint[],
  style: Required<TopologyRouteStyle>,
): void {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(style.color),
    transparent: style.opacity < 1,
    opacity: style.opacity,
    depthTest: style.depthTest,
    depthWrite: style.depthTest && style.opacity >= 1,
  })
  resources.add(material)
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const direction = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  for (let index = 1; index < points.length; index++) {
    start.set(points[index - 1].x, points[index - 1].y, points[index - 1].z)
    end.set(points[index].x, points[index].y, points[index].z)
    direction.subVectors(end, start)
    const length = direction.length()
    if (length <= Number.EPSILON) continue
    const geometry = new THREE.CylinderGeometry(style.width / 2, style.width / 2, length, 8, 1, false)
    resources.add(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(start).add(end).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(yAxis, direction.normalize())
    mesh.renderOrder = 810
    root.add(mesh)
  }
}

function createFlowTrack(
  id: string,
  root: THREE.Group,
  resources: Set<{ dispose(): void }>,
  rawPoints: readonly TopologyGraphPoint[],
  style: {
    speed: number
    spacing: number
    color: TopologyGraphColor
    size: number
    direction: TopologyEdgeFlowDirection
    depthTest: boolean
    opacity: number
  },
): FlowTrack | null {
  if (rawPoints.length < 2) return null
  const points = vectors(rawPoints)
  const cumulative = cumulativeLengths(points)
  const totalLength = cumulative[cumulative.length - 1]
  if (totalLength <= Number.EPSILON) return null
  const count = Math.max(1, Math.min(MAX_FLOW_MARKERS_PER_PATH, Math.ceil(totalLength / style.spacing)))
  const geometry = new THREE.SphereGeometry(style.size, 8, 6)
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(style.color),
    transparent: style.opacity < 1,
    opacity: style.opacity,
    depthTest: style.depthTest,
    depthWrite: false,
  })
  resources.add(geometry)
  resources.add(material)
  const directions: readonly (1 | -1)[] = style.direction === 'BOTH'
    ? [1, -1]
    : [style.direction === 'REVERSE' ? -1 : 1]
  const markers: FlowMarker[] = []
  for (let index = 0; index < count; index++) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 811
    root.add(mesh)
    markers.push({
      mesh,
      offset: index * (totalLength / count),
      direction: directions[index % directions.length],
    })
  }
  const track: FlowTrack = {
    id,
    root,
    points,
    cumulative,
    totalLength,
    speed: style.speed,
    phase: 0,
    markers,
  }
  const target = new THREE.Vector3()
  markers.forEach((marker) => {
    const distance = marker.direction === 1 ? marker.offset : totalLength - marker.offset
    positionAt(points, cumulative, totalLength, distance, target)
    marker.mesh.position.copy(target)
  })
  return track
}

/**
 * 创建 topology 的 Three.js 可视化 manager。
 * 所有 edge/route flow 共用一个 requestAnimationFrame，不为每段单独启动循环。
 */
export function createTopologyRenderer(graphManager: GraphManagerInternal): TopologyRendererInternal {
  const edgeVisuals = new Map<string, EdgeVisualRecord>()
  const routes = new Map<string, RouteRecord>()
  const flowTracks = new Map<string, FlowTrack>()
  let animationFrame: number | null = null
  let previousFrameTime: number | null = null

  function unregisterFlow(track: FlowTrack | null): void {
    if (!track) return
    flowTracks.delete(track.id)
    if (flowTracks.size === 0 && animationFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
      previousFrameTime = null
    }
  }

  function tick(time: number): void {
    animationFrame = null
    const delta = previousFrameTime === null ? 0 : Math.min((time - previousFrameTime) / 1_000, 0.1)
    previousFrameTime = time
    const target = new THREE.Vector3()
    for (const track of flowTracks.values()) {
      if (!track.root.visible) continue
      track.phase += track.speed * delta
      for (const marker of track.markers) {
        const distance = marker.direction === 1
          ? marker.offset + track.phase
          : track.totalLength - marker.offset - track.phase
        positionAt(track.points, track.cumulative, track.totalLength, distance, target)
        marker.mesh.position.copy(target)
      }
    }
    ensureFlowLoop()
  }

  function ensureFlowLoop(): void {
    if (
      animationFrame === null &&
      flowTracks.size > 0 &&
      typeof requestAnimationFrame === 'function'
    ) {
      animationFrame = requestAnimationFrame(tick)
    }
  }

  function registerFlow(track: FlowTrack | null): void {
    if (!track) return
    flowTracks.set(track.id, track)
    ensureFlowLoop()
  }

  function disposeBuild(build: VisualBuild): void {
    unregisterFlow(build.flowTrack)
    build.root.removeFromParent()
    build.root.clear()
    disposeResources(build.resources)
  }

  function edgeKey(graphId: string, edgeId: string): string {
    return `${graphId}\u0000${edgeId}`
  }

  function buildEdgeVisual(graph: GraphRecord, edgeId: string, scene: THREE.Scene): EdgeVisualRecord {
    const edge = graph.edgeById.get(edgeId)!
    const state = edge.visualState
    const root = new THREE.Group()
    const resources = new Set<{ dispose(): void }>()
    const key = edgeKey(graph.id, edge.id)
    root.name = `topology_edge_${graph.id}_${edge.id}`
    root.userData.__sspTopologyGraphId = graph.id
    root.userData.__sspTopologyEdgeId = edge.id
    try {
      addPolyline(root, resources, edge.points, {
        color: state.color,
        width: state.width,
        opacity: state.opacity,
        depthTest: state.depthTest,
      })
      const flow = state.flow
      const flowTrack = flow?.active
        ? createFlowTrack(`edge:${key}`, root, resources, edge.points, {
            direction: flow.direction ?? DEFAULT_EDGE_FLOW.direction,
            speed: flow.speed ?? DEFAULT_EDGE_FLOW.speed,
            spacing: flow.spacing ?? DEFAULT_EDGE_FLOW.spacing,
            color: flow.color ?? state.color ?? DEFAULT_EDGE_FLOW.color,
            size: flow.size ?? DEFAULT_EDGE_FLOW.size,
            depthTest: state.depthTest,
            opacity: state.opacity,
          })
        : null
      return { key, graphId: graph.id, edgeId: edge.id, scene, root, resources, flowTrack }
    } catch (error) {
      root.clear()
      disposeResources(resources)
      throw new TopologyError('RENDER_FAILED', `failed to build edge "${edge.id}"`, undefined, {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function syncEdgeVisuals(graph: GraphRecord, edgeIds: readonly string[]): void {
    let scene: THREE.Scene | null = null
    const visibleIds = edgeIds.filter((edgeId) => graph.edgeById.get(edgeId)!.visualState.visible)
    if (visibleIds.length > 0) {
      try {
        scene = getSspContext().scene
      } catch {
        fail('CONTEXT_UNAVAILABLE', 'Three.js context is required to display topology edges')
      }
    }

    const staged = new Map<string, EdgeVisualRecord>()
    try {
      for (const edgeId of visibleIds) {
        const built = buildEdgeVisual(graph, edgeId, scene!)
        staged.set(built.key, built)
      }
    } catch (error) {
      staged.forEach(disposeBuild)
      throw error
    }

    for (const edgeId of edgeIds) {
      const key = edgeKey(graph.id, edgeId)
      const previous = edgeVisuals.get(key)
      if (previous) {
        edgeVisuals.delete(key)
        disposeBuild(previous)
      }
      const next = staged.get(key)
      if (next) {
        next.scene.add(next.root)
        edgeVisuals.set(key, next)
        registerFlow(next.flowTrack)
      }
    }
  }

  function styleForStep(
    options: NormalizedRouteOptions,
    edgeId: string,
    mode: string | undefined,
  ): Required<TopologyRouteStyle> {
    let style = { ...options.style }
    if (mode && options.modeStyles[mode]) {
      style = normalizeStyle(options.modeStyles[mode], style, `options.modeStyles.${mode}`)
    }
    if (options.edgeStyles[edgeId]) {
      style = normalizeStyle(options.edgeStyles[edgeId], style, `options.edgeStyles.${edgeId}`)
    }
    return style
  }

  function buildRouteVisual(
    id: string,
    route: TopologyRouteSnapshot,
    options: NormalizedRouteOptions,
  ): VisualBuild {
    const root = new THREE.Group()
    const resources = new Set<{ dispose(): void }>()
    root.name = id
    root.userData.__sspTopologyRoute = true
    root.userData.__sspTopologyGraphId = route.graphId
    root.position.set(options.position.x, options.position.y, options.position.z)
    root.visible = options.visible
    try {
      if (route.steps.length === 0) {
        const routePoint = route.flattenedPoints[0]
        if (!routePoint) fail('INVALID_ARGUMENT', 'route has no renderable points', 'options.route')
        const geometry = new THREE.SphereGeometry(options.style.width, 12, 8)
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(options.style.color),
          transparent: options.style.opacity < 1,
          opacity: options.style.opacity,
          depthTest: options.style.depthTest,
        })
        resources.add(geometry)
        resources.add(material)
        const marker = new THREE.Mesh(geometry, material)
        marker.position.set(routePoint.x, routePoint.y, routePoint.z)
        root.add(marker)
      } else {
        route.steps.forEach((step) => {
          addPolyline(root, resources, step.points, styleForStep(options, step.edgeId, step.mode))
        })
      }
      const flowTrack = options.flow
        ? createFlowTrack(`route:${id}`, root, resources, route.flattenedPoints, {
            direction: 'FORWARD',
            speed: options.flow.speed,
            spacing: options.flow.spacing,
            color: options.flow.color,
            size: options.flow.size,
            depthTest: options.style.depthTest,
            opacity: options.style.opacity,
          })
        : null
      return { root, resources, flowTrack }
    } catch (error) {
      root.clear()
      disposeResources(resources)
      if (error instanceof TopologyError) throw error
      throw new TopologyError('RENDER_FAILED', 'failed to build route geometry', undefined, {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function currentRoute(record: RouteRecord): boolean {
    if (record.status === 'DISPOSED' || !isDescendantOf(record.root, record.scene)) return false
    try {
      return getSspContext().scene === record.scene
    } catch {
      return false
    }
  }

  function disposeRoute(record: RouteRecord): void {
    if (record.status === 'DISPOSED') return
    routes.delete(record.id)
    unregisterFlow(record.flowTrack)
    record.root.removeFromParent()
    record.root.clear()
    disposeResources(record.resources)
    record.flowTrack = null
    record.status = 'DISPOSED'
  }

  function renderRoute(options: TopologyRouteRenderOptions): TopologyRouteRenderResult {
    plainRecord(options, 'options')
    validateRoute(options.route)
    const graph = graphManager.getRecord(options.route.graphId)
    if (!graph) return { rendered: false, code: 'GRAPH_NOT_FOUND' }
    if (
      options.stalePolicy !== 'SNAPSHOT' &&
      options.route.graphRoutingRevision !== graph.routingRevision
    ) {
      return {
        rendered: false,
        code: 'STALE_ROUTE',
        currentRevision: graph.routingRevision,
      }
    }
    const normalized = normalizeRouteOptions(options)
    let scene: THREE.Scene
    try {
      scene = getSspContext().scene
    } catch {
      fail('CONTEXT_UNAVAILABLE', 'Three.js context is required to render a topology route')
    }
    for (const record of Array.from(routes.values())) {
      if (record.scene !== scene || !isDescendantOf(record.root, record.scene)) disposeRoute(record)
    }

    const id = `topology_route_${nextRouteId++}`
    const built = buildRouteVisual(id, options.route, normalized)
    let routeRecord!: RouteRecord
    const handle: TopologyRouteHandle = {
      get id() { return routeRecord.id },
      get root() { return routeRecord.root },
      get route() { return routeRecord.route },
      get status() { return routeRecord.status },
    }
    routeRecord = {
      id,
      graphId: graph.id,
      scene,
      route: options.route,
      root: built.root,
      resources: built.resources,
      flowTrack: built.flowTrack,
      status: normalized.visible ? 'ACTIVE' : 'HIDDEN',
      options: normalized,
      handle,
    }
    try {
      scene.add(routeRecord.root)
      routes.set(id, routeRecord)
      if (normalized.visible) registerFlow(routeRecord.flowTrack)
      return { rendered: true, handle }
    } catch (error) {
      disposeRoute(routeRecord)
      throw new TopologyError('RENDER_FAILED', 'failed to attach route to the current scene', undefined, {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function rebuildRoute(record: RouteRecord, options: NormalizedRouteOptions): void {
    const built = buildRouteVisual(record.id, record.route, options)
    const previous: VisualBuild = {
      root: record.root,
      resources: record.resources,
      flowTrack: record.flowTrack,
    }
    record.scene.add(built.root)
    // 旧、新 route flow 使用同一稳定 key；先注销旧 track，避免误删新 track。
    disposeBuild(previous)
    record.root = built.root
    record.resources = built.resources
    record.flowTrack = built.flowTrack
    record.options = options
    record.status = options.visible ? 'ACTIVE' : 'HIDDEN'
    if (options.visible) registerFlow(record.flowTrack)
  }

  function setRouteVisualState(routeId: string, patch: TopologyRouteVisualStatePatch): boolean {
    const route = routes.get(routeId)
    if (!route || !currentRoute(route) || route.status === 'STALE') return false
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      fail('INVALID_ARGUMENT', 'patch must be an object', 'patch')
    }
    if (patch.visible !== undefined && typeof patch.visible !== 'boolean') {
      fail('INVALID_ARGUMENT', 'patch.visible must be a boolean', 'patch.visible')
    }
    const nextStyle = normalizeStyle(patch, route.options.style, 'patch')
    const nextFlow = patch.flow === undefined
      ? route.options.flow
      : normalizeRouteFlow(patch.flow, 'patch.flow')
    rebuildRoute(route, {
      ...route.options,
      visible: patch.visible ?? route.options.visible,
      style: nextStyle,
      flow: nextFlow,
    })
    return true
  }

  function setRouteVisible(routeId: string, visible: boolean): boolean {
    const route = routes.get(routeId)
    if (!route || !currentRoute(route) || route.status === 'STALE') return false
    route.root.visible = visible
    route.options = { ...route.options, visible }
    route.status = visible ? 'ACTIVE' : 'HIDDEN'
    if (visible) registerFlow(route.flowTrack)
    else unregisterFlow(route.flowTrack)
    return true
  }

  function getRouteById(routeId: string): TopologyRouteHandle | null {
    const route = routes.get(routeId)
    return route && currentRoute(route) ? route.handle : null
  }

  function listRoutes(): TopologyRouteHandle[] {
    return Array.from(routes.values()).filter(currentRoute).map((route) => route.handle)
  }

  function removeRoute(routeId: string): boolean {
    const route = routes.get(routeId)
    if (!route) return false
    disposeRoute(route)
    return true
  }

  function removeAllRoutes(): number {
    const active = Array.from(routes.values())
    active.forEach(disposeRoute)
    return active.length
  }

  function invalidateRoutes(graphId: string): readonly string[] {
    const invalidated: string[] = []
    for (const route of routes.values()) {
      if (route.graphId !== graphId || route.status === 'DISPOSED' || route.status === 'STALE') continue
      unregisterFlow(route.flowTrack)
      route.root.visible = false
      route.status = 'STALE'
      invalidated.push(route.id)
    }
    return invalidated
  }

  function removeGraphVisuals(graphId: string): void {
    for (const [key, visual] of Array.from(edgeVisuals.entries())) {
      if (visual.graphId !== graphId) continue
      edgeVisuals.delete(key)
      disposeBuild(visual)
    }
    for (const route of Array.from(routes.values())) {
      if (route.graphId === graphId) disposeRoute(route)
    }
  }

  return {
    renderRoute,
    setRouteVisualState,
    showRoute: (routeId) => setRouteVisible(routeId, true),
    hideRoute: (routeId) => setRouteVisible(routeId, false),
    getRouteById,
    listRoutes,
    removeRoute,
    removeAllRoutes,
    invalidateRoutes,
    syncEdgeVisuals,
    removeGraphVisuals,
  }
}
