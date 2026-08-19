import type {
  TopologyGraphEdgeInput,
  TopologyGraphInput,
  TopologyGraphNodeInput,
  TopologyGraphPoint,
} from '../../ssp/topology/types'
import {
  GLB_TOPOLOGY_COORDINATE_SPACE,
  GLB_TOPOLOGY_SCHEMA_VERSION,
  type GlbTopologyDocument,
} from './types'

const MAX_VIA_PER_EDGE = 64
const MIN_EDGE_LENGTH = 1e-6

export type GlbTopologyValidationCode =
  | 'INVALID_SCHEMA'
  | 'INVALID_VALUE'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_ENDPOINT'
  | 'NON_FINITE_POINT'

export class GlbTopologyValidationError extends Error {
  readonly name = 'GlbTopologyValidationError'

  constructor(
    readonly code: GlbTopologyValidationCode,
    message: string,
    readonly path?: string,
  ) {
    super(`[glbTopology] ${message}`)
  }
}

function fail(code: GlbTopologyValidationCode, message: string, path?: string): never {
  throw new GlbTopologyValidationError(code, message, path)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_SCHEMA', `${path} must be an object`, path)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_VALUE', `${path} must be a non-empty string`, path)
  }
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_VALUE', `${path} must be a finite number`, path)
  }
  return value
}

function point(value: unknown, path: string): TopologyGraphPoint {
  const source = record(value, path)
  const coordinates = ['x', 'y', 'z'] as const
  coordinates.forEach((coordinate) => {
    if (typeof source[coordinate] !== 'number' || !Number.isFinite(source[coordinate])) {
      fail('NON_FINITE_POINT', `${path}.${coordinate} must be finite`, `${path}.${coordinate}`)
    }
  })
  const result = {
    x: source.x as number,
    y: source.y as number,
    z: source.z as number,
  }
  return result
}

function stringArray(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) fail('INVALID_VALUE', `${path} must be an array`, path)
  return value.map((item, index) => stringValue(item, `${path}[${index}]`))
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('INVALID_VALUE', `${path} must be a boolean`, path)
  return value
}

function ensureUnique(items: readonly { id: string }[], label: string, path: string): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) fail('DUPLICATE_ID', `duplicate ${label} id "${item.id}"`, `${path}[${index}].id`)
    seen.add(item.id)
  })
}

function pointDistance(left: TopologyGraphPoint, right: TopologyGraphPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
}

function validateNode(value: unknown, path: string): TopologyGraphNodeInput {
  const source = record(value, path)
  const node: TopologyGraphNodeInput = {
    id: stringValue(source.id, `${path}.id`),
    layerId: stringValue(source.layerId, `${path}.layerId`),
    position: point(source.position, `${path}.position`),
    connectorId: source.connectorId === undefined ? undefined : stringValue(source.connectorId, `${path}.connectorId`),
    label: source.label === undefined ? undefined : stringValue(source.label, `${path}.label`),
    kind: source.kind === undefined ? undefined : stringValue(source.kind, `${path}.kind`),
    subtype: source.subtype === undefined ? undefined : stringValue(source.subtype, `${path}.subtype`),
    tags: stringArray(source.tags, `${path}.tags`),
    data: source.data === undefined ? undefined : record(source.data, `${path}.data`),
  }
  return node
}

