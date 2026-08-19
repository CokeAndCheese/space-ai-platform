import type * as THREE from 'three'
import type {
  TopologyGraphInput,
  TopologyGraphPoint,
  TopologyRouteRenderOptions,
  TopologyRouteRenderResult,
} from '../../ssp/topology/types'
import type { TopologyTool } from '../../ssp/topology/topologyTool'

export const GLB_TOPOLOGY_SCHEMA_VERSION = 1 as const
export const GLB_TOPOLOGY_COORDINATE_SPACE = 'MODEL_LOCAL' as const

export interface GlbTopologyGenerator {
  name: string
  version: string
  parameters?: Readonly<Record<string, unknown>>
}

export interface GlbTopologyDiagnostics {
  source?: Readonly<Record<string, unknown>>
  components?: readonly unknown[]
  unresolvedNodes?: readonly unknown[]
  warnings?: readonly unknown[]
  [key: string]: unknown
}

/** The serializable topology payload embedded in scene.extras.sspTopology. */
export interface GlbTopologyDocument {
  schemaVersion: typeof GLB_TOPOLOGY_SCHEMA_VERSION
  coordinateSpace: typeof GLB_TOPOLOGY_COORDINATE_SPACE
  generator?: GlbTopologyGenerator
  graphs: readonly TopologyGraphInput[]
  diagnostics?: GlbTopologyDiagnostics
}

export interface WorldTopologyBuildOptions {
  /** Optional graph id prefix. The runtime supplies an asset-scoped prefix. */
  graphIdPrefix?: string
}

export interface GlbTopologyAssetMount {
  readonly assetId: string
  readonly root: THREE.Object3D
  readonly graphIds: readonly string[]
  readonly routeIds: readonly string[]
  renderRoute(options: TopologyRouteRenderOptions): TopologyRouteRenderResult
  removeRoute(routeId: string): boolean
  dispose(): void
}

export interface GlbTopologyRuntimeTool {
  createGraph(input: TopologyGraphInput): { id: string }
  getGraph(id: string): { id: string } | null | undefined
  removeGraph(id: string): boolean
  renderRoute(options: TopologyRouteRenderOptions): TopologyRouteRenderResult
  removeRoute(id: string): boolean
}

export interface GlbTopologyAttachOptions {
  assetId: string
  root: THREE.Object3D
  /** Use this payload instead of reading root.userData.sspTopology. */
  topology?: unknown
}

export interface GlbTopologyRuntimeAdapterOptions {
  embeddedTopology: unknown
  modelRoot: THREE.Object3D
  topologyTool: TopologyTool
}

export interface GlbTopologyRuntimeAdapterHandle {
  readonly graphIds: readonly string[]
  readonly routeIds: readonly string[]
  dispose(): void
}

export interface GlbTopologyRuntime {
  attach(options: GlbTopologyAttachOptions): GlbTopologyAssetMount
  detach(assetId: string): boolean
  clear(): number
  get(assetId: string): GlbTopologyAssetMount | null
  list(): readonly GlbTopologyAssetMount[]
  dispose(): void
}

export type { TopologyGraphInput, TopologyGraphPoint }
