import * as THREE from 'three'
import {
  compileTopologySidecarV1,
  parseTopologySidecarV1,
  type TopologyAssetProof,
  type TopologyJsonObject,
  type TopologyJsonValue,
  type TopologyLoadedAsset,
  type TopologySidecarCompileContext,
  type TopologySidecarCompileResult,
  type TopologySidecarDiagnostic,
} from '@/adapters/topology'
import {
  clonePackageArchiveResources,
  packageDiagnostic,
  parsePackageZipV1,
  parsePackageZipV2,
  prebindPackageTopologyV1,
  validatePackageArchive,
  validatePackageArchiveV2,
  type Digest,
  type Metadata33Projection,
  type PackageDiagnostic,
  type PackageFloor,
  type PackageTopologyUnavailableV2,
  type PreparedPackageTopologyV1,
  type ValidatedPackageArchiveV2,
} from '@/adapters/package'
import type { ModelRecord } from '@/composables/useModelLibrary'
import {
  TopologyError,
  type TopologyGraphInput,
  type TopologyGraphSnapshot,
} from '@/ssp/topology/types'

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_VERSION = 2
const DEFAULT_ASSET_CONCURRENCY = 3
const SAFE_ERROR_DETAIL_DEPTH = 6
const SAFE_ERROR_DETAIL_NODES = 256
const SAFE_ERROR_CONTAINER_ITEMS = 64
const SAFE_ERROR_STRING_LENGTH = 4096
const SENSITIVE_DIAGNOSTIC_KEY = /(?:api.?key|authorization|cause|cookie|credential|message|password|secret|signature|signed|stack|token)/i

export type TopologySceneSessionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'scene-ready'
  | 'unavailable'
  | 'error'

export interface TopologySceneSessionNode {
  id: string
  layerId: string
  label?: string
  kind?: string
  subtype?: string
}

export interface TopologySceneSessionSnapshot {
  status: TopologySceneSessionStatus
  graphId: string | null
  nodes: readonly TopologySceneSessionNode[]
  diagnostic: TopologySidecarDiagnostic | null
  packageDiagnostic: PackageDiagnostic | null
  packageSession: TopologyPackageSessionState | null
}

export interface TopologyPackageSessionAsset {
  readonly assetId: string
  readonly canonicalUri: string
  readonly floorName: string
  readonly building: string | null
  readonly level: number | null
  readonly floorType: string
  readonly root: THREE.Object3D
}

export interface TopologyPackageSessionSnapshot {
  readonly manifestUri: string
  readonly packageId: string
  readonly revision: string
  readonly assets: readonly TopologyPackageSessionAsset[]
}

export interface PackageAssetResourceProofV2 {
  readonly assetId: string
  readonly canonicalUri: string
  readonly digest: Digest
  readonly packageRevision: string
  readonly root: THREE.Object3D
  readonly selectionGeneration: number
  readonly provenance: 'SAME_RESPONSE_BYTES'
}

export type PackageMetadataProjectionV2 = Omit<Metadata33Projection, 'buffer'>

export interface TopologyAbsentPackageSessionAssetV2 {
  readonly assetId: string
  readonly canonicalUri: string
  readonly floorName: string
  readonly building: string | null
  readonly level: number | null
  readonly floorType: string
  readonly root: THREE.Object3D
  readonly metadata: PackageMetadataProjectionV2
  readonly resourceProof: PackageAssetResourceProofV2
}

export interface TopologyAbsentPackageSessionSnapshotV2 {
  readonly schemaVersion: 2
  readonly profile: 'TOPOLOGY_ABSENT_TRANSITION'
  readonly manifestUri: string
  readonly packageId: string
  readonly revision: string
  readonly assets: readonly TopologyAbsentPackageSessionAssetV2[]
  readonly topologyCapability: PackageTopologyUnavailableV2
}

export type TopologyPackageSessionState =
  | TopologyPackageSessionSnapshot
  | TopologyAbsentPackageSessionSnapshotV2

export interface TopologyFloorInfo {
  floorName: string
  building?: string | null
  level?: number | null
  floorType?: string | null
  url: string
  root: THREE.Object3D
}

export interface TopologyFetchResponse {
  ok: boolean
  status: number
  redirected: boolean
  url: string
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

export interface TopologyCachePort {
  enabled: boolean
  readonly files: Record<string, unknown>
  add(key: string, value: unknown): void
}

export interface TopologySceneLifecyclePorts {
  origin: string
  fetch(
    url: string,
    init: {
      signal: AbortSignal
      credentials: 'same-origin'
      redirect: 'error'
      headers?: Readonly<Record<string, string>>
    },
  ): Promise<TopologyFetchResponse>
  digestSha256(bytes: ArrayBuffer): Promise<string>
  cache: TopologyCachePort
  resolveLoaderUrl(url: string): string
  loadFloor(url: string): Promise<TopologyFloorInfo>
  /**
   * Receives modelTool's basename key, not a public URI. SSP advances its
   * global pending-load generation here, so lifecycle calls this only after
   * the current selection's model loads have settled.
   */
  unloadFloor(transportKey: string): void
  getScene(): THREE.Scene
  compileSidecar(
    jsonText: string,
    context: TopologySidecarCompileContext,
  ): TopologySidecarCompileResult
  createGraph(input: TopologyGraphInput): TopologyGraphSnapshot
  getGraph(id: string): TopologyGraphSnapshot | null
  removeGraph(id: string): boolean
  removeAllRoutes(): number
  removeAllGraphs(): number
  removeAllLegacyTopologies(): number
  /** Must invalidate/reject older pending model loads before they can attach. */
  unloadAllModels(): void
  assetConcurrency?: number
  createPackageSessionId?(): string
}

export interface TopologySelectionPlan {
  selection: ModelRecord
  assets: readonly ModelRecord[]
  sidecarUri: string
}

export type TopologyModelSelectionResult =
  | { kind: 'empty'; generation: number }
  | { kind: 'loaded'; generation: number; assetCount: number }
  | { kind: 'model-error'; generation: number; message: string }
  | { kind: 'stale'; generation: number }

interface SelectionTicket {
  generation: number
  controller: AbortController
  modelLoadsSettled: Promise<void>
  settleModelLoads(): void
}

interface SelectionAssets {
  loadedAssets: readonly TopologyLoadedAsset[]
  assetProofs: readonly TopologyAssetProof[]
  visualFailures: readonly TopologySidecarDiagnostic[]
  proofFailures: readonly TopologySidecarDiagnostic[]
}

interface SelectionAssetOutcome {
  loaded: TopologyLoadedAsset | null
  proof: TopologyAssetProof | null
  visualFailure: TopologySidecarDiagnostic | null
  proofFailure: TopologySidecarDiagnostic | null
}

interface PackageAssetLoadOutcome {
  readonly loaded: TopologyLoadedAsset
  readonly proof: TopologyAssetProof
  readonly sessionAsset: TopologyPackageSessionAsset
  /** modelTool's private basename key; never exposed as package identity. */
  readonly transportKey: string
}

interface PackageAssetLoadOutcomeV2 {
  readonly sessionAsset: TopologyAbsentPackageSessionAssetV2
  /** modelTool's private basename key; never exposed as package identity. */
  readonly transportKey: string
}

class StaleSelectionError extends Error {
  constructor() {
    super('selection is stale')
    this.name = 'StaleSelectionError'
  }
}

class SelectionFailure extends Error {
  constructor(
    readonly diagnostic: TopologySidecarDiagnostic,
    readonly modelMessage: string,
  ) {
    super(diagnostic.message)
    this.name = 'SelectionFailure'
  }
}

class AssetAuthorizationError extends SelectionFailure {}

class PackageAssetLoadFailure extends Error {
  constructor(readonly diagnostic: TopologySidecarDiagnostic) {
    super(diagnostic.message)
    this.name = 'PackageAssetLoadFailure'
  }
}

class PackageAssetLoadFailureV2 extends Error {
  constructor(readonly diagnostic: PackageDiagnostic) {
    super(diagnostic.code)
    this.name = 'PackageAssetLoadFailureV2'
  }
}

class PackageTransportRetirementFailure extends Error {
  constructor() {
    super('a superseded package transport could not be retired')
    this.name = 'PackageTransportRetirementFailure'
  }
}

class LoaderResolvedUrlMismatchError extends Error {
  constructor(
    readonly expectedCanonicalUri: string,
    readonly resolvedUri: string,
  ) {
    super('model loader URL resolution escaped the authorized asset URI')
    this.name = 'LoaderResolvedUrlMismatchError'
  }
}

function redactedUri(uri: string): string {
  try {
    const value = new URL(uri)
    value.username = ''
    value.password = ''
    value.search = ''
    value.hash = ''
    return value.href
  } catch {
    return ''
  }
}

function diagnostic(
  sidecarUri: string,
  code: TopologySidecarDiagnostic['code'],
  phase: TopologySidecarDiagnostic['phase'],
  message: string,
  options: {
    path?: string
    assetId?: string | null
    entityId?: string | null
    details?: TopologyJsonObject
  } = {},
): TopologySidecarDiagnostic {
  return {
    code,
    phase,
    message,
    path: options.path ?? '',
    sidecarUri: redactedUri(sidecarUri),
    assetId: options.assetId ?? null,
    entityId: options.entityId ?? null,
    details: options.details ?? {},
  }
}

function failSelection(
  sidecarUri: string,
  code: TopologySidecarDiagnostic['code'],
  phase: TopologySidecarDiagnostic['phase'],
  message: string,
  modelMessage: string,
  options: {
    path?: string
    assetId?: string | null
    entityId?: string | null
    details?: TopologyJsonObject
  } = {},
): never {
  throw new SelectionFailure(
    diagnostic(sidecarUri, code, phase, message, options),
    modelMessage,
  )
}

function canonicalOrigin(origin: string): URL {
  const parsed = new URL(origin)
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('application origin must be credential-free HTTP(S)')
  }
  return parsed
}

function packageSessionId(
  generation: number,
  factory: (() => string) | undefined,
): string {
  let candidate: string
  if (factory !== undefined) {
    candidate = factory()
  } else if (typeof globalThis.crypto?.randomUUID === 'function') {
    candidate = globalThis.crypto.randomUUID()
  } else {
    candidate = `generation-${generation.toString(36).padStart(8, '0')}`
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(candidate)) {
    throw new Error('package session id must be an opaque URL-safe token')
  }
  return candidate
}

function selectionTicket(generation: number): SelectionTicket {
  const controller = new AbortController()
  let settled = false
  let settle!: () => void
  const modelLoadsSettled = new Promise<void>((resolve) => { settle = resolve })
  return {
    generation,
    controller,
    modelLoadsSettled,
    settleModelLoads: () => {
      if (settled) return
      settled = true
      settle()
    },
  }
}

function packageManifestUri(origin: string, sessionId: string): string {
  return new URL(
    `/__space-model-package-v1/${sessionId}/space-model-package.v1.json`,
    canonicalOrigin(origin),
  ).href
}