function validateEdge(value: unknown, path: string): TopologyGraphEdgeInput {
  const source = record(value, path)
  const edge: TopologyGraphEdgeInput = {
    id: stringValue(source.id, `${path}.id`),
    source: stringValue(source.source, `${path}.source`),
    target: stringValue(source.target, `${path}.target`),
    relation: source.relation as TopologyGraphEdgeInput['relation'],
    direction: source.direction as TopologyGraphEdgeInput['direction'],
    weight: source.weight === undefined ? undefined : finiteNumber(source.weight, `${path}.weight`),
    mode: source.mode === undefined ? undefined : stringValue(source.mode, `${path}.mode`),
    tags: stringArray(source.tags, `${path}.tags`),
    data: source.data === undefined ? undefined : record(source.data, `${path}.data`),
  }
  if (edge.relation !== 'LINK' && edge.relation !== 'CONNECTOR') {
    fail('INVALID_VALUE', `${path}.relation is invalid`, `${path}.relation`)
  }
  if (edge.direction !== 'FORWARD' && edge.direction !== 'BIDIRECTIONAL') {
    fail('INVALID_VALUE', `${path}.direction is invalid`, `${path}.direction`)
  }
  if (source.path !== undefined) {
    const pathValue = record(source.path, `${path}.path`)
    if (pathValue.type !== 'POLYLINE' || !Array.isArray(pathValue.via)) {
      fail('INVALID_VALUE', `${path}.path must be a POLYLINE`, `${path}.path`)
    }
    edge.path = {
      type: 'POLYLINE',
      via: pathValue.via.map((item, index) => point(item, `${path}.path.via[${index}]`)),
    }
    if (edge.path.via.length > MAX_VIA_PER_EDGE) {
      fail('INVALID_VALUE', `${path}.path.via exceeds ${MAX_VIA_PER_EDGE} points`, `${path}.path.via`)
    }
  }
  if (source.initialState !== undefined) {
    const state = record(source.initialState, `${path}.initialState`)
    edge.initialState = {
      enabled: state.enabled === undefined ? undefined : booleanValue(state.enabled, `${path}.initialState.enabled`),
      weightOverride:
        state.weightOverride === undefined || state.weightOverride === null
          ? state.weightOverride as null | undefined
          : finiteNumber(state.weightOverride, `${path}.initialState.weightOverride`),
      blockerIds: stringArray(state.blockerIds, `${path}.initialState.blockerIds`),
    }
  }
  return edge
}

function validateGraph(value: unknown, path: string): TopologyGraphInput {
  const source = record(value, path)
  if (!Array.isArray(source.layers)) fail('INVALID_SCHEMA', `${path}.layers must be an array`, `${path}.layers`)
  if (!Array.isArray(source.nodes)) fail('INVALID_SCHEMA', `${path}.nodes must be an array`, `${path}.nodes`)
  if (!Array.isArray(source.edges)) fail('INVALID_SCHEMA', `${path}.edges must be an array`, `${path}.edges`)
  if (source.layers.length === 0) fail('INVALID_SCHEMA', `${path}.layers must not be empty`, `${path}.layers`)
  if (source.nodes.length === 0) fail('INVALID_SCHEMA', `${path}.nodes must not be empty`, `${path}.nodes`)

  const layers = source.layers.map((item, index) => {
    const layer = record(item, `${path}.layers[${index}]`)
    return {
      id: stringValue(layer.id, `${path}.layers[${index}].id`),
      label: layer.label === undefined ? undefined : stringValue(layer.label, `${path}.layers[${index}].label`),
      order: layer.order === undefined ? undefined : finiteNumber(layer.order, `${path}.layers[${index}].order`),
      elevation:
        layer.elevation === undefined ? undefined : finiteNumber(layer.elevation, `${path}.layers[${index}].elevation`),
      tags: stringArray(layer.tags, `${path}.layers[${index}].tags`),
      data: layer.data === undefined ? undefined : record(layer.data, `${path}.layers[${index}].data`),
    }
  })
  const nodes = source.nodes.map((item, index) => validateNode(item, `${path}.nodes[${index}]`))
  const edges = source.edges.map((item, index) => validateEdge(item, `${path}.edges[${index}]`))
  ensureUnique(layers, 'layer', `${path}.layers`)
  ensureUnique(nodes, 'node', `${path}.nodes`)
  ensureUnique(edges, 'edge', `${path}.edges`)

  const layerIds = new Set(layers.map((layer) => layer.id))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  nodes.forEach((node, index) => {
    if (!layerIds.has(node.layerId)) {
      fail('UNKNOWN_ENDPOINT', `node references unknown layer "${node.layerId}"`, `${path}.nodes[${index}].layerId`)
    }
  })
  edges.forEach((edge, index) => {
    const edgePath = `${path}.edges[${index}]`
    if (!nodeIds.has(edge.source)) {
      fail('UNKNOWN_ENDPOINT', `edge references unknown source "${edge.source}"`, `${edgePath}.source`)
    }
    if (!nodeIds.has(edge.target)) {
      fail('UNKNOWN_ENDPOINT', `edge references unknown target "${edge.target}"`, `${edgePath}.target`)
    }
    if (edge.source === edge.target) {
      fail('INVALID_VALUE', 'edge source and target must be different', edgePath)
    }
    const sourceNode = nodeById.get(edge.source)!
    const targetNode = nodeById.get(edge.target)!
    const crossesLayer = sourceNode.layerId !== targetNode.layerId
    if (!crossesLayer && edge.relation !== 'LINK') {
      fail('INVALID_VALUE', 'same-layer edge must use relation LINK', `${edgePath}.relation`)
    }
    if (crossesLayer) {
      if (edge.relation !== 'CONNECTOR') {
        fail('INVALID_VALUE', 'cross-layer edge must use relation CONNECTOR', `${edgePath}.relation`)
      }
      if (!sourceNode.connectorId || sourceNode.connectorId !== targetNode.connectorId) {
        fail('INVALID_VALUE', 'cross-layer endpoints must share a non-empty connectorId', edgePath)
      }
    }
    const points = [sourceNode.position, ...(edge.path?.via ?? []), targetNode.position]
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      if (pointDistance(points[pointIndex - 1], points[pointIndex]) <= MIN_EDGE_LENGTH) {
        fail('INVALID_VALUE', 'edge contains equal or effectively equal adjacent points', `${edgePath}.path`)
      }
    }
  })

  return {
    id: stringValue(source.id, `${path}.id`),
    layers,
    nodes,
    edges,
    tags: stringArray(source.tags, `${path}.tags`),
    data: source.data === undefined ? undefined : record(source.data, `${path}.data`),
  }
}

