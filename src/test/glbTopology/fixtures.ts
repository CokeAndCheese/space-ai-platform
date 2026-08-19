import * as THREE from 'three'
import type { TopologyGraphInput } from '../../ssp/topology/types'

export interface EmbeddedTopologyFixture {
  schemaVersion: 1
  coordinateSpace: 'MODEL_LOCAL'
  generator: {
    name: 'ssp-glb-topology'
    version: '0.1.0'
    parameters: {
      strategy: 'SEMANTIC_NODE_MST_KNN'
      nearestNeighbors: number
      coordinatePrecision: number
      elevationOffset: number
      topSurfaceTolerance: number
    }
  }
  graphs: readonly TopologyGraphInput[]
  diagnostics: {
    source: Readonly<Record<string, unknown>>
    components: readonly unknown[]
    unresolvedNodes: readonly unknown[]
    warnings: readonly string[]
  }
}

function graphFixture(id = 'model-topology:A_1F'): TopologyGraphInput {
  return {
    id,
    layers: [{ id: 'A_1F', label: 'A 1F', order: 1, elevation: 0 }],
    nodes: [
      {
        id: 'space-a',
        layerId: 'A_1F',
        position: { x: 1, y: 2, z: 3 },
        kind: 'SPACE',
        data: { sourceSid: 'SPACE_A_1F' },
      },
      {
        id: 'portal-a',
        layerId: 'A_1F',
        position: { x: 4, y: 2, z: 3 },
        kind: 'PORTAL',
        subtype: 'DOOR',
        data: { sourceSid: 'PORTAL_A_1F' },
      },
    ],
    edges: [
      {
        id: 'space-to-portal',
        source: 'space-a',
        target: 'portal-a',
        relation: 'LINK',
        direction: 'BIDIRECTIONAL',
        path: {
          type: 'POLYLINE',
          via: [
            { x: 2, y: 3, z: 3 },
            { x: 3, y: 3, z: 3 },
          ],
        },
        data: { sourceSid: 'EDGE_SPACE_PORTAL_A_1F' },
      },
    ],
    tags: ['generated'],
    data: { source: 'synthetic-glb-fixture' },
  }
}

export function createEmbeddedTopologyFixture(): EmbeddedTopologyFixture {
  return {
    schemaVersion: 1,
    coordinateSpace: 'MODEL_LOCAL',
    generator: {
      name: 'ssp-glb-topology',
      version: '0.1.0',
      parameters: {
        strategy: 'SEMANTIC_NODE_MST_KNN',
        nearestNeighbors: 3,
        coordinatePrecision: 6,
        elevationOffset: 0.08,
        topSurfaceTolerance: 0.005,
      },
    },
    graphs: [graphFixture()],
    diagnostics: {
      source: { uri: 'synthetic://glb-topology-fixture' },
      components: [],
      unresolvedNodes: [],
      warnings: [],
    },
  }
}

export function createWorldTransform(): THREE.Object3D {
  // Deliberately exercises translation, non-uniform scale, and rotation.
  // updateMatrixWorld() is part of the runtime adapter's contract: it must use
  // the loaded model root's matrixWorld, not local coordinates or a child matrix.
  const root = new THREE.Object3D()
  root.position.set(10, 20, 30)
  root.rotation.z = Math.PI / 2
  root.scale.set(2, 3, 4)
  root.updateMatrixWorld(true)
  return root
}

export function cloneWithInvalidSchemaVersion(fixture: EmbeddedTopologyFixture): unknown {
  return { ...fixture, schemaVersion: 2 }
}

export function cloneWithInvalidCoordinateSpace(fixture: EmbeddedTopologyFixture): unknown {
  return { ...fixture, coordinateSpace: 'WORLD' }
}

export function cloneWithInvalidEndpoint(fixture: EmbeddedTopologyFixture): unknown {
  return {
    ...fixture,
    graphs: fixture.graphs.map((graph) => ({
      ...graph,
      edges: graph.edges.map((edge) => ({ ...edge, target: 'missing-node' })),
    })),
  }
}

export function cloneWithNonFiniteCoordinate(fixture: EmbeddedTopologyFixture): unknown {
  return {
    ...fixture,
    graphs: fixture.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node, index) => (
        index === 0 ? { ...node, position: { ...node.position, x: Number.NaN } } : node
      )),
    })),
  }
}