function packageManifestUriV2(origin: string, sessionId: string): string {
  return new URL(
    `/__space-model-package-v2/${sessionId}/space-model-package.v2.json`,
    canonicalOrigin(origin),
  ).href
}

function packageTransportIdentity(
  manifestUri: string,
  sessionId: string,
  index: number,
  digest: string,
): { readonly url: string; readonly key: string } {
  const key = `${sessionId}-${String(index).padStart(3, '0')}-${digest.slice(0, 16)}`
  return Object.freeze({
    key,
    url: new URL(`./.transport/${key}.glb`, manifestUri).href,
  })
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer
  }
  return bytes.slice().buffer
}

function canonicalManifestAsset(record: ModelRecord, origin: string, sidecarUri: string): string {
  if (record.kind !== 'file') {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'only manifest file records can be loaded as topology assets',
      '模型清单包含非法资产记录',
    )
  }
  if (record.url.includes('\\')) {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest asset URL cannot contain backslashes',
      '模型资产 URL 非法',
    )
  }
  if (
    !record.url.startsWith('/') &&
    !record.url.startsWith('http://') &&
    !record.url.startsWith('https://')
  ) {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest GLB URL must use the exact URL forms supported by modelTool.loadFloor',
      '模型资产 URL 无法安全交接给模型加载器',
      { details: { requirement: 'EXACT_MODEL_TOOL_URL' } },
    )
  }
  const appOrigin = canonicalOrigin(origin)
  let canonical: URL
  try {
    canonical = new URL(record.url, appOrigin)
  } catch {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest asset URL cannot be normalized',
      '模型资产 URL 非法',
    )
  }
  if (
    canonical.origin !== appOrigin.origin ||
    canonical.username ||
    canonical.password ||
    canonical.search ||
    canonical.hash ||
    !/\.glb$/i.test(canonical.pathname)
  ) {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest asset must be a same-origin GLB URL without credentials, query, or fragment',
      '仅支持当前模型清单授权的同源 GLB',
      { details: { field: 'assetUrl' } },
    )
  }
  return canonical.href
}

function loaderFloorKey(record: ModelRecord): string {
  const filename = record.url.split('/').pop() ?? ''
  return filename.replace(/\.glb$/i, '')
}

export function resolveTopologySelectionPlan(
  selectedUrl: string,
  manifest: readonly ModelRecord[],
  origin: string,
): TopologySelectionPlan {
  const matches = manifest.filter((record) => record.url === selectedUrl)
  if (matches.length !== 1) {
    const placeholderSidecar = new URL('/topology.v1.json', canonicalOrigin(origin)).href
    failSelection(
      placeholderSidecar,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'selection must match exactly one current manifest record',
      '模型不在当前清单中',
      { details: { manifestMatches: matches.length } },
    )
  }
  const selection = matches[0]!
  const appOrigin = canonicalOrigin(origin)
  let selectionUrl: URL
  try {
    selectionUrl = new URL(selection.url, appOrigin)
  } catch {
    throw new Error('selection URL cannot be normalized')
  }
  if (
    selectionUrl.origin !== appOrigin.origin ||
    selectionUrl.username ||
    selectionUrl.password ||
    selectionUrl.search ||
    selectionUrl.hash
  ) {
    throw new Error('selection URL must be same-origin without credentials, query, or fragment')
  }

  let sidecarUrl: URL
  let assets: ModelRecord[]
  if (selection.kind === 'scene') {
    const directoryPath = selectionUrl.pathname.endsWith('/')
      ? selectionUrl.pathname
      : `${selectionUrl.pathname}/`
    sidecarUrl = new URL(`${directoryPath}topology.v1.json`, appOrigin)
    assets = manifest.filter(
      (record) => record.kind === 'file' && record.subcategory === selection.filename,
    )
    if (assets.length === 0) {
      failSelection(
        sidecarUrl.href,
        'SIDECAR_PARTIAL_SCENE',
        'DISCOVER',
        'scene selection has no authorized GLB records in the current manifest',
        '场景在当前模型清单中没有 GLB 资产',
      )
    }
    for (const asset of assets) {
      const canonical = new URL(canonicalManifestAsset(asset, origin, sidecarUrl.href))
      if (!canonical.pathname.startsWith(directoryPath)) {
        failSelection(
          sidecarUrl.href,
          'SIDECAR_FIELD_INVALID',
          'DISCOVER',
          'scene asset must remain inside the selected manifest scene directory',
          '场景资产目录与当前选择不一致',
        )
      }
    }
  } else {
    if (!/\.glb$/i.test(selectionUrl.pathname)) {
      throw new Error('file selection must be a GLB')
    }
    sidecarUrl = new URL(selectionUrl.href)
    sidecarUrl.pathname = sidecarUrl.pathname.replace(/\.glb$/i, '.topology.v1.json')
    assets = [selection]
    canonicalManifestAsset(selection, origin, sidecarUrl.href)
  }

  const canonicalUris = new Set<string>()
  const floorKeys = new Set<string>()
  for (const asset of assets) {
    const canonicalUri = canonicalManifestAsset(asset, origin, sidecarUrl.href)
    if (canonicalUris.has(canonicalUri)) {
      failSelection(
        sidecarUrl.href,
        'SIDECAR_FIELD_INVALID',
        'DISCOVER',
        'manifest selection contains duplicate canonical asset URLs',
        '模型清单包含重复资产 URL',
      )
    }
    canonicalUris.add(canonicalUri)
    const floorKey = loaderFloorKey(asset)
    if (!floorKey || floorKeys.has(floorKey)) {
      failSelection(
        sidecarUrl.href,
        'SIDECAR_FIELD_INVALID',
        'DISCOVER',
        'manifest selection contains duplicate model loader keys',
        '当前场景包含无法由模型加载器区分的同名 GLB',
      )
    }
    floorKeys.add(floorKey)
  }

  return { selection, assets, sidecarUri: sidecarUrl.href }
}

function glbJson(bytes: ArrayBuffer): Record<string, unknown> {
  if (bytes.byteLength < 20) throw new Error('GLB is too short')
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('GLB magic is invalid')
  if (view.getUint32(4, true) !== GLB_VERSION) throw new Error('GLB version is unsupported')
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB length is inconsistent')
  const chunkLength = view.getUint32(12, true)
  const chunkType = view.getUint32(16, true)
  if (chunkType !== GLB_JSON_CHUNK || chunkLength === 0 || 20 + chunkLength > bytes.byteLength) {
    throw new Error('GLB JSON chunk is invalid')
  }
  const jsonBytes = new Uint8Array(bytes, 20, chunkLength)
  const jsonText = new TextDecoder('utf-8', { fatal: true })
    .decode(jsonBytes)
    .replace(/\u0000+$/u, '')
    .trimEnd()
  const parsed = JSON.parse(jsonText) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('GLB JSON chunk must be an object')
  }
  return parsed as Record<string, unknown>
}

function assertEmbeddedUris(values: unknown, collection: 'buffers' | 'images'): void {
  if (values === undefined) return
  if (!Array.isArray(values)) throw new Error(`GLB ${collection} must be an array`)
  values.forEach((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`GLB ${collection}[${String(index)}] must be an object`)
    }
    const uri = (value as Record<string, unknown>).uri
    if (uri === undefined) return
    if (typeof uri !== 'string' || !/^data:/i.test(uri)) {
      throw new Error(`GLB ${collection}[${String(index)}] references an external URI`)
    }
  })
}

export function assertSelfContainedGlb(
  bytes: ArrayBuffer,
  sidecarUri: string,
  canonicalAssetUri: string,
): void {
  try {
    const json = glbJson(bytes)
    assertEmbeddedUris(json.buffers, 'buffers')
    assertEmbeddedUris(json.images, 'images')
  } catch {
    failSelection(
      sidecarUri,
      'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
      'BIND',
      'R1 SAME_RESPONSE_BYTES requires a valid self-contained GLB without external buffer or image URIs',
      '当前 R1 加载链路仅支持自包含 GLB',
      { details: { assetUri: redactedUri(canonicalAssetUri), requirement: 'SELF_CONTAINED_GLB' } },
    )
  }
}

export async function computeSha256Hex(
  bytes: ArrayBuffer,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<string> {
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable')
  const digestBytes = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digestBytes), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function loadFloorWithSynchronousCacheLease<T>(options: {
  url: string
  canonicalUrl: string
  bytes: ArrayBuffer
  cache: TopologyCachePort
  resolveLoaderUrl(url: string): string
  assertCurrent(): void
  loadFloor(url: string): Promise<T>
}): Promise<T> {
  const resolvedKey = assertAuthorizedLoaderResolution(
    options.url,
    options.canonicalUrl,
    options.resolveLoaderUrl,
  )
  options.assertCurrent()
  const files = options.cache.files
  const hadKey = Object.prototype.hasOwnProperty.call(files, resolvedKey)
  const previousValue = files[resolvedKey]
  const previousEnabled = options.cache.enabled
  let loadPromise!: Promise<T>
  try {
    options.cache.enabled = true
    options.cache.add(resolvedKey, options.bytes)
    loadPromise = Promise.resolve(options.loadFloor(options.url))
  } finally {
    if (hadKey) files[resolvedKey] = previousValue
    else delete files[resolvedKey]
    options.cache.enabled = previousEnabled
  }
  return loadPromise
}

function assertAuthorizedLoaderResolution(
  url: string,
  canonicalUrl: string,
  resolveLoaderUrl: (url: string) => string,
): string {
  const resolvedKey = resolveLoaderUrl(url)
  if (typeof resolvedKey !== 'string' || resolvedKey.length === 0) {
    throw new Error('model loader resolved an empty cache key')
  }
  let normalizedResolvedUrl: string
  try {
    normalizedResolvedUrl = new URL(resolvedKey, canonicalUrl).href
  } catch {
    throw new LoaderResolvedUrlMismatchError(canonicalUrl, '')
  }
  if (normalizedResolvedUrl !== canonicalUrl) {
    throw new LoaderResolvedUrlMismatchError(canonicalUrl, normalizedResolvedUrl)
  }
  return resolvedKey
}

function owningScene(root: THREE.Object3D): THREE.Scene | null {
  let current: THREE.Object3D | null = root
  while (current !== null) {
    if ((current as THREE.Scene).isScene === true) return current as THREE.Scene
    current = current.parent
  }
  return null
}

function isVisibleInScene(root: THREE.Object3D, scene: THREE.Scene): boolean {
  return (root as { isObject3D?: boolean }).isObject3D === true && owningScene(root) === scene
}

type LoadedFloorIdentityField = 'floorName' | 'building' | 'level' | 'floorType'

function loadedFloorIdentityMismatchField(
  info: TopologyFloorInfo,
  expected: PackageFloor,
): LoadedFloorIdentityField | null {
  if (info.floorName !== expected.floorName) return 'floorName'
  if (!Object.is(info.building, expected.building)) return 'building'
  if (!Object.is(info.level, expected.level)) return 'level'
  if (info.floorType !== expected.floorType) return 'floorType'
  return null
}

function safeErrorName(error: unknown): string {
  let name = ''
  try {
    name = error instanceof Error ? error.name : ''
  } catch {
    // Hostile/custom Error subclasses must not break diagnostic fallback.
  }
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : 'UnknownError'
}

function safeDiagnosticString(value: string): string {
  const bounded = value.slice(0, SAFE_ERROR_STRING_LENGTH)
  try {
    const parsed = new URL(bounded)
    if (parsed.protocol === 'file:') return '[redacted-local-path]'
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return redactedUri(parsed.href)
  } catch {
    // Non-URL strings remain valid bounded topology metadata.
  }

  const remoteUrls: string[] = []
  const withoutRemoteUrls = bounded.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    const marker = `\u0000safe-url-${String(remoteUrls.length)}\u0000`
    remoteUrls.push(redactedUri(candidate) || '[redacted-uri]')
    return marker
  })
  if (
    /file:\/\//i.test(withoutRemoteUrls) ||
    /(?:^|[^A-Za-z0-9._-])\/(?!\/)[^\s"'<>]+/.test(withoutRemoteUrls) ||
    /[A-Za-z]:[\\/]/.test(withoutRemoteUrls)
  ) {
    return '[redacted-local-path]'
  }
  return withoutRemoteUrls.replace(/\u0000safe-url-(\d+)\u0000/g, (_marker, index: string) => (
    remoteUrls[Number(index)] ?? '[redacted-uri]'
  ))
}

