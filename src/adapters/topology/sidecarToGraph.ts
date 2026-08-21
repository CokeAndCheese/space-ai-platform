import * as THREE from 'three'
import type { TopologyGraphInput, TopologyGraphPoint } from '../../ssp/topology/types'
import {
  canonicalizeTopologyAssetUri,
  parseTopologySidecarV1,
  redactTopologySidecarUri,
} from './sidecarV1'
import type {
  TopologyAssetBindingSnapshot,
  TopologyAssetProof,
  TopologyJsonObject,
  TopologyLoadedAsset,
  TopologySidecarAssetV1,
  TopologySidecarCompileContext,
  TopologySidecarCompileResult,
  TopologySidecarDiagnostic,
  TopologySidecarDiagnosticCode,
  TopologySidecarPointV1,
  TopologySidecarV1,
} from './types'

const MIN_POINT_DISTANCE_SQUARED = 1e-12
const MATRIX_EPSILON = 1e-12

interface BoundAsset {
  asset: TopologySidecarAssetV1
  assetIndex: number
  canonicalUri: string
  loaded: TopologyLoadedAsset
  proof: TopologyAssetProof
}

interface PreparedAsset extends BoundAsset {
  matrixWorld: THREE.Matrix4
}

class SidecarCompileFailure extends Error {
  readonly diagnostic: TopologySidecarDiagnostic

  constructor(diagnostic: TopologySidecarDiagnostic) {
    super(diagnostic.message)
    this.name = 'SidecarCompileFailure'
    this.diagnostic = diagnostic
  }
}

function fail(
  context: TopologySidecarCompileContext,
  code: TopologySidecarDiagnosticCode,
  phase: TopologySidecarDiagnostic['phase'],
  path: string,
  message: string,
  options: {
    assetId?: string | null
    entityId?: string | null
    details?: TopologyJsonObject
  } = {},
): never {
  throw new SidecarCompileFailure({
    code,
    phase,
    message,
    path,
    sidecarUri: redactTopologySidecarUri(context.sidecarUri),
    assetId: options.assetId ?? null,
    entityId: options.entityId ?? null,
    details: options.details ?? {},
  })
}

function isCurrent(
  context: TopologySidecarCompileContext,
  path: string,
): void {
  let current = false
  try {
    current = context.isSelectionCurrent(context.selectionGeneration)
  } catch {
    current = false
  }
  if (!current) {
    fail(
      context,
      'SIDECAR_REQUEST_STALE',
      'LIFECYCLE',
      path,
      'topology sidecar request no longer belongs to the current selection',
    )
  }
}

function isAttachedToScene(root: THREE.Object3D, scene: THREE.Scene): boolean {
  if (root === scene) return false
  let current: THREE.Object3D | null = root
  while (current !== null) {
    if (current === scene) return true
    current = current.parent
  }
  return false
}

function isValidDigest(proof: TopologyAssetProof): boolean {
  return proof.digest?.algorithm === 'SHA-256' && /^[0-9a-f]{64}$/.test(proof.digest.value)
}

function isValidRevision(revision: string | undefined): revision is string {
  return (
    typeof revision === 'string' &&
    revision === revision.trim() &&
    revision.length > 0 &&
    revision.length <= 160
  )
}

function indexByCanonicalUri<T extends { canonicalUri: string }>(
  values: readonly T[],
): Map<string, T[]> {
  const indexed = new Map<string, T[]>()
  values.forEach((value) => {
    const matches = indexed.get(value.canonicalUri)
    if (matches === undefined) {
      indexed.set(value.canonicalUri, [value])
    } else {
      matches.push(value)
    }
  })
  return indexed
}

function indexProofsByRoot(
  proofs: readonly TopologyAssetProof[],
): Map<THREE.Object3D, TopologyAssetProof[]> {
  const indexed = new Map<THREE.Object3D, TopologyAssetProof[]>()
  proofs.forEach((proof) => {
    const matches = indexed.get(proof.root)
    if (matches === undefined) {
      indexed.set(proof.root, [proof])
    } else {
      matches.push(proof)
    }
  })
  return indexed
}

