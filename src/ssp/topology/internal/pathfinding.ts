import {
  TopologyError,
  type TopologyGraphPoint,
  type TopologyPathQuery,
  type TopologyPathResult,
  type TopologyRouteSnapshot,
  type TopologyRouteStep,
  type TopologyVisitRequirement,
} from '../types'
import type { GraphArc, GraphRecord } from './graphManager'

const MAX_REQUIREMENT_GROUPS = 4
const DISTANCE_EPSILON = 1e-10

interface SearchState {
  key: string
  nodeId: string
  mask: number
  distance: number
  order: number
}

interface PreviousState {
  previousKey: string
  arc: GraphArc
}

interface SearchResult {
  final: SearchState | null
  previous: Map<string, PreviousState>
  visitedStateCount: number
}

/** @internal 最小二叉堆；distance 相同按入堆顺序保证确定性。 */
class MinHeap {
  private readonly items: SearchState[] = []

  get size(): number {
    return this.items.length
  }

  push(item: SearchState): void {
    this.items.push(item)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!this.before(this.items[index], this.items[parent])) break
      ;[this.items[index], this.items[parent]] = [this.items[parent], this.items[index]]
      index = parent
    }
  }

  pop(): SearchState | null {
    const first = this.items[0]
    const last = this.items.pop()
    if (!first || !last) return first ?? null
    if (this.items.length === 0) return first
    this.items[0] = last
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let next = index
      if (left < this.items.length && this.before(this.items[left], this.items[next])) next = left
      if (right < this.items.length && this.before(this.items[right], this.items[next])) next = right
      if (next === index) break
      ;[this.items[index], this.items[next]] = [this.items[next], this.items[index]]
      index = next
    }
    return first
  }

  private before(a: SearchState, b: SearchState): boolean {
    return a.distance < b.distance || (a.distance === b.distance && a.order < b.order)
  }
}

function fail(message: string, path: string): never {
  throw new TopologyError('INVALID_ARGUMENT', message, path)
}

function requiredId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${path} must be a non-empty string`, path)
  return value.trim()
}

function stringList(value: unknown, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${path} must be an array`, path)
  return Array.from(new Set(value.map((item, index) => requiredId(item, `${path}[${index}]`))))
}