/** Parse and validate the embedded V1 payload without mutating it. */
export function validateEmbeddedTopology(value: unknown): GlbTopologyDocument {
  const source = record(value, 'topology')
  if (source.schemaVersion !== GLB_TOPOLOGY_SCHEMA_VERSION) {
    fail('INVALID_SCHEMA', `schemaVersion must be ${GLB_TOPOLOGY_SCHEMA_VERSION}`, 'topology.schemaVersion')
  }
  if (source.coordinateSpace !== GLB_TOPOLOGY_COORDINATE_SPACE) {
    fail('INVALID_SCHEMA', `coordinateSpace must be ${GLB_TOPOLOGY_COORDINATE_SPACE}`, 'topology.coordinateSpace')
  }
  if (!Array.isArray(source.graphs)) fail('INVALID_SCHEMA', 'topology.graphs must be an array', 'topology.graphs')
  if (source.graphs.length === 0) fail('INVALID_SCHEMA', 'topology.graphs must not be empty', 'topology.graphs')

  const graphValues = source.graphs.map((item, index) => validateGraph(item, `topology.graphs[${index}]`))
  ensureUnique(
    graphValues.filter((graph): graph is TopologyGraphInput & { id: string } => typeof graph.id === 'string'),
    'graph',
    'topology.graphs',
  )

  let generator: GlbTopologyDocument['generator']
  if (source.generator !== undefined) {
    const generatorSource = record(source.generator, 'topology.generator')
    generator = {
      name: stringValue(generatorSource.name, 'topology.generator.name'),
      version: stringValue(generatorSource.version, 'topology.generator.version'),
      parameters:
        generatorSource.parameters === undefined
          ? undefined
          : record(generatorSource.parameters, 'topology.generator.parameters'),
    }
  }

  return {
    schemaVersion: GLB_TOPOLOGY_SCHEMA_VERSION,
    coordinateSpace: GLB_TOPOLOGY_COORDINATE_SPACE,
    generator,
    graphs: graphValues,
    diagnostics: source.diagnostics === undefined ? undefined : record(source.diagnostics, 'topology.diagnostics'),
  }
}

export function isEmbeddedTopology(value: unknown): value is GlbTopologyDocument {
  try {
    validateEmbeddedTopology(value)
    return true
  } catch {
    return false
  }
}

export type { TopologyGraphEdgeInput, TopologyGraphNodeInput, TopologyGraphPoint }