function verifyProof(
  asset: TopologySidecarAssetV1,
  assetIndex: number,
  canonicalUri: string,
  loaded: TopologyLoadedAsset,
  proofByUri: ReadonlyMap<string, readonly TopologyAssetProof[]>,
  proofByRoot: ReadonlyMap<THREE.Object3D, readonly TopologyAssetProof[]>,
  context: TopologySidecarCompileContext,
): TopologyAssetProof {
  const assetPath = `/assets/${String(assetIndex)}`
  const candidates = proofByUri.get(canonicalUri) ?? []
  if (candidates.length === 0) {
    if ((proofByRoot.get(loaded.root)?.length ?? 0) > 0) {
      fail(
        context,
        'SIDECAR_ASSET_BINDING_MISMATCH',
        'BIND',
        `${assetPath}/uri`,
        'AssetProof canonical URI does not match its loaded asset',
        { assetId: asset.assetId, details: { field: 'canonicalUri' } },
      )
    }
    fail(
      context,
      'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
      'BIND',
      `${assetPath}/uri`,
      'sidecar asset has no trustworthy AssetProof',
      { assetId: asset.assetId, details: { proofMatches: 0 } },
    )
  }
  if (candidates.length !== 1) {
    fail(
      context,
      'SIDECAR_ASSET_BINDING_MISMATCH',
      'BIND',
      `${assetPath}/uri`,
      'loaded asset must have exactly one matching AssetProof',
      { assetId: asset.assetId, details: { proofMatches: candidates.length } },
    )
  }
  const proof = candidates[0]!
  if (proof.root !== loaded.root) {
    fail(
      context,
      'SIDECAR_ASSET_BINDING_MISMATCH',
      'BIND',
      assetPath,
      'AssetProof root does not match the loaded asset root',
      { assetId: asset.assetId, details: { field: 'root' } },
    )
  }
  if (proof.selectionGeneration !== loaded.selectionGeneration) {
    fail(
      context,
      'SIDECAR_ASSET_BINDING_MISMATCH',
      'BIND',
      assetPath,
      'AssetProof generation does not match the loaded asset generation',
      { assetId: asset.assetId, details: { field: 'selectionGeneration' } },
    )
  }
  if (proof.provenance === 'SAME_RESPONSE_BYTES') {
    if (!isValidDigest(proof) || asset.revision !== undefined) {
      fail(
        context,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        assetPath,
        'same-response AssetProof can verify digest-bound assets only',
        { assetId: asset.assetId, details: { provenance: proof.provenance } },
      )
    }
  } else if (proof.provenance === 'IMMUTABLE_PACKAGE_REVISION') {
    if (!isValidRevision(proof.revision) || (asset.digest !== undefined && !isValidDigest(proof))) {
      fail(
        context,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        assetPath,
        'immutable-package AssetProof lacks a verifiable revision or declared digest',
        { assetId: asset.assetId, details: { provenance: proof.provenance } },
      )
    }
  } else {
    fail(
      context,
      'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
      'BIND',
      assetPath,
      'AssetProof provenance is not trusted by sidecar v1',
      { assetId: asset.assetId },
    )
  }
  if (
    asset.digest !== undefined &&
    (proof.digest?.algorithm !== asset.digest.algorithm || proof.digest.value !== asset.digest.value)
  ) {
    fail(
      context,
      'SIDECAR_ASSET_BINDING_MISMATCH',
      'BIND',
      `${assetPath}/digest/value`,
      'asset digest does not match the loaded GLB proof',
      { assetId: asset.assetId, details: { algorithm: asset.digest.algorithm } },
    )
  }
  if (asset.revision !== undefined && proof.revision !== asset.revision) {
    fail(
      context,
      'SIDECAR_ASSET_BINDING_MISMATCH',
      'BIND',
      `${assetPath}/revision`,
      'asset revision does not match the loaded GLB proof',
      { assetId: asset.assetId },
    )
  }
  return proof
}

