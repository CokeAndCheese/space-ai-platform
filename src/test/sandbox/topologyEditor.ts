import * as THREE from 'three'
import type { GlbTopologyDocument } from '@/adapters/glbTopology'
import { applyTopologyOverrideDocument } from '../../adapters/glbTopology/override.js'
import type {
  TopologyOverrideDocument,
  TopologyOverrideV2Document,
} from '@/adapters/glbTopology/override.js'
import type { TopologyGraphInput, TopologyGraphPoint } from '@/ssp/topology/types'

export interface TopologyEditorPoint {
  x: number
  y: number
  z: number
}

export interface TopologyEditorOverrideRecord {
  graphId: string
  edgeId: string
  path: {
    type: 'POLYLINE'
    via: readonly TopologyEditorPoint[]
  }
}

export function clonePoint(point: TopologyGraphPoint): TopologyEditorPoint {
  return { x: point.x, y: point.y, z: point.z }
}

export function clonePoints(points: readonly TopologyGraphPoint[]): TopologyEditorPoint[] {
  return points.map(clonePoint)
}

export function modelToWorld(point: TopologyGraphPoint, root: THREE.Object3D): THREE.Vector3 {
  root.updateWorldMatrix(true, false)
  return new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(root.matrixWorld)
}

export function worldToModel(point: THREE.Vector3, root: THREE.Object3D): TopologyEditorPoint {
  root.updateWorldMatrix(true, false)
  return clonePoint(point.clone().applyMatrix4(root.matrixWorld.clone().invert()))
}

export function getGraph(
  topology: GlbTopologyDocument,
  graphId: string,
): TopologyGraphInput | undefined {
  return topology.graphs.find((graph) => graph.id === graphId)
}

export function getEdge(
  graph: TopologyGraphInput | undefined,
  edgeId: string,
): TopologyGraphInput['edges'][number] | undefined {
  return graph?.edges.find((edge) => edge.id === edgeId)
}

export function sameLayer(
  graph: TopologyGraphInput | undefined,
  edge: TopologyGraphInput['edges'][number] | undefined,
): boolean {
  if (!graph || !edge) return false
  const source = graph.nodes.find((node) => node.id === edge.source)
  const target = graph.nodes.find((node) => node.id === edge.target)
  return Boolean(source && target && source.layerId === target.layerId)
}

export function edgeEndpoints(
  graph: TopologyGraphInput,
  edge: TopologyGraphInput['edges'][number],
): [TopologyGraphPoint, TopologyGraphPoint] | null {
  const source = graph.nodes.find((node) => node.id === edge.source)
  const target = graph.nodes.find((node) => node.id === edge.target)
  return source && target ? [source.position, target.position] : null
}

/** Keep exported override JSON stable for diffs and review. */
export function deterministicStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize)
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)]),
      )
    }
    return input
  }
  return `${JSON.stringify(normalize(value), null, 2)}\n`
}

/** The editor keeps one asset-qualified override document for multi-GLB scenes. */
export function createEmptyOverrideDocument(
  graphId = '',
  sourceAsset?: string,
): TopologyOverrideV2Document {
  return {
    overrideSchemaVersion: 2,
    coordinateSpace: 'MODEL_LOCAL',
    target: { graphId, ...(sourceAsset ? { sourceAsset } : {}) },
    operations: [],
  }
}

/** Read the editor's canonical records, while tolerating a validated API document. */
export function readOverrideRecords(value: unknown): TopologyEditorOverrideRecord[] {
  if (!value || typeof value !== 'object') return []
  const source = value as Record<string, unknown>
  const direct = Array.isArray(source.operations)
    ? source.operations.filter((operation) => (
      operation !== null
      && typeof operation === 'object'
      && (operation as Record<string, unknown>).type === 'OVERRIDE_EDGE_PATH'
    ))
    : Array.isArray(source.edgeOverrides)
      ? source.edgeOverrides
      : Array.isArray(source.overrides) ? source.overrides : []
  const target = source.target && typeof source.target === 'object'
    ? source.target as Record<string, unknown>
    : undefined
  const targetGraphId = typeof target?.graphId === 'string' ? target.graphId : ''
  const recordsByEdgeId = new Map<string, TopologyEditorOverrideRecord>()
  for (const item of direct) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const path = entry.path
    const via = path && typeof path === 'object' ? (path as Record<string, unknown>).via : entry.via
    if (
      typeof entry.edgeId !== 'string' ||
      !Array.isArray(via)
    ) continue
    const points = via.filter((point): point is TopologyEditorPoint => {
      if (!point || typeof point !== 'object') return false
      const candidate = point as Record<string, unknown>
      return ['x', 'y', 'z'].every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))
    })
    if (points.length !== via.length) continue
    const record = {
      graphId: typeof entry.graphId === 'string' ? entry.graphId : targetGraphId,
      edgeId: entry.edgeId,
      path: { type: 'POLYLINE', via: points.map(clonePoint) },
    } satisfies TopologyEditorOverrideRecord
    // A V2 operation log may override the same edge more than once. The last
    // operation is the currently effective path.
    recordsByEdgeId.set(record.edgeId, record)
  }
  return [...recordsByEdgeId.values()].sort((left, right) => left.edgeId.localeCompare(right.edgeId))
}

export function findOverrideRecord(
  value: unknown,
  graphId: string,
  edgeId: string,
): TopologyEditorOverrideRecord | undefined {
  return readOverrideRecords(value).find((record) =>
    record.graphId === graphId && record.edgeId === edgeId,
  )
}

/** The browser editor keeps cross-layer connector geometry read-only. */
export function findNonSameLayerOverrideEdgeIds(
  topology: GlbTopologyDocument,
  document: TopologyOverrideDocument | TopologyOverrideV2Document,
): string[] {
  const effective = applyTopologyOverrideDocument(topology, document)
  const graph = getGraph(effective, document.target.graphId)
  return readOverrideRecords(document)
    .filter((entry) => !sameLayer(graph, getEdge(graph, entry.edgeId)))
    .map((entry) => entry.edgeId)
    .sort((left, right) => left.localeCompare(right))
}