function finiteNonNegative(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${path} must be a finite number greater than or equal to 0`, path)
  }
  return value
}

function stateKey(nodeId: string, mask: number): string {
  return JSON.stringify([nodeId, mask])
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function compileRequirements(
  graph: GraphRecord,
  value: unknown,
):
  | { ok: true; requirements: string[][]; nodeMasks: Map<string, number>; fullMask: number }
  | { ok: false; result: TopologyPathResult } {
  if (value === undefined) {
    return { ok: true, requirements: [], nodeMasks: new Map(), fullMask: 0 }
  }
  if (!Array.isArray(value)) fail('query.requirements must be an array', 'query.requirements')
  if (value.length > MAX_REQUIREMENT_GROUPS) {
    throw new TopologyError(
      'LIMIT_EXCEEDED',
      `query.requirements exceeds the ${MAX_REQUIREMENT_GROUPS} group limit`,
      'query.requirements',
    )
  }

  const requirements: string[][] = []
  const nodeMasks = new Map<string, number>()
  for (const [index, raw] of value.entries()) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      fail(`query.requirements[${index}] must be an object`, `query.requirements[${index}]`)
    }
    const nodes = stringList(
      (raw as TopologyVisitRequirement).anyOfNodeIds,
      `query.requirements[${index}].anyOfNodeIds`,
    )
    if (nodes.length === 0) {
      fail(
        `query.requirements[${index}].anyOfNodeIds must not be empty`,
        `query.requirements[${index}].anyOfNodeIds`,
      )
    }
    for (const nodeId of nodes) {
      if (!graph.nodeById.has(nodeId)) {
        return {
          ok: false,
          result: {
            ok: false,
            code: 'REQUIREMENT_NODE_NOT_FOUND',
            message: `requirement node "${nodeId}" was not found`,
            requirementIndex: index,
          },
        }
      }
      nodeMasks.set(nodeId, (nodeMasks.get(nodeId) ?? 0) | (1 << index))
    }
    requirements.push(nodes)
  }
  return {
    ok: true,
    requirements,
    nodeMasks,
    fullMask: requirements.length === 0 ? 0 : (1 << requirements.length) - 1,
  }
}

function search(
  graph: GraphRecord,
  startNodeId: string,
  goalNodeId: string,
  nodeMasks: ReadonlyMap<string, number>,
  fullMask: number,
  allowedModes: ReadonlySet<string> | null,
  excludedNodes: ReadonlySet<string>,
  excludedEdges: ReadonlySet<string>,
  maxWeight: number,
): SearchResult {
  const startMask = nodeMasks.get(startNodeId) ?? 0
  const startKey = stateKey(startNodeId, startMask)
  const distances = new Map<string, number>([[startKey, 0]])
  const previous = new Map<string, PreviousState>()
  const heap = new MinHeap()
  let order = 0
  let visitedStateCount = 0
  heap.push({ key: startKey, nodeId: startNodeId, mask: startMask, distance: 0, order: order++ })

  while (heap.size > 0) {
    const current = heap.pop()!
    const best = distances.get(current.key)
    if (best === undefined || current.distance > best + DISTANCE_EPSILON) continue
    visitedStateCount += 1
    if (current.nodeId === goalNodeId && current.mask === fullMask) {
      return { final: current, previous, visitedStateCount }
    }

    for (const arc of graph.adjacency.get(current.nodeId) ?? []) {
      const edge = graph.edgeById.get(arc.edgeId)!
      if (!edge.routingState.enabled || edge.routingState.blockerIds.length > 0) continue
      if (excludedEdges.has(edge.id) || excludedNodes.has(arc.to)) continue
      if (allowedModes && (!edge.mode || !allowedModes.has(edge.mode))) continue
      const weight = edge.routingState.weightOverride ?? edge.baseWeight
      const nextDistance = current.distance + weight
      if (nextDistance > maxWeight + DISTANCE_EPSILON) continue
      const nextMask = current.mask | (nodeMasks.get(arc.to) ?? 0)
      const nextKey = stateKey(arc.to, nextMask)
      const known = distances.get(nextKey)
      if (known !== undefined && nextDistance >= known - DISTANCE_EPSILON) continue
      distances.set(nextKey, nextDistance)
      previous.set(nextKey, { previousKey: current.key, arc })
      heap.push({
        key: nextKey,
        nodeId: arc.to,
        mask: nextMask,
        distance: nextDistance,
        order: order++,
      })
    }
  }

  return { final: null, previous, visitedStateCount }
}

function orientedPoints(graph: GraphRecord, arc: GraphArc): TopologyGraphPoint[] {
  const edge = graph.edgeById.get(arc.edgeId)!
  const source = edge.points.map((item) => ({ ...item }))
  return arc.traversalDirection === 'FORWARD' ? source : source.reverse()
}

function reconstruct(
  graph: GraphRecord,
  final: SearchState,
  previous: ReadonlyMap<string, PreviousState>,
  startNodeId: string,
  goalNodeId: string,
  requirements: readonly (readonly string[])[],
): TopologyRouteSnapshot {
  const arcs: GraphArc[] = []
  let key = final.key
  while (true) {
    const prior = previous.get(key)
    if (!prior) break
    arcs.push(prior.arc)
    key = prior.previousKey
  }
  arcs.reverse()

  const steps: TopologyRouteStep[] = arcs.map((arc) => {
    const edge = graph.edgeById.get(arc.edgeId)!
    const from = graph.nodeById.get(arc.from)!
    const to = graph.nodeById.get(arc.to)!
    return {
      edgeId: edge.id,
      fromNodeId: from.id,
      toNodeId: to.id,
      fromLayerId: from.layerId,
      toLayerId: to.layerId,
      relation: edge.relation,
      traversalDirection: arc.traversalDirection,
      points: orientedPoints(graph, arc),
      length: edge.length,
      weight: edge.routingState.weightOverride ?? edge.baseWeight,
      mode: edge.mode,
    }
  })

  const nodeIds = [startNodeId, ...steps.map((step) => step.toNodeId)]
  const layerIds: string[] = []
  for (const nodeId of nodeIds) {
    const layerId = graph.nodeById.get(nodeId)!.layerId
    if (!layerIds.includes(layerId)) layerIds.push(layerId)
  }
  const flattenedPoints = steps.length === 0
    ? [{ ...graph.nodeById.get(startNodeId)!.position }]
    : steps.flatMap((step, index) => (
      index === 0 ? step.points : step.points.slice(1)
    )).map((item) => ({ ...item }))
  const selectedRequirementNodeIds = requirements.map((group) => (
    nodeIds.find((nodeId) => group.includes(nodeId))!
  ))

  return {
    graphId: graph.id,
    graphRoutingRevision: graph.routingRevision,
    startNodeId,
    goalNodeId,
    selectedRequirementNodeIds,
    nodeIds,
    layerIds,
    steps,
    flattenedPoints,
    totalLength: steps.reduce((total, step) => total + step.length, 0),
    totalWeight: steps.reduce((total, step) => total + step.weight, 0),
  }
}

/**
 * @internal 精确约束 Dijkstra。
 * 状态为 (nodeId, 已满足 requirement bitmask)，因此不会使用逐点贪心近似。
 */
export function findPathInGraph(
  graph: GraphRecord,
  query: TopologyPathQuery,
): TopologyPathResult {
  const startedAt = now()
  const startNodeId = requiredId(query.startNodeId, 'query.startNodeId')
  const goalNodeId = requiredId(query.goalNodeId, 'query.goalNodeId')
  if (!graph.nodeById.has(startNodeId)) {
    return { ok: false, code: 'START_NOT_FOUND', message: `start node "${startNodeId}" was not found` }
  }
  if (!graph.nodeById.has(goalNodeId)) {
    return { ok: false, code: 'GOAL_NOT_FOUND', message: `goal node "${goalNodeId}" was not found` }
  }
  if (
    query.expectedRoutingRevision !== undefined &&
    (!Number.isInteger(query.expectedRoutingRevision) || query.expectedRoutingRevision < 1)
  ) {
    fail(
      'query.expectedRoutingRevision must be a positive integer',
      'query.expectedRoutingRevision',
    )
  }
  if (
    query.expectedRoutingRevision !== undefined &&
    query.expectedRoutingRevision !== graph.routingRevision
  ) {
    return {
      ok: false,
      code: 'REVISION_CONFLICT',
      message: 'graph routing revision changed before path search',
      currentRevision: graph.routingRevision,
    }
  }

  const compiled = compileRequirements(graph, query.requirements)
  if (!compiled.ok) return compiled.result
  const allowedModeValues = query.allowedModes === undefined
    ? null
    : stringList(query.allowedModes, 'query.allowedModes')
  const allowedModes = allowedModeValues === null ? null : new Set(allowedModeValues)
  const excludedNodes = new Set(stringList(query.excludedNodeIds, 'query.excludedNodeIds'))
  const excludedEdges = new Set(stringList(query.excludedEdgeIds, 'query.excludedEdgeIds'))
  const maxWeight = query.maxWeight === undefined
    ? Number.POSITIVE_INFINITY
    : finiteNonNegative(query.maxWeight, 'query.maxWeight')

  let result: SearchResult
  if (excludedNodes.has(startNodeId) || excludedNodes.has(goalNodeId)) {
    result = { final: null, previous: new Map(), visitedStateCount: 0 }
  } else {
    result = search(
      graph,
      startNodeId,
      goalNodeId,
      compiled.nodeMasks,
      compiled.fullMask,
      allowedModes,
      excludedNodes,
      excludedEdges,
      maxWeight,
    )
  }

  if (!result.final) {
    if (query.maxWeight !== undefined) {
      const unrestricted = search(
        graph,
        startNodeId,
        goalNodeId,
        compiled.nodeMasks,
        compiled.fullMask,
        allowedModes,
        excludedNodes,
        excludedEdges,
        Number.POSITIVE_INFINITY,
      )
      if (unrestricted.final) {
        return {
          ok: false,
          code: 'NO_PATH_WITHIN_WEIGHT',
          message: `no path has total weight at most ${maxWeight}`,
        }
      }
    }
    return {
      ok: false,
      code: compiled.requirements.length > 0 ? 'NO_PATH_SATISFYING_REQUIREMENTS' : 'NO_PATH',
      message: compiled.requirements.length > 0
        ? 'no path satisfies every required node group'
        : 'no path connects the requested nodes',
    }
  }

  return {
    ok: true,
    route: reconstruct(
      graph,
      result.final,
      result.previous,
      startNodeId,
      goalNodeId,
      compiled.requirements,
    ),
    stats: {
      algorithm: 'CONSTRAINED_DIJKSTRA',
      visitedStateCount: result.visitedStateCount,
      durationMs: now() - startedAt,
    },
  }
}