function safeTopologyErrorPath(value: string): string {
  const bounded = value.slice(0, SAFE_ERROR_STRING_LENGTH)
  if (
    /^[A-Za-z][A-Za-z0-9_.\[\]-]*$/.test(bounded) ||
    /^\/(?:assets|blockers|connectors|edges|graph|id|layers|nodes|options|patch|query|route|selector)(?:\/|$)[A-Za-z0-9_./\[\]-]*$/.test(bounded)
  ) {
    return bounded
  }
  return safeDiagnosticString(bounded)
}

function safeJsonValue(
  value: unknown,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
  ancestors: ReadonlySet<object> = new Set(),
): TopologyJsonValue | undefined {
  if (budget.nodes >= SAFE_ERROR_DETAIL_NODES || depth > SAFE_ERROR_DETAIL_DEPTH) return undefined
  budget.nodes += 1
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return safeDiagnosticString(value)
  if (typeof value !== 'object' || ancestors.has(value)) return undefined

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)
  if (Array.isArray(value)) {
    const items: TopologyJsonValue[] = []
    for (const item of value.slice(0, SAFE_ERROR_CONTAINER_ITEMS)) {
      const safe = safeJsonValue(item, depth + 1, budget, nextAncestors)
      if (safe !== undefined) items.push(safe)
    }
    return items
  }

  let prototype: object | null
  let descriptors: Record<string, PropertyDescriptor>
  try {
    prototype = Object.getPrototypeOf(value) as object | null
    if (prototype !== Object.prototype && prototype !== null) return undefined
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return undefined
  }
  const output: Record<string, TopologyJsonValue> = {}
  for (const key of Object.keys(descriptors).slice(0, SAFE_ERROR_CONTAINER_ITEMS)) {
    if (
      /^(?:__proto__|prototype|constructor)$/i.test(key) ||
      SENSITIVE_DIAGNOSTIC_KEY.test(key)
    ) continue
    const descriptor = descriptors[key]!
    if (!('value' in descriptor)) continue
    const safe = safeJsonValue(descriptor.value, depth + 1, budget, nextAncestors)
    if (safe !== undefined) output[key.slice(0, SAFE_ERROR_STRING_LENGTH)] = safe
  }
  return output
}

function safeCaughtErrorDetails(error: unknown): TopologyJsonObject {
  const output: Record<string, TopologyJsonValue> = { cause: safeErrorName(error) }
  if (!(error instanceof TopologyError)) return output

  let code: unknown
  let path: unknown
  let details: unknown
  try {
    code = error.code
    path = error.path
    details = error.details
  } catch {
    return output
  }
  if (
    code !== 'INVALID_ARGUMENT' &&
    code !== 'DUPLICATE_ID' &&
    code !== 'BROKEN_REFERENCE' &&
    code !== 'INVALID_GRAPH' &&
    code !== 'LIMIT_EXCEEDED' &&
    code !== 'CONTEXT_UNAVAILABLE' &&
    code !== 'RENDER_FAILED'
  ) return output

  const topologyError: Record<string, TopologyJsonValue> = { code }
  if (typeof path === 'string') topologyError.path = safeTopologyErrorPath(path)
  const safeDetails = safeJsonValue(details)
  if (safeDetails !== undefined && !Array.isArray(safeDetails) && safeDetails !== null) {
    topologyError.details = safeDetails
  }
  output.topologyError = topologyError
  return output
}

function proofFailureFromUnknown(
  sidecarUri: string,
  canonicalAssetUri: string,
  error: unknown,
): TopologySidecarDiagnostic {
  if (error instanceof SelectionFailure) return error.diagnostic
  if (error instanceof LoaderResolvedUrlMismatchError) {
    return diagnostic(
      sidecarUri,
      'SIDECAR_ASSET_BINDING_MISMATCH',
      'BIND',
      'model loader URL resolution does not match the authorized manifest asset',
      {
        details: {
          requirement: 'RESOLVED_URL_MATCH',
          expectedAssetUri: redactedUri(error.expectedCanonicalUri),
          resolvedAssetUri: redactedUri(error.resolvedUri),
        },
      },
    )
  }
  return diagnostic(
    sidecarUri,
    'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
    'BIND',
    'SAME_RESPONSE_BYTES proof could not be completed for the current asset',
    {
      details: {
        assetUri: redactedUri(canonicalAssetUri),
        cause: safeErrorName(error),
      },
    },
  )
}

function visualFailureDiagnostic(
  sidecarUri: string,
  canonicalAssetUri: string,
  selectedAssetCount: number,
  proofFailure: TopologySidecarDiagnostic,
  error: unknown,
): TopologySidecarDiagnostic {
  return diagnostic(
    sidecarUri,
    selectedAssetCount > 1 ? 'SIDECAR_PARTIAL_SCENE' : 'SIDECAR_ASSET_NOT_LOADED',
    'BIND',
    'the selected manifest asset could not be loaded for visual display',
    {
      details: {
        assetUri: redactedUri(canonicalAssetUri),
        proofFailureCode: proofFailure.code,
        loaderCause: safeErrorName(error),
      },
    },
  )
}

function modelFailureFromUnknown(sidecarUri: string, error: unknown): SelectionFailure {
  if (error instanceof SelectionFailure) return error
  return new SelectionFailure(
    diagnostic(
      sidecarUri,
      'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
      'BIND',
      'current manifest asset could not be loaded and strongly bound',
      { details: { cause: safeErrorName(error) } },
    ),
    '模型资产加载或校验失败',
  )
}

function freezeJsonValue(value: TopologyJsonObject[string]): TopologyJsonObject[string] {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeJsonValue(item)))
  }
  if (typeof value === 'object' && value !== null) {
    const clone: Record<string, TopologyJsonObject[string]> = {}
    for (const [key, item] of Object.entries(value)) clone[key] = freezeJsonValue(item)
    return Object.freeze(clone)
  }
  return value
}

function freezeDiagnostic(value: TopologySidecarDiagnostic): TopologySidecarDiagnostic {
  return Object.freeze({
    ...value,
    details: freezeJsonValue(value.details) as TopologyJsonObject,
  })
}

function freezePackageDiagnostic(value: PackageDiagnostic): PackageDiagnostic {
  return Object.freeze({
    ...value,
    details: Object.freeze({ ...value.details }),
  })
}

function isTopologyAbsentPackageSessionV2(
  value: TopologyPackageSessionState,
): value is TopologyAbsentPackageSessionSnapshotV2 {
  return 'schemaVersion' in value && value.schemaVersion === 2
}

function freezeMetadataProjectionV2(
  value: PackageMetadataProjectionV2,
): PackageMetadataProjectionV2 {
  return Object.freeze({
    scene: Object.freeze({ ...value.scene }),
    nodes: Object.freeze(value.nodes.map((node) => Object.freeze({ ...node }))),
  })
}

function freezePackageSession(
  value: TopologyPackageSessionState,
): TopologyPackageSessionState {
  if (isTopologyAbsentPackageSessionV2(value)) {
    return Object.freeze({
      schemaVersion: 2,
      profile: 'TOPOLOGY_ABSENT_TRANSITION',
      manifestUri: value.manifestUri,
      packageId: value.packageId,
      revision: value.revision,
      assets: Object.freeze(value.assets.map((asset) => Object.freeze({
        ...asset,
        metadata: freezeMetadataProjectionV2(asset.metadata),
        resourceProof: Object.freeze({
          ...asset.resourceProof,
          digest: Object.freeze({ ...asset.resourceProof.digest }),
        }),
      }))),
      topologyCapability: Object.freeze({ ...value.topologyCapability }),
    })
  }
  return Object.freeze({
    manifestUri: value.manifestUri,
    packageId: value.packageId,
    revision: value.revision,
    assets: Object.freeze(value.assets.map((asset) => Object.freeze({ ...asset }))),
  })
}

interface TopologySceneSessionStateInput {
  status: TopologySceneSessionStatus
  graphId: string | null
  nodes: readonly TopologySceneSessionNode[]
  diagnostic: TopologySidecarDiagnostic | null
  packageDiagnostic?: PackageDiagnostic | null
  packageSession?: TopologyPackageSessionState | null
}

export class TopologySceneLifecycle {
  private generation = 0
  private active: SelectionTicket | null = null
  /**
   * modelTool.unloadFloor invalidates its global pending-load generation even
   * though it removes one basename key. A stale package retirement therefore
   * waits for the current selection's model loads, while the current selection
   * waits for that retirement before compiling or committing a graph.
   */
  private readonly packageRetirements = new Set<{
    readonly sourceGeneration: number
    readonly promise: Promise<void>
  }>()
  private state: TopologySceneSessionSnapshot = {
    status: 'idle',
    graphId: null,
    nodes: [],
    diagnostic: null,
    packageDiagnostic: null,
    packageSession: null,
  }

  constructor(
    private readonly ports: TopologySceneLifecyclePorts,
    private readonly onStateChange: (state: TopologySceneSessionSnapshot) => void = () => undefined,
  ) {
    this.publish(this.state)
  }

  get snapshot(): TopologySceneSessionSnapshot {
    return this.state
  }

  getPackageAssetById(assetId: string): TopologyPackageSessionAsset | null {
    const packageSession = this.state.packageSession
    if (packageSession === null || isTopologyAbsentPackageSessionV2(packageSession)) return null
    return packageSession.assets.find((asset) => asset.assetId === assetId) ?? null
  }