function bindAssets(
  document: TopologySidecarV1,
  context: TopologySidecarCompileContext,
): readonly BoundAsset[] {
  const canonicalAssets = document.assets.map((asset, assetIndex) => ({
    asset,
    assetIndex,
    canonicalUri: canonicalizeTopologyAssetUri(asset.uri, context.sidecarUri),
  }))
  const loadedByUri = indexByCanonicalUri(context.loadedAssets)
  const proofByUri = indexByCanonicalUri(context.assetProofs)
  const proofByRoot = indexProofsByRoot(context.assetProofs)

  let loadedAssetCount = 0
  canonicalAssets.forEach(({ asset, assetIndex, canonicalUri }) => {
    const loadedMatches = loadedByUri.get(canonicalUri) ?? []
    if (loadedMatches.length > 1) {
      fail(
        context,
        'SIDECAR_ASSET_NOT_LOADED',
        'BIND',
        `/assets/${String(assetIndex)}/uri`,
        'sidecar asset must have exactly one loaded instance',
        { assetId: asset.assetId, details: { loadedMatches: loadedMatches.length } },
      )
    }
    if (loadedMatches.length === 1) loadedAssetCount += 1
  })

  if (loadedAssetCount === 0) {
    const first = canonicalAssets[0]!
    fail(
      context,
      'SIDECAR_ASSET_NOT_LOADED',
      'BIND',
      `/assets/${String(first.assetIndex)}/uri`,
      'none of the sidecar assets are loaded',
      {
        assetId: first.asset.assetId,
        details: { requiredAssets: canonicalAssets.length, loadedAssets: 0 },
      },
    )
  }
  if (loadedAssetCount < canonicalAssets.length) {
    const missing = canonicalAssets.find(({ canonicalUri }) =>
      (loadedByUri.get(canonicalUri)?.length ?? 0) === 0,
    )!
    fail(
      context,
      'SIDECAR_PARTIAL_SCENE',
      'BIND',
      `/assets/${String(missing.assetIndex)}/uri`,
      'only part of the sidecar asset set is loaded',
      {
        assetId: missing.asset.assetId,
        details: { requiredAssets: canonicalAssets.length, loadedAssets: loadedAssetCount },
      },
    )
  }

  const bound: BoundAsset[] = []
  const rootOwner = new Map<THREE.Object3D, string>()
  canonicalAssets.forEach(({ asset, assetIndex, canonicalUri }) => {
    const loaded = loadedByUri.get(canonicalUri)![0]!
    if (!loaded.root?.isObject3D || !isAttachedToScene(loaded.root, context.scene)) {
      fail(
        context,
        'SIDECAR_ASSET_NOT_LOADED',
        'BIND',
        `/assets/${String(assetIndex)}`,
        'loaded asset root is not attached to the current scene',
        { assetId: asset.assetId, details: { loadedMatches: 1 } },
      )
    }
    const previousOwner = rootOwner.get(loaded.root)
    if (previousOwner !== undefined) {
      fail(
        context,
        'SIDECAR_ASSET_NOT_LOADED',
        'BIND',
        `/assets/${String(assetIndex)}`,
        'one loaded root cannot satisfy multiple sidecar assets',
        { assetId: asset.assetId, details: { conflictsWithAssetId: previousOwner } },
      )
    }
    rootOwner.set(loaded.root, asset.assetId)
    if (loaded.selectionGeneration !== context.selectionGeneration) {
      fail(
        context,
        'SIDECAR_ASSET_BINDING_MISMATCH',
        'BIND',
        `/assets/${String(assetIndex)}`,
        'loaded asset belongs to a different selection generation',
        { assetId: asset.assetId, details: { field: 'selectionGeneration' } },
      )
    }
    const proof = verifyProof(
      asset,
      assetIndex,
      canonicalUri,
      loaded,
      proofByUri,
      proofByRoot,
      context,
    )
    bound.push({ asset, assetIndex, canonicalUri, loaded, proof })
  })
  return bound
}

function prepareWorldMatrix(
  bound: BoundAsset,
  context: TopologySidecarCompileContext,
): PreparedAsset {
  const path = `/assets/${String(bound.assetIndex)}`
  try {
    bound.loaded.root.updateWorldMatrix(true, false)
  } catch {
    fail(
      context,
      'SIDECAR_COORDINATE_INVALID',
      'TRANSFORM',
      path,
      'asset world matrix could not be updated',
      { assetId: bound.asset.assetId },
    )
  }
  const elements = bound.loaded.root.matrixWorld.elements
  if (
    elements.length !== 16 ||
    elements.some((value) => !Number.isFinite(value)) ||
    Math.abs(elements[3]!) > MATRIX_EPSILON ||
    Math.abs(elements[7]!) > MATRIX_EPSILON ||
    Math.abs(elements[11]!) > MATRIX_EPSILON ||
    Math.abs(elements[15]! - 1) > MATRIX_EPSILON
  ) {
    fail(
      context,
      'SIDECAR_COORDINATE_INVALID',
      'TRANSFORM',
      path,
      'asset world matrix must be finite and affine',
      { assetId: bound.asset.assetId },
    )
  }
  const determinant = bound.loaded.root.matrixWorld.determinant()
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= MATRIX_EPSILON) {
    fail(
      context,
      'SIDECAR_COORDINATE_INVALID',
      'TRANSFORM',
      path,
      'asset world matrix must be invertible',
      { assetId: bound.asset.assetId },
    )
  }
  return { ...bound, matrixWorld: bound.loaded.root.matrixWorld.clone() }
}

