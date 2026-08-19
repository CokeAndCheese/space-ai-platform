import * as THREE from 'three'
import type {
  TopologyGraphEdgeInput,
  TopologyGraphInput,
  TopologyGraphNodeInput,
  TopologyGraphPoint,
} from '../../ssp/topology/types'
import { GlbTopologyValidationError, validateEmbeddedTopology } from './validation'
import type { GlbTopologyDocument, WorldTopologyBuildOptions } from './types'

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)]),
    ) as T
  }
  return value
}

function worldPoint(point: TopologyGraphPoint, matrixWorld: THREE.Matrix4, path: string): TopologyGraphPoint {
  const transformed = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(matrixWorld)
  if (![transformed.x, transformed.y, transformed.z].every(Number.isFinite)) {
    throw new GlbTopologyValidationError('NON_FINITE_POINT', `${path} became non-finite in world space`, path)
  }
  return { x: transformed.x, y: transformed.y, z: transformed.z }
}

function transformNode(node: TopologyGraphNodeInput, matrixWorld: THREE.Matrix4, path: string): TopologyGraphNodeInput {
  return {
    ...node,
    position: worldPoint(node.position, matrixWorld, `${path}.position`),
    tags: node.tags ? [...node.tags] : undefined,
    data: node.data ? cloneValue(node.data) : undefined,
  }
}

function transformEdge(edge: TopologyGraphEdgeInput, matrixWorld: THREE.Matrix4, path: string): TopologyGraphEdgeInput {
  return {
    ...edge,
    path: edge.path
      ? {
          type: 'POLYLINE',
          via: edge.path.via.map((point, index) => worldPoint(point, matrixWorld, `${path}.path.via[${index}]`)),
        }
      : undefined,
    initialState: edge.initialState
      ? {
          ...edge.initialState,
          blockerIds: edge.initialState.blockerIds ? [...edge.initialState.blockerIds] : undefined,
        }
      : undefined,
    tags: edge.tags ? [...edge.tags] : undefined,
    data: edge.data ? cloneValue(edge.data) : undefined,
  }
}

function transformGraphWithMatrix(
  graph: TopologyGraphInput,
  matrixWorld: THREE.Matrix4,
  graphPath: string,
): TopologyGraphInput {
  return {
    ...graph,
    layers: graph.layers.map((layer) => ({
      ...layer,
      tags: layer.tags ? [...layer.tags] : undefined,
      data: layer.data ? cloneValue(layer.data) : undefined,
    })),
    nodes: graph.nodes.map((node, index) => transformNode(node, matrixWorld, `${graphPath}.nodes[${index}]`)),
    edges: graph.edges.map((edge, index) => transformEdge(edge, matrixWorld, `${graphPath}.edges[${index}]`)),
    tags: graph.tags ? [...graph.tags] : undefined,
    data: graph.data ? cloneValue(graph.data) : undefined,
  }
}

/** Convert one model-local graph to world coordinates using the loaded model root. */
export function transformGraphToWorld(
  graph: TopologyGraphInput,
  root: THREE.Object3D,
  graphPath = 'graph',
): TopologyGraphInput {
  root.updateWorldMatrix(true, false)
  const matrixWorld = root.matrixWorld.clone()
  return transformGraphWithMatrix(graph, matrixWorld, graphPath)
}

/** Build all world-space graph inputs from an embedded document. */
export function buildWorldGraphs(
  topology: GlbTopologyDocument,
  root: THREE.Object3D,
  options: WorldTopologyBuildOptions = {},
): TopologyGraphInput[] {
  root.updateWorldMatrix(true, false)
  const matrixWorld = root.matrixWorld.clone()
  return topology.graphs.map((graph, index) => {
    const transformed = transformGraphWithMatrix(graph, matrixWorld, `topology.graphs[${index}]`)
    const graphId = graph.id ?? `graph-${index + 1}`
    return {
      ...transformed,
      id: options.graphIdPrefix ? `${options.graphIdPrefix}:${graphId}` : graphId,
    }
  })
}

export const convertModelLocalToWorld = transformGraphToWorld

/** Compatibility entry point for callers that provide the embedded payload directly. */
export function convertEmbeddedTopologyToWorld(
  topology: GlbTopologyDocument | unknown,
  root: THREE.Object3D,
): readonly TopologyGraphInput[] {
  const validated = validateEmbeddedTopology(topology)
  return buildWorldGraphs(validated, root)
}
