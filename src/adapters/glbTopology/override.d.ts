import type {
  GlbTopologyDocument,
  TopologyGraphEdgeInput,
  TopologyGraphNodeInput,
  TopologyPolylineInput,
} from './types'

export interface TopologyOverridePoint {
  x: number
  y: number
  z: number
}

export interface TopologyEdgePathOverride {
  edgeId: string
  expect: {
    source: string
    target: string
  }
  path: {
    type: 'POLYLINE'
    via: readonly TopologyOverridePoint[]
  }
}

export interface TopologyOverrideDocument {
  overrideSchemaVersion: 1
  coordinateSpace: 'MODEL_LOCAL'
  target: {
    graphId: string
    sourceAsset?: string
  }
  edgeOverrides: readonly TopologyEdgePathOverride[]
}

export interface TopologyOverrideV2Target {
  graphId: string
  sourceAsset?: string
}

/** V2 deliberately uses the same standard path shape as TopologyGraphInput. */
export type TopologyOverrideV2Path = TopologyPolylineInput

export type TopologyOverrideV2Edge = Omit<TopologyGraphEdgeInput, 'path'> & {
  path?: TopologyPolylineInput
}

export interface TopologyOverrideV2AddNodeOperation {
  seq: number
  type: 'ADD_NODE'
  node: TopologyGraphNodeInput
}

export interface TopologyOverrideV2RemoveNodeOperation {
  seq: number
  type: 'REMOVE_NODE'
  nodeId: string
  expect: { layerId: string }
}

export interface TopologyOverrideV2RestoreNodeOperation extends Omit<TopologyOverrideV2RemoveNodeOperation, 'type'> {
  type: 'RESTORE_NODE'
}

export interface TopologyOverrideV2AddEdgeOperation {
  seq: number
  type: 'ADD_EDGE'
  edge: TopologyOverrideV2Edge
}

export interface TopologyOverrideV2RemoveEdgeOperation {
  seq: number
  type: 'REMOVE_EDGE'
  edgeId: string
  expect: { source: string; target: string }
}

export interface TopologyOverrideV2RestoreEdgeOperation extends Omit<TopologyOverrideV2RemoveEdgeOperation, 'type'> {
  type: 'RESTORE_EDGE'
}

export interface TopologyOverrideV2OverrideEdgePathOperation {
  seq: number
  type: 'OVERRIDE_EDGE_PATH'
  edgeId: string
  expect: { source: string; target: string }
  path: TopologyPolylineInput
}

export type TopologyOverrideV2Operation =
  | TopologyOverrideV2AddNodeOperation
  | TopologyOverrideV2RemoveNodeOperation
  | TopologyOverrideV2RestoreNodeOperation
  | TopologyOverrideV2AddEdgeOperation
  | TopologyOverrideV2RemoveEdgeOperation
  | TopologyOverrideV2RestoreEdgeOperation
  | TopologyOverrideV2OverrideEdgePathOperation

export interface TopologyOverrideV2Document {
  overrideSchemaVersion: 2
  coordinateSpace: 'MODEL_LOCAL'
  target: TopologyOverrideV2Target
  operations: readonly TopologyOverrideV2Operation[]
}

export interface TopologyOverrideV2Summary {
  graphId: string
  sourceAsset: string | null
  count: number
  addedNodeIds: readonly string[]
  addedEdgeIds: readonly string[]
  removedNodeIds: readonly string[]
  removedEdgeIds: readonly string[]
  restoredNodeIds: readonly string[]
  restoredEdgeIds: readonly string[]
  pathOverriddenEdgeIds: readonly string[]
}

export interface TopologyOverrideApplyWithSummary {
  topology: GlbTopologyDocument
  summary: TopologyOverrideV2Summary | Readonly<Record<string, unknown>>
}

export const TOPOLOGY_OVERRIDE_SCHEMA_VERSION: 1
export const TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION: 2
export const TOPOLOGY_OVERRIDE_COORDINATE_SPACE: 'MODEL_LOCAL'
export const TOPOLOGY_OVERRIDE_MAX_VIA_POINTS: 64
export const TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH: 1e-6

export function validateTopologyOverrideDocument(value: unknown): readonly string[]
export function applyTopologyOverrideDocument(
  topology: GlbTopologyDocument,
  overrideDocument: TopologyOverrideDocument | TopologyOverrideV2Document,
): GlbTopologyDocument
export function applyTopologyOverrideDocumentWithSummary(
  topology: GlbTopologyDocument,
  overrideDocument: TopologyOverrideDocument | TopologyOverrideV2Document,
): TopologyOverrideApplyWithSummary
export function upsertTopologyEdgePathOverride(
  document: TopologyOverrideDocument,
  entry: TopologyEdgePathOverride,
): TopologyOverrideDocument
export function removeTopologyEdgePathOverride(
  document: TopologyOverrideDocument,
  edgeId: string,
): TopologyOverrideDocument

export function createEmptyTopologyOverrideV2Document(
  graphId?: string,
  sourceAsset?: string,
): TopologyOverrideV2Document
export const createTopologyOverrideV2Document: typeof createEmptyTopologyOverrideV2Document
export const createEmptyTopologyOverrideDocumentV2: typeof createEmptyTopologyOverrideV2Document
export function appendTopologyOverrideOperation(
  document: TopologyOverrideV2Document,
  operation: Omit<TopologyOverrideV2Operation, 'seq'>,
): TopologyOverrideV2Document
export function replaceTopologyOverrideOperations(
  document: TopologyOverrideV2Document,
  operations: readonly TopologyOverrideV2Operation[],
): TopologyOverrideV2Document
export function updateTopologyOverrideDocument(
  document: TopologyOverrideV2Document,
  operation: Omit<TopologyOverrideV2Operation, 'seq'>,
): TopologyOverrideV2Document
export function addTopologyOverrideNode(
  document: TopologyOverrideV2Document,
  node: TopologyGraphNodeInput,
): TopologyOverrideV2Document
export function removeTopologyOverrideNode(
  document: TopologyOverrideV2Document,
  nodeId: string,
  expect: { layerId: string } | string,
): TopologyOverrideV2Document
export function restoreTopologyOverrideNode(
  document: TopologyOverrideV2Document,
  nodeId: string,
  expect: { layerId: string } | string,
): TopologyOverrideV2Document
export function addTopologyOverrideEdge(
  document: TopologyOverrideV2Document,
  edge: TopologyOverrideV2Edge,
): TopologyOverrideV2Document
export function removeTopologyOverrideEdge(
  document: TopologyOverrideV2Document,
  edgeId: string,
  expect: { source: string; target: string },
): TopologyOverrideV2Document
export function restoreTopologyOverrideEdge(
  document: TopologyOverrideV2Document,
  edgeId: string,
  expect: { source: string; target: string },
): TopologyOverrideV2Document
export function overrideTopologyEdgePath(
  document: TopologyOverrideV2Document,
  edgeId: string,
  expect: { source: string; target: string },
  path: TopologyPolylineInput,
): TopologyOverrideV2Document