function transformPoint(
  point: TopologySidecarPointV1,
  bound: PreparedAsset,
  path: string,
  entityId: string,
  context: TopologySidecarCompileContext,
): TopologyGraphPoint {
  const world = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(bound.matrixWorld)
  if (![world.x, world.y, world.z].every(Number.isFinite)) {
    fail(
      context,
      'SIDECAR_COORDINATE_INVALID',
      'TRANSFORM',
      path,
      'world-space coordinate is not finite',
      { assetId: bound.asset.assetId, entityId },
    )
  }
  return { x: world.x, y: world.y, z: world.z }
}

function bindingSnapshot(bound: PreparedAsset): TopologyAssetBindingSnapshot {
  return {
    assetId: bound.asset.assetId,
    canonicalUri: redactTopologySidecarUri(bound.canonicalUri),
    rootUuid: bound.loaded.root.uuid,
    matrixWorld: [...bound.matrixWorld.elements],
    ...(bound.proof.digest === undefined ? {} : { digest: { ...bound.proof.digest } }),
    ...(bound.proof.revision === undefined ? {} : { revision: bound.proof.revision }),
    provenance: bound.proof.provenance,
  }
}

function compileInput(
  document: TopologySidecarV1,
  boundAssets: readonly PreparedAsset[],
  context: TopologySidecarCompileContext,
): TopologyGraphInput {
  const boundById = new Map(boundAssets.map((bound) => [bound.asset.assetId, bound]))
  const connectorByNode = new Map<string, string>()
  document.connectors.forEach((connector) => {
    connector.nodeIds.forEach((nodeId) => connectorByNode.set(nodeId, connector.id))
  })
  const activeBlockersByEdge = new Map<string, Set<string>>()
  document.blockers.forEach((blocker) => {
    if (!blocker.active) return
    blocker.edgeIds.forEach((edgeId) => {
      const blockers = activeBlockersByEdge.get(edgeId) ?? new Set<string>()
      blockers.add(blocker.id)
      activeBlockersByEdge.set(edgeId, blockers)
    })
  })

  const nodes = document.nodes.map((node, nodeIndex) => {
    const bound = boundById.get(node.assetId)!
    const position = transformPoint(
      node.position,
      bound,
      `/nodes/${String(nodeIndex)}/position`,
      node.id,
      context,
    )
    const connectorId = connectorByNode.get(node.id)
    return {
      id: node.id,
      layerId: node.layerId,
      position,
      ...(connectorId === undefined ? {} : { connectorId }),
      ...(node.label === undefined ? {} : { label: node.label }),
      ...(node.kind === undefined ? {} : { kind: node.kind }),
      ...(node.subtype === undefined ? {} : { subtype: node.subtype }),
      ...(node.tags === undefined ? {} : { tags: node.tags }),
      ...(node.data === undefined ? {} : { data: node.data }),
    }
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  const edges = document.edges.map((edge, edgeIndex) => {
    const via = edge.path?.via.map((point, viaIndex) => {
      const bound = boundById.get(point.assetId)!
      return transformPoint(
        point.position,
        bound,
        `/edges/${String(edgeIndex)}/path/via/${String(viaIndex)}/position`,
        edge.id,
        context,
      )
    }) ?? []
    const polyline = [nodeById.get(edge.source)!.position, ...via, nodeById.get(edge.target)!.position]
    for (let pointIndex = 1; pointIndex < polyline.length; pointIndex += 1) {
      const previous = polyline[pointIndex - 1]!
      const current = polyline[pointIndex]!
      const dx = current.x - previous.x
      const dy = current.y - previous.y
      const dz = current.z - previous.z
      if (dx * dx + dy * dy + dz * dz <= MIN_POINT_DISTANCE_SQUARED) {
        fail(
          context,
          'SIDECAR_COORDINATE_INVALID',
          'TRANSFORM',
          pointIndex === polyline.length - 1
            ? `/edges/${String(edgeIndex)}/target`
            : `/edges/${String(edgeIndex)}/path/via/${String(pointIndex - 1)}`,
          'adjacent world-space polyline points must be more than 1e-6 apart',
          { entityId: edge.id },
        )
      }
    }
    const blockerIds = [...(activeBlockersByEdge.get(edge.id) ?? [])].sort()
    const initialState = edge.initialState === undefined && blockerIds.length === 0
      ? undefined
      : {
          ...(edge.initialState?.enabled === undefined ? {} : { enabled: edge.initialState.enabled }),
          ...(edge.initialState?.weightOverride === undefined
            ? {}
            : { weightOverride: edge.initialState.weightOverride }),
          ...(blockerIds.length === 0 ? {} : { blockerIds }),
        }
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      direction: edge.direction,
      ...(edge.path === undefined ? {} : { path: { type: 'POLYLINE' as const, via } }),
      ...(edge.weight === undefined ? {} : { weight: edge.weight }),
      ...(initialState === undefined ? {} : { initialState }),
      ...(edge.mode === undefined ? {} : { mode: edge.mode }),
      ...(edge.tags === undefined ? {} : { tags: edge.tags }),
      ...(edge.data === undefined ? {} : { data: edge.data }),
    }
  })

  return {
    id: document.graphId,
    layers: document.layers.map((layer) => ({
      id: layer.id,
      ...(layer.label === undefined ? {} : { label: layer.label }),
      ...(layer.order === undefined ? {} : { order: layer.order }),
      ...(layer.elevation === undefined ? {} : { elevation: layer.elevation }),
      ...(layer.tags === undefined ? {} : { tags: layer.tags }),
      ...(layer.data === undefined ? {} : { data: layer.data }),
    })),
    nodes,
    edges,
    ...(document.tags === undefined ? {} : { tags: document.tags }),
    ...(document.data === undefined ? {} : { data: document.data }),
  }
}

/**
 * Parses, validates, strongly binds, and world-space compiles sidecar v1.
 * This function is synchronous and pure with respect to network and SSP state:
 * it never fetches and never calls createGraph.
 */
export function compileTopologySidecarV1(
  jsonText: string,
  context: TopologySidecarCompileContext,
): TopologySidecarCompileResult {
  const parsed = parseTopologySidecarV1(jsonText, context.sidecarUri)
  if (!parsed.ok) return parsed

  try {
    isCurrent(context, '')
    const boundAssets = bindAssets(parsed.document, context)
    isCurrent(context, '')
    const preparedAssets = boundAssets.map((bound) => prepareWorldMatrix(bound, context))
    const input = compileInput(parsed.document, preparedAssets, context)
    isCurrent(context, '')
    preparedAssets.forEach((bound) => {
      if (!isAttachedToScene(bound.loaded.root, context.scene)) {
        fail(
          context,
          'SIDECAR_ASSET_NOT_LOADED',
          'BIND',
          `/assets/${String(bound.assetIndex)}`,
          'asset root detached from the current scene during compilation',
          { assetId: bound.asset.assetId },
        )
      }
      try {
        bound.loaded.root.updateWorldMatrix(true, false)
      } catch {
        fail(
          context,
          'SIDECAR_REQUEST_STALE',
          'LIFECYCLE',
          `/assets/${String(bound.assetIndex)}`,
          'asset transform became unavailable during compilation',
          { assetId: bound.asset.assetId },
        )
      }
      if (!bound.loaded.root.matrixWorld.equals(bound.matrixWorld)) {
        fail(
          context,
          'SIDECAR_REQUEST_STALE',
          'LIFECYCLE',
          `/assets/${String(bound.assetIndex)}`,
          'asset world transform changed during compilation',
          { assetId: bound.asset.assetId },
        )
      }
    })
    return {
      ok: true,
      document: parsed.document,
      input,
      bindingSnapshot: {
        sidecarRevision: parsed.document.revision,
        selectionGeneration: context.selectionGeneration,
        assets: preparedAssets.map(bindingSnapshot),
      },
    }
  } catch (error) {
    if (error instanceof SidecarCompileFailure) {
      return { ok: false, diagnostics: [error.diagnostic] }
    }
    return {
      ok: false,
      diagnostics: [{
        code: 'SIDECAR_FIELD_INVALID',
        phase: 'COMPILE',
        message: 'topology sidecar compilation failed without producing a graph input',
        path: '',
        sidecarUri: redactTopologySidecarUri(context.sidecarUri),
        assetId: null,
        entityId: null,
        details: {},
      }],
    }
  }
}
