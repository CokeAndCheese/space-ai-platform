import type * as THREE from 'three'
import type { TopologyGraphInput } from '../../ssp/topology/types'

export type TopologyJsonPrimitive = string | number | boolean | null
export type TopologyJsonValue =
  | TopologyJsonPrimitive
  | readonly TopologyJsonValue[]
  | TopologyJsonObject
export interface TopologyJsonObject {
  readonly [key: string]: TopologyJsonValue
}

export interface TopologySidecarDigest {
  algorithm: 'SHA-256'
  value: string
}

export interface TopologySidecarAssetV1 {
  assetId: string
  uri: string
  digest?: TopologySidecarDigest
  revision?: string
}

export interface TopologySidecarLayerV1 {
  id: string
  label?: string
  order?: number
  elevation?: number
  tags?: readonly string[]
  data?: TopologyJsonObject
}

export interface TopologySidecarPointV1 {
  x: number
  y: number
  z: number
}

export interface TopologySidecarNodeV1 {
  id: string
  layerId: string
  assetId: string
  position: TopologySidecarPointV1
  label?: string
  kind?: string
  subtype?: string
  tags?: readonly string[]
  data?: TopologyJsonObject
}

export interface TopologySidecarViaPointV1 {
  assetId: string
  position: TopologySidecarPointV1
}

export interface TopologySidecarEdgeStateV1 {
  enabled?: boolean
  weightOverride?: number | null
}

export interface TopologySidecarEdgeV1 {
  id: string
  source: string
  target: string
  relation: 'LINK' | 'CONNECTOR'
  direction: 'FORWARD' | 'BIDIRECTIONAL'
  path?: {
    type: 'POLYLINE'
    via: readonly TopologySidecarViaPointV1[]
  }
  weight?: number
  initialState?: TopologySidecarEdgeStateV1
  mode?: string
  tags?: readonly string[]
  data?: TopologyJsonObject
}

export interface TopologySidecarConnectorV1 {
  id: string
  nodeIds: readonly string[]
  edgeIds: readonly string[]
  label?: string
  tags?: readonly string[]
  data?: TopologyJsonObject
}

export interface TopologySidecarBlockerV1 {
  id: string
  active: boolean
  edgeIds: readonly string[]
  label?: string
  kind?: string
  tags?: readonly string[]
  data?: TopologyJsonObject
}

export interface TopologySidecarV1 {
  schema: 'space-ai-platform/topology-sidecar'
  schemaVersion: 1
  revision: string
  graphId: string
  coordinateSpace: 'ASSET_LOCAL'
  unit: 'meter'
  upAxis: 'Y'
  assets: readonly TopologySidecarAssetV1[]
  layers: readonly TopologySidecarLayerV1[]
  nodes: readonly TopologySidecarNodeV1[]
  edges: readonly TopologySidecarEdgeV1[]
  connectors: readonly TopologySidecarConnectorV1[]
  blockers: readonly TopologySidecarBlockerV1[]
  tags?: readonly string[]
  data?: TopologyJsonObject
}

export type TopologySidecarDiagnosticCode =
  | 'SIDECAR_NOT_FOUND'
  | 'SIDECAR_JSON_INVALID'
  | 'SIDECAR_SCHEMA_UNSUPPORTED'
  | 'SIDECAR_FIELD_INVALID'
  | 'SIDECAR_DUPLICATE_ID'
  | 'SIDECAR_REFERENCE_BROKEN'
  | 'SIDECAR_ASSET_NOT_LOADED'
  | 'SIDECAR_ASSET_BINDING_UNVERIFIABLE'
  | 'SIDECAR_ASSET_BINDING_MISMATCH'
  | 'SIDECAR_PARTIAL_SCENE'
  | 'SIDECAR_COORDINATE_INVALID'
  | 'SIDECAR_CONNECTOR_INVALID'
  | 'SIDECAR_BLOCKER_INVALID'
  | 'SIDECAR_LIMIT_EXCEEDED'
  | 'SIDECAR_REQUEST_STALE'
  | 'SIDECAR_GRAPH_COMMIT_FAILED'

export type TopologySidecarDiagnosticPhase =
  | 'DISCOVER'
  | 'PARSE'
  | 'VALIDATE'
  | 'BIND'
  | 'TRANSFORM'
  | 'COMPILE'
  | 'COMMIT'
  | 'LIFECYCLE'

export interface TopologySidecarDiagnostic {
  code: TopologySidecarDiagnosticCode
  phase: TopologySidecarDiagnosticPhase
  message: string
  path: string
  sidecarUri: string
  assetId: string | null
  entityId: string | null
  details: TopologyJsonObject
}

export type TopologySelectionGeneration = string | number

export type TopologyAssetProofProvenance =
  | 'SAME_RESPONSE_BYTES'
  | 'IMMUTABLE_PACKAGE_REVISION'

/** 当前选择中实际已加载并挂入 scene 的资产实例；不表达内容可信性。 */
export interface TopologyLoadedAsset {
  canonicalUri: string
  root: THREE.Object3D
  selectionGeneration: TopologySelectionGeneration
}

/**
 * SSP 外的加载协调层提供的强绑定证明。
 * SAME_RESPONSE_BYTES 必须携带 digest；IMMUTABLE_PACKAGE_REVISION 必须携带 revision。
 */
export interface TopologyAssetProof {
  canonicalUri: string
  root: THREE.Object3D
  selectionGeneration: TopologySelectionGeneration
  digest?: TopologySidecarDigest
  revision?: string
  provenance: TopologyAssetProofProvenance
}

export interface TopologySidecarCompileContext {
  /** 绝对、同源的 sidecar URL；适配器不会自行请求该 URL。 */
  sidecarUri: string
  scene: THREE.Scene
  selectionGeneration: TopologySelectionGeneration
  /** token 检查是防止迟到结果提交的权威门禁。 */
  isSelectionCurrent: (generation: TopologySelectionGeneration) => boolean
  loadedAssets: readonly TopologyLoadedAsset[]
  assetProofs: readonly TopologyAssetProof[]
}

export interface TopologyAssetBindingSnapshot {
  assetId: string
  canonicalUri: string
  rootUuid: string
  matrixWorld: readonly number[]
  digest?: TopologySidecarDigest
  revision?: string
  provenance: TopologyAssetProofProvenance
}

export interface TopologySidecarBindingSnapshot {
  sidecarRevision: string
  selectionGeneration: TopologySelectionGeneration
  assets: readonly TopologyAssetBindingSnapshot[]
}

export type TopologySidecarParseResult =
  | { ok: true; document: TopologySidecarV1 }
  | { ok: false; diagnostics: readonly TopologySidecarDiagnostic[] }

export type TopologySidecarCompileResult =
  | {
      ok: true
      document: TopologySidecarV1
      input: TopologyGraphInput
      bindingSnapshot: TopologySidecarBindingSnapshot
    }
  | { ok: false; diagnostics: readonly TopologySidecarDiagnostic[] }