  getPackageAssetsByFloorName(floorName: string): readonly TopologyPackageSessionAsset[] {
    const packageSession = this.state.packageSession
    if (packageSession === null || isTopologyAbsentPackageSessionV2(packageSession)) {
      return Object.freeze([])
    }
    return Object.freeze(
      packageSession.assets.filter((asset) => asset.floorName === floorName),
    )
  }

  getPackageV2AssetById(assetId: string): TopologyAbsentPackageSessionAssetV2 | null {
    const packageSession = this.state.packageSession
    if (packageSession === null || !isTopologyAbsentPackageSessionV2(packageSession)) return null
    return packageSession.assets.find((asset) => asset.assetId === assetId) ?? null
  }

  getPackageV2ResourceProof(assetId: string): PackageAssetResourceProofV2 | null {
    return this.getPackageV2AssetById(assetId)?.resourceProof ?? null
  }

  isGenerationCurrent(generation: number): boolean {
    return this.generation === generation
  }

  invalidate(): number {
    const generation = ++this.generation
    this.active?.settleModelLoads()
    this.active?.controller.abort()
    this.active = null
    this.publish({ status: 'idle', graphId: null, nodes: [], diagnostic: null })
    return generation
  }

  invalidateAndCleanup(): number {
    const generation = ++this.generation
    this.active?.settleModelLoads()
    this.active?.controller.abort()
    this.active = null
    const cleanupErrors = this.cleanupResources()
    if (cleanupErrors.length > 0) {
      this.publish({
        status: 'error',
        graphId: null,
        nodes: [],
        diagnostic: diagnostic(
          new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'LIFECYCLE',
          'one or more model-session resources could not be released',
          { details: { failedStages: cleanupErrors.map((item) => item.stage) } },
        ),
      })
    } else {
      this.publish({ status: 'idle', graphId: null, nodes: [], diagnostic: null })
    }
    return generation
  }

  async select(
    selectedUrl: string,
    manifest: readonly ModelRecord[],
  ): Promise<TopologyModelSelectionResult> {
    const generation = ++this.generation
    this.active?.settleModelLoads()
    this.active?.controller.abort()
    this.active = null
    const cleanupErrors = this.cleanupResources()
    if (cleanupErrors.length > 0) {
      const sidecarUri = new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href
      const failure = diagnostic(
        sidecarUri,
        'SIDECAR_GRAPH_COMMIT_FAILED',
        'LIFECYCLE',
        'old model-session resources could not be fully released',
        { details: { failedStages: cleanupErrors.map((item) => item.stage) } },
      )
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure })
      return { kind: 'model-error', generation, message: '旧模型资源清理失败' }
    }
    if (!selectedUrl) {
      this.publish({ status: 'idle', graphId: null, nodes: [], diagnostic: null })
      return { kind: 'empty', generation }
    }

    const ticket = selectionTicket(generation)
    this.active = ticket
    this.publish({ status: 'loading', graphId: null, nodes: [], diagnostic: null })

    let plan: TopologySelectionPlan
    try {
      plan = resolveTopologySelectionPlan(selectedUrl, manifest, this.ports.origin)
    } catch (error) {
      ticket.settleModelLoads()
      if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation }
      const sidecarUri = new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href
      const failure = modelFailureFromUnknown(sidecarUri, error)
      ticket.controller.abort()
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure.diagnostic })
      return { kind: 'model-error', generation, message: failure.modelMessage }
    }

    let assets: SelectionAssets
    try {
      assets = await this.loadSelectionAssets(plan, ticket)
      ticket.settleModelLoads()
      await this.awaitPriorPackageRetirements(ticket)
    } catch (error) {
      ticket.settleModelLoads()
      if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation }
      if (error instanceof PackageTransportRetirementFailure) {
        const cleanupErrors = this.cleanupResources()
        const failure = diagnostic(
          plan.sidecarUri,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'LIFECYCLE',
          'a superseded package transport could not be retired before legacy model commit',
          { details: { failedStages: cleanupErrors.map((item) => item.stage) } },
        )
        this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure })
        return { kind: 'model-error', generation, message: '旧模型包资源清理失败' }
      }
      const failure = modelFailureFromUnknown(plan.sidecarUri, error)
      this.publish({
        status: 'error',
        graphId: null,
        nodes: [],
        diagnostic: failure.diagnostic,
      })
      return { kind: 'model-error', generation, message: failure.modelMessage }
    }

    if (!this.isTicketCurrent(ticket)) return { kind: 'stale', generation }
    const visibleAssetCount = assets.loadedAssets.length
    const modelResult = (): TopologyModelSelectionResult => visibleAssetCount === 0
      ? { kind: 'model-error', generation, message: '模型资产加载失败' }
      : { kind: 'loaded', generation, assetCount: visibleAssetCount }

    const sidecar = await this.loadSidecar(plan.sidecarUri, ticket)
    if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation }
    if (sidecar.kind === 'stale') return { kind: 'stale', generation }
    if (sidecar.kind === 'unavailable') {
      this.publish({ status: 'unavailable', graphId: null, nodes: [], diagnostic: sidecar.diagnostic })
      return modelResult()
    }
    if (sidecar.kind === 'error') {
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: sidecar.diagnostic })
      return modelResult()
    }

    if (visibleAssetCount === 0) {
      const parsed = parseTopologySidecarV1(sidecar.text, plan.sidecarUri)
      const noVisualFailure = assets.visualFailures[0] ?? diagnostic(
        plan.sidecarUri,
        'SIDECAR_ASSET_NOT_LOADED',
        'BIND',
        'no selected manifest asset produced a visible THREE.Scene root',
      )
      const failure = !parsed.ok
        ? parsed.diagnostics[0] ?? noVisualFailure
        : noVisualFailure
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure })
      return modelResult()
    }

    const scene = this.ports.getScene()
    const context: TopologySidecarCompileContext = {
      sidecarUri: plan.sidecarUri,
      scene,
      selectionGeneration: generation,
      isSelectionCurrent: (candidate) => candidate === generation && this.isTicketCurrent(ticket),
      loadedAssets: assets.loadedAssets,
      assetProofs: assets.assetProofs,
    }

    let compiled: TopologySidecarCompileResult
    try {
      compiled = this.ports.compileSidecar(sidecar.text, context)
    } catch (error) {
      compiled = {
        ok: false,
        diagnostics: [diagnostic(
          plan.sidecarUri,
          'SIDECAR_FIELD_INVALID',
          'COMPILE',
          'topology sidecar compiler failed unexpectedly',
          { details: safeCaughtErrorDetails(error) },
        )],
      }
    }
    if (!this.isTicketCurrent(ticket)) return { kind: 'stale', generation }
    if (!compiled.ok) {
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: compiled.diagnostics[0] ?? null })
      return modelResult()
    }

    const commit = this.commitGraph(compiled.input, plan.sidecarUri, ticket)
    if (commit.kind === 'stale') return { kind: 'stale', generation }
    if (commit.kind === 'error') {
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: commit.diagnostic })
      return modelResult()
    }
    this.publish({
      status: 'ready',
      graphId: commit.snapshot.id,
      nodes: compiled.input.nodes.map((node) => ({
        id: node.id,
        layerId: node.layerId,
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.kind === undefined ? {} : { kind: node.kind }),
        ...(node.subtype === undefined ? {} : { subtype: node.subtype }),
      })),
      diagnostic: null,
    })
    return { kind: 'loaded', generation, assetCount: visibleAssetCount }
  }

  async selectPackage(packageBytes: Uint8Array): Promise<TopologyModelSelectionResult> {
    const generation = ++this.generation
    this.active?.settleModelLoads()
    this.active?.controller.abort()
    this.active = null
    const cleanupErrors = this.cleanupResources()
    if (cleanupErrors.length > 0) {
      const sidecarUri = new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href
      const failure = diagnostic(
        sidecarUri,
        'SIDECAR_GRAPH_COMMIT_FAILED',
        'LIFECYCLE',
        'old model-session resources could not be fully released before package import',
        { details: { failedStages: cleanupErrors.map((item) => item.stage) } },
      )
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure })
      return { kind: 'model-error', generation, message: '旧模型资源清理失败' }
    }

    const ticket = selectionTicket(generation)
    this.active = ticket
    this.publish({ status: 'loading', graphId: null, nodes: [], diagnostic: null })

    let sessionId: string
    let manifestUri: string
    try {
      sessionId = packageSessionId(generation, this.ports.createPackageSessionId)
      manifestUri = packageManifestUri(this.ports.origin, sessionId)
    } catch (error) {
      const failure = packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        '/',
        { cause: safeErrorName(error) },
      )
      return this.failPackageSelection(ticket, { packageDiagnostic: failure }, '模型包会话初始化失败')
    }

    let prepared: PreparedPackageTopologyV1
    try {
      // parsePackageZipV1 is synchronous. It completes before this async method
      // yields, then resource entries are copied so later caller mutation cannot
      // alter the bytes that are hashed, validated, and handed to GLTFLoader.
      const parsedArchive = parsePackageZipV1(packageBytes, manifestUri)
      if (!parsedArchive.ok) {
        return this.failPackageSelection(
          ticket,
          { packageDiagnostic: parsedArchive.diagnostic },
          '标准模型包校验失败',
        )
      }
      const ownedArchive = clonePackageArchiveResources(parsedArchive.value)
      const validated = await validatePackageArchive(ownedArchive)
      this.assertTicketCurrent(ticket)
      if (!validated.ok) {
        return this.failPackageSelection(
          ticket,
          { packageDiagnostic: validated.diagnostic },
          '标准模型包校验失败',
        )
      }
      const binding = prebindPackageTopologyV1(ownedArchive, validated.value)
      if (!binding.ok) {
        return this.failPackageSelection(
          ticket,
          binding.kind === 'package'
            ? { packageDiagnostic: binding.diagnostic }
            : { sidecarDiagnostic: binding.diagnostic },
          '标准模型包拓扑绑定失败',
        )
      }
      prepared = binding.value
    } catch (error) {
      if (!this.ownsGeneration(ticket) || error instanceof StaleSelectionError) {
        ticket.settleModelLoads()
        return { kind: 'stale', generation }
      }
      const failure = packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        '/',
        { cause: safeErrorName(error) },
        { manifestUri },
      )
      return this.failPackageSelection(ticket, { packageDiagnostic: failure }, '标准模型包校验失败')
    }

    let packageAssets: readonly PackageAssetLoadOutcome[]
    try {
      packageAssets = await this.loadPackageAssets(prepared, sessionId, ticket)
      ticket.settleModelLoads()
      await this.awaitPriorPackageRetirements(ticket)
    } catch (error) {
      ticket.settleModelLoads()
      if (!this.ownsGeneration(ticket) || error instanceof StaleSelectionError) {
        return { kind: 'stale', generation }
      }
      const failure = error instanceof PackageTransportRetirementFailure
        ? diagnostic(
            prepared.manifest.topology.canonicalUri,
            'SIDECAR_GRAPH_COMMIT_FAILED',
            'LIFECYCLE',
            'a superseded package transport could not be retired before graph compilation',
          )
        : error instanceof PackageAssetLoadFailure
          ? error.diagnostic
          : diagnostic(
            prepared.manifest.topology.canonicalUri,
            'SIDECAR_ASSET_NOT_LOADED',
            'BIND',
            'package asset loading failed without a trustworthy loaded root',
            { details: { cause: safeErrorName(error) } },
            )
      return this.failPackageSelection(
        ticket,
        { sidecarDiagnostic: failure },
        '标准模型包资产加载失败',
      )
    }

    if (!this.isTicketCurrent(ticket)) return { kind: 'stale', generation }
    const context: TopologySidecarCompileContext = {
      sidecarUri: prepared.manifest.topology.canonicalUri,
      scene: this.ports.getScene(),
      selectionGeneration: generation,
      isSelectionCurrent: (candidate) => candidate === generation && this.isTicketCurrent(ticket),
      loadedAssets: packageAssets.map((asset) => asset.loaded),
      assetProofs: packageAssets.map((asset) => asset.proof),
    }

    let compiled: TopologySidecarCompileResult
    try {
      compiled = this.ports.compileSidecar(prepared.topologyText, context)
    } catch (error) {
      compiled = {
        ok: false,
        diagnostics: [diagnostic(
          prepared.manifest.topology.canonicalUri,
          'SIDECAR_FIELD_INVALID',
          'COMPILE',
          'topology sidecar compiler failed unexpectedly',
          { details: safeCaughtErrorDetails(error) },
        )],
      }
    }
    if (!this.isTicketCurrent(ticket)) return { kind: 'stale', generation }
    if (!compiled.ok) {
      return this.failPackageSelection(
        ticket,
        { sidecarDiagnostic: compiled.diagnostics[0] ?? diagnostic(
          prepared.manifest.topology.canonicalUri,
          'SIDECAR_FIELD_INVALID',
          'COMPILE',
          'topology sidecar compilation failed without a diagnostic',
        ) },
        '标准模型包拓扑编译失败',
      )
    }

    const commit = this.commitGraph(
      compiled.input,
      prepared.manifest.topology.canonicalUri,
      ticket,
    )
    if (commit.kind === 'stale') return { kind: 'stale', generation }
    if (commit.kind === 'error') {
      return this.failPackageSelection(
        ticket,
        { sidecarDiagnostic: commit.diagnostic },
        '标准模型包拓扑提交失败',
      )
    }

    const packageSession: TopologyPackageSessionSnapshot = {
      manifestUri: prepared.manifest.manifestUri,
      packageId: prepared.manifest.packageId,
      revision: prepared.manifest.revision,
      assets: packageAssets.map((asset) => asset.sessionAsset),
    }
    this.publish({
      status: 'ready',
      graphId: commit.snapshot.id,
      nodes: compiled.input.nodes.map((node) => ({
        id: node.id,
        layerId: node.layerId,
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.kind === undefined ? {} : { kind: node.kind }),
        ...(node.subtype === undefined ? {} : { subtype: node.subtype }),
      })),
      diagnostic: null,
      packageSession,
    })
    return { kind: 'loaded', generation, assetCount: packageAssets.length }
  }

  async selectPackageV2(packageBytes: Uint8Array): Promise<TopologyModelSelectionResult> {
    const generation = ++this.generation
    this.active?.settleModelLoads()
    this.active?.controller.abort()
    this.active = null
    const cleanupErrors = this.cleanupResources()
    if (cleanupErrors.length > 0) {
      const failure = packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        '/',
        {
          reason: 'old-session-cleanup',
          failedStageCount: cleanupErrors.length,
          failedStages: cleanupErrors.map((item) => item.stage).join(','),
        },
      )
      this.publish({
        status: 'error',
        graphId: null,
        nodes: [],
        diagnostic: null,
        packageDiagnostic: failure,
      })
      return { kind: 'model-error', generation, message: '旧模型资源清理失败' }
    }

    const ticket = selectionTicket(generation)
    this.active = ticket
    this.publish({ status: 'loading', graphId: null, nodes: [], diagnostic: null })

    let sessionId: string
    let manifestUri: string
    try {
      sessionId = packageSessionId(generation, this.ports.createPackageSessionId)
      manifestUri = packageManifestUriV2(this.ports.origin, sessionId)
    } catch (error) {
      const failure = packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        '/',
        { reason: 'session-initialization', error: safeErrorName(error) },
      )
      return this.failPackageV2Selection(ticket, failure, '模型包会话初始化失败')
    }

    let validated: ValidatedPackageArchiveV2
    try {
      // The v2 ZIP parser produces owned entry byte arrays. Validation therefore
      // finishes manifest revision, every digest, Metadata 3.3, and cross-asset
      // identity checks before any model loader can observe an asset.
      const parsedArchive = parsePackageZipV2(packageBytes, manifestUri)
      if (!parsedArchive.ok) {
        return this.failPackageV2Selection(
          ticket,
          parsedArchive.diagnostic,
          '标准模型包校验失败',
        )
      }
      const validatedArchive = await validatePackageArchiveV2(parsedArchive.value)
      this.assertTicketCurrent(ticket)
      if (!validatedArchive.ok) {
        return this.failPackageV2Selection(
          ticket,
          validatedArchive.diagnostic,
          '标准模型包校验失败',
        )
      }
      validated = validatedArchive.value
    } catch (error) {
      if (!this.ownsGeneration(ticket) || error instanceof StaleSelectionError) {
        ticket.settleModelLoads()
        return { kind: 'stale', generation }
      }
      const failure = packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        '/',
        { reason: 'package-validation', error: safeErrorName(error) },
        { manifestUri },
      )
      return this.failPackageV2Selection(ticket, failure, '标准模型包校验失败')
    }

    let packageAssets: readonly PackageAssetLoadOutcomeV2[]
    try {
      packageAssets = await this.loadPackageAssetsV2(validated, sessionId, ticket)
      ticket.settleModelLoads()
      await this.awaitPriorPackageRetirements(ticket)
    } catch (error) {
      ticket.settleModelLoads()
      if (!this.ownsGeneration(ticket) || error instanceof StaleSelectionError) {
        return { kind: 'stale', generation }
      }
      const failure = error instanceof PackageAssetLoadFailureV2
        ? error.diagnostic
        : packageDiagnostic(
            'PACKAGE_FIELD_INVALID',
            'LIFECYCLE',
            '/assets',
            {
              reason: error instanceof PackageTransportRetirementFailure
                ? 'transport-retirement'
                : 'asset-load',
              error: safeErrorName(error),
            },
            { manifestUri },
          )
      return this.failPackageV2Selection(ticket, failure, '标准模型包资产加载失败')
    }

    if (!this.isTicketCurrent(ticket)) return { kind: 'stale', generation }
    const manifest = validated.archive.manifestDocument
    const packageSession: TopologyAbsentPackageSessionSnapshotV2 = {
      schemaVersion: 2,
      profile: 'TOPOLOGY_ABSENT_TRANSITION',
      manifestUri: manifest.manifestUri,
      packageId: manifest.packageId,
      revision: manifest.revision,
      assets: packageAssets.map((asset) => asset.sessionAsset),
      topologyCapability: validated.topologyCapability,
    }
    this.publish({
      status: 'scene-ready',
      graphId: null,
      nodes: [],
      diagnostic: null,
      packageDiagnostic: null,
      packageSession,
    })
    return { kind: 'loaded', generation, assetCount: packageAssets.length }
  }

  private failPackageSelection(
    ticket: SelectionTicket,
    failure: {
      readonly packageDiagnostic?: PackageDiagnostic
      readonly sidecarDiagnostic?: TopologySidecarDiagnostic
    },
    modelMessage: string,
  ): TopologyModelSelectionResult {
    ticket.settleModelLoads()
    if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation: ticket.generation }
    ticket.controller.abort()
    if (this.active === ticket) this.active = null
    const cleanupErrors = this.cleanupResources()
    const cleanupFailure = cleanupErrors.length === 0
      ? null
      : diagnostic(
          new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'LIFECYCLE',
          'failed package session could not be fully released',
          { details: { failedStages: cleanupErrors.map((item) => item.stage) } },
        )
    this.publish({
      status: 'error',
      graphId: null,
      nodes: [],
      diagnostic: cleanupFailure ?? failure.sidecarDiagnostic ?? null,
      packageDiagnostic: failure.packageDiagnostic ?? null,
    })
    return {
      kind: 'model-error',
      generation: ticket.generation,
      message: cleanupFailure === null ? modelMessage : '模型包失败且资源清理不完整',
    }
  }

  private failPackageV2Selection(
    ticket: SelectionTicket,
    failure: PackageDiagnostic,
    modelMessage: string,
  ): TopologyModelSelectionResult {
    ticket.settleModelLoads()
    if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation: ticket.generation }
    ticket.controller.abort()
    if (this.active === ticket) this.active = null
    const cleanupErrors = this.cleanupResources()
    const manifestUri = failure.manifestUri
    const publishedFailure = cleanupErrors.length === 0
      ? failure
      : packageDiagnostic(
          'PACKAGE_FIELD_INVALID',
          'LIFECYCLE',
          '/',
          {
            reason: 'failed-session-cleanup',
            failedStageCount: cleanupErrors.length,
            failedStages: cleanupErrors.map((item) => item.stage).join(','),
          },
          { manifestUri },
        )
    this.publish({
      status: 'error',
      graphId: null,
      nodes: [],
      diagnostic: null,
      packageDiagnostic: publishedFailure,
    })
    return {
      kind: 'model-error',
      generation: ticket.generation,
      message: cleanupErrors.length === 0 ? modelMessage : '模型包失败且资源清理不完整',
    }
  }

  private async loadPackageAssets(
    prepared: PreparedPackageTopologyV1,
    sessionId: string,
    ticket: SelectionTicket,
  ): Promise<readonly PackageAssetLoadOutcome[]> {
    const outcomes = new Array<PackageAssetLoadOutcome>(prepared.assets.length)
    const concurrency = Math.min(
      3,
      Math.max(2, this.ports.assetConcurrency ?? DEFAULT_ASSET_CONCURRENCY),
    )
    let cursor = 0
    let firstFailure: PackageAssetLoadFailure | null = null
    let stale = false

    const worker = async (): Promise<void> => {
      while (firstFailure === null) {
        if (!this.isTicketCurrent(ticket)) {
          stale = true
          return
        }
        const index = cursor++
        if (index >= prepared.assets.length) return
        try {
          outcomes[index] = await this.loadPackageAsset(
            prepared,
            prepared.assets[index]!,
            index,
            sessionId,
            ticket,
          )
        } catch (error) {
          if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
            stale = true
            return
          }
          firstFailure = error instanceof PackageAssetLoadFailure
            ? error
            : new PackageAssetLoadFailure(diagnostic(
                prepared.manifest.topology.canonicalUri,
                'SIDECAR_ASSET_NOT_LOADED',
                'BIND',
                'package asset loading failed without a trustworthy loaded root',
                {
                  assetId: prepared.assets[index]!.manifestAsset.assetId,
                  details: { cause: safeErrorName(error) },
                },
              ))
          return
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, prepared.assets.length) },
      () => worker(),
    )
    await Promise.allSettled(workers)
    if (stale || !this.isTicketCurrent(ticket)) throw new StaleSelectionError()
    if (firstFailure !== null) throw firstFailure
    if (outcomes.some((outcome) => outcome === undefined)) {
      throw new PackageAssetLoadFailure(diagnostic(
        prepared.manifest.topology.canonicalUri,
        'SIDECAR_PARTIAL_SCENE',
        'BIND',
        'package asset workers did not produce a complete loaded scene',
        { details: { expected: prepared.assets.length, actual: outcomes.filter(Boolean).length } },
      ))
    }
    const roots = new Set(outcomes.map((outcome) => outcome.loaded.root))
    if (roots.size !== outcomes.length) {
      throw new PackageAssetLoadFailure(diagnostic(
        prepared.manifest.topology.canonicalUri,
        'SIDECAR_ASSET_NOT_LOADED',
        'BIND',
        'one loaded root cannot satisfy multiple package assets',
        { details: { assets: outcomes.length, roots: roots.size } },
      ))
    }
    return Object.freeze(outcomes)
  }

  private async loadPackageAsset(
    prepared: PreparedPackageTopologyV1,
    asset: PreparedPackageTopologyV1['assets'][number],
    index: number,
    sessionId: string,
    ticket: SelectionTicket,
  ): Promise<PackageAssetLoadOutcome> {
    this.assertTicketCurrent(ticket)
    const manifestAsset = asset.manifestAsset
    const transport = packageTransportIdentity(
      prepared.manifest.manifestUri,
      sessionId,
      index,
      manifestAsset.digest.value,
    )
    let info: TopologyFloorInfo | null = null
    try {
      info = await loadFloorWithSynchronousCacheLease({
        url: transport.url,
        canonicalUrl: transport.url,
        bytes: exactArrayBuffer(asset.entry.bytes),
        cache: this.ports.cache,
        resolveLoaderUrl: this.ports.resolveLoaderUrl,
        assertCurrent: () => this.assertTicketCurrent(ticket),
        loadFloor: this.ports.loadFloor,
      })
      this.assertTicketCurrent(ticket)
      if (!isVisibleInScene(info.root, this.ports.getScene())) {
        throw new PackageAssetLoadFailure(diagnostic(
          prepared.manifest.topology.canonicalUri,
          'SIDECAR_ASSET_NOT_LOADED',
          'BIND',
          'package model loader did not attach the asset root to the current scene',
          { assetId: manifestAsset.assetId, details: { requirement: 'SAME_THREE_SCENE' } },
        ))
      }
      const identityMismatch = loadedFloorIdentityMismatchField(info, manifestAsset.floor)
      const mismatchField = info.url !== transport.url ? 'url' : identityMismatch
      if (mismatchField !== null) {
        throw new PackageAssetLoadFailure(diagnostic(
          prepared.manifest.topology.canonicalUri,
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'BIND',
          'package model loader result does not match the authorized transport and floor identity',
          {
            assetId: manifestAsset.assetId,
            details: {
              field: mismatchField,
            },
          },
        ))
      }

      // modelTool retains this same FloorInfo object internally. Replacing its
      // private transport URL immediately prevents it from becoming an external
      // asset identity while preserving the modelTool key needed for unloadAll.
      info.url = manifestAsset.canonicalUri
      const loaded: TopologyLoadedAsset = {
        canonicalUri: manifestAsset.canonicalUri,
        root: info.root,
        selectionGeneration: ticket.generation,
      }
      const proof: TopologyAssetProof = {
        canonicalUri: manifestAsset.canonicalUri,
        root: info.root,
        selectionGeneration: ticket.generation,
        digest: { ...manifestAsset.digest },
        ...(asset.sidecarAsset.revision === undefined
          ? { provenance: 'SAME_RESPONSE_BYTES' as const }
          : {
              revision: asset.sidecarAsset.revision,
              provenance: 'IMMUTABLE_PACKAGE_REVISION' as const,
            }),
      }
      const sessionAsset: TopologyPackageSessionAsset = {
        assetId: manifestAsset.assetId,
        canonicalUri: manifestAsset.canonicalUri,
        floorName: manifestAsset.floor.floorName,
        building: manifestAsset.floor.building,
        level: manifestAsset.floor.level,
        floorType: manifestAsset.floor.floorType,
        root: info.root,
      }
      return Object.freeze({ loaded, proof, sessionAsset, transportKey: transport.key })
    } catch (error) {
      let retirementError: unknown | null = null
      if (info !== null) {
        try {
          await this.retirePackageTransport(transport.key, ticket)
        } catch (retirementFailure) {
          retirementError = retirementFailure
        }
      }
      if (retirementError !== null && !this.isTicketCurrent(ticket)) {
        // A newer ticket observes the registered rejection and owns fail-closed
        // cleanup. The stale ticket must never globally clear that newer state.
        // With no active successor (for example unmount), global cleanup is safe.
        if (this.active === null) this.cleanupResources()
        throw new StaleSelectionError()
      }
      if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
        throw new StaleSelectionError()
      }
      if (retirementError !== null) {
        throw new PackageAssetLoadFailure(diagnostic(
          prepared.manifest.topology.canonicalUri,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'LIFECYCLE',
          'a failed package asset could not be retired by its private transport key',
          {
            assetId: manifestAsset.assetId,
            details: { cause: safeErrorName(retirementError) },
          },
        ))
      }
      if (error instanceof PackageAssetLoadFailure) throw error
      throw new PackageAssetLoadFailure(diagnostic(
        prepared.manifest.topology.canonicalUri,
        'SIDECAR_ASSET_NOT_LOADED',
        'BIND',
        'package GLB bytes could not be loaded into a trustworthy scene root',
        {
          assetId: manifestAsset.assetId,
          details: { cause: safeErrorName(error) },
        },
      ))
    }
  }

  private async loadPackageAssetsV2(
    validated: ValidatedPackageArchiveV2,
    sessionId: string,
    ticket: SelectionTicket,
  ): Promise<readonly PackageAssetLoadOutcomeV2[]> {
    const assets = validated.archive.manifestDocument.assets
    const outcomes = new Array<PackageAssetLoadOutcomeV2>(assets.length)
    const concurrency = Math.min(
      3,
      Math.max(2, this.ports.assetConcurrency ?? DEFAULT_ASSET_CONCURRENCY),
    )
    let cursor = 0
    let firstFailure: PackageAssetLoadFailureV2 | null = null
    let stale = false

    const worker = async (): Promise<void> => {
      while (firstFailure === null) {
        if (!this.isTicketCurrent(ticket)) {
          stale = true
          return
        }
        const index = cursor++
        if (index >= assets.length) return
        try {
          outcomes[index] = await this.loadPackageAssetV2(
            validated,
            index,
            sessionId,
            ticket,
          )
        } catch (error) {
          if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
            stale = true
            return
          }
          const manifestAsset = assets[index]!
          firstFailure = error instanceof PackageAssetLoadFailureV2
            ? error
            : new PackageAssetLoadFailureV2(packageDiagnostic(
                'PACKAGE_FIELD_INVALID',
                'LIFECYCLE',
                `/assets/${index}`,
                { reason: 'asset-load', error: safeErrorName(error) },
                {
                  manifestUri: validated.archive.manifestDocument.manifestUri,
                  assetId: manifestAsset.assetId,
                },
              ))
          return
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, assets.length) },
      () => worker(),
    )
    await Promise.allSettled(workers)
    if (stale || !this.isTicketCurrent(ticket)) throw new StaleSelectionError()
    if (firstFailure !== null) throw firstFailure
    if (outcomes.some((outcome) => outcome === undefined)) {
      throw new PackageAssetLoadFailureV2(packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        '/assets',
        {
          reason: 'partial-scene',
          expected: assets.length,
          actual: outcomes.filter(Boolean).length,
        },
        { manifestUri: validated.archive.manifestDocument.manifestUri },
      ))
    }
    const roots = new Set(outcomes.map((outcome) => outcome.sessionAsset.root))
    if (roots.size !== outcomes.length) {
      throw new PackageAssetLoadFailureV2(packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        '/assets',
        { reason: 'duplicate-loaded-root', assets: outcomes.length, roots: roots.size },
        { manifestUri: validated.archive.manifestDocument.manifestUri },
      ))
    }
    return Object.freeze(outcomes)
  }

  private async loadPackageAssetV2(
    validated: ValidatedPackageArchiveV2,
    index: number,
    sessionId: string,
    ticket: SelectionTicket,
  ): Promise<PackageAssetLoadOutcomeV2> {
    this.assertTicketCurrent(ticket)
    const manifest = validated.archive.manifestDocument
    const manifestAsset = manifest.assets[index]!
    const entry = validated.archive.assets[index]!
    const metadata = validated.metadata[index]!
    const transport = packageTransportIdentity(
      manifest.manifestUri,
      sessionId,
      index,
      manifestAsset.digest.value,
    )
    let info: TopologyFloorInfo | null = null
    try {
      info = await loadFloorWithSynchronousCacheLease({
        url: transport.url,
        canonicalUrl: transport.url,
        bytes: exactArrayBuffer(entry.bytes),
        cache: this.ports.cache,
        resolveLoaderUrl: this.ports.resolveLoaderUrl,
        assertCurrent: () => this.assertTicketCurrent(ticket),
        loadFloor: this.ports.loadFloor,
      })
      this.assertTicketCurrent(ticket)
      if (!isVisibleInScene(info.root, this.ports.getScene())) {
        throw new PackageAssetLoadFailureV2(packageDiagnostic(
          'PACKAGE_FIELD_INVALID',
          'LIFECYCLE',
          `/assets/${index}`,
          { reason: 'root-not-attached-to-current-scene' },
          { manifestUri: manifest.manifestUri, assetId: manifestAsset.assetId },
        ))
      }
      const identityMismatch = loadedFloorIdentityMismatchField(info, manifestAsset.floor)
      const mismatchField = info.url !== transport.url ? 'url' : identityMismatch
      if (mismatchField !== null) {
        throw new PackageAssetLoadFailureV2(packageDiagnostic(
          'PACKAGE_FIELD_INVALID',
          'LIFECYCLE',
          `/assets/${index}`,
          {
            reason: 'loader-identity-mismatch',
            field: mismatchField,
          },
          { manifestUri: manifest.manifestUri, assetId: manifestAsset.assetId },
        ))
      }

      // modelTool keeps its private basename key separately. Public state and
      // proof retain only manifest identity; the transport URL is never emitted.
      info.url = manifestAsset.canonicalUri
      const resourceProof: PackageAssetResourceProofV2 = {
        assetId: manifestAsset.assetId,
        canonicalUri: manifestAsset.canonicalUri,
        digest: { ...manifestAsset.digest },
        packageRevision: manifest.revision,
        root: info.root,
        selectionGeneration: ticket.generation,
        provenance: 'SAME_RESPONSE_BYTES',
      }
      const publicMetadata: PackageMetadataProjectionV2 = {
        scene: { ...metadata.scene },
        nodes: metadata.nodes.map((node) => ({ ...node })),
      }
      const sessionAsset: TopologyAbsentPackageSessionAssetV2 = {
        assetId: manifestAsset.assetId,
        canonicalUri: manifestAsset.canonicalUri,
        floorName: manifestAsset.floor.floorName,
        building: manifestAsset.floor.building,
        level: manifestAsset.floor.level,
        floorType: manifestAsset.floor.floorType,
        root: info.root,
        metadata: publicMetadata,
        resourceProof,
      }
      return Object.freeze({ sessionAsset, transportKey: transport.key })
    } catch (error) {
      let retirementError: unknown | null = null
      if (info !== null) {
        try {
          await this.retirePackageTransport(transport.key, ticket)
        } catch (retirementFailure) {
          retirementError = retirementFailure
        }
      }
      if (retirementError !== null && !this.isTicketCurrent(ticket)) {
        if (this.active === null) this.cleanupResources()
        throw new StaleSelectionError()
      }
      if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
        throw new StaleSelectionError()
      }
      if (retirementError !== null) {
        throw new PackageAssetLoadFailureV2(packageDiagnostic(
          'PACKAGE_FIELD_INVALID',
          'LIFECYCLE',
          `/assets/${index}`,
          { reason: 'transport-retirement', error: safeErrorName(retirementError) },
          { manifestUri: manifest.manifestUri, assetId: manifestAsset.assetId },
        ))
      }
      if (error instanceof PackageAssetLoadFailureV2) throw error
      throw new PackageAssetLoadFailureV2(packageDiagnostic(
        'PACKAGE_FIELD_INVALID',
        'LIFECYCLE',
        `/assets/${index}`,
        { reason: 'asset-load', error: safeErrorName(error) },
        { manifestUri: manifest.manifestUri, assetId: manifestAsset.assetId },
      ))
    }
  }

  private async awaitPriorPackageRetirements(ticket: SelectionTicket): Promise<void> {
    const retirements = [...this.packageRetirements]
      .filter((entry) => entry.sourceGeneration < ticket.generation)
      .map((entry) => entry.promise)
    if (retirements.length > 0) await Promise.all(retirements)
    this.assertTicketCurrent(ticket)
  }

  private retirePackageTransport(
    transportKey: string,
    sourceTicket: SelectionTicket,
  ): Promise<void> {
    const promise = (async (): Promise<void> => {
      let waitedFor: SelectionTicket | null = null
      while (true) {
        const current = this.active
        if (
          current === null ||
          current.generation <= sourceTicket.generation ||
          current === waitedFor
        ) {
          break
        }
        waitedFor = current
        await current.modelLoadsSettled
      }
      try {
        // SSP's precise unload still advances its global load generation. The
        // current selection has no pending model load at this point.
        this.ports.unloadFloor(transportKey)
      } catch {
        throw new PackageTransportRetirementFailure()
      }
    })()
    const entry = { sourceGeneration: sourceTicket.generation, promise }
    this.packageRetirements.add(entry)
    void promise.then(
      () => this.packageRetirements.delete(entry),
      () => this.packageRetirements.delete(entry),
    )
    return promise
  }

  private publish(state: TopologySceneSessionStateInput): void {
    const nodes = Object.freeze(state.nodes.map((node) => Object.freeze({ ...node })))
    this.state = Object.freeze({
      status: state.status,
      graphId: state.graphId,
      nodes,
      diagnostic: state.diagnostic === null
        ? null
        : freezeDiagnostic(state.diagnostic),
      packageDiagnostic: state.packageDiagnostic == null
        ? null
        : freezePackageDiagnostic(state.packageDiagnostic),
      packageSession: state.packageSession == null
        ? null
        : freezePackageSession(state.packageSession),
    })
    this.onStateChange(this.state)
  }

  private ownsGeneration(ticket: SelectionTicket): boolean {
    return this.generation === ticket.generation
  }

  private isTicketCurrent(ticket: SelectionTicket): boolean {
    return (
      this.ownsGeneration(ticket) &&
      this.active === ticket &&
      !ticket.controller.signal.aborted
    )
  }

  private assertTicketCurrent(ticket: SelectionTicket): void {
    if (!this.isTicketCurrent(ticket)) throw new StaleSelectionError()
  }

  private cleanupResources(): Array<{ stage: string; error: unknown }> {
    const errors: Array<{ stage: string; error: unknown }> = []
    const stages: ReadonlyArray<readonly [string, () => unknown]> = [
      ['removeAllRoutes', () => this.ports.removeAllRoutes()],
      ['removeAllGraphs', () => this.ports.removeAllGraphs()],
      ['removeAllLegacyTopologies', () => this.ports.removeAllLegacyTopologies()],
      ['unloadAllModels', () => this.ports.unloadAllModels()],
    ]
    for (const [stage, run] of stages) {
      try {
        run()
      } catch (error) {
        errors.push({ stage, error })
      }
    }
    return errors
  }

  private async loadSelectionAssets(
    plan: TopologySelectionPlan,
    ticket: SelectionTicket,
  ): Promise<SelectionAssets> {
    const outcomes = new Array<SelectionAssetOutcome>(plan.assets.length)
    const concurrency = Math.min(4, Math.max(2, this.ports.assetConcurrency ?? DEFAULT_ASSET_CONCURRENCY))
    let cursor = 0
    let stale = false

    const worker = async (): Promise<void> => {
      while (true) {
        if (!this.isTicketCurrent(ticket)) {
          stale = true
          return
        }
        const index = cursor++
        if (index >= plan.assets.length) return
        const asset = plan.assets[index]!
        try {
          const result = await this.loadSelectionAsset(
            asset,
            plan.sidecarUri,
            plan.assets.length,
            ticket,
          )
          this.assertTicketCurrent(ticket)
          outcomes[index] = result
        } catch (error) {
          if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
            stale = true
            return
          }
          const canonicalUri = canonicalManifestAsset(asset, this.ports.origin, plan.sidecarUri)
          const proofFailure = proofFailureFromUnknown(plan.sidecarUri, canonicalUri, error)
          outcomes[index] = {
            loaded: null,
            proof: null,
            proofFailure,
            visualFailure: visualFailureDiagnostic(
              plan.sidecarUri,
              canonicalUri,
              plan.assets.length,
              proofFailure,
              error,
            ),
          }
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, plan.assets.length) },
      () => worker(),
    )
    await Promise.allSettled(workers)
    if (stale) throw new StaleSelectionError()
    this.assertTicketCurrent(ticket)
    if (outcomes.some((asset) => asset === undefined)) {
      throw new Error('asset worker completed without a selection outcome')
    }
    return {
      loadedAssets: outcomes.flatMap((outcome) => outcome.loaded === null ? [] : [outcome.loaded]),
      assetProofs: outcomes.flatMap((outcome) => outcome.proof === null ? [] : [outcome.proof]),
      visualFailures: outcomes.flatMap(
        (outcome) => outcome.visualFailure === null ? [] : [outcome.visualFailure],
      ),
      proofFailures: outcomes.flatMap(
        (outcome) => outcome.proofFailure === null ? [] : [outcome.proofFailure],
      ),
    }
  }

  private async loadSelectionAsset(
    record: ModelRecord,
    sidecarUri: string,
    selectedAssetCount: number,
    ticket: SelectionTicket,
  ): Promise<SelectionAssetOutcome> {
    this.assertTicketCurrent(ticket)
    const canonicalUri = canonicalManifestAsset(record, this.ports.origin, sidecarUri)
    const visualFallback = async (
      proofFailure: TopologySidecarDiagnostic,
    ): Promise<SelectionAssetOutcome> => {
      try {
        assertAuthorizedLoaderResolution(
          record.url,
          canonicalUri,
          this.ports.resolveLoaderUrl,
        )
        this.assertTicketCurrent(ticket)
        const info = await this.ports.loadFloor(record.url)
        this.assertTicketCurrent(ticket)
        if (!isVisibleInScene(info.root, this.ports.getScene())) {
          const rootFailure = diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_NOT_LOADED',
            'BIND',
            'ordinary model loader did not attach a valid root to the current THREE.Scene',
            { details: { requirement: 'SAME_THREE_SCENE' } },
          )
          return {
            loaded: null,
            proof: null,
            proofFailure,
            visualFailure: rootFailure,
          }
        }
        const loaded: TopologyLoadedAsset = {
          canonicalUri,
          root: info.root,
          selectionGeneration: ticket.generation,
        }
        if (info.url !== record.url) {
          return {
            loaded,
            proof: null,
            visualFailure: null,
            proofFailure: diagnostic(
              sidecarUri,
              'SIDECAR_ASSET_BINDING_MISMATCH',
              'BIND',
              'ordinary model loader result does not match the selected manifest asset',
              { details: { field: 'url' } },
            ),
          }
        }
        return {
          loaded,
          proof: null,
          visualFailure: null,
          proofFailure,
        }
      } catch (visualError) {
        if (!this.isTicketCurrent(ticket) || visualError instanceof StaleSelectionError) {
          throw new StaleSelectionError()
        }
        const effectiveProofFailure = visualError instanceof LoaderResolvedUrlMismatchError ||
          visualError instanceof SelectionFailure
          ? proofFailureFromUnknown(sidecarUri, canonicalUri, visualError)
          : proofFailure
        return {
          loaded: null,
          proof: null,
          proofFailure: effectiveProofFailure,
          visualFailure: visualFailureDiagnostic(
            sidecarUri,
            canonicalUri,
            selectedAssetCount,
            effectiveProofFailure,
            visualError,
          ),
        }
      }
    }

    let response: TopologyFetchResponse
    try {
      response = await this.ports.fetch(record.url, {
        signal: ticket.controller.signal,
        credentials: 'same-origin',
        redirect: 'error',
      })
      this.assertTicketCurrent(ticket)
    } catch (error) {
      if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
        throw new StaleSelectionError()
      }
      const proofFailure = proofFailureFromUnknown(sidecarUri, canonicalUri, error)
      return visualFallback(proofFailure)
    }

    if (response.redirected) {
      const error = new AssetAuthorizationError(
        diagnostic(
          sidecarUri,
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'BIND',
          'authorized manifest GLB request was redirected',
          { details: { redirected: true } },
        ),
        '模型资产请求发生未授权重定向',
      )
      return {
        loaded: null,
        proof: null,
        proofFailure: error.diagnostic,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          error.diagnostic,
          error,
        ),
      }
    }
    if (response.url !== '') {
      let responseUri: string
      try {
        responseUri = new URL(response.url, this.ports.origin).href
      } catch {
        responseUri = ''
      }
      if (responseUri !== canonicalUri) {
        const error = new AssetAuthorizationError(
          diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_BINDING_MISMATCH',
            'BIND',
            'authorized manifest GLB response URL does not match the requested asset',
            {
              details: {
                requirement: 'RESPONSE_URL_MATCH',
                expectedAssetUri: redactedUri(canonicalUri),
                responseAssetUri: redactedUri(responseUri),
              },
            },
          ),
          '模型资产响应与当前选择不一致',
        )
        return {
          loaded: null,
          proof: null,
          proofFailure: error.diagnostic,
          visualFailure: visualFailureDiagnostic(
            sidecarUri,
            canonicalUri,
            selectedAssetCount,
            error.diagnostic,
            error,
          ),
        }
      }
    }
    if (!response.ok) {
      const proofFailure = diagnostic(
        sidecarUri,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        'authorized manifest GLB response is unavailable for SAME_RESPONSE_BYTES proof',
        { details: { status: response.status } },
      )
      return visualFallback(proofFailure)
    }

    let bytes: ArrayBuffer
    try {
      bytes = await response.arrayBuffer()
      this.assertTicketCurrent(ticket)
    } catch (error) {
      if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
        throw new StaleSelectionError()
      }
      const proofFailure = proofFailureFromUnknown(sidecarUri, canonicalUri, error)
      return visualFallback(proofFailure)
    }

    let loadPromise: Promise<TopologyFloorInfo>
    try {
      loadPromise = loadFloorWithSynchronousCacheLease({
        url: record.url,
        canonicalUrl: canonicalUri,
        bytes,
        cache: this.ports.cache,
        resolveLoaderUrl: this.ports.resolveLoaderUrl,
        assertCurrent: () => this.assertTicketCurrent(ticket),
        loadFloor: this.ports.loadFloor,
      })
    } catch (error) {
      const proofFailure = proofFailureFromUnknown(sidecarUri, canonicalUri, error)
      return {
        loaded: null,
        proof: null,
        proofFailure,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          proofFailure,
          error,
        ),
      }
    }

    const proofPromise = this.proveAssetBytes(bytes, sidecarUri, canonicalUri, ticket)
    const [loadResult, proofResult] = await Promise.allSettled([loadPromise, proofPromise])
    this.assertTicketCurrent(ticket)
    if (loadResult.status === 'rejected') {
      const proofFailure = proofResult.status === 'rejected'
        ? proofFailureFromUnknown(sidecarUri, canonicalUri, proofResult.reason)
        : diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
            'BIND',
            'the GLB response bytes could not be parsed into a visible asset root',
            { details: { cause: safeErrorName(loadResult.reason) } },
          )
      return {
        loaded: null,
        proof: null,
        proofFailure,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          proofFailure,
          loadResult.reason,
        ),
      }
    }

    const info = loadResult.value
    if (!isVisibleInScene(info.root, this.ports.getScene())) {
      const proofFailure = proofResult.status === 'rejected'
        ? proofFailureFromUnknown(sidecarUri, canonicalUri, proofResult.reason)
        : diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
            'BIND',
            'model loader did not attach a valid root to the current THREE.Scene',
            { details: { requirement: 'SAME_THREE_SCENE' } },
          )
      return {
        loaded: null,
        proof: null,
        proofFailure,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          proofFailure,
          new Error('DetachedModelRoot'),
        ),
      }
    }

    const loaded: TopologyLoadedAsset = {
      canonicalUri,
      root: info.root,
      selectionGeneration: ticket.generation,
    }
    if (info.url !== record.url) {
      const error = new AssetAuthorizationError(
        diagnostic(
          sidecarUri,
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'BIND',
          'model loader result does not match the exact authorized manifest URL',
          { details: { field: info.url !== record.url ? 'url' : 'root' } },
        ),
        '模型加载结果与当前选择不一致',
      )
      return {
        loaded,
        proof: null,
        proofFailure: error.diagnostic,
        visualFailure: null,
      }
    }
    if (proofResult.status === 'rejected') {
      return {
        loaded,
        proof: null,
        visualFailure: null,
        proofFailure: proofFailureFromUnknown(sidecarUri, canonicalUri, proofResult.reason),
      }
    }
    return {
      loaded,
      proof: {
        canonicalUri,
        root: info.root,
        selectionGeneration: ticket.generation,
        digest: { algorithm: 'SHA-256', value: proofResult.value },
        provenance: 'SAME_RESPONSE_BYTES',
      },
      visualFailure: null,
      proofFailure: null,
    }
  }

  private async proveAssetBytes(
    bytes: ArrayBuffer,
    sidecarUri: string,
    canonicalUri: string,
    ticket: SelectionTicket,
  ): Promise<string> {
    assertSelfContainedGlb(bytes, sidecarUri, canonicalUri)
    this.assertTicketCurrent(ticket)
    let digestValue: string
    try {
      digestValue = await this.ports.digestSha256(bytes)
    } catch (error) {
      failSelection(
        sidecarUri,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        'WebCrypto SHA-256 proof could not be produced',
        '当前环境无法生成可信模型摘要',
        { details: { cause: safeErrorName(error) } },
      )
    }
    this.assertTicketCurrent(ticket)
    if (!/^[0-9a-f]{64}$/.test(digestValue)) {
      failSelection(
        sidecarUri,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        'SHA-256 implementation returned a non-canonical digest',
        '模型摘要格式无效',
      )
    }
    return digestValue
  }

  private async loadSidecar(
    sidecarUri: string,
    ticket: SelectionTicket,
  ): Promise<
    | { kind: 'ok'; text: string }
    | { kind: 'unavailable'; diagnostic: TopologySidecarDiagnostic }
    | { kind: 'error'; diagnostic: TopologySidecarDiagnostic }
    | { kind: 'stale' }
  > {
    try {
      this.assertTicketCurrent(ticket)
      const response = await this.ports.fetch(sidecarUri, {
        signal: ticket.controller.signal,
        credentials: 'same-origin',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      })
      this.assertTicketCurrent(ticket)
      if (response.status === 404 && !response.redirected) {
        return {
          kind: 'unavailable',
          diagnostic: diagnostic(
            sidecarUri,
            'SIDECAR_NOT_FOUND',
            'DISCOVER',
            'current model selection has no topology.v1.json sidecar',
          ),
        }
      }
      if (
        !response.ok ||
        response.redirected ||
        (response.url !== '' && new URL(response.url, this.ports.origin).href !== sidecarUri)
      ) {
        return {
          kind: 'error',
          diagnostic: diagnostic(
            sidecarUri,
            'SIDECAR_FIELD_INVALID',
            'DISCOVER',
            'topology sidecar request failed or redirected',
            { details: { status: response.status, redirected: response.redirected } },
          ),
        }
      }
      const text = await response.text()
      this.assertTicketCurrent(ticket)
      return { kind: 'ok', text }
    } catch (error) {
      if (!this.ownsGeneration(ticket) || error instanceof StaleSelectionError) return { kind: 'stale' }
      return {
        kind: 'error',
        diagnostic: diagnostic(
          sidecarUri,
          'SIDECAR_FIELD_INVALID',
          'DISCOVER',
          'topology sidecar could not be read',
          { details: { cause: safeErrorName(error) } },
        ),
      }
    }
  }

  private commitGraph(
    input: TopologyGraphInput,
    sidecarUri: string,
    ticket: SelectionTicket,
  ):
    | { kind: 'ready'; snapshot: TopologyGraphSnapshot }
    | { kind: 'error'; diagnostic: TopologySidecarDiagnostic }
    | { kind: 'stale' } {
    if (!this.isTicketCurrent(ticket)) return { kind: 'stale' }
    let snapshot: TopologyGraphSnapshot
    try {
      snapshot = this.ports.createGraph(input)
    } catch (error) {
      const compensation = this.compensateGraphs([input.id ?? ''])
      if (!this.ownsGeneration(ticket)) return { kind: 'stale' }
      return {
        kind: 'error',
        diagnostic: diagnostic(
          sidecarUri,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'COMMIT',
          'topology graph commit failed',
          {
            details: {
              ...safeCaughtErrorDetails(error),
              compensationFailed: compensation.failed,
              compensationFallbackUsed: compensation.fallbackUsed,
            },
          },
        ),
      }
    }

    if (!this.isTicketCurrent(ticket)) {
      this.compensateGraphs([input.id ?? ''])
      return { kind: 'stale' }
    }
    const actualId = typeof snapshot?.id === 'string'
      ? snapshot.id.slice(0, SAFE_ERROR_STRING_LENGTH)
      : null
    const actualSchemaVersion = typeof snapshot?.schemaVersion === 'number' &&
      Number.isFinite(snapshot.schemaVersion)
      ? snapshot.schemaVersion
      : null
    if (actualId !== input.id || actualSchemaVersion !== 2) {
      const compensation = this.compensateGraphs([input.id ?? ''])
      return {
        kind: 'error',
        diagnostic: diagnostic(
          sidecarUri,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'COMMIT',
          'topology graph snapshot does not match the compiled commit contract',
          {
            details: {
              expectedId: input.id ?? null,
              actualId,
              expectedSchemaVersion: 2,
              actualSchemaVersion,
              compensationFailed: compensation.failed,
              compensationFallbackUsed: compensation.fallbackUsed,
            },
          },
        ),
      }
    }
    return { kind: 'ready', snapshot }
  }

  private compensateGraphs(ids: readonly string[]): { failed: boolean; fallbackUsed: boolean } {
    const uniqueIds = [...new Set(ids.filter((candidate) => candidate.length > 0))]
    let preciseFailed = false
    for (const id of uniqueIds) {
      try {
        // createGraph can throw after mutating its manager. Always issue the
        // precise id-scoped removal, then verify that no committed graph remains.
        this.ports.removeGraph(id)
        if (this.ports.getGraph(id) !== null) preciseFailed = true
      } catch {
        preciseFailed = true
      }
    }
    if (!preciseFailed) return { failed: false, fallbackUsed: false }

    // The exact removal is the primary contract. If its port fails, fail closed
    // while still in the same synchronous commit stack: no newer generation can
    // have reached its own commit yet, so clearing routes/graphs cannot erase a
    // subsequently committed session.
    let fallbackFailed = false
    try {
      this.ports.removeAllRoutes()
    } catch {
      fallbackFailed = true
    }
    try {
      this.ports.removeAllGraphs()
    } catch {
      fallbackFailed = true
    }
    for (const id of uniqueIds) {
      try {
        if (this.ports.getGraph(id) !== null) fallbackFailed = true
      } catch {
        fallbackFailed = true
      }
    }
    return { failed: fallbackFailed, fallbackUsed: true }
  }
}

export function createTopologySceneLifecycle(
  ports: Omit<TopologySceneLifecyclePorts, 'compileSidecar'> & {
    compileSidecar?: TopologySceneLifecyclePorts['compileSidecar']
  },
  onStateChange?: (state: TopologySceneSessionSnapshot) => void,
): TopologySceneLifecycle {
  return new TopologySceneLifecycle(
    { ...ports, compileSidecar: ports.compileSidecar ?? compileTopologySidecarV1 },
    onStateChange,
  )
}
